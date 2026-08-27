// Historical G1 + BrainCo VLA canary verifier for one immutable 25x26 plan.
//
// This program remains a read-only dry-run diagnostic. Its former write path
// predates the immutable authorization package required by Issue #27, so it
// must never create rt/arm_sdk or BrainCo publishers. A future physical canary
// needs a separately reviewed command that binds the authorization package,
// the current control-entry topology, and the installed protection boundary.
#include <algorithm>
#include <boost/property_tree/json_parser.hpp>
#include <boost/property_tree/ptree.hpp>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <utility>
#include <vector>

#include <unitree/idl/go2/MotorCmds_.hpp>
#include <unitree/idl/hg/LowCmd_.hpp>
#include <unitree/idl/hg/LowState_.hpp>
#include <unitree/robot/channel/channel_factory.hpp>
#include <unitree/robot/channel/channel_publisher.hpp>
#include <unitree/robot/channel/channel_subscriber.hpp>

namespace {
using LowCmd = unitree_hg::msg::dds_::LowCmd_;
using LowState = unitree_hg::msg::dds_::LowState_;
using HandCmd = unitree_go::msg::dds_::MotorCmds_;

constexpr int kMotorCount = 29;
constexpr int kWeightIndex = 29;
constexpr int kFirstArm = 15;
constexpr int kLastArm = 28;
constexpr char kAuthorization[] = "G1-VLA-COMPLETE-ACTION-V8-20260827";
constexpr char kPlanSha256[] = "5f3e53af9a4e6000dc964209957ca57989b92cb894ab92a5ad252bf9af965758";
constexpr char kRunDirectory[] = "/home/unitree/shaka-g1-zero-hold-v5";
constexpr auto kPeriod = std::chrono::milliseconds(20);

struct Args { std::string network, plan, authorization; bool execute = false; };

uint32_t Crc32Core(const uint32_t* words, uint32_t length) {
  uint32_t crc = 0xFFFFFFFFU;
  constexpr uint32_t polynomial = 0x04C11DB7U;
  for (uint32_t index = 0; index < length; ++index) {
    uint32_t xbit = 1U << 31;
    const uint32_t word = words[index];
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
  void Callback(const void* message) {
    const auto* incoming = static_cast<const LowState*>(message);
    std::lock_guard<std::mutex> lock(mutex_);
    if (incoming == nullptr || !CrcIsValid(*incoming)) { ++invalid_; return; }
    std::memcpy(&state_, incoming, sizeof(state_));
    received_ = std::chrono::steady_clock::now();
    ++valid_;
  }
  LowState Fresh() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (valid_ < 50 || std::chrono::steady_clock::now() - received_ > std::chrono::milliseconds(100)) {
      throw std::runtime_error("fewer than 50 CRC-valid lowstate samples or feedback is stale");
    }
    return state_;
  }
  uint64_t valid() const { std::lock_guard<std::mutex> lock(mutex_); return valid_; }
  uint64_t invalid() const { std::lock_guard<std::mutex> lock(mutex_); return invalid_; }
 private:
  mutable std::mutex mutex_;
  LowState state_{};
  std::chrono::steady_clock::time_point received_{};
  uint64_t valid_ = 0, invalid_ = 0;
};

class ArmSdkActivityMonitor {
 public:
  void Callback(const void*) { std::lock_guard<std::mutex> lock(mutex_); ++samples_; }
  uint64_t samples() const { std::lock_guard<std::mutex> lock(mutex_); return samples_; }
 private:
  mutable std::mutex mutex_;
  uint64_t samples_ = 0;
};

Args Parse(int argc, char** argv) {
  Args args;
  for (int i = 1; i < argc; ++i) {
    const std::string value = argv[i];
    const auto next = [&]() -> std::string {
      if (++i >= argc) throw std::runtime_error("missing value after " + value);
      return argv[i];
    };
    if (value == "--execute") args.execute = true;
    else if (value == "--network-interface") args.network = next();
    else if (value == "--action-plan") args.plan = next();
    else if (value == "--authorization") args.authorization = next();
    else throw std::runtime_error("invalid V7 argument: " + value);
  }
  if (args.network.empty() || args.plan.empty()) throw std::runtime_error("network interface and action plan are required");
  if (args.execute) {
    throw std::runtime_error(
        "physical execution is retired: prepare and explicitly authorize the "
        "Issue #27 canary package instead");
  }
  if (!args.execute && !args.authorization.empty()) throw std::runtime_error("authorization requires --execute");
  return args;
}

std::string Sha256(const std::string& path) {
  int fds[2];
  if (pipe(fds) != 0) throw std::runtime_error("could not create SHA-256 pipe");
  const pid_t pid = fork();
  if (pid < 0) { close(fds[0]); close(fds[1]); throw std::runtime_error("could not start SHA-256 checker"); }
  if (pid == 0) {
    dup2(fds[1], STDOUT_FILENO); close(fds[0]); close(fds[1]);
    execl("/usr/bin/sha256sum", "sha256sum", "--", path.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  close(fds[1]);
  std::string output; char buffer[128]; ssize_t read_count = 0;
  while ((read_count = read(fds[0], buffer, sizeof(buffer))) > 0) output.append(buffer, static_cast<size_t>(read_count));
  close(fds[0]); int status = 0;
  if (waitpid(pid, &status, 0) != pid || !WIFEXITED(status) || WEXITSTATUS(status) != 0 || output.size() < 65) {
    throw std::runtime_error("could not compute action-plan SHA-256");
  }
  const std::string digest = output.substr(0, 64);
  if (output[64] != ' ' || digest.find_first_not_of("0123456789abcdef") != std::string::npos) {
    throw std::runtime_error("sha256sum returned an invalid digest");
  }
  return digest;
}

std::vector<std::vector<float>> ReadPlan(const std::string& path) {
  if (Sha256(path) != kPlanSha256) throw std::runtime_error("action-plan SHA-256 is not the frozen V7 plan");
  boost::property_tree::ptree root;
  boost::property_tree::read_json(path, root);
  if (root.get<int>("schema_version") != 1 ||
      root.get<std::string>("kind") != "unifolm_vla_action_plan_evidence" ||
      root.get<std::string>("execution_mode") != "zero-write" ||
      root.get<int>("command_publishers_created") != 0 || root.get<int>("writes") != 0 ||
      root.get<int>("contract.action_dimension") != 26 || root.get<int>("contract.action_horizon") != 25 ||
      root.get<std::string>("contract.live_brainco_action_units") != "normalized_0_to_1" ||
      root.get<std::string>("projection.protocol") != "shaka.g1-vla-brainco-action-projection.v1" ||
      root.get<bool>("projection.arm_coordinates_modified") != false) {
    throw std::runtime_error("action plan does not declare the immutable projected BrainCo26 contract");
  }
  std::vector<std::vector<float>> plan;
  for (const auto& row : root.get_child("trajectory")) {
    std::vector<float> target;
    for (const auto& value : row.second) target.push_back(value.second.get_value<float>());
    if (target.size() != 26) throw std::runtime_error("plan does not contain 26 channels");
    for (float value : target) if (!std::isfinite(value)) throw std::runtime_error("plan contains non-finite values");
    plan.push_back(std::move(target));
  }
  if (plan.size() != 25) throw std::runtime_error("plan does not contain 25 targets");
  return plan;
}

void ValidateState(const LowState& state, bool moving) {
  if (state.motor_state().size() < kMotorCount || state.imu_state().gyroscope().size() != 3) throw std::runtime_error("lowstate is incomplete");
  double leg = 0, upper = 0, torque = 0, gyro = 0;
  for (int i = 0; i < kMotorCount; ++i) {
    const auto& motor = state.motor_state().at(i);
    if (!std::isfinite(motor.q()) || !std::isfinite(motor.dq()) || !std::isfinite(motor.tau_est())) throw std::runtime_error("lowstate is non-finite");
    if (i < 12) leg = std::max(leg, std::abs(static_cast<double>(motor.dq())));
    else { upper = std::max(upper, std::abs(static_cast<double>(motor.dq()))); torque = std::max(torque, std::abs(static_cast<double>(motor.tau_est()))); }
  }
  for (double value : state.imu_state().gyroscope()) { if (!std::isfinite(value)) throw std::runtime_error("lowstate gyroscope is non-finite"); gyro = std::max(gyro, std::abs(value)); }
  if (leg > (moving ? 0.30 : 0.20)) throw std::runtime_error("feedback gate: leg speed exceeds limit");
  if (upper > (moving ? 3.0 : 0.12)) throw std::runtime_error("feedback gate: upper-body speed exceeds limit");
  if (gyro > 0.15) throw std::runtime_error("feedback gate: body angular speed exceeds limit");
  if (!moving && torque > 4.0) throw std::runtime_error("feedback gate: stationary upper-body torque exceeds 4 Nm");
  if (moving) {
    for (int index = 12; index <= 14; ++index) {
      if (std::abs(static_cast<double>(state.motor_state().at(index).tau_est())) > 4.0) {
        throw std::runtime_error("feedback gate: torso torque exceeds 4 Nm");
      }
    }
    // The V5 4 Nm threshold was valid for a zero-displacement canary but
    // rejects ordinary motion of G1's 25 Nm shoulder/elbow joints. These are
    // 50% of the URDF effort limits; wrists retain their tighter 2.5 Nm cap.
    for (int offset = 0; offset < 14; ++offset) {
      const double limit = (offset == 5 || offset == 6 || offset == 12 || offset == 13) ? 2.5 : 12.5;
      const double measured = std::abs(static_cast<double>(state.motor_state().at(kFirstArm + offset).tau_est()));
      if (measured > limit) {
        std::ostringstream reason;
        reason << "feedback gate: arm " << offset << " torque " << measured << " exceeds " << limit << " Nm";
        throw std::runtime_error(reason.str());
      }
    }
  }
}

void RequireStationary(StateMonitor& monitor) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(1500);
  uint64_t accepted = 0, previous = 0;
  while (std::chrono::steady_clock::now() < deadline) {
    const auto state = monitor.Fresh();
    const uint64_t current = monitor.valid();
    if (current != previous) { ValidateState(state, false); previous = current; ++accepted; }
    std::this_thread::sleep_for(std::chrono::milliseconds(4));
  }
  if (accepted < 50) throw std::runtime_error("stationary preflight received fewer than 50 fresh feedback samples");
}

void FillArm(LowCmd& command, const LowState& state, const std::vector<float>& target, float weight) {
  command = LowCmd{};
  command.mode_pr() = state.mode_pr(); command.mode_machine() = state.mode_machine();
  if (command.motor_cmd().size() <= kWeightIndex) throw std::runtime_error("arm SDK command has no authority weight slot");
  for (int i = 0; i < kMotorCount; ++i) {
    auto& out = command.motor_cmd().at(i); const auto& in = state.motor_state().at(i);
    out.mode() = 1; out.q() = in.q(); out.dq() = 0; out.tau() = 0; out.kp() = 0; out.kd() = 0;
  }
  for (int i = 12; i <= kLastArm; ++i) {
    auto& out = command.motor_cmd().at(i); const auto& in = state.motor_state().at(i);
    out.q() = in.q(); out.dq() = in.dq(); out.tau() = in.tau_est(); out.kp() = 60; out.kd() = 1.5F;
  }
  for (int i = 0; i < 14; ++i) command.motor_cmd().at(kFirstArm + i).q() = target.at(i);
  for (int i = kMotorCount; i < static_cast<int>(command.motor_cmd().size()); ++i) {
    auto& out = command.motor_cmd().at(i); out.mode() = 0; out.q() = out.dq() = out.tau() = out.kp() = out.kd() = 0;
  }
  command.motor_cmd().at(kWeightIndex).q() = weight;
  command.crc() = Crc32Core(reinterpret_cast<const uint32_t*>(&command), (sizeof(LowCmd) >> 2) - 1);
}

void FillHand(HandCmd& command, const std::vector<float>& target, int offset) {
  command = HandCmd{};
  command.cmds().resize(6);
  for (int i = 0; i < 6; ++i) {
    const float position = target.at(offset + i);
    if (!std::isfinite(position) || position < 0 || position > 1) throw std::runtime_error("BrainCo target is outside [0,1]");
    command.cmds().at(i).q() = position; command.cmds().at(i).dq() = 1.0F;
  }
}

using HandPair = std::pair<HandCmd, HandCmd>;
std::vector<HandPair> BuildHandFrames(const std::vector<std::vector<float>>& plan) {
  std::vector<HandPair> frames; frames.reserve(plan.size());
  for (const auto& row : plan) { HandCmd left{}, right{}; FillHand(left, row, 14); FillHand(right, row, 20); frames.emplace_back(std::move(left), std::move(right)); }
  return frames;
}

bool ConsumeAuthorization() {
  const std::string marker = std::string(kRunDirectory) + "/authorization-v8.consumed";
  const int descriptor = open(marker.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (descriptor < 0) return false;
  const std::string receipt = std::string(kAuthorization) + "\n" + kPlanSha256 + "\n";
  const bool complete = write(descriptor, receipt.data(), receipt.size()) == static_cast<ssize_t>(receipt.size());
  close(descriptor);
  if (!complete) throw std::runtime_error("could not persist V7 authorization receipt");
  return true;
}

class ReleaseGuard {
 public:
  ReleaseGuard(unitree::robot::ChannelPublisherPtr<LowCmd> publisher, StateMonitor& monitor) : publisher_(std::move(publisher)), monitor_(monitor) {}
  void Arm() { active_ = true; }
  void Disarm() { active_ = false; }
  ~ReleaseGuard() { if (active_) Release(); }
  void Release() noexcept {
    try {
      for (int tick = 0; tick < 50; ++tick) {
        const auto state = monitor_.Fresh(); std::vector<float> hold(14);
        for (int i = 0; i < 14; ++i) hold[i] = state.motor_state().at(kFirstArm + i).q();
        LowCmd command; FillArm(command, state, hold, 1.0F - static_cast<float>(tick + 1) / 50.0F);
        publisher_->Write(command); std::this_thread::sleep_for(kPeriod);
      }
    } catch (...) {}
    active_ = false;
  }
 private:
  unitree::robot::ChannelPublisherPtr<LowCmd> publisher_;
  StateMonitor& monitor_;
  bool active_ = false;
};

int Run(const Args& args) {
  const auto plan = ReadPlan(args.plan);
  const auto prevalidated_hands = BuildHandFrames(plan);  // no DDS publisher exists yet.
  StateMonitor monitor; ArmSdkActivityMonitor arm_activity;
  unitree::robot::ChannelFactory::Instance()->Init(0, args.network);
  auto state_subscriber = std::make_shared<unitree::robot::ChannelSubscriber<LowState>>("rt/lowstate");
  state_subscriber->InitChannel([&monitor](const void* msg) { monitor.Callback(msg); }, 1);
  auto arm_subscriber = std::make_shared<unitree::robot::ChannelSubscriber<LowCmd>>("rt/arm_sdk");
  arm_subscriber->InitChannel([&arm_activity](const void* msg) { arm_activity.Callback(msg); }, 1);
  // Let the subscriber collect the minimum 50 Hz feedback window before the
  // first freshness check. This path still creates no command publisher.
  std::this_thread::sleep_for(std::chrono::milliseconds(1500));
  RequireStationary(monitor);
  const auto entry = monitor.Fresh();
  if (arm_activity.samples() != 0) throw std::runtime_error("rt/arm_sdk is already active; authority is not idle");
  if (!args.execute) {
    std::cout << "{\"result\":\"g1_vla_complete_action_v8_dry_run_ok\",\"writes\":0,\"plan_steps\":25,\"valid_state_samples\":" << monitor.valid() << ",\"invalid_state_samples\":" << monitor.invalid() << "}" << std::endl;
    return 0;
  }
  ValidateState(monitor.Fresh(), false);
  if (arm_activity.samples() != 0) throw std::runtime_error("rt/arm_sdk became active during final execution gate");
  if (!ConsumeAuthorization()) throw std::runtime_error("V8 physical authorization was already consumed");

  auto left = std::make_shared<unitree::robot::ChannelPublisher<HandCmd>>("rt/brainco/left/cmd"); left->InitChannel();
  auto right = std::make_shared<unitree::robot::ChannelPublisher<HandCmd>>("rt/brainco/right/cmd"); right->InitChannel();
  auto arm = std::make_shared<unitree::robot::ChannelPublisher<LowCmd>>("rt/arm_sdk"); arm->InitChannel();
  ReleaseGuard release(arm, monitor); release.Arm();
  uint64_t arm_writes = 0, hand_writes = 0;
  const auto approach_start = std::chrono::steady_clock::now();
  for (int tick = 0; tick < 300; ++tick) {
    std::this_thread::sleep_until(approach_start + tick * kPeriod);
    const auto state = monitor.Fresh(); ValidateState(state, tick > 0);
    std::vector<float> target(14); const float blend = static_cast<float>(tick + 1) / 300.0F;
    for (int i = 0; i < 14; ++i) target[i] = entry.motor_state().at(kFirstArm + i).q() * (1 - blend) + plan[0][i] * blend;
    LowCmd command; FillArm(command, state, target, 1);
    if (!arm->Write(command)) throw std::runtime_error("rt/arm_sdk has no matched humanoid subscriber");
    ++arm_writes; left->Write(prevalidated_hands[0].first); right->Write(prevalidated_hands[0].second); hand_writes += 2;
  }
  const auto trajectory_start = std::chrono::steady_clock::now();
  for (int tick = 0; tick < 42; ++tick) {
    std::this_thread::sleep_until(trajectory_start + tick * kPeriod);
    const float phase = std::min(24.0F, tick * 0.60F); const int lo = static_cast<int>(phase), hi = std::min(24, lo + 1); const float blend = phase - lo;
    std::vector<float> row(26); for (int i = 0; i < 26; ++i) row[i] = plan[lo][i] * (1 - blend) + plan[hi][i] * blend;
    const auto state = monitor.Fresh(); ValidateState(state, true);
    std::vector<float> arms(row.begin(), row.begin() + 14); LowCmd command; FillArm(command, state, arms, 1);
    if (!arm->Write(command)) throw std::runtime_error("rt/arm_sdk write failed");
    ++arm_writes; HandCmd left_frame{}, right_frame{}; FillHand(left_frame, row, 14); FillHand(right_frame, row, 20); left->Write(left_frame); right->Write(right_frame); hand_writes += 2;
  }
  release.Release(); release.Disarm();
  std::cout << "{\"result\":\"g1_vla_complete_action_v8_completed\",\"arm_writes\":" << arm_writes << ",\"hand_writes\":" << hand_writes << ",\"plan_sha256\":\"" << kPlanSha256 << "\"}" << std::endl;
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
  try { return Run(Parse(argc, argv)); }
  catch (const std::exception& error) { std::cerr << "{\"result\":\"g1_vla_complete_action_v8_rejected\",\"reason\":\"" << error.what() << "\"}" << std::endl; return 2; }
}
