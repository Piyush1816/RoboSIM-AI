import {
  DEFAULT_SCENARIOS,
  DEMO_PREVIEW_EXPERIMENTS,
  NAVIGATION_POLICIES,
  ROBOT_UNITS,
} from '../data/campusConfig';
import {
  BUILTIN_ENVIRONMENTS,
  syncEnvironmentDerivedStructures,
} from '../data/environmentTemplates';
import {
  loadAllWorkspaceCategoriesFromCloud,
  saveWorkspaceCategoryToCloud,
  WorkspaceCategoryKey,
} from '../firebase/firebaseClient';
import { diagnoseExperimentFailure } from '../simulation/failureIntelligence';
import { createInitialCandidatePolicyState } from '../simulation/policyLearner';
import {
  BenchmarkSuiteResult,
  CandidatePolicyState,
  CrossRobotBenchmarkResult,
  EnvironmentDefinition,
  ExperimentRecord,
  FailureDiagnosisRecord,
  FailureDrivenGenerationBatch,
  FailureEventRecord,
  NavigationPolicyConfig,
  RobotUnitConfig,
  ScenarioConfig,
} from '../types/simulation';

export const STORAGE_KEYS = {
  EXPERIMENTS: 'robosim_ai_experiments_v1',
  FAILURES: 'robosim_ai_failures_v1',
  SCENARIOS: 'robosim_ai_custom_scenarios_v1',
  POLICIES: 'robosim_ai_policies_v1',
  CANDIDATE_POLICY: 'robosim_ai_candidate_qpolicy_v1',
  BENCHMARKS: 'robosim_ai_benchmarks_v1',
  ROBOT_BENCHMARKS: 'robosim_ai_robot_benchmarks_v1',
  FD_BATCHES: 'robosim_ai_fd_batches_v1',
  DEMO_MODE: 'robosim_ai_demo_mode_v1',
  ROBOTS: 'robosim_ai_custom_robots_v1',
  SELECTED_ROBOT_ID: 'robosim_ai_selected_robot_id_v1',
  ENVIRONMENTS: 'robosim_ai_custom_environments_v1',
  SELECTED_ENVIRONMENT_ID: 'robosim_ai_selected_environment_id_v1',
};

let activeCloudUid: string | null = null;

export function setActiveCloudUserId(uid: string | null): void {
  activeCloudUid = uid;
}

export function getActiveCloudUserId(): string | null {
  return activeCloudUid;
}

function triggerCloudSync(category: WorkspaceCategoryKey, payload: unknown): void {
  if (!activeCloudUid) return;
  void saveWorkspaceCategoryToCloud(activeCloudUid, category, payload);
}

export const STORE_SYNC_EVENT = 'robosim_ai_store_sync_v1';
const BROADCAST_CHANNEL_NAME = 'robosim_ai_broadcast_v1';

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
} catch {
  broadcastChannel = null;
}

export function notifyStoreSubscribers(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORE_SYNC_EVENT));
  }
  try {
    broadcastChannel?.postMessage({ type: 'SYNC', timestamp: Date.now() });
  } catch {
    // ignore broadcast errors
  }
}

export function subscribeToStoreChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleCustomEvent = () => callback();
  const handleStorageEvent = (e: StorageEvent) => {
    if (!e.key || Object.values(STORAGE_KEYS).includes(e.key)) {
      callback();
    }
  };
  const handleBroadcast = () => callback();

  window.addEventListener(STORE_SYNC_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);
  broadcastChannel?.addEventListener('message', handleBroadcast);

  return () => {
    window.removeEventListener(STORE_SYNC_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
    broadcastChannel?.removeEventListener('message', handleBroadcast);
  };
}

