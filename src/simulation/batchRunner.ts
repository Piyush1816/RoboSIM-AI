import { NAVIGATION_POLICIES } from '../data/campusConfig';
import {
  BenchmarkAggregateMetrics,
  BenchmarkScenarioComparison,
  BenchmarkSuiteResult,
  CandidatePolicyState,
  ExperimentRecord,
  ExperimentRunType,
  NavigationPolicyConfig,
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
    robotId,
    {
      onComplete: (payload) => {
        capturedCompletion = payload;
      },
    }
  );

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

  const finalCompletion: SimulationCompletionData = capturedCompletion ?? {
    runSessionId: `HEADLESS-${Date.now()}`,
    scenarioId: seededScenario.id,
    scenarioName: seededScenario.name,
    scenarioSeed: effectiveSeed,
    robotId: controller.getCurrentRobot().id,
    robotName: controller.getCurrentRobot().name,
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: policy.version,
    isCandidatePolicy: Boolean(policy.isCandidatePolicy),
    originName: controller.getOriginLocation().name,
    destinationName: controller.getTargetLocation().name,
    status: 'Failed',
    durationSec: Number(controller.elapsedTimeSec.toFixed(1)),
    distanceMeters: Number(controller.distanceTraveledM.toFixed(1)),
    collisions: controller.collisionsCount,
    replanCount: controller.replanCount,
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
    robotId: finalCompletion.robotId,
    robotName: finalCompletion.robotName,
    policyId: finalCompletion.policyId,
    policyName: finalCompletion.policyName,
    policyVersion: finalCompletion.policyVersion ?? policy.version,
    isCandidatePolicy: finalCompletion.isCandidatePolicy,
    runType,
    originName: finalCompletion.originName,
    destinationName: finalCompletion.destinationName,
    status: finalCompletion.status,
    durationSec: finalCompletion.durationSec,
    distanceMeters: finalCompletion.distanceMeters,
    collisions: finalCompletion.collisions,
    replanCount: finalCompletion.replanCount,
    unnecessaryReplanCount: finalCompletion.unnecessaryReplanCount,
    deadlockCount: finalCompletion.deadlockCount,
    episodeReward: finalCompletion.episodeReward,
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
    onEpisodeTrained,
    shouldPauseOrCancel,
  } = options;

  const validScenarios =
    trainingScenarios.length > 0
      ? trainingScenarios
      : [];

  // Deep clone mutable state so React state updates cleanly
  const workingState: CandidatePolicyState = JSON.parse(
    JSON.stringify(candidatePolicyState)
  );

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
      failureCategory: experimentRecord.failureCategory,
    };

    workingState.trainingHistory.push(trainingEp);
    newEpisodeRecords.push(trainingEp);
    newExperimentRecords.push(experimentRecord);

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

  return {
    policyId,
    policyName,
    policyVersion,
    episodesCount: records.length,
    successRatePct: Number(((successes / n) * 100).toFixed(1)),
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
  };
}

/**
 * Section 9: FAIR BASELINE VS. TRAINED POLICY BENCHMARKING
 * Evaluates the Baseline Policy and the Trained Candidate Policy on the
 * EXACT SAME held-out test scenarios and identical random seeds.
 */
export async function runFairPolicyBenchmarkSuite(options: {
  heldOutScenarios: ScenarioConfig[];
  baselinePolicy: NavigationPolicyConfig;
  candidatePolicyState: CandidatePolicyState;
  episodesPerScenario?: number;
  robotId?: string;
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
    onProgress,
  } = options;

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

  const totalSteps = heldOutScenarios.length * episodesPerScenario * 2;
  let stepCounter = 0;

  for (const scen of heldOutScenarios) {
    const baseSeed =
      scen.randomSeed ?? scen.pedestrianDistribution?.randomSeed ?? 303;

    for (let ep = 0; ep < episodesPerScenario; ep++) {
      const seed = ep === 0 ? baseSeed : baseSeed + ep * 43;

      // 1. Run Baseline Policy on (scen, seed)
      const baseRes = runSingleHeadlessEpisode({
        scenario: scen,
        policy: baselinePolicy,
        robotId,
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
    heldOutScenarios.length
  } held-out test scenarios (${
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

  const benchmarkResult: BenchmarkSuiteResult = {
    id: `BENCH-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    candidatePolicyVersion: candidatePolicyState.version,
    heldOutScenariosCount: heldOutScenarios.length,
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
