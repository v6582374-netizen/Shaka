// One-time, zero-displacement G1 arm_sdk commissioning pulse.
//
// This is intentionally a narrow physical-canary executable.  It has no VLA,
// network client, hand command, or rt/lowcmd publisher.  It talks only to the
// existing humanoid subscriber through rt/arm_sdk and refuses to publish until
// a sustained stationary-feedback preflight passes.  A consumed marker makes
// the physical authorization single-use.

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unistd.h>

#include <unitree/idl/hg/LowCmd_.hpp>
#include <unitree/idl/hg/LowState_.hpp>
#include <unitree/robot/channel/channel_publisher.hpp>
#include <unitree/robot/channel/channel_subscriber.hpp>

namespace {

using LowCmd = unitree_hg::msg::dds_::LowCmd_;
using LowState = unitree_hg::msg::dds_::LowState_;

constexpr std::string_view kArmSdkTopic = "rt/arm_sdk";
constexpr std::string_view kLowStateTopic = "rt/lowstate";
constexpr std::string_view kAuthorization = "G1-ARM-SDK-ZERO-HOLD-V5-20260827";
constexpr std::string_view kDefaultInterface = "enp0s31f6";
constexpr std::string_view kDefaultRunDirectory = "/home/unitree/shaka-g1-zero-hold-v5";

constexpr int kMotorCount = 29;
constexpr int kWeightIndex = 29;
constexpr int kFirstLegIndex = 0;
constexpr int kLastLegIndex = 11;
constexpr int kFirstUpperIndex = 12;
constexpr int kLastUpperIndex = 28;
constexpr double kControlHz = 50.0;
constexpr auto kControlPeriod = std::chrono::milliseconds(20);
constexpr auto kMaximumStateAge = std::chrono::milliseconds(100);
constexpr auto kStationaryWindow = std::chrono::milliseconds(1500);
constexpr int kMinimumStationarySamples = 50;
constexpr int kPrefillFrames = 50;
constexpr int kEnabledFrames = 1;
constexpr int kReleaseFrames = 150;
constexpr int kZeroTailFrames = 25;
constexpr double kPositionKp = 60.0;
constexpr double kVelocityKd = 1.5;
constexpr double kMaximumMatchedTorqueNm = 4.0;
constexpr double kMaximumInitialLegSpeedRadS = 0.12;
constexpr double kMaximumInitialUpperSpeedRadS = 0.08;
constexpr double kMaximumRunningLegSpeedRadS = 0.20;
constexpr double kMaximumRunningUpperSpeedRadS = 0.12;
constexpr double kMaximumAngularSpeedRadS = 0.15;
constexpr double kMaximumUpperDriftRad = 0.03;

struct Arguments {
  std::string interface = std::string(kDefaultInterface);
  std::string authorization;
  std::string run_directory = std::string(kDefaultRunDirectory);
  bool execute = false;
};

struct Snapshot {
  LowState state{};
  std::chrono::steady_clock::time_point received_at{};
  uint64_t sequence = 0;
};

struct Result {
  std::string result;
  std::string reason;
  bool execute = false;
  bool authorization_consumed = false;
  uint64_t valid_state_samples = 0;
  uint64_t invalid_state_samples = 0;
  uint64_t foreign_arm_sdk_samples = 0;
  uint64_t writes = 0;
  double last_weight = 0.0;
};

[[noreturn]] void Reject(const std::string& message) { throw std::runtime_error(message); }

uint64_t MonotonicNanoseconds() {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count());
}

uint32_t Crc32Core(const uint32_t* ptr, uint32_t len) {
  uint32_t crc = 0xFFFFFFFF;
  constexpr uint32_t kPolynomial = 0x04C11DB7U;
  for (uint32_t index = 0; index < len; ++index) {
    uint32_t xbit = 1U << 31;
    const uint32_t word = ptr[index];
    for (int bit = 0; bit < 32; ++bit) {
      if (crc & (1U << 31)) {
        crc = (crc << 1) ^ kPolynomial;
      } else {
        crc <<= 1;
      }
      if (word & xbit) {
        crc ^= kPolynomial;
      }
      xbit >>= 1;
    }
  }
  return crc;
}

bool CrcIsValid(const LowState& state) {
  return state.crc() == Crc32Core(reinterpret_cast<const uint32_t*>(&state),
                                  (sizeof(LowState) >> 2) - 1);
}