export function loadStoredExperiments(): ExperimentRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const rawExp = localStorage.getItem(STORAGE_KEYS.EXPERIMENTS);
    const parsedExp: ExperimentRecord[] = rawExp ? JSON.parse(rawExp) : [];
    if (!Array.isArray(parsedExp)) return [];

    // Merge any legacy failure metadata from STORAGE_KEYS.FAILURES into corresponding failed experiments
    const rawFail = localStorage.getItem(STORAGE_KEYS.FAILURES);
    const parsedFail: FailureEventRecord[] = rawFail ? JSON.parse(rawFail) : [];
    const failByExpId = new Map<string, FailureEventRecord>();
    if (Array.isArray(parsedFail)) {
      for (const f of parsedFail) {
        if (f && f.experimentId) {
          failByExpId.set(f.experimentId, f);
        }
      }
    }

    const scenarios = loadScenarios();
    const scenById = new Map(scenarios.map((s) => [s.id, s]));

    // Deduplicate by ID and enrich failed records with Failure Intelligence diagnosis
    const seenIds = new Set<string>();
    const unified: ExperimentRecord[] = [];
    for (const exp of parsedExp) {
      if (!exp || !exp.id || seenIds.has(exp.id)) continue;
      seenIds.add(exp.id);

      const matchedScen = scenById.get(exp.scenarioId);
      const baseEnriched: ExperimentRecord = {
        ...exp,
        scenarioSeed:
          exp.scenarioSeed ??
          matchedScen?.randomSeed ??
          matchedScen?.pedestrianDistribution?.randomSeed ??
          101,
        scenarioGenerationSource:
          exp.scenarioGenerationSource ??
          matchedScen?.generationSource ??
          'Preset',
        scenarioDifficulty:
          exp.scenarioDifficulty ?? matchedScen?.difficulty ?? 'Moderate',
        policyVersion: exp.policyVersion ?? '2.1.0',
        runType: exp.runType ?? 'Interactive',
      };

      if (baseEnriched.status === 'Failed') {
        const legacyFail = failByExpId.get(baseEnriched.id);
        const withLegacy: ExperimentRecord = {
          ...baseEnriched,
          failureType:
            baseEnriched.failureType ??
            legacyFail?.failureType ??
            'Collision with Barrier',
          obstacleType:
            baseEnriched.obstacleType ??
            legacyFail?.obstacleType ??
            'Construction Barrier',
          failureCoordinates:
            baseEnriched.failureCoordinates ??
            legacyFail?.coordinates ?? { x: 8, z: 0 },
          rootCause:
            baseEnriched.rootCause ??
            legacyFail?.rootCause ??
            baseEnriched.failureReason ??
            'Robot encountered an impassable obstacle or collision boundary along the active corridor.',
          mitigationSuggested:
            baseEnriched.mitigationSuggested ??
            legacyFail?.mitigationSuggested ??
            'Activate Hybrid A* Safety-First v2.1 or train Candidate Q-Learning Policy.',
        };
        const diag =
          withLegacy.failureDiagnosis ??
          diagnoseExperimentFailure(withLegacy, matchedScen);
        unified.push({
          ...withLegacy,
          failureCategory: diag.failureCategory,
          failureDiagnosis: diag,
        });
      } else {
        unified.push(baseEnriched);
      }
    }
    return unified;
  } catch {
    return [];
  }
}

export function saveStoredExperiment(record: ExperimentRecord): ExperimentRecord[] {
  try {
    const current = loadStoredExperiments();
    const filtered = current.filter((item) => item.id !== record.id);
    const updated = [record, ...filtered];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(updated));
      const failureRecords = deriveFailureRecordsFromExperiments(updated);
      localStorage.setItem(STORAGE_KEYS.FAILURES, JSON.stringify(failureRecords));
      triggerCloudSync('experiments', updated);
      triggerCloudSync('failures', failureRecords);
    }
    notifyStoreSubscribers();
    return updated;
  } catch {
    return [record];
  }
}

export function saveStoredExperimentsBatch(
  records: ExperimentRecord[]
): ExperimentRecord[] {
  try {
    const current = loadStoredExperiments();
    const newIds = new Set(records.map((r) => r.id));
    const filtered = current.filter((item) => !newIds.has(item.id));
    const updated = [...records.slice().reverse(), ...filtered];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(updated));
      const failureRecords = deriveFailureRecordsFromExperiments(updated);
      localStorage.setItem(STORAGE_KEYS.FAILURES, JSON.stringify(failureRecords));
      triggerCloudSync('experiments', updated);
      triggerCloudSync('failures', failureRecords);
    }
    notifyStoreSubscribers();
    return updated;
  } catch {
    return records;
  }
}

export function clearStoredExperiments(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.EXPERIMENTS);
      localStorage.removeItem(STORAGE_KEYS.FAILURES);
    }
    notifyStoreSubscribers();
  } catch {
    // ignore storage errors
  }
}

/**
 * Authoritatively derives FailureDiagnosisRecord[] from failed ExperimentRecord items.
 */
export function deriveFailureDiagnosesFromExperiments(
  experiments: ExperimentRecord[],
  scenarios: ScenarioConfig[] = DEFAULT_SCENARIOS
): FailureDiagnosisRecord[] {
  const scenMap = new Map(scenarios.map((s) => [s.id, s]));
  return experiments
    .filter((exp) => exp.status === 'Failed')
    .map(
      (exp) =>
        exp.failureDiagnosis ??
        diagnoseExperimentFailure(exp, scenMap.get(exp.scenarioId))
    );
}

/**
 * Authoritatively derives FailureEventRecord[] strictly from failed ExperimentRecord items.
 * Guarantees that successful experiments NEVER appear as failures.
 */
