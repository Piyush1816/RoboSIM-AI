import {
  formatRobotHardwareSummary,
  NAVIGATION_POLICIES,
  ROBOT_UNITS,
} from '../data/campusConfig';
import { loadRobots } from '../storage/experimentStorage';
import {
  BeforeAfterDemonstrationResult,
  BenchmarkAggregateMetrics,
  BenchmarkScenarioComparison,
  BenchmarkSuiteResult,
  CandidatePolicyState,
  CrossRobotBenchmarkResult,
  CrossRobotComparisonEntry,
  EnvironmentDefinition,
  ExperimentRecord,
  ExperimentRunType,
  NavigationPolicyConfig,
  RobotUnitConfig,
  ScenarioConfig,
  TrainingEpisodeRecord,
} from '../types/simulation';
import { diagnoseExperimentFailure } from './failureIntelligence';
import {
  AutonomousNavigationController,
  SimulationCompletionData,
} from './navigationController';

export interface SingleHeadlessRunOptions {
  scenario: ScenarioConfig;
  policy: NavigationPolicyConfig;
  robotId?: string;
  robotConfigOverride?: RobotUnitConfig;
  environment?: EnvironmentDefinition;
  payloadKgOverride?: number;
  seedOverride?: number;
  runType?: ExperimentRunType;
  candidatePolicyState?: CandidatePolicyState | null;
  isTrainingEpisode?: boolean;
  /**
   * When benchmarking Baseline vs Candidate policy, Baseline uses its standard
   * rule-based reactive replanning controller while Candidate uses its learned Q-table.
   */
  useBaselineReactiveMode?: boolean;
  experimentId?: string;
}

/**
 * Executes a single 100% real headless simulation episode using AutonomousNavigationController.
 * Deterministic for any given scenario + seedOverride.
 */
