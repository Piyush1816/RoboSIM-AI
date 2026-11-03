import {
  DEFAULT_SCENARIOS,
  DEMO_PREVIEW_EXPERIMENTS,
  NAVIGATION_POLICIES,
} from '../data/campusConfig';
import { diagnoseExperimentFailure } from '../simulation/failureIntelligence';
import { createInitialCandidatePolicyState } from '../simulation/policyLearner';
import {
  BenchmarkSuiteResult,
  CandidatePolicyState,
  ExperimentRecord,
  FailureDiagnosisRecord,
  FailureDrivenGenerationBatch,
  FailureEventRecord,
  NavigationPolicyConfig,
  ScenarioConfig,
} from '../types/simulation';

export const STORAGE_KEYS = {
  EXPERIMENTS: 'robosim_ai_experiments_v1',
  FAILURES: 'robosim_ai_failures_v1',
  SCENARIOS: 'robosim_ai_custom_scenarios_v1',
  POLICIES: 'robosim_ai_policies_v1',
  CANDIDATE_POLICY: 'robosim_ai_candidate_qpolicy_v1',
  BENCHMARKS: 'robosim_ai_benchmarks_v1',
  FD_BATCHES: 'robosim_ai_fd_batches_v1',
  DEMO_MODE: 'robosim_ai_demo_mode_v1',
};

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
    const filtered = custom.filter((c) => !incomingIds.has(c.id));
    const updatedCustom = [
      ...filtered,
      ...newScenarios.map((s) => ({ ...s, isCustom: true })),
    ];
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(updatedCustom));
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
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}