export function deriveFailureRecordsFromExperiments(
  experiments: ExperimentRecord[]
): FailureEventRecord[] {
  const scenarios = loadScenarios();
  const scenMap = new Map(scenarios.map((s) => [s.id, s]));

  return experiments
    .filter((exp) => exp.status === 'Failed')
    .map((exp, idx) => {
      const diag =
        exp.failureDiagnosis ??
        diagnoseExperimentFailure(exp, scenMap.get(exp.scenarioId));
      return {
        id: `FAIL-${
          exp.id.replace(/^(DEMO-)?EXP-/, '') || String(idx + 1).padStart(2, '0')
        }`,
        experimentId: exp.id,
        scenarioId: exp.scenarioId,
        timestamp: exp.timestamp,
        scenarioName: exp.scenarioName,
        robotName: exp.robotName,
        policyName: exp.policyName,
        policyVersion: diag.policyVersion,
        failureType: diag.failureType,
        failureCategory: diag.failureCategory,
        outcomeDistinction: diag.outcomeDistinction,
        obstacleType: exp.obstacleType ?? 'Construction Barrier',
        coordinates: diag.coordinates,
        severity: diag.severity,
        rootCause: diag.probableRootCause,
        mitigationSuggested: diag.suggestedImprovement,
        environmentalConditions: diag.environmentalConditions,
        robotStateBeforeFailure: diag.robotStateBeforeFailure,
        actionsTaken: diag.actionsTaken,
        supportingEvidence: diag.supportingEvidence,
        isDemoData: exp.isDemoData,
      };
    });
}

export interface OverviewMetricsSummary {
  totalExperiments: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRateFormatted: string;
  successRateNumeric: number;
  totalCollisions: number;
  avgDeliveryTimeFormatted: string;
  avgDeliveryTimeNumeric: number;
  totalAvoidedEncounters: number;
  totalPredictedEncounters: number;
  avgPredictionAccuracyPct: number;
  elevatorFailuresCount: number;
  robotsAwaitingAssistance: number;
  avgElevatorWaitTimeSec: number;
  elevatorSuccessRatePct: number;
  avgGlobalReplans: number;
  avgWaitingTimeSec: number;
  totalDeadlocks: number;
}

export function computeOverviewMetrics(
  experiments: ExperimentRecord[]
): OverviewMetricsSummary {
  const totalExperiments = experiments.length;
  const successfulRuns = experiments.filter((e) => e.status === 'Success');
  const successfulDeliveries = successfulRuns.length;
  const failedDeliveries = experiments.filter((e) => e.status === 'Failed').length;

  const successRateNumeric =
    totalExperiments > 0 ? (successfulDeliveries / totalExperiments) * 100 : 0;
  const successRateFormatted =
    totalExperiments > 0 ? `${successRateNumeric.toFixed(1)}%` : '—';

  const totalCollisions = experiments.reduce((acc, e) => acc + e.collisions, 0);

  const avgDeliveryTimeNumeric =
    successfulDeliveries > 0
      ? successfulRuns.reduce((acc, e) => acc + e.durationSec, 0) /
        successfulDeliveries
      : 0;
  const avgDeliveryTimeFormatted =
    successfulDeliveries > 0 ? `${avgDeliveryTimeNumeric.toFixed(1)}s` : '—';

  const totalAvoidedEncounters = experiments.reduce(
    (acc, e) => acc + (e.avoidedEncountersCount ?? 0),
    0
  );
  const totalPredictedEncounters = experiments.reduce(
    (acc, e) => acc + (e.predictedEncountersCount ?? 0),
    0
  );
  const runsWithPredAcc = experiments.filter(
    (e) => typeof e.predictionAccuracyPct === 'number'
  );
  const avgPredictionAccuracyPct =
    runsWithPredAcc.length > 0
      ? runsWithPredAcc.reduce(
          (acc, e) => acc + (e.predictionAccuracyPct ?? 92),
          0
        ) / runsWithPredAcc.length
      : 0;

  const elevatorRuns = experiments.filter(
    (e) =>
      e.elevatorUsed ||
      e.scenarioId === 'scen-elevator-recovery' ||
      e.failureType === 'Elevator Mechanical Failure' ||
      e.failureType === 'Elevator Unavailable'
  );
  const elevatorSuccessCount = elevatorRuns.filter(
    (e) => e.status === 'Success'
  ).length;
  const elevatorFailuresCount = experiments.filter(
    (e) =>
      e.failureType === 'Elevator Mechanical Failure' ||
      e.failureType === 'Elevator Unavailable'
  ).length;
  const robotsAwaitingAssistance = experiments.filter(
    (e) =>
      e.elevatorAssistanceRequested ||
      e.failureType === 'Elevator Mechanical Failure'
  ).length;
  const avgElevatorWaitTimeSec =
    elevatorRuns.length > 0
      ? elevatorRuns.reduce((acc, e) => acc + (e.elevatorWaitTimeSec ?? 0), 0) /
        elevatorRuns.length
      : 0;
  const elevatorSuccessRatePct =
    elevatorRuns.length > 0
      ? (elevatorSuccessCount / elevatorRuns.length) * 100
      : 100;

  const avgGlobalReplans =
    totalExperiments > 0
      ? experiments.reduce(
          (acc, e) => acc + (e.globalReplanCount ?? e.replanCount ?? 0),
          0
        ) / totalExperiments
      : 0;

  const avgWaitingTimeSec =
    totalExperiments > 0
      ? experiments.reduce((acc, e) => acc + (e.totalWaitingTimeSec ?? 0), 0) /
        totalExperiments
      : 0;

  const totalDeadlocks = experiments.reduce(
    (acc, e) =>
      acc +
      (e.deadlockCount ?? (e.failureType === 'Pathway Deadlock' ? 1 : 0)),
    0
  );

  return {
    totalExperiments,
    successfulDeliveries,
    failedDeliveries,
    successRateFormatted,
    successRateNumeric,
    totalCollisions,
    avgDeliveryTimeFormatted,
    avgDeliveryTimeNumeric,
    totalAvoidedEncounters,
    totalPredictedEncounters,
    avgPredictionAccuracyPct,
    elevatorFailuresCount,
    robotsAwaitingAssistance,
    avgElevatorWaitTimeSec,
    elevatorSuccessRatePct,
    avgGlobalReplans,
    avgWaitingTimeSec,
    totalDeadlocks,
  };
}

