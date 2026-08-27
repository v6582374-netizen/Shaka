# Embodied Skill Acquisition

This context describes how the project acquires, validates, and retains executable robot skills while minimizing human input and maximizing physical experiment throughput.

## Language

**Skill acquisition system**:
The platform that generates, evaluates, improves, and installs executable robot skills.
_Avoid_: Self-evolving system, when cross-task improvement has not yet been demonstrated

**Candidate implementation**:
An executable program, policy, or hybrid under evaluation that has not yet passed installation acceptance.
_Avoid_: Skill, checkpoint

**Installed skill**:
A versioned, callable asset that satisfies its contract, independent reproduction criteria, regression checks, and rollback requirements.
_Avoid_: Successful candidate, first success

**Skill acquisition loop**:
The end-to-end process proven when the system acquires and installs its first skill.
_Avoid_: Self-evolution

**Physical autoresearch**:
A bounded policy-improvement process in which a coding agent proposes, executes, compares, and revises learning or control hypotheses through frozen task, reward, reset, hardware-protection, logging, and robot-control interfaces. A human sets the total rollout and robot-time budget, while the coding agent allocates sub-budgets across hypotheses. The human defines the task and independently confirms final success.
_Avoid_: Unrestricted autonomous robot research, mutable evaluation during policy search

**Verified self-evolution**:
Cross-task improvement demonstrated when acquiring a second independent skill requires a predefined, materially lower acquisition cost than the first.
_Avoid_: Self-evolution inferred from architecture or from one installed skill

**Zero training annotation**:
No human supplies per-episode labels used as training signals; diagnostic human observations may be retained only as audit evidence.
_Avoid_: Zero human involvement, zero observation

**Hardware protection boundary**:
The hard execution boundary that prevents abrupt large joint motion and collisions capable of damaging the robot or task equipment; within it, experiment throughput takes priority over conservative behavior.
_Avoid_: Safety first, risk minimization

**Unique robot-control entry point**:
The sole runtime boundary authorized to publish actuator commands; every candidate output must pass through its immutable hardware protection rules before reaching the robot.
_Avoid_: Direct policy control, multiple actuator writers

**Fixed device pose**:
The target device remains physically fixed in position and orientation throughout skill acquisition and invocation.
_Avoid_: Variable device placement

**Robot base pose variation**:
The Unitree G1 may start from different positions or orientations relative to the fixed target device, within the skill's declared operating range.
_Avoid_: Device position variation

**Yellow-button contact task**:
An invocation succeeds when recorded visual evidence shows the designated fingertip contact the yellow button and then withdraw from the device; button travel and downstream device responses are not part of the task result.
_Avoid_: Button-press task, lid-opening task

**Admissible robot base pose**:
An initial G1 base pose from which the yellow button is observable and kinematically reachable without moving the feet or leaving the hardware protection boundary.
_Avoid_: Arbitrary nearby position

**Stationary-base invocation**:
A skill invocation during which the G1 keeps both feet planted while the torso, arms, and hands may move.
_Avoid_: Walking manipulation

**Standard manipulator start state**:
The single prescribed initial arm and hand posture used for every first-version invocation, so robot base pose is the only intentional starting-pose variation.
_Avoid_: Arbitrary safe arm posture

**Autonomous rollout reset**:
A fixed procedure outside the candidate implementation that returns the arms and hands to the standard manipulator start state after a `failed` or `indeterminate` rollout and verifies readiness before creating a new single-attempt invocation. A hardware-protection abort suspends the autonomous loop for human inspection instead of triggering another rollout.
_Avoid_: Retry inside one invocation, candidate-controlled reset, automatic continuation after abort

**Single-attempt invocation**:
A skill invocation containing exactly one yellow-button contact attempt; another attempt is a new invocation with a separate record.
_Avoid_: Automatic retry inside one invocation

**Invocation evidence record**:
The evidence belonging to exactly one single-attempt invocation, sufficient to distinguish candidate output, executed command, physical feedback, hardware protection intervention, and independently judged task outcome.
_Avoid_: Training episode, experiment summary

**Failure attribution**:
The association between an invocation's directly observed failure stage and an optional post-run diagnostic conclusion; diagnostic conclusions never replace or rewrite the underlying evidence.
_Avoid_: Root cause, when causality has not been demonstrated

**Retreated completion**:
Completion reached only after visible fingertip contact has ended and the hand has withdrawn from the device; returning the arm to its full initial posture is not required.
_Avoid_: Completion while touching the button, mandatory full homing

**Independent task evaluator**:
A mechanism outside the candidate implementation that determines whether recorded evidence satisfies the task contract; candidate action completion is not task-success evidence.
_Avoid_: Candidate self-evaluation, command completion as success

**Training proxy reward**:
An automated outcome outside the candidate implementation that guides physical autoresearch after being validated and frozen. It uses the task result states `succeeded`, `failed`, `indeterminate`, `aborted`, and `abstained`; only `succeeded` and `failed` provide task-outcome labels for learning or candidate comparison. Human labels may be used only for one-time evaluator development and isolated acceptance testing, never as live rollout feedback or candidate-policy training data. It cannot establish task success or replace the independent task evaluator.
_Avoid_: Automated success verdict, human per-episode training label, candidate self-reward

**Qualifying VLA failure**:
A repeatable terminal-stage control error observed after the VLA has correctly interpreted the task, selected the designated fingertip, approached the yellow button, and executed through a healthy deployment path without hardware protection abort. The error must be plausibly correctable within a bounded residual action range.
_Avoid_: Any failed invocation, deployment defect, semantic or target-selection error, hardware protection abort

**Intent-only invocation**:
A skill call that requests the yellow-button task without supplying image coordinates, three-dimensional coordinates, or a prepared motion target; the skill localizes the button from current observations.
_Avoid_: Coordinate-driven invocation

**First verified success**:
The first fresh single-attempt invocation executed through the unique robot-control entry point whose recorded visual evidence shows yellow-button contact and retreat, as confirmed by the independent task evaluator, with a complete evidence record and without abort or human action guidance.
_Avoid_: Contact without retreat, first completed command, unreviewed apparent success, post-hoc reclassification of a historical run