export function runSingleHeadlessEpisode(
  options: SingleHeadlessRunOptions
): {
  experimentRecord: ExperimentRecord;
  completionData: SimulationCompletionData;
  stepsExecuted: number;
} {
  const {
    scenario,
    policy,
    robotId = 'bot-rover-01',
    robotConfigOverride,
    environment,
    payloadKgOverride,
    seedOverride,
    runType = 'Batch',
    candidatePolicyState = null,
    isTrainingEpisode = false,
    useBaselineReactiveMode = false,
    experimentId,
  } = options;

  const effectiveSeed =
    seedOverride ??
    scenario.randomSeed ??
    scenario.pedestrianDistribution?.randomSeed ??
    101;

  const seededScenario: ScenarioConfig = {
    ...scenario,
    randomSeed: effectiveSeed,
    pedestrianDistribution: scenario.pedestrianDistribution
      ? {
          ...scenario.pedestrianDistribution,
          randomSeed: effectiveSeed,
        }
      : {
          commuterCount: Math.max(1, Math.floor(scenario.dynamicObstacleCount * 0.35)),
          randomCount: Math.floor(scenario.dynamicObstacleCount * 0.25),
          crossingCount: Math.max(1, Math.floor(scenario.dynamicObstacleCount * 0.25)),
          groupCount: Math.max(
            0,
            scenario.dynamicObstacleCount -
              Math.max(1, Math.floor(scenario.dynamicObstacleCount * 0.35)) -
              Math.floor(scenario.dynamicObstacleCount * 0.25) -
              Math.max(1, Math.floor(scenario.dynamicObstacleCount * 0.25))
          ),
          randomSeed: effectiveSeed,
        },
  };

  let capturedCompletion: SimulationCompletionData | null = null;

  const controller = new AutonomousNavigationController(
    seededScenario,
    policy,
    robotConfigOverride?.id ?? robotId,
    {
      onComplete: (payload) => {
        capturedCompletion = payload;
      },
    },
    environment
  );

  if (robotConfigOverride) {
    controller.setRobotHardwareConfig(robotConfigOverride);
  }
  if (payloadKgOverride !== undefined) {
    controller.setPayloadKg(payloadKgOverride);
  }

  if (candidatePolicyState && (policy.isCandidatePolicy || isTrainingEpisode)) {
    controller.candidatePolicyState = candidatePolicyState;
    controller.isTrainingEpisode = isTrainingEpisode;
  } else {
    controller.candidatePolicyState = null;
    controller.isTrainingEpisode = false;
  }

  if (useBaselineReactiveMode) {
    controller.useLegacyAvoidance = true;
  }

  controller.reset(false, false);
  if (robotConfigOverride) {
    controller.setRobotHardwareConfig(robotConfigOverride);
  }
  controller.start();

  const subDt = 0.05;
  const maxSteps = 2500; // up to 125s simulated time
  let steps = 0;

  while (controller.runState === 'running' && steps < maxSteps) {
    controller.step(subDt);
    steps += 1;
  }

  if (!capturedCompletion) {
    // Fallback if loop exited at maxSteps
    controller.step(subDt);
  }

  const currentBot = controller.getCurrentRobot();

  const finalCompletion: SimulationCompletionData = capturedCompletion ?? {
    runSessionId: `HEADLESS-${Date.now()}`,
    scenarioId: seededScenario.id,
    scenarioName: seededScenario.name,
    scenarioSeed: effectiveSeed,
    robotId: currentBot.id,
    robotName: currentBot.name,
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: policy.version,
    isCandidatePolicy: Boolean(policy.isCandidatePolicy),
    originName: controller.getOriginLocation().name,
    destinationName: controller.getTargetLocation().name,
    originFloor: controller.originFloor,
    destinationFloor: controller.targetFloor,
    status: 'Failed',
    durationSec: Number(controller.elapsedTimeSec.toFixed(1)),
    distanceMeters: Number(controller.distanceTraveledM.toFixed(1)),
    collisions: controller.collisionsCount,
    replanCount: controller.replanCount,
    safetyInterventionCount: controller.safetyInterventionCount,
    unnecessaryReplanCount: controller.unnecessaryReplanCount,
    deadlockCount: controller.deadlockCount,
    episodeReward: controller.episodeReward,
    decisionHistory: controller.decisionHistory,
    robotStateBeforeCompletion: `Timed out at (${controller.robotPos.x.toFixed(
      1
    )}, ${controller.robotPos.z.toFixed(1)})`,
    environmentalConditionsSummary: `Seed ${effectiveSeed}`,
    episodeActionCounts: controller.episodeActionCounts,
    pedestrianDetectionsCount: controller.pedestrianDetectionsCount,
    predictedEncountersCount: controller.predictedEncountersCount,
    avoidedEncountersCount: controller.avoidedEncountersCount,
    unnecessaryStopsCount: controller.unnecessaryStopsCount,
    predictionAccuracyPct: Number(controller.predictionAccuracyPct.toFixed(1)),
    pedestrianReplanCount: controller.pedestrianReplanCount,
    speedReductionEventsCount: controller.speedReductionEventsCount,
    reducedSpeedTimeSec: Number(controller.reducedSpeedTimeSec.toFixed(1)),
    pedestrianWaitingTimeSec: Number(
      controller.pedestrianWaitingTimeSec.toFixed(1)
    ),
    speedBasedAvoidanceCount: controller.speedBasedAvoidanceCount,
    localBypassCount: controller.localBypassCount,
    globalReplanCount: controller.globalReplanCount,
    totalWaitingTimeSec: Number(controller.totalWaitingTimeSec.toFixed(1)),
    elevatorWaitTimeSec: Number(controller.elevatorWaitTimeSec.toFixed(1)),
    batteryConsumedPct: Number(
      (controller.initialBatteryPct - controller.batteryPct).toFixed(1)
    ),
    failureType: 'Mission Timeout',
    failureReason: 'Excessive delivery time: Headless simulation step cap reached.',
  };

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const baseRecord: ExperimentRecord = {
    id:
      experimentId ||
      `EXP-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`,
    timestamp: nowStr,
    scenarioId: seededScenario.id,
    scenarioName: seededScenario.name,
    scenarioSeed: effectiveSeed,
    scenarioGenerationSource: seededScenario.generationSource ?? 'Preset',
    scenarioDifficulty: seededScenario.difficulty ?? 'Moderate',
    environmentId:
      environment?.id ??
      seededScenario.environmentId ??
      'env-campus-standard',
    environmentName:
      environment?.name ??
      seededScenario.environmentName ??
      'University Campus Testbed',
    environmentVersion:
      environment?.version ?? seededScenario.environmentVersion ?? '1.0',
    robotId: finalCompletion.robotId,
    robotName: finalCompletion.robotName,
    robotHardwareSummary:
      finalCompletion.robotHardwareSummary ??
      formatRobotHardwareSummary(currentBot),
    robotConfigSnapshot: { ...currentBot },
    payloadKg:
      finalCompletion.payloadKg ??
      payloadKgOverride ??
      currentBot.defaultPayloadKg,
    policyId: finalCompletion.policyId,
    policyName: finalCompletion.policyName,
    policyVersion: finalCompletion.policyVersion ?? policy.version,
    isCandidatePolicy: finalCompletion.isCandidatePolicy,
    runType,
    originName: finalCompletion.originName,
    destinationName: finalCompletion.destinationName,
    originFloor: finalCompletion.originFloor,
    destinationFloor: finalCompletion.destinationFloor,
    status: finalCompletion.status,
    durationSec: finalCompletion.durationSec,
    distanceMeters: finalCompletion.distanceMeters,
    collisions: finalCompletion.collisions,
    replanCount: finalCompletion.replanCount,
    safetyInterventionCount: finalCompletion.safetyInterventionCount,
    unnecessaryReplanCount: finalCompletion.unnecessaryReplanCount,
    deadlockCount: finalCompletion.deadlockCount,
    episodeReward: finalCompletion.episodeReward,
    qTableUpdatesCount: finalCompletion.qTableUpdatesCount,
    trajectorySamples: finalCompletion.trajectorySamples,
    decisionHistory: finalCompletion.decisionHistory,
    robotStateBeforeCompletion: finalCompletion.robotStateBeforeCompletion,
    environmentalConditionsSummary:
      finalCompletion.environmentalConditionsSummary,
    pedestrianDetectionsCount: finalCompletion.pedestrianDetectionsCount,
    predictedEncountersCount: finalCompletion.predictedEncountersCount,
    avoidedEncountersCount: finalCompletion.avoidedEncountersCount,
    unnecessaryStopsCount: finalCompletion.unnecessaryStopsCount,
    predictionAccuracyPct: finalCompletion.predictionAccuracyPct,
    pedestrianReplanCount: finalCompletion.pedestrianReplanCount,
    speedReductionEventsCount: finalCompletion.speedReductionEventsCount,
    reducedSpeedTimeSec: finalCompletion.reducedSpeedTimeSec,
    pedestrianWaitingTimeSec: finalCompletion.pedestrianWaitingTimeSec,
    speedBasedAvoidanceCount: finalCompletion.speedBasedAvoidanceCount,
    localBypassCount: finalCompletion.localBypassCount,
    globalReplanCount: finalCompletion.globalReplanCount,
    pedestrianDistribution: finalCompletion.pedestrianDistribution,
    predictionHorizonSec: finalCompletion.predictionHorizonSec,
    totalWaitingTimeSec: finalCompletion.totalWaitingTimeSec,
    elevatorWaitTimeSec: finalCompletion.elevatorWaitTimeSec,
    elevatorUsed: finalCompletion.elevatorUsed,
    elevatorStateEncountered: finalCompletion.elevatorStateEncountered,
    elevatorFaultMode: finalCompletion.elevatorFaultMode,
    elevatorReroutedToBackup: finalCompletion.elevatorReroutedToBackup,
    elevatorAssistanceRequested: finalCompletion.elevatorAssistanceRequested,
    elevatorEventsLog: finalCompletion.elevatorEventsLog,
    batteryConsumedPct: finalCompletion.batteryConsumedPct,
    failureReason: finalCompletion.failureReason,
    failureType: finalCompletion.failureType,
    obstacleType: finalCompletion.obstacleType,
    failureCoordinates: finalCompletion.failureCoordinates,
    rootCause: finalCompletion.rootCause,
    mitigationSuggested: finalCompletion.mitigationSuggested,
  };

  if (baseRecord.status === 'Failed') {
    const diag = diagnoseExperimentFailure(baseRecord, seededScenario);
    baseRecord.failureCategory = diag.failureCategory;
    baseRecord.failureDiagnosis = diag;
    baseRecord.rootCause = diag.probableRootCause;
    baseRecord.mitigationSuggested = diag.suggestedImprovement;
  }

  return {
    experimentRecord: baseRecord,
    completionData: finalCompletion,
    stepsExecuted: steps,
  };
}

export interface BatchExperimentRunnerOptions {
  scenarios: ScenarioConfig[];
  policy: NavigationPolicyConfig;
  robotId?: string;
  environment?: EnvironmentDefinition;
  episodesPerScenario: number;
  candidatePolicyState?: CandidatePolicyState | null;
  onEpisodeFinished?: (
    record: ExperimentRecord,
    completedCount: number,
    totalCount: number
  ) => void;
  shouldCancel?: () => boolean;
}

/**
 * Section 4: Asynchronous Headless Batch Experiment Runner.
 * Yields to the browser event loop between episodes so the UI progress bar updates smoothly.
 */