export interface PolicyAnalyticsSummary {
  policy: NavigationPolicyConfig;
  totalRuns: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRatePct: number;
  avgCompletionTimeSec: number;
  avgDistanceMeters: number;
  avgBatteryConsumedPct: number;
  totalCollisions: number;
  totalReplanCount: number;
  avgPredictionAccuracyPct: number;
  totalAvoidedEncounters: number;
  totalUnnecessaryStops: number;
  avgElevatorWaitTimeSec: number;
  avgWaitingTimeSec: number;
  totalDeadlocks: number;
  avgReward: number;
}

export function computePolicyAnalytics(
  experiments: ExperimentRecord[],
  policies: NavigationPolicyConfig[]
): PolicyAnalyticsSummary[] {
  return policies.map((pol) => {
    const runs = experiments.filter((e) => e.policyId === pol.id);
    const totalRuns = runs.length;
    const successfulDeliveries = runs.filter((e) => e.status === 'Success').length;
    const failedDeliveries = runs.filter((e) => e.status === 'Failed').length;
    const successRatePct =
      totalRuns > 0 ? (successfulDeliveries / totalRuns) * 100 : 0;
    const avgCompletionTimeSec =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + r.durationSec, 0) / totalRuns
        : 0;
    const avgDistanceMeters =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + r.distanceMeters, 0) / totalRuns
        : 0;
    const avgBatteryConsumedPct =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + r.batteryConsumedPct, 0) / totalRuns
        : 0;
    const totalCollisions = runs.reduce((acc, r) => acc + r.collisions, 0);
    const totalReplanCount = runs.reduce(
      (acc, r) => acc + (r.globalReplanCount ?? r.replanCount),
      0
    );

    const runsWithPred = runs.filter(
      (r) => typeof r.predictionAccuracyPct === 'number'
    );
    const avgPredictionAccuracyPct =
      runsWithPred.length > 0
        ? runsWithPred.reduce(
            (acc, r) => acc + (r.predictionAccuracyPct ?? 92),
            0
          ) / runsWithPred.length
        : 0;
    const totalAvoidedEncounters = runs.reduce(
      (acc, r) => acc + (r.avoidedEncountersCount ?? 0),
      0
    );
    const totalUnnecessaryStops = runs.reduce(
      (acc, r) => acc + (r.unnecessaryStopsCount ?? 0),
      0
    );
    const avgElevatorWaitTimeSec =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + (r.elevatorWaitTimeSec ?? 0), 0) /
          totalRuns
        : 0;
    const avgWaitingTimeSec =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + (r.totalWaitingTimeSec ?? 0), 0) /
          totalRuns
        : 0;
    const totalDeadlocks = runs.reduce(
      (acc, r) =>
        acc +
        (r.deadlockCount ?? (r.failureType === 'Pathway Deadlock' ? 1 : 0)),
      0
    );
    const avgReward =
      totalRuns > 0
        ? runs.reduce((acc, r) => acc + (r.episodeReward ?? 0), 0) / totalRuns
        : 0;

    return {
      policy: pol,
      totalRuns,
      successfulDeliveries,
      failedDeliveries,
      successRatePct,
      avgCompletionTimeSec,
      avgDistanceMeters,
      avgBatteryConsumedPct,
      totalCollisions,
      totalReplanCount,
      avgPredictionAccuracyPct,
      totalAvoidedEncounters,
      totalUnnecessaryStops,
      avgElevatorWaitTimeSec,
      avgWaitingTimeSec,
      totalDeadlocks,
      avgReward,
    };
  });
}

export function getActiveExperimentsList(
  storedExperiments: ExperimentRecord[],
  demoPreviewEnabled: boolean
): ExperimentRecord[] {
  if (!demoPreviewEnabled) return storedExperiments;
  const existingIds = new Set(storedExperiments.map((e) => e.id));
  const demoFiltered = DEMO_PREVIEW_EXPERIMENTS.filter(
    (d) => !existingIds.has(d.id)
  );
  return [...storedExperiments, ...demoFiltered];
}

