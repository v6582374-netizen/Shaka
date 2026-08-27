// One-shot, supervised P0 G1 VLA physical canary.
//
// This is deliberately *not* an unattended controller.  It exists to close
// the first real VLA -> G1 loop with a bounded experiment after a human has
// made the physical environment safe.  It publishes only to rt/arm_sdk, uses
// one VLA wrist output only as a direction bit, moves at most 0.01 rad, keeps
// all other arm joints at their entry positions, never drives either hand, and
// releases authority immediately after the one attempt.

#include <algorithm>
#include <boost/property_tree/json_parser.hpp>
#include <boost/property_tree/ptree.hpp>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

#include <unitree/idl/hg/LowCmd_.hpp>
#include <unitree/idl/hg/LowState_.hpp>
#include <unitree/robot/channel/channel_factory.hpp>
#include <unitree/robot/channel/channel_publisher.hpp>
#include <unitree/robot/channel/channel_subscriber.hpp>

namespace {

using LowCmd = unitree_hg::msg::dds_::LowCmd_;
using LowState = unitree_hg::msg::dds_::LowState_;

constexpr char kProtocol[] = "shaka.g1-vla-supervised-canary.v1";
constexpr char kPackageKind[] = "g1_vla_supervised_canary_package";
constexpr char kArmSdkTopic[] = "rt/arm_sdk";
constexpr char kLowStateTopic[] = "rt/lowstate";
constexpr int kMotorCount = 29;
constexpr int kWeightIndex = 29;
constexpr int kFirstUpperIndex = 12;
constexpr int kLastUpperIndex = 28;
constexpr int kActiveArmIndex = 6;
constexpr int kActiveMotorIndex = 15 + kActiveArmIndex;
constexpr double kMaximumDeltaRad = 0.01;
constexpr int kCommandPeriodMs = 20;
constexpr int kPrefillTicks = 50;
constexpr int kActiveTicks = 15;
constexpr int kReleaseTicks = 50;
constexpr auto kMaximumStateAge = std::chrono::milliseconds(100);

struct Args {
  std::string network;
  std::string package;
  std::string run_directory;
  std::string authorization;
  bool execute = false;
};

struct Package {
  std::string digest;
  std::string plan_path;
  std::string plan_digest;
  double vla_target_rad = 0.0;
};

struct Snapshot {
  LowState state{};
  std::chrono::steady_clock::time_point received_at{};
  uint64_t sequence = 0;
};

[[noreturn]] void Reject(const std::string& reason) { throw std::runtime_error(reason); }

uint32_t Crc32Core(const uint32_t* ptr, uint32_t len) {
  uint32_t crc = 0xFFFFFFFFU;
  constexpr uint32_t polynomial = 0x04C11DB7U;
  for (uint32_t index = 0; index < len; ++index) {
    uint32_t xbit = 1U << 31;
    const uint32_t word = ptr[index];
    for (int bit = 0; bit < 32; ++bit) {
      crc = (crc & (1U << 31)) ? ((crc << 1) ^ polynomial) : (crc << 1);
      if (word & xbit) crc ^= polynomial;
      xbit >>= 1;
    }
  }
  return crc;
}

bool CrcIsValid(const LowState& state) {
  return state.crc() == Crc32Core(reinterpret_cast<const uint32_t*>(&state),
                                  (sizeof(LowState) >> 2) - 1);
}

class StateMonitor {
 public:
  void OnState(const void* raw) {
    const auto* incoming = static_cast<const LowState*>(raw);
    std::lock_guard<std::mutex> lock(mutex_);
    if (incoming == nullptr || !CrcIsValid(*incoming)) {
      ++invalid_samples_;
      return;
    }
    std::memcpy(&latest_.state, incoming, sizeof(LowState));
    latest_.received_at = std::chrono::steady_clock::now();
    latest_.sequence = ++valid_samples_;
  }

  Snapshot Fresh() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (latest_.sequence == 0) Reject("no CRC-valid G1 lowstate sample received");
    if (std::chrono::steady_clock::now() - latest_.received_at > kMaximumStateAge) {
      Reject("G1 lowstate feedback is stale");
    }
    return latest_;
  }