export async function runHeadlessBatchExperiments(
  options: BatchExperimentRunnerOptions
): Promise<ExperimentRecord[]> {
  const {
    scenarios,
    policy,
    robotId = 'bot-rover-01',
    environment,
    episodesPerScenario,
    candidatePolicyState = null,
    onEpisodeFinished,
    shouldCancel,
  } = options;

  const results: ExperimentRecord[] = [];
  const totalCount = scenarios.length * episodesPerScenario;
  let completedCount = 0;

  for (const scen of scenarios) {
    const baseSeed =
      scen.randomSeed ?? scen.pedestrianDistribution?.randomSeed ?? 101;

    for (let ep = 0; ep < episodesPerScenario; ep++) {
      if (shouldCancel?.()) {
        return results;
      }

      const epSeed = ep === 0 ? baseSeed : baseSeed + ep * 43;
      const useBaselineReactive =
        policy.id === 'pol-astar-fast' ||
        (policy.isReadOnlyBaseline && !policy.isCandidatePolicy);

      const { experimentRecord } = runSingleHeadlessEpisode({
        scenario: scen,
        policy,
        robotId,
        environment,
        seedOverride: epSeed,
        runType: 'Batch',
        candidatePolicyState: policy.isCandidatePolicy
          ? candidatePolicyState
          : null,
        isTrainingEpisode: false,
        useBaselineReactiveMode: useBaselineReactive,
      });

      results.push(experimentRecord);
      completedCount += 1;
      onEpisodeFinished?.(experimentRecord, completedCount, totalCount);

      // Yield briefly to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }

  return results;
}

export interface PolicyTrainingRunOptions {
  trainingScenarios: ScenarioConfig[];
  candidatePolicyState: CandidatePolicyState;
  episodesCount: number;
  robotId?: string;
  environment?: EnvironmentDefinition;
  onEpisodeTrained?: (
    episodeRecord: TrainingEpisodeRecord,
    experimentRecord: ExperimentRecord,
    updatedPolicy: CandidatePolicyState,
    completedEpisodes: number,
    totalEpisodes: number
  ) => void;
  shouldPauseOrCancel?: () => 'run' | 'pause' | 'cancel';
}

/**
 * Section 8: Executes the Tabular Q-Learning Training Loop across selected training scenarios.
 * Updates Q-table weights, decays exploration rate (epsilon), records episode history,
 * and increments candidate policy version.
 */
export async function executePolicyTrainingLoop(
  options: PolicyTrainingRunOptions
): Promise<{
  updatedPolicyState: CandidatePolicyState;
  episodeRecords: TrainingEpisodeRecord[];
  experimentRecords: ExperimentRecord[];
}> {
  const {
    trainingScenarios,
    candidatePolicyState,
    episodesCount,
    robotId = 'bot-rover-01',
    environment,
    onEpisodeTrained,
    shouldPauseOrCancel,
  } = options;

  const validScenarios =
    trainingScenarios.length > 0
      ? trainingScenarios
      : [];

  const allRobots = loadRobots();
  const trainingRobot =
    allRobots.find((r) => r.id === robotId) ??
    ROBOT_UNITS.find((r) => r.id === robotId) ??
    ROBOT_UNITS[0];

  // Deep clone mutable state so React state updates cleanly
  const workingState: CandidatePolicyState = JSON.parse(
    JSON.stringify(candidatePolicyState)
  );
  workingState.trainedRobotId = trainingRobot.id;
  workingState.trainedRobotName = trainingRobot.name;
  workingState.trainedEnvironmentId =
    environment?.id ?? 'env-campus-standard';
  workingState.trainedEnvironmentName =
    environment?.name ?? 'University Campus Testbed';

  const candidatePolicyConfig: NavigationPolicyConfig =
    NAVIGATION_POLICIES.find((p) => p.id === 'pol-candidate-rl') ?? {
      id: 'pol-candidate-rl',
      name: 'Candidate Q-Learning Policy',
      version: workingState.version,
      algorithm: 'Tabular Q-Learning + Safety Layer',
      description: 'Trainable Tabular Q-Learning Policy with Hard Safety Layer',
      safetyClearanceM: 1.75,
      cruiseSpeedFactor: 0.88,
      replanThresholdSec: 1.5,
      constructionAvoidanceWeight: 2.8,
      batteryReserveThresholdPct: 20,
      isCandidatePolicy: true,
    };

  const newEpisodeRecords: TrainingEpisodeRecord[] = [];
  const newExperimentRecords: ExperimentRecord[] = [];

  for (let i = 0; i < episodesCount; i++) {
    while (shouldPauseOrCancel?.() === 'pause') {
      await new Promise((r) => setTimeout(r, 120));
    }
    if (shouldPauseOrCancel?.() === 'cancel') {
      break;
    }

    const scen = validScenarios[i % validScenarios.length];
    const baseSeed =
      scen.randomSeed ?? scen.pedestrianDistribution?.randomSeed ?? 202;
    const cycleIndex = Math.floor(i / validScenarios.length);
    const episodeSeed = baseSeed + cycleIndex * 31;

    const episodeNum = workingState.totalEpisodesTrained + 1;
    const epsilonUsed = Number(
      workingState.hyperparameters.explorationRate.toFixed(3)
    );

    workingState.totalEpisodesTrained = episodeNum;
    workingState.isTrained = true;
    workingState.version = `1.${Math.floor(episodeNum / 5)}.${episodeNum}-rl`;
    workingState.lastTrainedAt = new Date()
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const { experimentRecord, completionData, stepsExecuted } =
      runSingleHeadlessEpisode({
        scenario: scen,
        policy: {
          ...candidatePolicyConfig,
          version: workingState.version,
        },
        robotId,
        environment,
        seedOverride: episodeSeed,
        runType: 'Training',
        candidatePolicyState: workingState,
        isTrainingEpisode: true,
        useBaselineReactiveMode: false,
      });

    // Decay exploration rate epsilon after episode
    workingState.hyperparameters.explorationRate = Number(
      Math.max(
        workingState.hyperparameters.minExplorationRate,
        workingState.hyperparameters.explorationRate *
          workingState.hyperparameters.explorationDecay
      ).toFixed(4)
    );

    const trainingEp: TrainingEpisodeRecord = {
      id: `TRN-EP-${String(episodeNum).padStart(3, '0')}`,
      episodeNumber: episodeNum,
      timestamp: experimentRecord.timestamp,
      scenarioId: scen.id,
      scenarioName: scen.name,
      scenarioSeed: episodeSeed,
      policyVersion: workingState.version,
      status: experimentRecord.status,
      totalReward: completionData.episodeReward,
      stepsCount: stepsExecuted,
      qTableUpdatesCount: completionData.qTableUpdatesCount ?? 0,
      durationSec: experimentRecord.durationSec,
      distanceMeters: experimentRecord.distanceMeters,
      collisions: experimentRecord.collisions,
      globalReplanCount:
        experimentRecord.globalReplanCount ?? experimentRecord.replanCount,
      unnecessaryReplanCount: experimentRecord.unnecessaryReplanCount ?? 0,
      waitingTimeSec: experimentRecord.totalWaitingTimeSec ?? 0,
      deadlockCount: experimentRecord.deadlockCount ?? 0,
      batteryConsumedPct: experimentRecord.batteryConsumedPct,
      epsilonUsed,
      actionCounts: completionData.episodeActionCounts,
      safetyInterventionCount: experimentRecord.safetyInterventionCount ?? 0,
      failureCategory: experimentRecord.failureCategory,
    };

    workingState.trainingHistory.push(trainingEp);
    newEpisodeRecords.push(trainingEp);
    newExperimentRecords.push(experimentRecord);

    // Update summary metrics on workingState
    const allHist = workingState.trainingHistory;
    const succCount = allHist.filter((h) => h.status === 'Success').length;
    const failCount = allHist.length - succCount;
    const meanRew =
      allHist.length > 0
        ? allHist.reduce((s, h) => s + h.totalReward, 0) / allHist.length
        : 0;
    const totalSaf = allHist.reduce(
      (s, h) => s + (h.safetyInterventionCount ?? 0),
      0
    );
    workingState.trainingMetricsSummary = {
      episodesCompleted: allHist.length,
      successCount: succCount,
      failureCount: failCount,
      successRatePct:
        allHist.length > 0
          ? Number(((succCount / allHist.length) * 100).toFixed(1))
          : 0,
      meanReward: Number(meanRew.toFixed(1)),
      safetyInterventions: totalSaf,
      learnedStatesCount: Object.keys(workingState.qTable).length,
      totalQTableUpdates: workingState.totalQTableUpdates ?? 0,
    };

    onEpisodeTrained?.(
      trainingEp,
      experimentRecord,
      JSON.parse(JSON.stringify(workingState)),
      i + 1,
      episodesCount
    );

    await new Promise((r) => setTimeout(r, 12));
  }

  return {
    updatedPolicyState: workingState,
    episodeRecords: newEpisodeRecords,
    experimentRecords: newExperimentRecords,
  };
}

function computeAggregateBenchmarkMetrics(
  policyId: string,
  policyName: string,
  policyVersion: string,
  records: ExperimentRecord[]
): BenchmarkAggregateMetrics {
  const n = Math.max(1, records.length);
  const successes = records.filter((r) => r.status === 'Success').length;
  const navigationFailuresCount = records.filter((r) => r.status === 'Failed').length;
  const runsWithCollision = records.filter((r) => r.collisions > 0).length;
  const totalCollisions = records.reduce((s, r) => s + r.collisions, 0);
  const avgTime = records.reduce((s, r) => s + r.durationSec, 0) / n;
  const avgDist = records.reduce((s, r) => s + r.distanceMeters, 0) / n;
  const totalDeadlocks = records.reduce((s, r) => s + (r.deadlockCount ?? 0), 0);
  const avgWait =
    records.reduce((s, r) => s + (r.totalWaitingTimeSec ?? 0), 0) / n;
  const avgReplans =
    records.reduce(
      (s, r) => s + (r.globalReplanCount ?? r.replanCount ?? 0),
      0
    ) / n;
  const avgUnnecessary =
    records.reduce((s, r) => s + (r.unnecessaryReplanCount ?? 0), 0) / n;
  const avgBat = records.reduce((s, r) => s + r.batteryConsumedPct, 0) / n;
  const avgReward =
    records.reduce((s, r) => s + (r.episodeReward ?? 0), 0) / n;
  const totalSafetyInterventions = records.reduce(
    (s, r) => s + (r.safetyInterventionCount ?? 0),
    0
  );
  const elevatorFailuresCount = records.filter(
    (r) =>
      r.status === 'Failed' &&
      (r.failureCategory === 'Elevator-related failure' ||
        r.failureType === 'Elevator Mechanical Failure' ||
        r.failureType === 'Elevator Unavailable')
  ).length;

  return {
    policyId,
    policyName,
    policyVersion,
    episodesCount: records.length,
    successRatePct: Number(((successes / n) * 100).toFixed(1)),
    navigationFailuresCount,
    collisionRatePct: Number(((runsWithCollision / n) * 100).toFixed(1)),
    totalCollisions,
    avgCompletionTimeSec: Number(avgTime.toFixed(1)),
    avgDistanceMeters: Number(avgDist.toFixed(1)),
    totalDeadlocks,
    avgWaitingTimeSec: Number(avgWait.toFixed(1)),
    avgGlobalReplans: Number(avgReplans.toFixed(2)),
    avgUnnecessaryReplans: Number(avgUnnecessary.toFixed(2)),
    avgBatteryConsumedPct: Number(avgBat.toFixed(1)),
    avgReward: Number(avgReward.toFixed(1)),
    totalSafetyInterventions,
    elevatorFailuresCount,
  };
}

/**
 * Runs a synchronized Before vs. After Demonstration on a single challenging scenario:
 * A. Original Baseline Policy (or Untrained Policy)
 * B. Trained Candidate Policy (with frozen Q-table)
 * Under identical robot configuration, starting position, destination, environment, and scenario seed.
 */
export function runBeforeAfterDemonstration(options: {
  scenario: ScenarioConfig;
  baselinePolicy: NavigationPolicyConfig;
  candidatePolicyState: CandidatePolicyState;
  robotId?: string;
  environment?: EnvironmentDefinition;
  seedOverride?: number;
}): {
  demonstration: BeforeAfterDemonstrationResult;
  baselineExperiment: ExperimentRecord;
  candidateExperiment: ExperimentRecord;
} {
  const {
    scenario,
    baselinePolicy,
    candidatePolicyState,
    robotId = 'bot-rover-01',
    environment,
    seedOverride,
  } = options;

  const seed =
    seedOverride ??
    scenario.randomSeed ??
    scenario.pedestrianDistribution?.randomSeed ??
    333;

  // 1. Run A: Original Baseline Policy
  const baseRun = runSingleHeadlessEpisode({
    scenario,
    policy: baselinePolicy,
    robotId,
    environment,
    seedOverride: seed,
    runType: 'Evaluation',
    candidatePolicyState: null,
    isTrainingEpisode: false,
    useBaselineReactiveMode: true,
  });

  // 2. Run B: Trained Candidate Policy (strictly frozen Q-table: isTrainingEpisode = false)
  const frozenState: CandidatePolicyState = JSON.parse(
    JSON.stringify(candidatePolicyState)
  );
  const candidatePolicyConfig: NavigationPolicyConfig = {
    id: 'pol-candidate-rl',
    name: frozenState.name,
    version: frozenState.version,
    algorithm: 'Tabular Q-Learning + Safety Layer',
    description: 'Frozen Tabular Q-Learning Policy with Hard Safety Layer',
    safetyClearanceM: 1.75,
    cruiseSpeedFactor: 0.88,
    replanThresholdSec: 1.5,
    constructionAvoidanceWeight: 2.8,
    batteryReserveThresholdPct: 20,
    isCandidatePolicy: true,
  };

  const candRun = runSingleHeadlessEpisode({
    scenario,
    policy: candidatePolicyConfig,
    robotId,
    environment,
    seedOverride: seed,
    runType: 'Evaluation',
    candidatePolicyState: frozenState,
    isTrainingEpisode: false,
    useBaselineReactiveMode: false,
  });

  const bRec = baseRun.experimentRecord;
  const cRec = candRun.experimentRecord;

  const timeDelta = Number((bRec.durationSec - cRec.durationSec).toFixed(1));
  const replanDelta =
    (bRec.globalReplanCount ?? bRec.replanCount) -
    (cRec.globalReplanCount ?? cRec.replanCount);
  const waitDelta = Number(
    ((bRec.totalWaitingTimeSec ?? 0) - (cRec.totalWaitingTimeSec ?? 0)).toFixed(1)
  );
  const safDelta =
    (bRec.safetyInterventionCount ?? 0) - (cRec.safetyInterventionCount ?? 0);

  let improvementSummary = '';
  if (bRec.status === 'Failed' && cRec.status === 'Success') {
    improvementSummary = `Closed-Loop Breakthrough: Baseline Policy failed (${
      bRec.failureType ?? 'Navigation Failure'
    } after ${bRec.durationSec}s, ${
      bRec.globalReplanCount ?? bRec.replanCount
    } replans, ${
      bRec.totalWaitingTimeSec ?? 0
    }s waiting), whereas the Trained Candidate Policy (${
      frozenState.version
    }) successfully completed delivery in ${cRec.durationSec}s with ${
      cRec.globalReplanCount ?? cRec.replanCount
    } global replans and ${cRec.totalWaitingTimeSec ?? 0}s waiting time.`;
  } else if (bRec.status === 'Success' && cRec.status === 'Success') {
    improvementSummary = `Both policies completed delivery, with Trained Candidate (${
      frozenState.version
    }) changing completion time by ${
      timeDelta >= 0 ? `-${timeDelta}s faster` : `+${Math.abs(timeDelta)}s`
    } (${bRec.durationSec}s → ${cRec.durationSec}s), reducing global replans by ${replanDelta} (${
      bRec.globalReplanCount ?? bRec.replanCount
    } → ${
      cRec.globalReplanCount ?? cRec.replanCount
    }), reducing waiting time by ${waitDelta}s, and reducing safety interventions by ${safDelta}.`;
  } else if (bRec.status === 'Success' && cRec.status === 'Failed') {
    improvementSummary = `Regression Detected: Baseline completed delivery in ${bRec.durationSec}s, whereas Candidate Policy (${frozenState.version}) failed (${cRec.failureType ?? 'Navigation Failure'}). Additional training episodes on this scenario family are recommended.`;
  } else {
    improvementSummary = `Both Baseline (${bRec.failureType}) and Candidate (${cRec.failureType}) halted safely without completing delivery. Additional training episodes or corridor clearance required.`;
  }

  const demonstration: BeforeAfterDemonstrationResult = {
    id: `DEMO-CMP-${Date.now().toString().slice(-6)}`,
    timestamp: bRec.timestamp,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scenarioSeed: seed,
    robotId: bRec.robotId,
    robotName: bRec.robotName,
    environmentId: bRec.environmentId ?? 'env-campus-main',
    environmentName: bRec.environmentName ?? 'University Innovation Campus',
    originPosition: {
      x: bRec.originCoordinates?.x ?? -15,
      z: bRec.originCoordinates?.z ?? -20,
      floor: bRec.originFloor ?? 0,
      label: bRec.originName,
    },
    destinationPosition: {
      x: bRec.destinationCoordinates?.x ?? 15,
      z: bRec.destinationCoordinates?.z ?? 18,
      floor: bRec.destinationFloor ?? 0,
      label: bRec.destinationName,
    },
    baselineRun: {
      policyLabel: baselinePolicy.name,
      policyVersion: baselinePolicy.version,
      status: bRec.status,
      durationSec: bRec.durationSec,
      distanceMeters: bRec.distanceMeters,
      collisions: bRec.collisions,
      globalReplanCount: bRec.globalReplanCount ?? bRec.replanCount,
      unnecessaryReplanCount: bRec.unnecessaryReplanCount ?? 0,
      waitingTimeSec: bRec.totalWaitingTimeSec ?? 0,
      deadlockCount: bRec.deadlockCount ?? 0,
      safetyInterventions: bRec.safetyInterventionCount ?? 0,
      episodeReward: bRec.episodeReward ?? 0,
      batteryConsumedPct: bRec.batteryConsumedPct,
      failureCategory: bRec.failureCategory,
      failureReason: bRec.failureReason,
      decisionHistory: bRec.decisionHistory ?? [],
      trajectory: bRec.trajectorySamples ?? [],
    },
    trainedCandidateRun: {
      policyLabel: `${frozenState.name} (${frozenState.version})`,
      policyVersion: frozenState.version,
      status: cRec.status,
      durationSec: cRec.durationSec,
      distanceMeters: cRec.distanceMeters,
      collisions: cRec.collisions,
      globalReplanCount: cRec.globalReplanCount ?? cRec.replanCount,
      unnecessaryReplanCount: cRec.unnecessaryReplanCount ?? 0,
      waitingTimeSec: cRec.totalWaitingTimeSec ?? 0,
      deadlockCount: cRec.deadlockCount ?? 0,
      safetyInterventions: cRec.safetyInterventionCount ?? 0,
      episodeReward: cRec.episodeReward ?? 0,
      batteryConsumedPct: cRec.batteryConsumedPct,
      failureCategory: cRec.failureCategory,
      failureReason: cRec.failureReason,
      decisionHistory: cRec.decisionHistory ?? [],
      trajectory: cRec.trajectorySamples ?? [],
    },
    improvementSummary,
  };

  return {
    demonstration,
    baselineExperiment: bRec,
    candidateExperiment: cRec,
  };
}

/**
 * Section 9: FAIR BASELINE VS. TRAINED POLICY BENCHMARKING
 * Evaluates the Baseline Policy and the Trained Candidate Policy on the
 * EXACT SAME held-out test scenarios and identical random seeds.
 * Enforces held-out separation by filtering out trainingScenarioIds if overlap exists.
 */
export async function runFairPolicyBenchmarkSuite(options: {
  heldOutScenarios: ScenarioConfig[];
  baselinePolicy: NavigationPolicyConfig;
  candidatePolicyState: CandidatePolicyState;
  episodesPerScenario?: number;
  robotId?: string;
  environment?: EnvironmentDefinition;
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<{
  benchmarkResult: BenchmarkSuiteResult;
  recordedExperiments: ExperimentRecord[];
}> {
  const {
    heldOutScenarios,
    baselinePolicy,
    candidatePolicyState,
    episodesPerScenario = 1,
    robotId = 'bot-rover-01',
    environment,
    onProgress,
  } = options;

  // Enforce strict held-out separation: exclude training scenarios when non-training scenarios exist
  const trainingIds = new Set(candidatePolicyState.trainingScenarioIds ?? []);
  const strictHeldOut = heldOutScenarios.filter((s) => !trainingIds.has(s.id));
  const evaluationScenarios =
    strictHeldOut.length > 0 ? strictHeldOut : heldOutScenarios;

  const candidatePolicyConfig: NavigationPolicyConfig = {
    id: 'pol-candidate-rl',
    name: candidatePolicyState.name,
    version: candidatePolicyState.version,
    algorithm: 'Tabular Q-Learning + Safety Layer',
    description:
      'Trained Tabular Q-Learning Candidate Policy with Hard Safety Layer',
    safetyClearanceM: 1.75,
    cruiseSpeedFactor: 0.88,
    replanThresholdSec: 1.5,
    constructionAvoidanceWeight: 2.8,
    batteryReserveThresholdPct: 20,
    isCandidatePolicy: true,
  };

  const baselineRecords: ExperimentRecord[] = [];
  const candidateRecords: ExperimentRecord[] = [];
  const scenarioComparisons: BenchmarkScenarioComparison[] = [];
  const allRecordedExperiments: ExperimentRecord[] = [];

  const totalSteps = evaluationScenarios.length * episodesPerScenario * 2;
  let stepCounter = 0;

  for (const scen of evaluationScenarios) {
    const baseSeed =
      scen.randomSeed ?? scen.pedestrianDistribution?.randomSeed ?? 303;

    for (let ep = 0; ep < episodesPerScenario; ep++) {
      const seed = ep === 0 ? baseSeed : baseSeed + ep * 43;

      // 1. Run Baseline Policy on (scen, seed)
      const baseRes = runSingleHeadlessEpisode({
        scenario: scen,
        policy: baselinePolicy,
        robotId,
        environment,
        seedOverride: seed,
        runType: 'Benchmark',
        candidatePolicyState: null,
        isTrainingEpisode: false,
        useBaselineReactiveMode: true,
      });
      baselineRecords.push(baseRes.experimentRecord);
      allRecordedExperiments.push(baseRes.experimentRecord);
      stepCounter += 1;
      onProgress?.(
        stepCounter,
        totalSteps,
        `Baseline on ${scen.name} (Seed ${seed})`
      );
      await new Promise((r) => setTimeout(r, 6));

      // 2. Run Candidate Q-Learning Policy on identical (scen, seed)
      const candRes = runSingleHeadlessEpisode({
        scenario: scen,
        policy: candidatePolicyConfig,
        robotId,
        environment,
        seedOverride: seed,
        runType: 'Benchmark',
        candidatePolicyState,
        isTrainingEpisode: false,
        useBaselineReactiveMode: false,
      });
      candidateRecords.push(candRes.experimentRecord);
      allRecordedExperiments.push(candRes.experimentRecord);
      stepCounter += 1;
      onProgress?.(
        stepCounter,
        totalSteps,
        `Candidate (${candidatePolicyState.version}) on ${scen.name} (Seed ${seed})`
      );
      await new Promise((r) => setTimeout(r, 6));

      scenarioComparisons.push({
        scenarioId: scen.id,
        scenarioName:
          episodesPerScenario > 1
            ? `${scen.name} (Ep ${ep + 1})`
            : scen.name,
        scenarioCategory: scen.category,
        scenarioSeed: seed,
        difficulty: scen.difficulty ?? 'High',
        generationSource: scen.generationSource ?? 'Preset',
        baseline: {
          status: baseRes.experimentRecord.status,
          durationSec: baseRes.experimentRecord.durationSec,
          distanceMeters: baseRes.experimentRecord.distanceMeters,
          collisions: baseRes.experimentRecord.collisions,
          globalReplanCount:
            baseRes.experimentRecord.globalReplanCount ??
            baseRes.experimentRecord.replanCount,
          unnecessaryReplanCount:
            baseRes.experimentRecord.unnecessaryReplanCount ?? 0,
          waitingTimeSec: baseRes.experimentRecord.totalWaitingTimeSec ?? 0,
          deadlockCount: baseRes.experimentRecord.deadlockCount ?? 0,
          batteryConsumedPct: baseRes.experimentRecord.batteryConsumedPct,
          episodeReward: baseRes.experimentRecord.episodeReward ?? 0,
          safetyInterventions:
            baseRes.experimentRecord.safetyInterventionCount ?? 0,
          failureCategory: baseRes.experimentRecord.failureCategory,
          failureReason: baseRes.experimentRecord.failureReason,
        },
        candidate: {
          status: candRes.experimentRecord.status,
          durationSec: candRes.experimentRecord.durationSec,
          distanceMeters: candRes.experimentRecord.distanceMeters,
          collisions: candRes.experimentRecord.collisions,
          globalReplanCount:
            candRes.experimentRecord.globalReplanCount ??
            candRes.experimentRecord.replanCount,
          unnecessaryReplanCount:
            candRes.experimentRecord.unnecessaryReplanCount ?? 0,
          waitingTimeSec: candRes.experimentRecord.totalWaitingTimeSec ?? 0,
          deadlockCount: candRes.experimentRecord.deadlockCount ?? 0,
          batteryConsumedPct: candRes.experimentRecord.batteryConsumedPct,
          episodeReward: candRes.experimentRecord.episodeReward ?? 0,
          safetyInterventions:
            candRes.experimentRecord.safetyInterventionCount ?? 0,
          failureCategory: candRes.experimentRecord.failureCategory,
          failureReason: candRes.experimentRecord.failureReason,
        },
      });
    }
  }

  const baselineMetrics = computeAggregateBenchmarkMetrics(
    baselinePolicy.id,
    baselinePolicy.name,
    baselinePolicy.version,
    baselineRecords
  );

  const candidateMetrics = computeAggregateBenchmarkMetrics(
    candidatePolicyConfig.id,
    candidatePolicyState.name,
    candidatePolicyState.version,
    candidateRecords
  );

  const failureCategoriesImproved: string[] = [];
  const failureCategoriesRegressed: string[] = [];
  const remainingWeaknesses: string[] = [];

  if (candidateMetrics.avgGlobalReplans < baselineMetrics.avgGlobalReplans) {
    failureCategoriesImproved.push(
      `Excessive global replanning reduced from ${baselineMetrics.avgGlobalReplans.toFixed(
        2
      )} to ${candidateMetrics.avgGlobalReplans.toFixed(2)} avg replans/run`
    );
  } else if (candidateMetrics.avgGlobalReplans > baselineMetrics.avgGlobalReplans) {
    failureCategoriesRegressed.push(
      `Global replanning increased (${baselineMetrics.avgGlobalReplans.toFixed(
        2
      )} → ${candidateMetrics.avgGlobalReplans.toFixed(2)})`
    );
  }

  if (candidateMetrics.avgCompletionTimeSec < baselineMetrics.avgCompletionTimeSec) {
    failureCategoriesImproved.push(
      `Excessive delivery time & corridor delays reduced by ${(
        baselineMetrics.avgCompletionTimeSec -
        candidateMetrics.avgCompletionTimeSec
      ).toFixed(1)}s on average`
    );
  } else if (
    candidateMetrics.avgCompletionTimeSec >
    baselineMetrics.avgCompletionTimeSec + 0.5
  ) {
    failureCategoriesRegressed.push(
      `Average delivery time increased by ${(
        candidateMetrics.avgCompletionTimeSec -
        baselineMetrics.avgCompletionTimeSec
      ).toFixed(1)}s`
    );
  }

  if (candidateMetrics.avgDistanceMeters < baselineMetrics.avgDistanceMeters) {
    failureCategoriesImproved.push(
      `Pedestrian interaction detours shortened from ${baselineMetrics.avgDistanceMeters.toFixed(
        1
      )}m to ${candidateMetrics.avgDistanceMeters.toFixed(1)}m`
    );
  }

  if (candidateMetrics.successRatePct > baselineMetrics.successRatePct) {
    failureCategoriesImproved.push(
      `Mission success rate improved from ${baselineMetrics.successRatePct.toFixed(
        1
      )}% to ${candidateMetrics.successRatePct.toFixed(1)}%`
    );
  } else if (candidateMetrics.successRatePct < baselineMetrics.successRatePct) {
    failureCategoriesRegressed.push(
      `Mission success rate decreased from ${baselineMetrics.successRatePct.toFixed(
        1
      )}% to ${candidateMetrics.successRatePct.toFixed(1)}%`
    );
  }

  if (candidateMetrics.avgReward > baselineMetrics.avgReward) {
    failureCategoriesImproved.push(
      `Mean episode reward improved from ${baselineMetrics.avgReward.toFixed(
        1
      )} to ${candidateMetrics.avgReward.toFixed(1)}`
    );
  }

  // Identify remaining weaknesses honestly
  for (const comp of scenarioComparisons) {
    if (comp.candidate.status === 'Failed') {
      remainingWeaknesses.push(
        `${comp.scenarioName}: Failed (${
          comp.candidate.failureCategory ?? 'Navigation failure'
        })`
      );
    } else if (comp.candidate.waitingTimeSec >= 5.0) {
      remainingWeaknesses.push(
        `${comp.scenarioName}: Elevated pedestrian/elevator wait time (${comp.candidate.waitingTimeSec.toFixed(
          1
        )}s)`
      );
    }
  }
  if (remainingWeaknesses.length === 0) {
    remainingWeaknesses.push(
      'Extreme topologically sealed corridors (Unreachable destination) still require safe mission halt by design.'
    );
  }

  const rewardDelta = candidateMetrics.avgReward - baselineMetrics.avgReward;
  const replanDelta =
    baselineMetrics.avgGlobalReplans - candidateMetrics.avgGlobalReplans;

  const overallSummary = `Evaluated across ${
    evaluationScenarios.length
  } held-out test scenarios in ${
    environment?.name ?? 'University Campus Testbed'
  } (${
    baselineRecords.length
  } episodes per policy with identical seeds). Candidate Policy (${
    candidatePolicyState.version
  }) achieved ${candidateMetrics.successRatePct.toFixed(
    1
  )}% success rate vs. ${baselineMetrics.successRatePct.toFixed(
    1
  )}% Baseline, reduced average global replans by ${replanDelta.toFixed(
    2
  )} per run (${baselineMetrics.avgGlobalReplans.toFixed(
    2
  )} → ${candidateMetrics.avgGlobalReplans.toFixed(
    2
  )}), changed average completion time from ${baselineMetrics.avgCompletionTimeSec.toFixed(
    1
  )}s to ${candidateMetrics.avgCompletionTimeSec.toFixed(
    1
  )}s, and shifted mean episode reward by ${
    rewardDelta >= 0 ? `+${rewardDelta.toFixed(1)}` : rewardDelta.toFixed(1)
  } (${baselineMetrics.avgReward.toFixed(1)} → ${candidateMetrics.avgReward.toFixed(
    1
  )}).`;

  const allRobots = loadRobots();
  const benchRobot =
    allRobots.find((r) => r.id === robotId) ??
    ROBOT_UNITS.find((r) => r.id === robotId) ??
    ROBOT_UNITS[0];

  const benchmarkResult: BenchmarkSuiteResult = {
    id: `BENCH-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    environmentId: environment?.id ?? 'env-campus-standard',
    environmentName: environment?.name ?? 'University Campus Testbed',
    environmentVersion: environment?.version ?? '1.0',
    robotId: benchRobot.id,
    robotName: benchRobot.name,
    candidatePolicyVersion: candidatePolicyState.version,
    heldOutScenariosCount: evaluationScenarios.length,
    episodesPerScenario,
    baselineMetrics,
    candidateMetrics,
    scenarioComparisons,
    failureCategoriesImproved,
    failureCategoriesRegressed,
    remainingWeaknesses,
    overallSummary,
  };

  return {
    benchmarkResult,
    recordedExperiments: allRecordedExperiments,
  };
}

/**
 * PART 5 & PART 11: CROSS-ROBOT HARDWARE BENCHMARKING
 * Answers: "Which robot configuration performs better in this particular environment?"
 * Evaluates multiple selected robot hardware profiles on the EXACT SAME scenarios,
 * random seeds, navigation policy, and mission payload weight.
 */
export async function runCrossRobotHardwareBenchmarkSuite(options: {
  robots: RobotUnitConfig[];
  scenarios: ScenarioConfig[];
  policy: NavigationPolicyConfig;
  environment?: EnvironmentDefinition;
  candidatePolicyState?: CandidatePolicyState | null;
  requestedPayloadKg?: number;
  episodesPerScenario?: number;
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<{
  benchmarkResult: CrossRobotBenchmarkResult;
  recordedExperiments: ExperimentRecord[];
}> {
  const {
    robots,
    scenarios,
    policy,
    environment,
    candidatePolicyState = null,
    requestedPayloadKg = 15,
    episodesPerScenario = 1,
    onProgress,
  } = options;

  const evalRobots = robots.length > 0 ? robots : ROBOT_UNITS;
  const evalScenarios = scenarios.length > 0 ? scenarios.slice(0, 4) : [];

  const entries: CrossRobotComparisonEntry[] = [];
  const allRecordedExperiments: ExperimentRecord[] = [];

  const totalRuns = evalRobots.length * evalScenarios.length * episodesPerScenario;
  let completedRuns = 0;

  for (const robot of evalRobots) {
    const robotRecords: ExperimentRecord[] = [];
    const payloadCompatible = requestedPayloadKg <= robot.payloadCapacityKg;

    for (const scen of evalScenarios) {
      const baseSeed =
        scen.randomSeed ?? scen.pedestrianDistribution?.randomSeed ?? 303;

      for (let ep = 0; ep < episodesPerScenario; ep++) {
        const seed = ep === 0 ? baseSeed : baseSeed + ep * 43;

        const { experimentRecord } = runSingleHeadlessEpisode({
          scenario: scen,
          policy,
          robotId: robot.id,
          robotConfigOverride: robot,
          environment,
          payloadKgOverride: requestedPayloadKg,
          seedOverride: seed,
          runType: 'Benchmark',
          candidatePolicyState: policy.isCandidatePolicy
            ? candidatePolicyState
            : null,
          isTrainingEpisode: false,
          useBaselineReactiveMode:
            policy.id === 'pol-astar-fast' ||
            Boolean(policy.isReadOnlyBaseline && !policy.isCandidatePolicy),
        });

        // If the requested mission payload exceeds the robot's structural payload limit,
        // apply an explicit overload penalty or failure annotation if close to limit
        if (!payloadCompatible && experimentRecord.status === 'Success') {
          const overloadFactor = requestedPayloadKg / Math.max(1, robot.payloadCapacityKg);
          if (overloadFactor > 1.25) {
            experimentRecord.status = 'Failed';
            experimentRecord.failureType = 'Battery Depletion';
            experimentRecord.failureCategory = 'Other or unclassified failure';
            experimentRecord.failureReason = `Payload Overload (${requestedPayloadKg} kg exceeds ${robot.name} ${robot.payloadCapacityKg} kg capacity by ${Math.round(
              (overloadFactor - 1) * 100
            )}%)`;
          } else {
            experimentRecord.durationSec = Number(
              (experimentRecord.durationSec * (1 + (overloadFactor - 1) * 0.35)).toFixed(1)
            );
            experimentRecord.batteryConsumedPct = Number(
              (experimentRecord.batteryConsumedPct * overloadFactor).toFixed(1)
            );
          }
        }

        robotRecords.push(experimentRecord);
        allRecordedExperiments.push(experimentRecord);
        completedRuns += 1;
        onProgress?.(
          completedRuns,
          totalRuns,
          `${robot.name} on ${scen.name} (Seed ${seed}, ${requestedPayloadKg}kg)`
        );
        await new Promise((r) => setTimeout(r, 6));
      }
    }

    const n = Math.max(1, robotRecords.length);
    const successes = robotRecords.filter((r) => r.status === 'Success').length;
    const failedRuns = robotRecords.filter((r) => r.status === 'Failed');
    const runsWithCollision = robotRecords.filter((r) => r.collisions > 0).length;
    const totalCollisions = robotRecords.reduce((s, r) => s + r.collisions, 0);
    const avgCompletionTimeSec = Number(
      (robotRecords.reduce((s, r) => s + r.durationSec, 0) / n).toFixed(1)
    );
    const avgDistanceMeters = Number(
      (robotRecords.reduce((s, r) => s + r.distanceMeters, 0) / n).toFixed(1)
    );
    const avgGlobalReplans = Number(
      (
        robotRecords.reduce(
          (s, r) => s + (r.globalReplanCount ?? r.replanCount ?? 0),
          0
        ) / n
      ).toFixed(2)
    );
    const totalSafetyInterventions = robotRecords.reduce(
      (s, r) => s + (r.safetyInterventionCount ?? 0),
      0
    );
    const avgBatteryConsumedPct = Number(
      (robotRecords.reduce((s, r) => s + r.batteryConsumedPct, 0) / n).toFixed(1)
    );
    const avgBatteryConsumedWh = Number(
      (((avgBatteryConsumedPct / 100) * robot.batteryCapacityWh)).toFixed(1)
    );

    const failureReasonsSet = new Set<string>();
    for (const f of failedRuns) {
      failureReasonsSet.add(
        f.failureReason || f.failureCategory || f.failureType || 'Navigation Failure'
      );
    }
    if (!payloadCompatible) {
      failureReasonsSet.add(
        `Requested ${requestedPayloadKg}kg exceeds ${robot.payloadCapacityKg}kg capacity`
      );
    }

    entries.push({
      robotId: robot.id,
      robotName: robot.name,
      robotModel: robot.model,
      maxSpeedMps: robot.maxSpeedMps,
      payloadCapacityKg: robot.payloadCapacityKg,
      batteryCapacityWh: robot.batteryCapacityWh,
      lidarRangeM: robot.lidarRangeM ?? 28,
      collisionRadiusM: robot.collisionRadiusM ?? 0.68,
      sensorSuite: robot.sensorSuite,
      payloadCompatible,
      episodesCount: robotRecords.length,
      successRatePct: Number(((successes / n) * 100).toFixed(1)),
      collisionRatePct: Number(((runsWithCollision / n) * 100).toFixed(1)),
      totalCollisions,
      avgCompletionTimeSec,
      avgDistanceMeters,
      navigationFailuresCount: failedRuns.length,
      avgGlobalReplans,
      totalSafetyInterventions,
      avgBatteryConsumedPct,
      avgBatteryConsumedWh,
      primaryFailureReasons: Array.from(failureReasonsSet),
    });
  }

  // Rank robots by: 1) payloadCompatible, 2) highest successRatePct, 3) lowest totalCollisions, 4) fastest avgCompletionTimeSec
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.payloadCompatible !== b.payloadCompatible) {
      return a.payloadCompatible ? -1 : 1;
    }
    if (b.successRatePct !== a.successRatePct) {
      return b.successRatePct - a.successRatePct;
    }
    if (a.totalCollisions !== b.totalCollisions) {
      return a.totalCollisions - b.totalCollisions;
    }
    return a.avgCompletionTimeSec - b.avgCompletionTimeSec;
  });

  const best = sortedEntries[0] ?? entries[0];
  const recommendationRationale = best
    ? `${best.robotName} achieved the strongest overall performance in ${
        environment?.name ?? 'University Campus Testbed'
      } for a ${requestedPayloadKg} kg payload under ${policy.name}: ${
        best.successRatePct
      }% success rate, ${best.totalCollisions} collisions, ${
        best.avgCompletionTimeSec
      }s average completion time, ${
        best.avgBatteryConsumedPct
      }% (${best.avgBatteryConsumedWh} Wh) average battery drain, and ${
        best.payloadCompatible
          ? `full payload compatibility (${best.payloadCapacityKg} kg max capacity)`
          : `payload capacity constraint (${best.payloadCapacityKg} kg max)`
      }.`
    : 'No robot entries evaluated.';

  const benchmarkResult: CrossRobotBenchmarkResult = {
    id: `RBOT-BENCH-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    environmentId: environment?.id ?? 'env-campus-standard',
    environmentName: environment?.name ?? 'University Campus Testbed',
    environmentVersion: environment?.version ?? '1.0',
    scenarioIds: evalScenarios.map((s) => s.id),
    scenarioNames: evalScenarios.map((s) => s.name),
    policyId: policy.id,
    policyName: policy.name,
    requestedPayloadKg,
    episodesPerScenario,
    seedBase:
      evalScenarios[0]?.randomSeed ??
      evalScenarios[0]?.pedestrianDistribution?.randomSeed ??
      303,
    entries,
    recommendedRobotId: best?.robotId ?? evalRobots[0].id,
    recommendedRobotName: best?.robotName ?? evalRobots[0].name,
    recommendationRationale,
  };

  return {
    benchmarkResult,
    recordedExperiments: allRecordedExperiments,
  };
}