export function loadScenarios(): ScenarioConfig[] {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SCENARIOS;
    const raw = localStorage.getItem(STORAGE_KEYS.SCENARIOS);
    if (!raw) return DEFAULT_SCENARIOS;
    const custom: ScenarioConfig[] = JSON.parse(raw);
    if (!Array.isArray(custom)) return DEFAULT_SCENARIOS;
    const defaultIds = new Set(DEFAULT_SCENARIOS.map((d) => d.id));
    const uniqueCustom = custom.filter((c) => c && c.id && !defaultIds.has(c.id));
    return [...DEFAULT_SCENARIOS, ...uniqueCustom];
  } catch {
    return DEFAULT_SCENARIOS;
  }
}

export function saveCustomScenario(scenario: ScenarioConfig): ScenarioConfig[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [...DEFAULT_SCENARIOS, scenario];
    }
    const raw = localStorage.getItem(STORAGE_KEYS.SCENARIOS);
    const custom: ScenarioConfig[] = raw ? JSON.parse(raw) : [];
    const filtered = custom.filter((c) => c.id !== scenario.id);
    const updatedCustom = [...filtered, { ...scenario, isCustom: true }];
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(updatedCustom));
    triggerCloudSync('scenarios', updatedCustom);
    notifyStoreSubscribers();
    return [...DEFAULT_SCENARIOS, ...updatedCustom];
  } catch {
    return [...DEFAULT_SCENARIOS, scenario];
  }
}

export function saveCustomScenariosBatch(
  newScenarios: ScenarioConfig[]
): ScenarioConfig[] {
  try {
    if (typeof localStorage === 'undefined') {
      return [...DEFAULT_SCENARIOS, ...newScenarios];
    }
    const raw = localStorage.getItem(STORAGE_KEYS.SCENARIOS);
    const custom: ScenarioConfig[] = raw ? JSON.parse(raw) : [];
    const incomingIds = new Set(newScenarios.map((s) => s.id));
    const incomingNames = new Set(newScenarios.map((s) => s.name));
    const filtered = custom.filter(
      (c) => !incomingIds.has(c.id) && !incomingNames.has(c.name)
    );
    const updatedCustom = [
      ...filtered,
      ...newScenarios.map((s) => ({ ...s, isCustom: true })),
    ];
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(updatedCustom));
    triggerCloudSync('scenarios', updatedCustom);
    notifyStoreSubscribers();
    return [...DEFAULT_SCENARIOS, ...updatedCustom];
  } catch {
    return [...DEFAULT_SCENARIOS, ...newScenarios];
  }
}

export function loadPolicies(): NavigationPolicyConfig[] {
  try {
    if (typeof localStorage === 'undefined') return NAVIGATION_POLICIES;
    const raw = localStorage.getItem(STORAGE_KEYS.POLICIES);
    if (!raw) return NAVIGATION_POLICIES;
    const parsed: NavigationPolicyConfig[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return NAVIGATION_POLICIES;
    // Ensure Candidate Q-Learning Policy is always present in the list
    const hasCandidate = parsed.some((p) => p.id === 'pol-candidate-rl');
    if (!hasCandidate) {
      const candDefault = NAVIGATION_POLICIES.find(
        (p) => p.id === 'pol-candidate-rl'
      );
      if (candDefault) {
        return [parsed[0], candDefault, ...parsed.slice(1)];
      }
    }
    return parsed;
  } catch {
    return NAVIGATION_POLICIES;
  }
}

export function savePolicies(policies: NavigationPolicyConfig[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.POLICIES, JSON.stringify(policies));
      triggerCloudSync('policies', policies);
    }
    notifyStoreSubscribers();
  } catch {
    // ignore storage errors
  }
}

export function loadCandidatePolicyState(): CandidatePolicyState {
  try {
    if (typeof localStorage === 'undefined') {
      return createInitialCandidatePolicyState();
    }
    const raw = localStorage.getItem(STORAGE_KEYS.CANDIDATE_POLICY);
    if (!raw) return createInitialCandidatePolicyState();
    const parsed: CandidatePolicyState = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.qTable) {
      return createInitialCandidatePolicyState();
    }
    return parsed;
  } catch {
    return createInitialCandidatePolicyState();
  }
}

export function saveCandidatePolicyState(state: CandidatePolicyState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.CANDIDATE_POLICY, JSON.stringify(state));
      triggerCloudSync('candidatePolicy', state);
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

export function resetCandidatePolicyState(): CandidatePolicyState {
  const fresh = createInitialCandidatePolicyState();
  saveCandidatePolicyState(fresh);
  return fresh;
}