  uint64_t valid_samples() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return valid_samples_;
  }

  uint64_t invalid_samples() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return invalid_samples_;
  }

 private:
  mutable std::mutex mutex_;
  Snapshot latest_{};
  uint64_t valid_samples_ = 0;
  uint64_t invalid_samples_ = 0;
};

class ArmSdkActivityMonitor {
 public:
  void OnArmSdk(const void*) {
    std::lock_guard<std::mutex> lock(mutex_);
    ++samples_;
  }
  uint64_t samples() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return samples_;
  }
 private:
  mutable std::mutex mutex_;
  uint64_t samples_ = 0;
};

std::string Sha256(const std::string& path) {
  int descriptors[2]{};
  if (pipe(descriptors) != 0) Reject("could not create SHA-256 pipe");
  const pid_t pid = fork();
  if (pid < 0) {
    close(descriptors[0]);
    close(descriptors[1]);
    Reject("could not start SHA-256 utility");
  }
  if (pid == 0) {
    dup2(descriptors[1], STDOUT_FILENO);
    close(descriptors[0]);
    close(descriptors[1]);
    execl("/usr/bin/sha256sum", "sha256sum", "--", path.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  close(descriptors[1]);
  std::string output;
  char buffer[128]{};
  ssize_t count = 0;
  while ((count = read(descriptors[0], buffer, sizeof(buffer))) > 0) {
    output.append(buffer, static_cast<size_t>(count));
  }
  close(descriptors[0]);
  int status = 0;
  if (waitpid(pid, &status, 0) != pid || !WIFEXITED(status) || WEXITSTATUS(status) != 0 || output.size() < 65) {
    Reject("could not compute artifact SHA-256");
  }
  const std::string digest = output.substr(0, 64);
  if (digest.find_first_not_of("0123456789abcdef") != std::string::npos) {
    Reject("SHA-256 utility returned an invalid digest");
  }
  return digest;
}

boost::property_tree::ptree ReadJson(const std::string& path, const std::string& description) {
  boost::property_tree::ptree value;
  try {
    boost::property_tree::read_json(path, value);
  } catch (const std::exception& error) {
    Reject(description + " is unreadable: " + error.what());
  }
  return value;
}

std::string RequireString(const boost::property_tree::ptree& value, const std::string& key) {
  const auto field = value.get_optional<std::string>(key);
  if (!field || field->empty()) Reject("package field is absent: " + key);
  return *field;
}

Package LoadPackage(const std::string& package_path) {
  Package package;
  package.digest = Sha256(package_path);
  const auto value = ReadJson(package_path, "P0 canary package");
  if (value.get<int>("schema_version", 0) != 1 ||
      value.get<std::string>("kind", "") != kPackageKind ||
      value.get<std::string>("protocol", "") != kProtocol ||
      value.get<std::string>("execution_mode", "") != "supervised-p0-review-only" ||
      value.get<bool>("physical_execution_authorized", true)) {
    Reject("P0 canary package has an unsupported or armed identity");
  }
  const auto& source = value.get_child("source");
  const auto& action_plan = source.get_child("action_plan");
  package.plan_path = RequireString(action_plan, "path");
  package.plan_digest = RequireString(action_plan, "sha256");
  if (Sha256(package.plan_path) != package.plan_digest) {
    Reject("P0 action plan no longer matches the package digest");
  }
  const auto& canary = value.get_child("canary");
  if (canary.get<int>("active_arm_index", -1) != kActiveArmIndex ||
      canary.get<std::string>("active_joint", "") != "left_wrist_yaw_joint" ||
      std::abs(canary.get<double>("maximum_delta_rad", 0.0) - kMaximumDeltaRad) > 1e-12 ||
      canary.get<int>("active_ticks", 0) != kActiveTicks ||
      canary.get<int>("release_ticks", 0) != kReleaseTicks ||
      canary.get<std::string>("hands", "") != "disabled" ||
      canary.get<std::string>("retry", "") != "forbidden") {
    Reject("P0 canary package attempts to enlarge its immutable motion envelope");
  }
  package.vla_target_rad = canary.get<double>("vla_proposed_absolute_target_rad", std::numeric_limits<double>::quiet_NaN());
  if (!std::isfinite(package.vla_target_rad)) Reject("P0 canary has no finite VLA target");

  const auto plan = ReadJson(package.plan_path, "P0 action plan");
  if (plan.get<int>("schema_version", 0) != 1 ||
      plan.get<std::string>("kind", "") != "unifolm_vla_action_plan_evidence" ||
      plan.get<std::string>("execution_mode", "") != "zero-write" ||
      plan.get<int>("command_publishers_created", -1) != 0 || plan.get<int>("writes", -1) != 0) {
    Reject("P0 source is not a zero-write VLA action plan");
  }
  const auto& trajectory = plan.get_child("trajectory");
  const auto row = trajectory.begin();
  if (row == trajectory.end()) Reject("P0 action plan has no VLA trajectory");
  int index = 0;
  double selected = std::numeric_limits<double>::quiet_NaN();
  for (const auto& item : row->second) {
    if (index == kActiveArmIndex) selected = item.second.get_value<double>();
    ++index;
  }
  if (index != 26 || !std::isfinite(selected) || std::abs(selected - package.vla_target_rad) > 1e-9) {
    Reject("P0 action plan does not match its selected VLA wrist target");
  }
  return package;
}

void ValidateFiniteStationary(const LowState& state) {
  if (state.motor_state().size() < kMotorCount || state.imu_state().gyroscope().size() != 3) {
    Reject("lowstate is incomplete");
  }
  double leg_speed = 0.0;
  double upper_speed = 0.0;
  double gyro = 0.0;
  for (int index = 0; index < kMotorCount; ++index) {
    const auto& motor = state.motor_state().at(index);
    if (!std::isfinite(motor.q()) || !std::isfinite(motor.dq()) || !std::isfinite(motor.tau_est())) {
      Reject("lowstate contains non-finite motor feedback");
    }
    if (index < 12) leg_speed = std::max(leg_speed, std::abs(static_cast<double>(motor.dq())));
    else upper_speed = std::max(upper_speed, std::abs(static_cast<double>(motor.dq())));
  }
  for (const double value : state.imu_state().gyroscope()) {
    if (!std::isfinite(value)) Reject("lowstate contains non-finite gyro feedback");
    gyro = std::max(gyro, std::abs(value));
  }
  if (leg_speed > 0.12) Reject("stationary preflight rejected: leg speed exceeds 0.12 rad/s");
  if (upper_speed > 0.08) Reject("stationary preflight rejected: upper-body speed exceeds 0.08 rad/s");
  if (gyro > 0.15) Reject("stationary preflight rejected: body angular speed exceeds 0.15 rad/s");
}

void RequireStationary(StateMonitor& monitor) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(1500);
  uint64_t previous = 0;
  int accepted = 0;
  while (std::chrono::steady_clock::now() < deadline) {
    const Snapshot snapshot = monitor.Fresh();
    if (snapshot.sequence != previous) {
      ValidateFiniteStationary(snapshot.state);
      previous = snapshot.sequence;
      ++accepted;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(4));
  }
  if (accepted < 50) Reject("stationary preflight received fewer than 50 fresh feedback samples");
}

void ValidateRunning(const LowState& current, const LowState& entry, double commanded_target) {
  ValidateFiniteStationary(current);
  const auto& motor = current.motor_state().at(kActiveMotorIndex);
  const double dynamic_torque = std::abs(static_cast<double>(motor.tau_est()) -
                                         static_cast<double>(entry.motor_state().at(kActiveMotorIndex).tau_est()));
  if (dynamic_torque > 3.0) Reject("P0 running guard rejected: wrist torque changed by more than 3 N m");
  if (std::abs(static_cast<double>(motor.q()) - commanded_target) > 0.04) {
    Reject("P0 running guard rejected: wrist tracking error exceeds 0.04 rad");
  }
}

void FillCommand(LowCmd* command, const LowState& current, const LowState& entry,
                 double active_target, double weight) {
  *command = LowCmd{};
  command->mode_pr() = current.mode_pr();
  command->mode_machine() = current.mode_machine();
  if (command->motor_cmd().size() <= kWeightIndex) Reject("arm SDK command has no authority-weight slot");
  for (int index = 0; index < kMotorCount; ++index) {
    auto& out = command->motor_cmd().at(index);
    const auto& measured = current.motor_state().at(index);
    out.mode() = 1;
    out.q() = measured.q();
    out.dq() = 0.0F;
    out.tau() = 0.0F;
    out.kp() = 0.0F;
    out.kd() = 0.0F;
  }
  for (int index = kFirstUpperIndex; index <= kLastUpperIndex; ++index) {
    auto& out = command->motor_cmd().at(index);
    const auto& measured = current.motor_state().at(index);
    out.q() = entry.motor_state().at(index).q();
    out.dq() = 0.0F;
    out.tau() = measured.tau_est();
    out.kp() = 60.0F;
    out.kd() = 1.5F;
  }
  command->motor_cmd().at(kActiveMotorIndex).q() = static_cast<float>(active_target);
  for (int index = kMotorCount; index < static_cast<int>(command->motor_cmd().size()); ++index) {
    auto& out = command->motor_cmd().at(index);
    out.mode() = 0;
    out.q() = out.dq() = out.tau() = out.kp() = out.kd() = 0.0F;
  }
  command->motor_cmd().at(kWeightIndex).q() = static_cast<float>(weight);
  command->crc() = Crc32Core(reinterpret_cast<const uint32_t*>(command),
                              (sizeof(LowCmd) >> 2) - 1);
}

bool ConsumeAuthorization(const Args& args, const Package& package) {
  if (args.authorization != package.digest) Reject("authorization must equal the immutable package SHA-256");
  const std::string marker = args.run_directory + "/supervised-p0-" + package.digest + ".consumed";
  const int descriptor = open(marker.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (descriptor < 0) return false;
  const std::string receipt = package.digest + "\n" + package.plan_digest + "\n";
  const bool complete = write(descriptor, receipt.data(), receipt.size()) == static_cast<ssize_t>(receipt.size());
  close(descriptor);
  if (!complete) Reject("could not persist the P0 one-time authorization receipt");
  return true;
}

void RecordStage(const Args& args, const Package& package, const char* stage, uint64_t writes) noexcept {
  const std::string path = args.run_directory + "/supervised-p0-" + package.digest + ".events.jsonl";
  const int descriptor = open(path.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (descriptor < 0) return;
  const std::string event = std::string("{\"stage\":\"") + stage + "\",\"package_sha256\":\"" +
                            package.digest + "\",\"arm_writes\":" + std::to_string(writes) + "}\n";
  (void)write(descriptor, event.data(), event.size());
  (void)fsync(descriptor);
  close(descriptor);
}

Args ParseArgs(int argc, char** argv) {
  Args args;
  for (int index = 1; index < argc; ++index) {
    const std::string item = argv[index];
    const auto next = [&]() {
      if (++index >= argc) Reject("missing value after " + item);
      return std::string(argv[index]);
    };
    if (item == "--network-interface") args.network = next();
    else if (item == "--package") args.package = next();
    else if (item == "--run-directory") args.run_directory = next();
    else if (item == "--authorization") args.authorization = next();
    else if (item == "--execute") args.execute = true;
    else Reject("unknown argument: " + item);
  }
  if (args.network.empty() || args.package.empty() || args.run_directory.empty()) {
    Reject("--network-interface, --package, and --run-directory are required");
  }
  if (args.execute != !args.authorization.empty()) {
    Reject("--authorization is required exactly with --execute");
  }
  return args;
}

void PrintResult(const std::string& result, const std::string& reason, const Package* package,
                 uint64_t writes, const StateMonitor& monitor) {
  std::cout << "{\"result\":\"" << result << "\",\"reason\":\"" << reason
            << "\",\"package_sha256\":\"" << (package == nullptr ? "" : package->digest)
            << "\",\"arm_writes\":" << writes << ",\"hand_writes\":0"
            << ",\"valid_state_samples\":" << monitor.valid_samples()
            << ",\"invalid_state_samples\":" << monitor.invalid_samples() << "}" << std::endl;
}

int Run(const Args& args) {
  const Package package = LoadPackage(args.package);
  StateMonitor monitor;
  ArmSdkActivityMonitor activity;
  unitree::robot::ChannelFactory::Instance()->Init(0, args.network);
  auto state_subscriber = std::make_shared<unitree::robot::ChannelSubscriber<LowState>>(kLowStateTopic);
  state_subscriber->InitChannel([&monitor](const void* message) { monitor.OnState(message); }, 1);
  auto arm_subscriber = std::make_shared<unitree::robot::ChannelSubscriber<LowCmd>>(kArmSdkTopic);
  arm_subscriber->InitChannel([&activity](const void* message) { activity.OnArmSdk(message); }, 1);
  std::this_thread::sleep_for(std::chrono::milliseconds(1500));
  RequireStationary(monitor);
  const Snapshot entry = monitor.Fresh();
  if (activity.samples() != 0) Reject("rt/arm_sdk is already active; authority is not idle");
  const double residual = package.vla_target_rad - entry.state.motor_state().at(kActiveMotorIndex).q();
  if (std::abs(residual) < 1e-4) Reject("VLA wrist target is indistinguishable from the measured entry pose");
  const double final_target = entry.state.motor_state().at(kActiveMotorIndex).q() +
                              std::copysign(kMaximumDeltaRad, residual);
  if (!args.execute) {
    PrintResult("g1_vla_supervised_p0_dry_run_ok", "no command publisher was created", &package, 0, monitor);
    return 0;
  }
  ValidateFiniteStationary(monitor.Fresh().state);
  if (activity.samples() != 0) Reject("rt/arm_sdk became active during the final execution gate");
  if (!ConsumeAuthorization(args, package)) Reject("this immutable P0 package was already consumed");
  RecordStage(args, package, "authorization_consumed", 0);

  auto publisher = std::make_shared<unitree::robot::ChannelPublisher<LowCmd>>(kArmSdkTopic);
  publisher->InitChannel();
  uint64_t writes = 0;
  RecordStage(args, package, "publisher_created", writes);
  const auto started = std::chrono::steady_clock::now();
  auto publish = [&](double target, double weight) {
    const Snapshot current = monitor.Fresh();
    LowCmd command{};
    FillCommand(&command, current.state, entry.state, target, weight);
    if (!publisher->Write(command)) Reject("rt/arm_sdk has no matched humanoid subscriber");
    ++writes;
  };
  try {
    for (int tick = 0; tick < kPrefillTicks; ++tick) {
      std::this_thread::sleep_until(started + std::chrono::milliseconds(tick * kCommandPeriodMs));
      ValidateFiniteStationary(monitor.Fresh().state);
      publish(entry.state.motor_state().at(kActiveMotorIndex).q(), 0.0);
    }
    for (int tick = 0; tick < kActiveTicks; ++tick) {
      if (tick == 0) RecordStage(args, package, "active_motion_started", writes);
      std::this_thread::sleep_until(started + std::chrono::milliseconds((kPrefillTicks + tick) * kCommandPeriodMs));
      const double blend = static_cast<double>(tick + 1) / kActiveTicks;
      const double target = entry.state.motor_state().at(kActiveMotorIndex).q() * (1.0 - blend) + final_target * blend;
      ValidateRunning(monitor.Fresh().state, entry.state, target);
      publish(target, 1.0);
    }
  } catch (...) {
    RecordStage(args, package, "abort_release_started", writes);
    // The same unconditional release below is used for an exception path.
    for (int tick = 0; tick < kReleaseTicks; ++tick) {
      try { publish(entry.state.motor_state().at(kActiveMotorIndex).q(), 1.0 - static_cast<double>(tick + 1) / kReleaseTicks); }
      catch (...) { break; }
      std::this_thread::sleep_for(std::chrono::milliseconds(kCommandPeriodMs));
    }
    RecordStage(args, package, "abort_release_finished", writes);
    throw;
  }
  RecordStage(args, package, "normal_release_started", writes);
  for (int tick = 0; tick < kReleaseTicks; ++tick) {
    publish(entry.state.motor_state().at(kActiveMotorIndex).q(), 1.0 - static_cast<double>(tick + 1) / kReleaseTicks);
    std::this_thread::sleep_for(std::chrono::milliseconds(kCommandPeriodMs));
  }
  RecordStage(args, package, "normal_release_finished", writes);
  PrintResult("g1_vla_supervised_p0_completed", "one bounded wrist-direction canary released authority", &package, writes, monitor);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  StateMonitor empty_monitor;
  try {
    return Run(ParseArgs(argc, argv));
  } catch (const std::exception& error) {
    PrintResult("g1_vla_supervised_p0_rejected", error.what(), nullptr, 0, empty_monitor);
    return 2;
  }
}