bool IsFinite(double value) { return std::isfinite(value); }

void RequireFiniteState(const LowState& state) {
  if (state.motor_state().size() < kMotorCount) {
    Reject("lowstate has fewer than 29 motor samples");
  }
  for (int index = 0; index < kMotorCount; ++index) {
    const auto& motor = state.motor_state().at(index);
    if (!IsFinite(motor.q()) || !IsFinite(motor.dq()) || !IsFinite(motor.tau_est())) {
      Reject("lowstate contains non-finite q, dq, or tau_est");
    }
  }
  if (state.imu_state().gyroscope().size() != 3) {
    Reject("lowstate gyroscope does not contain three axes");
  }
  for (double value : state.imu_state().gyroscope()) {
    if (!IsFinite(value)) {
      Reject("lowstate contains non-finite angular velocity");
    }
  }
}

class StateMonitor {
 public:
  void OnState(const void* raw) {
    const auto* incoming = static_cast<const LowState*>(raw);
    if (incoming == nullptr || !CrcIsValid(*incoming)) {
      std::lock_guard<std::mutex> lock(mutex_);
      ++invalid_samples_;
      return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    std::memcpy(&latest_.state, incoming, sizeof(LowState));
    latest_.received_at = std::chrono::steady_clock::now();
    latest_.sequence = ++valid_samples_;
  }

  Snapshot FreshSnapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (latest_.sequence == 0) {
      Reject("no CRC-valid G1 lowstate sample received");
    }
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

double MaximumSpeed(const LowState& state, int first_index, int last_index) {
  double maximum = 0.0;
  for (int index = first_index; index <= last_index; ++index) {
    maximum = std::max(maximum, std::abs(static_cast<double>(state.motor_state().at(index).dq())));
  }
  return maximum;
}

double MaximumAngularSpeed(const LowState& state) {
  double maximum = 0.0;
  for (double value : state.imu_state().gyroscope()) {
    maximum = std::max(maximum, std::abs(value));
  }
  return maximum;
}

double MaximumUpperTorque(const LowState& state) {
  double maximum = 0.0;
  for (int index = kFirstUpperIndex; index <= kLastUpperIndex; ++index) {
    maximum = std::max(maximum,
                       std::abs(static_cast<double>(state.motor_state().at(index).tau_est())));
  }
  return maximum;
}

void ValidateInitialState(const Snapshot& snapshot) {
  RequireFiniteState(snapshot.state);
  const double leg_speed = MaximumSpeed(snapshot.state, kFirstLegIndex, kLastLegIndex);
  const double upper_speed = MaximumSpeed(snapshot.state, kFirstUpperIndex, kLastUpperIndex);
  const double angular_speed = MaximumAngularSpeed(snapshot.state);
  const double upper_torque = MaximumUpperTorque(snapshot.state);
  if (leg_speed > kMaximumInitialLegSpeedRadS) {
    Reject("stationary preflight rejected: leg speed exceeds 0.12 rad/s");
  }
  if (upper_speed > kMaximumInitialUpperSpeedRadS) {
    Reject("stationary preflight rejected: upper-body speed exceeds 0.08 rad/s");
  }
  if (angular_speed > kMaximumAngularSpeedRadS) {
    Reject("stationary preflight rejected: body angular speed exceeds 0.15 rad/s");
  }
  if (upper_torque > kMaximumMatchedTorqueNm) {
    Reject("stationary preflight rejected: upper-body torque exceeds 4 N m");
  }
}

void ValidateRunningState(const Snapshot& snapshot, const LowState& reference) {
  RequireFiniteState(snapshot.state);
  const double leg_speed = MaximumSpeed(snapshot.state, kFirstLegIndex, kLastLegIndex);
  const double upper_speed = MaximumSpeed(snapshot.state, kFirstUpperIndex, kLastUpperIndex);
  const double angular_speed = MaximumAngularSpeed(snapshot.state);
  const double upper_torque = MaximumUpperTorque(snapshot.state);
  if (leg_speed > kMaximumRunningLegSpeedRadS) {
    Reject("running guard rejected: leg speed exceeds 0.20 rad/s");
  }
  if (upper_speed > kMaximumRunningUpperSpeedRadS) {
    Reject("running guard rejected: upper-body speed exceeds 0.12 rad/s");
  }
  if (angular_speed > kMaximumAngularSpeedRadS) {
    Reject("running guard rejected: body angular speed exceeds 0.15 rad/s");
  }
  if (upper_torque > kMaximumMatchedTorqueNm) {
    Reject("running guard rejected: upper-body torque exceeds 4 N m");
  }
  for (int index = kFirstUpperIndex; index <= kLastUpperIndex; ++index) {
    const double drift = std::abs(static_cast<double>(snapshot.state.motor_state().at(index).q()) -
                                  static_cast<double>(reference.motor_state().at(index).q()));
    if (drift > kMaximumUpperDriftRad) {
      Reject("running guard rejected: upper-body feedback drift exceeds 0.03 rad");
    }
  }
}

void RequireSustainedStationary(StateMonitor& monitor) {
  const auto deadline = std::chrono::steady_clock::now() + kStationaryWindow;
  uint64_t previous_sequence = 0;
  int accepted = 0;
  while (std::chrono::steady_clock::now() < deadline) {
    const Snapshot snapshot = monitor.FreshSnapshot();
    if (snapshot.sequence != previous_sequence) {
      ValidateInitialState(snapshot);
      previous_sequence = snapshot.sequence;
      ++accepted;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(4));
  }
  if (accepted < kMinimumStationarySamples) {
    Reject("stationary preflight received fewer than 50 fresh feedback samples");
  }
}

double WeightForStep(int step) {
  if (step < kPrefillFrames) {
    return 0.0;
  }
  step -= kPrefillFrames;
  if (step < kEnabledFrames) {
    return 1.0;
  }
  step -= kEnabledFrames;
  if (step < kReleaseFrames) {
    return static_cast<double>(kReleaseFrames - step - 1) /
           static_cast<double>(kReleaseFrames);
  }
  return 0.0;
}

void FillCommand(LowCmd* command, const LowState& state, double weight) {
  if (command == nullptr) {
    Reject("internal error: null arm_sdk command");
  }
  *command = LowCmd{};
  command->mode_pr() = state.mode_pr();
  command->mode_machine() = state.mode_machine();
  if (command->motor_cmd().size() <= kWeightIndex) {
    Reject("arm_sdk command has no authority-weight slot");
  }
  for (int index = 0; index < kMotorCount; ++index) {
    auto& destination = command->motor_cmd().at(index);
    const auto& measured = state.motor_state().at(index);
    destination.mode() = 1;
    destination.q() = measured.q();
    destination.dq() = 0.0F;
    destination.tau() = 0.0F;
    destination.kp() = 0.0F;
    destination.kd() = 0.0F;
  }
  for (int index = kFirstUpperIndex; index <= kLastUpperIndex; ++index) {
    auto& destination = command->motor_cmd().at(index);
    const auto& measured = state.motor_state().at(index);
    destination.q() = measured.q();
    destination.dq() = measured.dq();
    destination.tau() = measured.tau_est();
    destination.kp() = static_cast<float>(kPositionKp);
    destination.kd() = static_cast<float>(kVelocityKd);
  }
  for (int index = kMotorCount; index < static_cast<int>(command->motor_cmd().size()); ++index) {
    auto& destination = command->motor_cmd().at(index);
    destination.mode() = 0;
    destination.q() = 0.0F;
    destination.dq() = 0.0F;
    destination.tau() = 0.0F;
    destination.kp() = 0.0F;
    destination.kd() = 0.0F;
  }
  command->motor_cmd().at(kWeightIndex).q() = static_cast<float>(weight);
  command->crc() = Crc32Core(reinterpret_cast<const uint32_t*>(command),
                              (sizeof(LowCmd) >> 2) - 1);
}

void WriteResult(const std::string& path, const Result& result) {
  std::ofstream output(path, std::ios::out | std::ios::trunc);
  if (!output) {
    return;
  }
  output << "{\n"
         << "  \"result\": \"" << result.result << "\",\n"
         << "  \"reason\": \"" << result.reason << "\",\n"
         << "  \"execute\": " << (result.execute ? "true" : "false") << ",\n"
         << "  \"authorization_consumed\": "
         << (result.authorization_consumed ? "true" : "false") << ",\n"
         << "  \"valid_state_samples\": " << result.valid_state_samples << ",\n"
         << "  \"invalid_state_samples\": " << result.invalid_state_samples << ",\n"
         << "  \"foreign_arm_sdk_samples\": " << result.foreign_arm_sdk_samples << ",\n"
         << "  \"writes\": " << result.writes << ",\n"
         << "  \"last_weight\": " << result.last_weight << ",\n"
         << "  \"program\": \"g1_arm_sdk_zero_hold_v5\",\n"
         << "  \"timestamp_monotonic_ns\": " << MonotonicNanoseconds() << "\n"
         << "}\n";
}

void PrintResult(const Result& result) {
  std::cout << "{\"result\":\"" << result.result << "\",\"reason\":\""
            << result.reason << "\",\"execute\":"
            << (result.execute ? "true" : "false") << ",\"authorization_consumed\":"
            << (result.authorization_consumed ? "true" : "false")
            << ",\"valid_state_samples\":" << result.valid_state_samples
            << ",\"invalid_state_samples\":" << result.invalid_state_samples
            << ",\"foreign_arm_sdk_samples\":" << result.foreign_arm_sdk_samples
            << ",\"writes\":" << result.writes << ",\"last_weight\":"
            << result.last_weight << "}\n";
}

bool ConsumeAuthorization(const std::string& run_directory) {
  const std::string marker = run_directory + "/authorization-v5.consumed";
  const int descriptor = open(marker.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (descriptor < 0) {
    return false;
  }
  const std::string content = std::string(kAuthorization) + "\n" +
                              std::to_string(MonotonicNanoseconds()) + "\n";
  const ssize_t written = write(descriptor, content.data(), content.size());
  close(descriptor);
  if (written != static_cast<ssize_t>(content.size())) {
    Reject("could not persist the one-time authorization receipt");
  }
  return true;
}

Arguments ParseArguments(int argc, char** argv) {
  Arguments arguments;
  for (int index = 1; index < argc; ++index) {
    const std::string value = argv[index];
    const auto next = [&]() -> std::string {
      if (index + 1 >= argc) {
        Reject("missing value after " + value);
      }
      return argv[++index];
    };
    if (value == "--network-interface") {
      arguments.interface = next();
    } else if (value == "--authorization") {
      arguments.authorization = next();
    } else if (value == "--run-directory") {
      arguments.run_directory = next();
    } else if (value == "--execute") {
      arguments.execute = true;
    } else if (value == "--help") {
      std::cout << "Usage: " << argv[0]
                << " [--network-interface IFACE] [--run-directory PATH]"
                   " [--execute --authorization G1-ARM-SDK-ZERO-HOLD-V5-20260827]\n";
      std::exit(0);
    } else {
      Reject("unknown argument: " + value);
    }
  }
  if (arguments.execute && arguments.authorization != kAuthorization) {
    Reject("execution authorization is absent or does not match V5");
  }
  if (!arguments.execute && !arguments.authorization.empty()) {
    Reject("--authorization is valid only together with --execute");
  }
  return arguments;
}

void BestEffortRelease(unitree::robot::ChannelPublisherPtr<LowCmd>& publisher,
                       StateMonitor& monitor, const LowState& fallback, double start_weight,
                       Result* result) {
  if (!publisher) {
    return;
  }
  const int frames = std::max(1, static_cast<int>(std::ceil(start_weight * kReleaseFrames)));
  for (int step = 0; step <= frames + kZeroTailFrames; ++step) {
    const double weight = step < frames ? start_weight * (1.0 - static_cast<double>(step) / frames) : 0.0;
    LowState state = fallback;
    try {
      state = monitor.FreshSnapshot().state;
    } catch (const std::exception&) {
      // The release path remains best effort if feedback is already unavailable.
    }
    LowCmd command{};
    FillCommand(&command, state, weight);
    publisher->Write(command);
    ++result->writes;
    result->last_weight = weight;
    std::this_thread::sleep_for(kControlPeriod);
  }
}

int Run(const Arguments& arguments) {
  Result result;
  result.execute = arguments.execute;
  const std::string result_path = arguments.run_directory + "/result-v5.json";
  StateMonitor monitor;
  ArmSdkActivityMonitor activity_monitor;
  unitree::robot::ChannelSubscriberPtr<LowState> state_subscriber;
  unitree::robot::ChannelSubscriberPtr<LowCmd> arm_sdk_subscriber;
  unitree::robot::ChannelPublisherPtr<LowCmd> publisher;
  LowState fallback{};
  bool publisher_created = false;
  bool release_required = false;

  try {
    unitree::robot::ChannelFactory::Instance()->Init(0, arguments.interface);
    state_subscriber.reset(new unitree::robot::ChannelSubscriber<LowState>(
        std::string(kLowStateTopic)));
    state_subscriber->InitChannel([&monitor](const void* message) { monitor.OnState(message); }, 1);
    arm_sdk_subscriber.reset(new unitree::robot::ChannelSubscriber<LowCmd>(
        std::string(kArmSdkTopic)));
    arm_sdk_subscriber->InitChannel(
        [&activity_monitor](const void* message) { activity_monitor.OnArmSdk(message); }, 1);

    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
    result.foreign_arm_sdk_samples = activity_monitor.samples();
    if (result.foreign_arm_sdk_samples != 0) {
      Reject("rt/arm_sdk already has an active publisher; authority is not idle");
    }
    RequireSustainedStationary(monitor);
    const Snapshot entry = monitor.FreshSnapshot();
    ValidateInitialState(entry);
    fallback = entry.state;
    result.valid_state_samples = monitor.valid_samples();
    result.invalid_state_samples = monitor.invalid_samples();

    if (!arguments.execute) {
      result.result = "g1_arm_sdk_zero_hold_v5_dry_run_ok";
      result.reason = "no publisher was created";
      WriteResult(result_path, result);
      PrintResult(result);
      return 0;
    }

    const Snapshot final_entry = monitor.FreshSnapshot();
    ValidateInitialState(final_entry);
    fallback = final_entry.state;
    if (activity_monitor.samples() != 0) {
      Reject("rt/arm_sdk became active during the final execution gate");
    }

    // The marker is deliberately consumed immediately before the first possible
    // publisher is created.  A failed preflight remains repeatable; an attempted
    // physical execution never does.
    if (!ConsumeAuthorization(arguments.run_directory)) {
      Reject("V5 physical authorization was already consumed");
    }
    result.authorization_consumed = true;

    publisher.reset(new unitree::robot::ChannelPublisher<LowCmd>(std::string(kArmSdkTopic)));
    publisher->InitChannel();
    publisher_created = true;
    const int total_frames = kPrefillFrames + kEnabledFrames + kReleaseFrames + kZeroTailFrames;
    const auto started = std::chrono::steady_clock::now();
    for (int step = 0; step < total_frames; ++step) {
      std::this_thread::sleep_until(started + step * kControlPeriod);
      const Snapshot current = monitor.FreshSnapshot();
      ValidateRunningState(current, final_entry.state);
      const double weight = WeightForStep(step);
      LowCmd command{};
      FillCommand(&command, current.state, weight);
      if (!publisher->Write(command)) {
        Reject("rt/arm_sdk write failed or has no matched humanoid subscriber");
      }
      ++result.writes;
      result.last_weight = weight;
      release_required = weight > 0.0;
    }
    result.valid_state_samples = monitor.valid_samples();
    result.invalid_state_samples = monitor.invalid_samples();
    result.result = "g1_arm_sdk_zero_hold_v5_completed";
    result.reason = "one-frame torque-matched zero-displacement handoff released to zero weight";
    WriteResult(result_path, result);
    PrintResult(result);
    return 0;
  } catch (const std::exception& error) {
    result.result = publisher_created ? "g1_arm_sdk_zero_hold_v5_aborted"
                                      : "g1_arm_sdk_zero_hold_v5_rejected";
    result.reason = error.what();
    if (publisher_created && release_required) {
      BestEffortRelease(publisher, monitor, fallback, result.last_weight, &result);
    }
    result.valid_state_samples = monitor.valid_samples();
    result.invalid_state_samples = monitor.invalid_samples();
    result.foreign_arm_sdk_samples = activity_monitor.samples();
    WriteResult(result_path, result);
    PrintResult(result);
    return 2;
  }
}

}  // namespace

int main(int argc, char** argv) {
  try {
    return Run(ParseArguments(argc, argv));
  } catch (const std::exception& error) {
    Result result;
    result.result = "g1_arm_sdk_zero_hold_v5_rejected";
    result.reason = error.what();
    PrintResult(result);
    return 2;
  }
}