export function loadBenchmarkHistory(): BenchmarkSuiteResult[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.BENCHMARKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBenchmarkResult(
  result: BenchmarkSuiteResult
): BenchmarkSuiteResult[] {
  try {
    const current = loadBenchmarkHistory();
    const updated = [result, ...current.filter((b) => b.id !== result.id)];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.BENCHMARKS, JSON.stringify(updated));
      triggerCloudSync('benchmarks', updated);
    }
    notifyStoreSubscribers();
    return updated;
  } catch {
    return [result];
  }
}

export function loadFailureDrivenBatches(): FailureDrivenGenerationBatch[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.FD_BATCHES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFailureDrivenBatch(
  batch: FailureDrivenGenerationBatch
): FailureDrivenGenerationBatch[] {
  try {
    const current = loadFailureDrivenBatches();
    const updated = [batch, ...current];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.FD_BATCHES, JSON.stringify(updated));
      triggerCloudSync('fdBatches', updated);
    }
    notifyStoreSubscribers();
    return updated;
  } catch {
    return [batch];
  }
}

export function loadDemoPreviewPreference(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEYS.DEMO_MODE) === 'true';
  } catch {
    return false;
  }
}

export function saveDemoPreviewPreference(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.DEMO_MODE, enabled ? 'true' : 'false');
      triggerCloudSync('preferences', {
        selectedRobotId: loadSelectedRobotId(),
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        demoPreviewEnabled: enabled,
      });
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

export function loadRobots(): RobotUnitConfig[] {
  try {
    if (typeof localStorage === 'undefined') return ROBOT_UNITS;
    const raw = localStorage.getItem(STORAGE_KEYS.ROBOTS);
    if (!raw) return ROBOT_UNITS;
    const custom: RobotUnitConfig[] = JSON.parse(raw);
    if (!Array.isArray(custom)) return ROBOT_UNITS;
    const defaultIds = new Set(ROBOT_UNITS.map((r) => r.id));
    const uniqueCustom = custom
      .filter((r) => r && r.id && !defaultIds.has(r.id))
      .map((r) => ({ ...r, isCustom: true }));
    return [...ROBOT_UNITS, ...uniqueCustom];
  } catch {
    return ROBOT_UNITS;
  }
}

export function saveCustomRobot(robot: RobotUnitConfig): RobotUnitConfig[] {
  try {
    const normalized: RobotUnitConfig = {
      ...robot,
      isCustom: true,
      collisionRadiusM:
        robot.collisionRadiusM ??
        Math.max(
          0.42,
          Number(
            (
              Math.hypot(robot.lengthM ?? 0.9, robot.widthM ?? 0.64) * 0.6
            ).toFixed(2)
          )
        ),
    };
    if (typeof localStorage === 'undefined') {
      return [...ROBOT_UNITS, normalized];
    }
    const raw = localStorage.getItem(STORAGE_KEYS.ROBOTS);
    const custom: RobotUnitConfig[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(custom)
      ? custom.filter((r) => r && r.id !== normalized.id)
      : [];
    const updatedCustom = [...filtered, normalized];
    localStorage.setItem(STORAGE_KEYS.ROBOTS, JSON.stringify(updatedCustom));
    triggerCloudSync('robots', updatedCustom);
    notifyStoreSubscribers();
    return [...ROBOT_UNITS, ...updatedCustom];
  } catch {
    return ROBOT_UNITS;
  }
}

export function deleteCustomRobot(robotId: string): RobotUnitConfig[] {
  try {
    if (typeof localStorage === 'undefined') return ROBOT_UNITS;
    const raw = localStorage.getItem(STORAGE_KEYS.ROBOTS);
    const custom: RobotUnitConfig[] = raw ? JSON.parse(raw) : [];
    const updatedCustom = Array.isArray(custom)
      ? custom.filter((r) => r && r.id !== robotId)
      : [];
    localStorage.setItem(STORAGE_KEYS.ROBOTS, JSON.stringify(updatedCustom));
    triggerCloudSync('robots', updatedCustom);
    if (loadSelectedRobotId() === robotId) {
      saveSelectedRobotId(ROBOT_UNITS[0].id);
    }
    notifyStoreSubscribers();
    return [...ROBOT_UNITS, ...updatedCustom];
  } catch {
    return ROBOT_UNITS;
  }
}

export function loadSelectedRobotId(): string {
  try {
    if (typeof localStorage === 'undefined') return ROBOT_UNITS[0].id;
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_ROBOT_ID);
    const allRobots = loadRobots();
    if (saved && allRobots.some((r) => r.id === saved)) {
      return saved;
    }
    return ROBOT_UNITS[0].id;
  } catch {
    return ROBOT_UNITS[0].id;
  }
}

export function saveSelectedRobotId(robotId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.SELECTED_ROBOT_ID, robotId);
      triggerCloudSync('preferences', {
        selectedRobotId: robotId,
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        demoPreviewEnabled: loadDemoPreviewPreference(),
      });
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

export function loadCrossRobotBenchmarkHistory(): CrossRobotBenchmarkResult[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEYS.ROBOT_BENCHMARKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCrossRobotBenchmarkResult(
  result: CrossRobotBenchmarkResult
): CrossRobotBenchmarkResult[] {
  try {
    const current = loadCrossRobotBenchmarkHistory();
    const updated = [result, ...current.filter((b) => b.id !== result.id)];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.ROBOT_BENCHMARKS, JSON.stringify(updated));
      triggerCloudSync('robotBenchmarks', updated);
    }
    notifyStoreSubscribers();
    return updated;
  } catch {
    return [result];
  }
}

export function loadEnvironments(): EnvironmentDefinition[] {
  try {
    if (typeof localStorage === 'undefined') return BUILTIN_ENVIRONMENTS;
    const raw = localStorage.getItem(STORAGE_KEYS.ENVIRONMENTS);
    if (!raw) return BUILTIN_ENVIRONMENTS;
    const custom: EnvironmentDefinition[] = JSON.parse(raw);
    if (!Array.isArray(custom)) return BUILTIN_ENVIRONMENTS;
    const customById = new Map<string, EnvironmentDefinition>();
    for (const c of custom) {
      if (c && c.id) {
        customById.set(c.id, syncEnvironmentDerivedStructures(c));
      }
    }
    const mergedBuiltIns = BUILTIN_ENVIRONMENTS.map((b) =>
      customById.has(b.id) ? customById.get(b.id)! : b
    );
    const builtInIds = new Set(BUILTIN_ENVIRONMENTS.map((b) => b.id));
    const uniqueCustom = Array.from(customById.values()).filter(
      (c) => !builtInIds.has(c.id)
    );
    return [...mergedBuiltIns, ...uniqueCustom];
  } catch {
    return BUILTIN_ENVIRONMENTS;
  }
}

export function saveCustomEnvironment(
  env: EnvironmentDefinition
): EnvironmentDefinition[] {
  try {
    const synced = syncEnvironmentDerivedStructures({
      ...env,
      updatedAt: new Date().toISOString(),
    });
    if (typeof localStorage === 'undefined') {
      return [...BUILTIN_ENVIRONMENTS, synced];
    }
    const raw = localStorage.getItem(STORAGE_KEYS.ENVIRONMENTS);
    const custom: EnvironmentDefinition[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(custom)
      ? custom.filter((c) => c && c.id !== synced.id)
      : [];
    const updatedCustom = [...filtered, synced];
    localStorage.setItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(updatedCustom));
    triggerCloudSync('environments', updatedCustom);
    notifyStoreSubscribers();
    return loadEnvironments();
  } catch {
    return BUILTIN_ENVIRONMENTS;
  }
}

export function deleteCustomEnvironment(envId: string): EnvironmentDefinition[] {
  try {
    if (typeof localStorage === 'undefined') return BUILTIN_ENVIRONMENTS;
    const raw = localStorage.getItem(STORAGE_KEYS.ENVIRONMENTS);
    const custom: EnvironmentDefinition[] = raw ? JSON.parse(raw) : [];
    const updatedCustom = Array.isArray(custom)
      ? custom.filter((c) => c && c.id !== envId)
      : [];
    localStorage.setItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(updatedCustom));
    triggerCloudSync('environments', updatedCustom);
    if (loadSelectedEnvironmentId() === envId) {
      saveSelectedEnvironmentId(BUILTIN_ENVIRONMENTS[0].id);
    }
    notifyStoreSubscribers();
    return loadEnvironments();
  } catch {
    return BUILTIN_ENVIRONMENTS;
  }
}

export function loadSelectedEnvironmentId(): string {
  try {
    if (typeof localStorage === 'undefined') return BUILTIN_ENVIRONMENTS[0].id;
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID);
    const allEnvs = loadEnvironments();
    if (saved && allEnvs.some((e) => e.id === saved)) {
      return saved;
    }
    return BUILTIN_ENVIRONMENTS[0].id;
  } catch {
    return BUILTIN_ENVIRONMENTS[0].id;
  }
}

export function saveSelectedEnvironmentId(envId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID, envId);
    triggerCloudSync('preferences', {
      selectedRobotId: loadSelectedRobotId(),
      selectedEnvironmentId: envId,
      demoPreviewEnabled: loadDemoPreviewPreference(),
    });
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

/**
 * Safely merges localStorage data with the authenticated user's Firestore workspace.
 * Never deletes local user data — merges by ID and pushes the unified state back to Firestore.
 */
export async function hydrateAndMigrateUserWorkspace(uid: string): Promise<{
  migratedCounts: {
    robots: number;
    environments: number;
    scenarios: number;
    experiments: number;
    benchmarks: number;
  };
}> {
  setActiveCloudUserId(uid);
  const cloudData = await loadAllWorkspaceCategoriesFromCloud(uid);

  const mergeById = <T extends { id: string }>(
    localArr: T[],
    cloudArr: unknown
  ): T[] => {
    const map = new Map<string, T>();
    if (Array.isArray(cloudArr)) {
      for (const item of cloudArr) {
        if (item && typeof item === 'object' && 'id' in item) {
          map.set((item as T).id, item as T);
        }
      }
    }
    for (const item of localArr) {
      if (item && item.id) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  };

  // 1. Custom Robots
  const rawLocalRobots = localStorage.getItem(STORAGE_KEYS.ROBOTS);
  const localCustomRobots: RobotUnitConfig[] = rawLocalRobots
    ? JSON.parse(rawLocalRobots)
    : [];
  const mergedRobots = mergeById(localCustomRobots, cloudData.robots);
  localStorage.setItem(STORAGE_KEYS.ROBOTS, JSON.stringify(mergedRobots));
  await saveWorkspaceCategoryToCloud(uid, 'robots', mergedRobots);

  // 2. Custom Environments
  const rawLocalEnvs = localStorage.getItem(STORAGE_KEYS.ENVIRONMENTS);
  const localCustomEnvs: EnvironmentDefinition[] = rawLocalEnvs
    ? JSON.parse(rawLocalEnvs)
    : [];
  const mergedEnvs = mergeById(localCustomEnvs, cloudData.environments);
  localStorage.setItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(mergedEnvs));
  await saveWorkspaceCategoryToCloud(uid, 'environments', mergedEnvs);

  // 3. Custom Scenarios
  const rawLocalScens = localStorage.getItem(STORAGE_KEYS.SCENARIOS);
  const localCustomScens: ScenarioConfig[] = rawLocalScens
    ? JSON.parse(rawLocalScens)
    : [];
  const mergedScens = mergeById(localCustomScens, cloudData.scenarios);
  localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(mergedScens));
  await saveWorkspaceCategoryToCloud(uid, 'scenarios', mergedScens);

  // 4. Experiments & Failures
  const localExps = loadStoredExperiments();
  const mergedExps = mergeById(localExps, cloudData.experiments);
  localStorage.setItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(mergedExps));
  const derivedFailures = deriveFailureRecordsFromExperiments(mergedExps);
  localStorage.setItem(STORAGE_KEYS.FAILURES, JSON.stringify(derivedFailures));
  await saveWorkspaceCategoryToCloud(uid, 'experiments', mergedExps);
  await saveWorkspaceCategoryToCloud(uid, 'failures', derivedFailures);

  // 5. Candidate Policy State
  const localCand = loadCandidatePolicyState();
  const cloudCand = cloudData.candidatePolicy as CandidatePolicyState | undefined;
  const activeCand =
    cloudCand &&
    (cloudCand.totalEpisodesTrained ?? 0) > (localCand.totalEpisodesTrained ?? 0)
      ? cloudCand
      : localCand;
  localStorage.setItem(STORAGE_KEYS.CANDIDATE_POLICY, JSON.stringify(activeCand));
  await saveWorkspaceCategoryToCloud(uid, 'candidatePolicy', activeCand);

  // 6. Benchmarks & Cross-Robot Benchmarks
  const localBench = loadBenchmarkHistory();
  const mergedBench = mergeById(localBench, cloudData.benchmarks);
  localStorage.setItem(STORAGE_KEYS.BENCHMARKS, JSON.stringify(mergedBench));
  await saveWorkspaceCategoryToCloud(uid, 'benchmarks', mergedBench);

  const localRobotBench = loadCrossRobotBenchmarkHistory();
  const mergedRobotBench = mergeById(localRobotBench, cloudData.robotBenchmarks);
  localStorage.setItem(
    STORAGE_KEYS.ROBOT_BENCHMARKS,
    JSON.stringify(mergedRobotBench)
  );
  await saveWorkspaceCategoryToCloud(uid, 'robotBenchmarks', mergedRobotBench);

  // 7. Preferences
  const cloudPrefs = cloudData.preferences as
    | {
        selectedRobotId?: string;
        selectedEnvironmentId?: string;
        demoPreviewEnabled?: boolean;
      }
    | undefined;
  if (cloudPrefs?.selectedRobotId && !localStorage.getItem(STORAGE_KEYS.SELECTED_ROBOT_ID)) {
    localStorage.setItem(STORAGE_KEYS.SELECTED_ROBOT_ID, cloudPrefs.selectedRobotId);
  }
  if (
    cloudPrefs?.selectedEnvironmentId &&
    !localStorage.getItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID)
  ) {
    localStorage.setItem(
      STORAGE_KEYS.SELECTED_ENVIRONMENT_ID,
      cloudPrefs.selectedEnvironmentId
    );
  }

  notifyStoreSubscribers();

  return {
    migratedCounts: {
      robots: mergedRobots.length,
      environments: mergedEnvs.length,
      scenarios: mergedScens.length,
      experiments: mergedExps.length,
      benchmarks: mergedBench.length + mergedRobotBench.length,
    },
  };
}


