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
  getPendingSyncCategories,
  loadAllWorkspaceCategoriesFromCloud,
  saveWorkspaceCategoryToCloud,
  setActivePendingSyncUserId,
  WorkspaceCategoryKey,
} from '../firebase/firebaseClient';
import { localEnvironmentFileStorage } from './localFileStorage';
import { diagnoseExperimentFailure } from '../simulation/failureIntelligence';
import { createInitialCandidatePolicyState } from '../simulation/policyLearner';
import { clearPersistedLabController } from '../three/CampusSceneManager';
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
  EXPERIMENTS: 'experiments_v1',
  FAILURES: 'failures_v1',
  SCENARIOS: 'custom_scenarios_v1',
  POLICIES: 'policies_v1',
  CANDIDATE_POLICY: 'candidate_qpolicy_v1',
  BENCHMARKS: 'benchmarks_v1',
  ROBOT_BENCHMARKS: 'robot_benchmarks_v1',
  FD_BATCHES: 'fd_batches_v1',
  DEMO_MODE: 'demo_mode_v1',
  ROBOTS: 'custom_robots_v1',
  SELECTED_ROBOT_ID: 'selected_robot_id_v1',
  ENVIRONMENTS: 'custom_environments_v1',
  SELECTED_ENVIRONMENT_ID: 'selected_environment_id_v1',
  SELECTED_POLICY_ID: 'selected_policy_id_v1',
} as const;

export type WorkspaceScopeMode = 'unauthenticated' | 'guest' | 'user';

const GUEST_SESSION_STORAGE_KEY = 'robosim_ai_guest_session_active_v1';

let activeScopeMode: WorkspaceScopeMode = (() => {
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(GUEST_SESSION_STORAGE_KEY) === 'true'
    ) {
      return 'guest';
    }
  } catch {
    // ignore
  }
  return 'unauthenticated';
})();

let activeCloudUid: string | null = null;

export function getScopedStorageKey(
  baseKey: string,
  overrideScope?: { mode: WorkspaceScopeMode; uid?: string | null }
): string | null {
  const mode = overrideScope ? overrideScope.mode : activeScopeMode;
  const uid = overrideScope ? overrideScope.uid ?? null : activeCloudUid;

  if (mode === 'user') {
    if (!uid) return null;
    return `robosim_workspace_user_${uid}_${baseKey}`;
  }
  if (mode === 'guest') {
    return `robosim_workspace_guest_${baseKey}`;
  }
  return null;
}

export function getActiveWorkspaceScope(): {
  mode: WorkspaceScopeMode;
  uid: string | null;
  namespacePrefix: string | null;
} {
  const namespacePrefix =
    activeScopeMode === 'user' && activeCloudUid
      ? `robosim_workspace_user_${activeCloudUid}_`
      : activeScopeMode === 'guest'
      ? 'robosim_workspace_guest_'
      : null;
  return {
    mode: activeScopeMode,
    uid: activeCloudUid,
    namespacePrefix,
  };
}

export function setActiveWorkspaceScope(
  mode: WorkspaceScopeMode,
  uid: string | null = null
): void {
  const normalizedUid = mode === 'user' && uid ? uid.trim() : null;
  const normalizedMode: WorkspaceScopeMode =
    mode === 'user' && !normalizedUid ? 'unauthenticated' : mode;

  const changed =
    activeScopeMode !== normalizedMode || activeCloudUid !== normalizedUid;

  activeScopeMode = normalizedMode;
  activeCloudUid = normalizedUid;
  setActivePendingSyncUserId(normalizedUid);

  if (changed) {
    clearPersistedLabController();
    notifyStoreSubscribers();
  }
}

export function setActiveCloudUserId(uid: string | null): void {
  if (uid && uid.trim()) {
    setActiveWorkspaceScope('user', uid.trim());
  } else {
    let isGuest = false;
    try {
      isGuest =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem(GUEST_SESSION_STORAGE_KEY) === 'true';
    } catch {
      isGuest = false;
    }
    setActiveWorkspaceScope(isGuest ? 'guest' : 'unauthenticated', null);
  }
}

export function getActiveCloudUserId(): string | null {
  return activeCloudUid;
}

function readScopedStorageItem(baseKey: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const scopedKey = getScopedStorageKey(baseKey);
    if (!scopedKey) return null;
    return localStorage.getItem(scopedKey);
  } catch {
    return null;
  }
}

function writeScopedStorageItem(baseKey: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const scopedKey = getScopedStorageKey(baseKey);
    if (!scopedKey) return false;
    localStorage.setItem(scopedKey, value);
    return true;
  } catch {
    return false;
  }
}

function removeScopedStorageItem(baseKey: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const scopedKey = getScopedStorageKey(baseKey);
    if (!scopedKey) return;
    localStorage.removeItem(scopedKey);
  } catch {
    // ignore
  }
}

function triggerCloudSync(category: WorkspaceCategoryKey, payload: unknown): void {
  if (activeScopeMode !== 'user' || !activeCloudUid) return;
  void saveWorkspaceCategoryToCloud(activeCloudUid, category, payload);
}

function triggerSettingsAndPreferencesCloudSync(prefsPayload: {
  selectedRobotId: string;
  selectedEnvironmentId: string;
  selectedPolicyId: string;
  demoPreviewEnabled: boolean;
}): void {
  if (activeScopeMode !== 'user' || !activeCloudUid) return;
  void saveWorkspaceCategoryToCloud(activeCloudUid, 'preferences', prefsPayload);
  void saveWorkspaceCategoryToCloud(activeCloudUid, 'settings', prefsPayload);
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
    const { namespacePrefix } = getActiveWorkspaceScope();
    if (!e.key || (namespacePrefix && e.key.startsWith(namespacePrefix))) {
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
    const rawExp = readScopedStorageItem(STORAGE_KEYS.EXPERIMENTS);
    const parsedExp: ExperimentRecord[] = rawExp ? JSON.parse(rawExp) : [];
    if (!Array.isArray(parsedExp)) return [];

    // Merge any failure metadata from scoped FAILURES into corresponding failed experiments
    const rawFail = readScopedStorageItem(STORAGE_KEYS.FAILURES);
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
    if (writeScopedStorageItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(updated))) {
      const failureRecords = deriveFailureRecordsFromExperiments(updated);
      writeScopedStorageItem(STORAGE_KEYS.FAILURES, JSON.stringify(failureRecords));
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
    if (writeScopedStorageItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(updated))) {
      const failureRecords = deriveFailureRecordsFromExperiments(updated);
      writeScopedStorageItem(STORAGE_KEYS.FAILURES, JSON.stringify(failureRecords));
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
    removeScopedStorageItem(STORAGE_KEYS.EXPERIMENTS);
    removeScopedStorageItem(STORAGE_KEYS.FAILURES);
    triggerCloudSync('experiments', []);
    triggerCloudSync('failures', []);
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
    const raw = readScopedStorageItem(STORAGE_KEYS.SCENARIOS);
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
    const raw = readScopedStorageItem(STORAGE_KEYS.SCENARIOS);
    const custom: ScenarioConfig[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(custom)
      ? custom.filter((c) => c.id !== scenario.id)
      : [];
    const updatedCustom = [...filtered, { ...scenario, isCustom: true }];
    if (writeScopedStorageItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(updatedCustom))) {
      triggerCloudSync('scenarios', updatedCustom);
    }
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
    const raw = readScopedStorageItem(STORAGE_KEYS.SCENARIOS);
    const custom: ScenarioConfig[] = raw ? JSON.parse(raw) : [];
    const incomingIds = new Set(newScenarios.map((s) => s.id));
    const incomingNames = new Set(newScenarios.map((s) => s.name));
    const filtered = Array.isArray(custom)
      ? custom.filter((c) => !incomingIds.has(c.id) && !incomingNames.has(c.name))
      : [];
    const updatedCustom = [
      ...filtered,
      ...newScenarios.map((s) => ({ ...s, isCustom: true })),
    ];
    if (writeScopedStorageItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(updatedCustom))) {
      triggerCloudSync('scenarios', updatedCustom);
    }
    notifyStoreSubscribers();
    return [...DEFAULT_SCENARIOS, ...updatedCustom];
  } catch {
    return [...DEFAULT_SCENARIOS, ...newScenarios];
  }
}

export function loadPolicies(): NavigationPolicyConfig[] {
  try {
    const candidateState = loadCandidatePolicyState();
    const activePolId =
      readScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID) || 'pol-hybrid-safe';

    const syncCandidateMetadata = (list: NavigationPolicyConfig[]): NavigationPolicyConfig[] => {
      const meanReward =
        candidateState.trainingMetricsSummary?.meanReward ??
        (candidateState.trainingHistory.length > 0
          ? Number(
              (
                candidateState.trainingHistory.reduce((acc, ep) => acc + ep.totalReward, 0) /
                candidateState.trainingHistory.length
              ).toFixed(1)
            )
          : undefined);

      return list.map((p) => {
        if (p.id === 'pol-candidate-rl') {
          return {
            ...p,
            name: candidateState.name || p.name,
            version: candidateState.version || p.version,
            isCandidatePolicy: true,
            createdAt: candidateState.createdAt ?? candidateState.lastTrainedAt ?? p.createdAt,
            activatedAt: candidateState.activatedAt ?? p.activatedAt,
            isActive: activePolId === 'pol-candidate-rl',
            trainedRobotId: candidateState.trainedRobotId ?? p.trainedRobotId,
            trainedRobotName: candidateState.trainedRobotName ?? p.trainedRobotName,
            trainedEnvironmentId: candidateState.trainedEnvironmentId ?? p.trainedEnvironmentId,
            trainedEnvironmentName:
              candidateState.trainedEnvironmentName ?? p.trainedEnvironmentName,
            totalEpisodesTrained: candidateState.totalEpisodesTrained ?? p.totalEpisodesTrained,
            meanEpisodeReward: meanReward ?? p.meanEpisodeReward,
          };
        }
        return {
          ...p,
          isActive: p.id === activePolId,
        };
      });
    };

    const raw = readScopedStorageItem(STORAGE_KEYS.POLICIES);
    if (!raw) return syncCandidateMetadata(NAVIGATION_POLICIES);
    const parsed: NavigationPolicyConfig[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return syncCandidateMetadata(NAVIGATION_POLICIES);
    }
    // Deduplicate by policy ID while ensuring Candidate Q-Learning Policy is always present
    const seen = new Set<string>();
    const deduped: NavigationPolicyConfig[] = [];
    for (const item of parsed) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }
    const hasCandidate = deduped.some((p) => p.id === 'pol-candidate-rl');
    if (!hasCandidate) {
      const candDefault = NAVIGATION_POLICIES.find(
        (p) => p.id === 'pol-candidate-rl'
      );
      if (candDefault) {
        return syncCandidateMetadata([deduped[0], candDefault, ...deduped.slice(1)]);
      }
    }
    return syncCandidateMetadata(deduped);
  } catch {
    return NAVIGATION_POLICIES;
  }
}

export function savePolicies(policies: NavigationPolicyConfig[]): void {
  try {
    if (writeScopedStorageItem(STORAGE_KEYS.POLICIES, JSON.stringify(policies))) {
      triggerCloudSync('policies', policies);
    }
    notifyStoreSubscribers();
  } catch {
    // ignore storage errors
  }
}

export function loadSelectedPolicyId(): string {
  try {
    const saved = readScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID);
    const rawPolicies = readScopedStorageItem(STORAGE_KEYS.POLICIES);
    const list: NavigationPolicyConfig[] = rawPolicies
      ? JSON.parse(rawPolicies)
      : NAVIGATION_POLICIES;
    const validIds = new Set(
      (Array.isArray(list) && list.length > 0 ? list : NAVIGATION_POLICIES).map(
        (p) => p.id
      )
    );
    validIds.add('pol-candidate-rl');
    validIds.add('pol-hybrid-safe');
    if (saved && validIds.has(saved)) {
      return saved;
    }
    return 'pol-hybrid-safe';
  } catch {
    return 'pol-hybrid-safe';
  }
}

export function saveSelectedPolicyId(policyId: string): void {
  try {
    if (writeScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID, policyId)) {
      const candRaw = readScopedStorageItem(STORAGE_KEYS.CANDIDATE_POLICY);
      if (candRaw) {
        const parsedCand = JSON.parse(candRaw) as CandidatePolicyState;
        if (parsedCand && typeof parsedCand === 'object') {
          const updatedCand: CandidatePolicyState = {
            ...parsedCand,
            isActive: policyId === 'pol-candidate-rl',
            activatedAt:
              policyId === 'pol-candidate-rl'
                ? parsedCand.activatedAt || new Date().toISOString()
                : parsedCand.activatedAt,
          };
          writeScopedStorageItem(
            STORAGE_KEYS.CANDIDATE_POLICY,
            JSON.stringify(updatedCand)
          );
          triggerCloudSync('candidatePolicy', updatedCand);
          triggerCloudSync('trainingStates', updatedCand);
        }
      }
      triggerSettingsAndPreferencesCloudSync({
        selectedRobotId: loadSelectedRobotId(),
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        selectedPolicyId: policyId,
        demoPreviewEnabled: loadDemoPreviewPreference(),
      });
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

export function loadCandidatePolicyState(): CandidatePolicyState {
  try {
    const raw = readScopedStorageItem(STORAGE_KEYS.CANDIDATE_POLICY);
    if (!raw) return createInitialCandidatePolicyState();
    const parsed: CandidatePolicyState = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.qTable) {
      return createInitialCandidatePolicyState();
    }
    const activePolId = readScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID);
    return {
      ...parsed,
      isActive:
        activePolId !== null
          ? activePolId === 'pol-candidate-rl'
          : Boolean(parsed.isActive),
    };
  } catch {
    return createInitialCandidatePolicyState();
  }
}

export function saveCandidatePolicyState(state: CandidatePolicyState): void {
  try {
    if (writeScopedStorageItem(STORAGE_KEYS.CANDIDATE_POLICY, JSON.stringify(state))) {
      triggerCloudSync('candidatePolicy', state);
      triggerCloudSync('trainingStates', state);
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

export function validateAndSaveAndActivateCandidatePolicy(
  candidateInput?: CandidatePolicyState
): {
  success: boolean;
  error?: string;
  candidateState: CandidatePolicyState;
  policies: NavigationPolicyConfig[];
  activePolicyId: string;
} {
  const currentCandidate = candidateInput ?? loadCandidatePolicyState();
  const currentPolicies = loadPolicies();

  if (!currentCandidate || typeof currentCandidate !== 'object') {
    return {
      success: false,
      error: 'Candidate policy state does not exist.',
      candidateState: createInitialCandidatePolicyState(),
      policies: currentPolicies,
      activePolicyId: loadSelectedPolicyId(),
    };
  }

  const qTableKeys =
    currentCandidate.qTable && typeof currentCandidate.qTable === 'object'
      ? Object.keys(currentCandidate.qTable)
      : [];

  if (
    !currentCandidate.isTrained ||
    currentCandidate.totalEpisodesTrained <= 0 ||
    qTableKeys.length === 0
  ) {
    return {
      success: false,
      error:
        'Cannot save & activate an untrained candidate policy: learned Q-table is empty (0 states learned). Run Q-Learning training episodes first.',
      candidateState: currentCandidate,
      policies: currentPolicies,
      activePolicyId: loadSelectedPolicyId(),
    };
  }

  const nowIso = new Date().toISOString();
  const history = Array.isArray(currentCandidate.trainingHistory)
    ? currentCandidate.trainingHistory
    : [];
  const episodesCompleted =
    history.length > 0 ? history.length : currentCandidate.totalEpisodesTrained;
  const successCount = history.filter((ep) => ep.status === 'Success').length;
  const failureCount = history.length - successCount;
  const successRatePct =
    history.length > 0
      ? Number(((successCount / history.length) * 100).toFixed(1))
      : 100;
  const meanReward =
    history.length > 0
      ? Number(
          (
            history.reduce((acc, ep) => acc + ep.totalReward, 0) / history.length
          ).toFixed(1)
        )
      : 0;
  const safetyInterventions = history.reduce(
    (acc, ep) => acc + (ep.safetyInterventionCount ?? 0),
    0
  );

  const enrichedCandidate: CandidatePolicyState = {
    ...currentCandidate,
    id: 'pol-candidate-rl',
    name: currentCandidate.name || 'Candidate Q-Learning Policy',
    createdAt: currentCandidate.createdAt || currentCandidate.lastTrainedAt || nowIso,
    lastTrainedAt: currentCandidate.lastTrainedAt || nowIso,
    activatedAt: nowIso,
    isActive: true,
    trainingMetricsSummary: {
      episodesCompleted,
      successCount,
      failureCount,
      successRatePct,
      meanReward,
      safetyInterventions,
      learnedStatesCount: qTableKeys.length,
    },
  };

  const updatedPolicies = currentPolicies.map((pol) => {
    if (pol.id === 'pol-candidate-rl') {
      return {
        ...pol,
        name: enrichedCandidate.name,
        version: enrichedCandidate.version,
        isCandidatePolicy: true,
        isActive: true,
        createdAt: enrichedCandidate.createdAt ?? nowIso,
        activatedAt: nowIso,
        trainedRobotId: enrichedCandidate.trainedRobotId,
        trainedRobotName: enrichedCandidate.trainedRobotName,
        trainedEnvironmentId: enrichedCandidate.trainedEnvironmentId,
        trainedEnvironmentName: enrichedCandidate.trainedEnvironmentName,
        totalEpisodesTrained: enrichedCandidate.totalEpisodesTrained,
        meanEpisodeReward: meanReward,
        description: `Trained Tabular Q-Learning policy (${enrichedCandidate.version}) with ${qTableKeys.length} learned states across ${enrichedCandidate.totalEpisodesTrained} episodes (${successRatePct}% success, mean reward ${meanReward > 0 ? '+' : ''}${meanReward}). Enforces hard collision safety layer.`,
      };
    }
    return {
      ...pol,
      isActive: false,
    };
  });

  try {
    const wroteCand = writeScopedStorageItem(
      STORAGE_KEYS.CANDIDATE_POLICY,
      JSON.stringify(enrichedCandidate)
    );
    writeScopedStorageItem(
      STORAGE_KEYS.POLICIES,
      JSON.stringify(updatedPolicies)
    );
    writeScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID, 'pol-candidate-rl');

    if (wroteCand) {
      // Verify persistence read-back
      const verifyRaw = readScopedStorageItem(STORAGE_KEYS.CANDIDATE_POLICY);
      const verifyParsed = verifyRaw
        ? (JSON.parse(verifyRaw) as CandidatePolicyState)
        : null;
      if (
        !verifyParsed ||
        !verifyParsed.qTable ||
        Object.keys(verifyParsed.qTable).length === 0
      ) {
        return {
          success: false,
          error: 'Failed to verify Q-table persistence in browser storage.',
          candidateState: currentCandidate,
          policies: currentPolicies,
          activePolicyId: loadSelectedPolicyId(),
        };
      }

      triggerCloudSync('candidatePolicy', enrichedCandidate);
      triggerCloudSync('trainingStates', enrichedCandidate);
      triggerCloudSync('policies', updatedPolicies);
      triggerSettingsAndPreferencesCloudSync({
        selectedRobotId: loadSelectedRobotId(),
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        selectedPolicyId: 'pol-candidate-rl',
        demoPreviewEnabled: loadDemoPreviewPreference(),
      });
    }

    notifyStoreSubscribers();

    return {
      success: true,
      candidateState: enrichedCandidate,
      policies: updatedPolicies,
      activePolicyId: 'pol-candidate-rl',
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Storage error while saving candidate policy.',
      candidateState: currentCandidate,
      policies: currentPolicies,
      activePolicyId: loadSelectedPolicyId(),
    };
  }
}

export function resetCandidatePolicyState(): CandidatePolicyState {
  const fresh = createInitialCandidatePolicyState();
  saveCandidatePolicyState(fresh);
  return fresh;
}

export function loadBenchmarkHistory(): BenchmarkSuiteResult[] {
  try {
    const raw = readScopedStorageItem(STORAGE_KEYS.BENCHMARKS);
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
    if (writeScopedStorageItem(STORAGE_KEYS.BENCHMARKS, JSON.stringify(updated))) {
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
    const raw = readScopedStorageItem(STORAGE_KEYS.FD_BATCHES);
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
    if (writeScopedStorageItem(STORAGE_KEYS.FD_BATCHES, JSON.stringify(updated))) {
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
    return readScopedStorageItem(STORAGE_KEYS.DEMO_MODE) === 'true';
  } catch {
    return false;
  }
}

export function saveDemoPreviewPreference(enabled: boolean): void {
  try {
    if (writeScopedStorageItem(STORAGE_KEYS.DEMO_MODE, enabled ? 'true' : 'false')) {
      triggerSettingsAndPreferencesCloudSync({
        selectedRobotId: loadSelectedRobotId(),
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        selectedPolicyId: loadSelectedPolicyId(),
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
    const raw = readScopedStorageItem(STORAGE_KEYS.ROBOTS);
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
    const raw = readScopedStorageItem(STORAGE_KEYS.ROBOTS);
    const custom: RobotUnitConfig[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(custom)
      ? custom.filter((r) => r && r.id !== normalized.id)
      : [];
    const updatedCustom = [...filtered, normalized];
    if (writeScopedStorageItem(STORAGE_KEYS.ROBOTS, JSON.stringify(updatedCustom))) {
      triggerCloudSync('robots', updatedCustom);
    }
    notifyStoreSubscribers();
    return [...ROBOT_UNITS, ...updatedCustom];
  } catch {
    return ROBOT_UNITS;
  }
}

export function deleteCustomRobot(robotId: string): RobotUnitConfig[] {
  try {
    const raw = readScopedStorageItem(STORAGE_KEYS.ROBOTS);
    const custom: RobotUnitConfig[] = raw ? JSON.parse(raw) : [];
    const updatedCustom = Array.isArray(custom)
      ? custom.filter((r) => r && r.id !== robotId)
      : [];
    if (writeScopedStorageItem(STORAGE_KEYS.ROBOTS, JSON.stringify(updatedCustom))) {
      triggerCloudSync('robots', updatedCustom);
    }
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
    const saved = readScopedStorageItem(STORAGE_KEYS.SELECTED_ROBOT_ID);
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
    if (writeScopedStorageItem(STORAGE_KEYS.SELECTED_ROBOT_ID, robotId)) {
      triggerSettingsAndPreferencesCloudSync({
        selectedRobotId: robotId,
        selectedEnvironmentId: loadSelectedEnvironmentId(),
        selectedPolicyId: loadSelectedPolicyId(),
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
    const raw = readScopedStorageItem(STORAGE_KEYS.ROBOT_BENCHMARKS);
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
    if (
      writeScopedStorageItem(
        STORAGE_KEYS.ROBOT_BENCHMARKS,
        JSON.stringify(updated)
      )
    ) {
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
    const raw = readScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS);
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

/**
 * Strips oversized inline binary data URLs (> 64KB) from EnvironmentDefinition
 * before syncing to Firestore so large files stay strictly in browser IndexedDB.
 */
export function sanitizeEnvironmentForCloud(
  env: EnvironmentDefinition
): EnvironmentDefinition {
  if (!env.importedMap) return env;
  const imported = { ...env.importedMap };
  if (imported.imageDataUrl && imported.imageDataUrl.length > 65536) {
    delete imported.imageDataUrl;
  }
  if (
    imported.modelDataUrl &&
    (imported.modelDataUrl.length > 65536 ||
      imported.modelDataUrl.startsWith('blob:'))
  ) {
    delete imported.modelDataUrl;
  }
  return {
    ...env,
    importedMap: imported,
  };
}

export function saveCustomEnvironment(
  env: EnvironmentDefinition
): EnvironmentDefinition[] {
  try {
    const synced = syncEnvironmentDerivedStructures({
      ...env,
      updatedAt: new Date().toISOString(),
    });
    const raw = readScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS);
    const custom: EnvironmentDefinition[] = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(custom)
      ? custom.filter((c) => c && c.id !== synced.id)
      : [];
    const updatedCustom = [...filtered, synced];
    const wrote = writeScopedStorageItem(
      STORAGE_KEYS.ENVIRONMENTS,
      JSON.stringify(updatedCustom)
    );
    if (!wrote) {
      // If localStorage quota is tight due to inline dataUrl, store sanitized copy in localStorage
      // (full binary blob is already stored in IndexedDB)
      const sanitizedLocal = updatedCustom.map(sanitizeEnvironmentForCloud);
      writeScopedStorageItem(
        STORAGE_KEYS.ENVIRONMENTS,
        JSON.stringify(sanitizedLocal)
      );
    }
    triggerCloudSync(
      'environments',
      updatedCustom.map(sanitizeEnvironmentForCloud)
    );
    notifyStoreSubscribers();
    return loadEnvironments();
  } catch {
    return BUILTIN_ENVIRONMENTS;
  }
}

export function deleteCustomEnvironment(envId: string): EnvironmentDefinition[] {
  try {
    const raw = readScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS);
    const custom: EnvironmentDefinition[] = raw ? JSON.parse(raw) : [];
    const updatedCustom = Array.isArray(custom)
      ? custom.filter((c) => c && c.id !== envId)
      : [];
    if (
      writeScopedStorageItem(
        STORAGE_KEYS.ENVIRONMENTS,
        JSON.stringify(updatedCustom)
      )
    ) {
      triggerCloudSync(
        'environments',
        updatedCustom.map(sanitizeEnvironmentForCloud)
      );
    }
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
    const saved = readScopedStorageItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID);
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
    if (writeScopedStorageItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID, envId)) {
      triggerSettingsAndPreferencesCloudSync({
        selectedRobotId: loadSelectedRobotId(),
        selectedEnvironmentId: envId,
        selectedPolicyId: loadSelectedPolicyId(),
        demoPreviewEnabled: loadDemoPreviewPreference(),
      });
    }
    notifyStoreSubscribers();
  } catch {
    // ignore
  }
}

function extractRecordTimestampMs(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const rec = item as Record<string, unknown>;
  const candidates = [
    rec.updatedAt,
    rec.activatedAt,
    rec.lastTrainedAt,
    rec.createdAt,
    rec.timestamp,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) {
      const parsed = Date.parse(val.replace(' ', 'T'));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

/**
 * Safely merges local and cloud arrays by stable ID (`id`) and update timestamp.
 * Neither local nor cloud blindly overwrites newer records.
 */
function mergeRecordsSafely<T extends { id: string }>(
  localArr: T[],
  cloudArr: unknown
): T[] {
  const map = new Map<string, T>();

  if (Array.isArray(cloudArr)) {
    for (const rawItem of cloudArr) {
      if (rawItem && typeof rawItem === 'object' && 'id' in rawItem) {
        const item = rawItem as T;
        if (item.id) {
          map.set(item.id, item);
        }
      }
    }
  }

  if (Array.isArray(localArr)) {
    for (const localItem of localArr) {
      if (!localItem || !localItem.id) continue;
      const existingCloud = map.get(localItem.id);
      if (!existingCloud) {
        map.set(localItem.id, localItem);
      } else {
        const cloudTs = extractRecordTimestampMs(existingCloud);
        const localTs = extractRecordTimestampMs(localItem);
        // Prefer whichever record has the newer timestamp; if equal/missing, prefer local working copy
        // while preserving any local runtime preview fields (e.g. imageDataUrl)
        if (localTs >= cloudTs) {
          map.set(localItem.id, { ...existingCloud, ...localItem });
        } else {
          map.set(localItem.id, { ...localItem, ...existingCloud });
        }
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Flushes any pending workspace categories that were queued while offline for the given uid.
 */
export async function flushPendingCloudSync(uid: string): Promise<number> {
  if (!uid || activeCloudUid !== uid) return 0;
  const pending = getPendingSyncCategories(uid);
  if (pending.length === 0) return 0;
  let flushedCount = 0;

  for (const category of pending) {
    if (activeCloudUid !== uid) break;
    let ok = false;
    switch (category) {
      case 'robots': {
        const raw = readScopedStorageItem(STORAGE_KEYS.ROBOTS);
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'robots',
          raw ? JSON.parse(raw) : []
        );
        break;
      }
      case 'environments': {
        const raw = readScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS);
        const parsed: EnvironmentDefinition[] = raw ? JSON.parse(raw) : [];
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'environments',
          parsed.map(sanitizeEnvironmentForCloud)
        );
        break;
      }
      case 'scenarios': {
        const raw = readScopedStorageItem(STORAGE_KEYS.SCENARIOS);
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'scenarios',
          raw ? JSON.parse(raw) : []
        );
        break;
      }
      case 'policies': {
        ok = await saveWorkspaceCategoryToCloud(uid, 'policies', loadPolicies());
        break;
      }
      case 'candidatePolicy':
      case 'trainingStates': {
        const cand = loadCandidatePolicyState();
        ok = await saveWorkspaceCategoryToCloud(uid, category, cand);
        break;
      }
      case 'experiments': {
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'experiments',
          loadStoredExperiments()
        );
        break;
      }
      case 'failures': {
        const exps = loadStoredExperiments();
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'failures',
          deriveFailureRecordsFromExperiments(exps)
        );
        break;
      }
      case 'benchmarks': {
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'benchmarks',
          loadBenchmarkHistory()
        );
        break;
      }
      case 'robotBenchmarks': {
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'robotBenchmarks',
          loadCrossRobotBenchmarkHistory()
        );
        break;
      }
      case 'fdBatches': {
        ok = await saveWorkspaceCategoryToCloud(
          uid,
          'fdBatches',
          loadFailureDrivenBatches()
        );
        break;
      }
      case 'preferences':
      case 'settings': {
        ok = await saveWorkspaceCategoryToCloud(uid, category, {
          selectedRobotId: loadSelectedRobotId(),
          selectedEnvironmentId: loadSelectedEnvironmentId(),
          selectedPolicyId: loadSelectedPolicyId(),
          demoPreviewEnabled: loadDemoPreviewPreference(),
        });
        break;
      }
    }
    if (ok) flushedCount++;
  }
  return flushedCount;
}

/**
 * Strictly isolated per-user workspace hydration and synchronization.
 * Merges ONLY the authenticated user's own local cache (`robosim_workspace_user_${uid}_*`)
 * with their Firestore documents (`users/${uid}/workspace/*`).
 * Never reads or imports another user's workspace or the Guest workspace.
 */
export async function hydrateAndMigrateUserWorkspace(
  uid: string,
  isSessionStillValid?: () => boolean
): Promise<{
  migratedCounts: {
    robots: number;
    environments: number;
    scenarios: number;
    experiments: number;
    benchmarks: number;
    localFilesClaimed: number;
  };
}> {
  const emptyResult = {
    migratedCounts: {
      robots: 0,
      environments: 0,
      scenarios: 0,
      experiments: 0,
      benchmarks: 0,
      localFilesClaimed: 0,
    },
  };

  if (!uid || !uid.trim()) {
    return emptyResult;
  }

  // Immediately lock the active workspace scope to this authenticated user's UID
  setActiveWorkspaceScope('user', uid);

  const checkValid = () => {
    if (activeScopeMode !== 'user' || activeCloudUid !== uid) return false;
    if (isSessionStillValid && !isSessionStillValid()) return false;
    return true;
  };

  const { categories: cloudData } = await loadAllWorkspaceCategoriesFromCloud(uid);

  // Guard against stale async completion if user signed out or switched accounts
  if (!checkValid()) {
    return emptyResult;
  }

  // 1. Custom Robots (strictly scoped to robosim_workspace_user_${uid}_custom_robots_v1)
  const rawLocalRobots = readScopedStorageItem(STORAGE_KEYS.ROBOTS);
  const localCustomRobots: RobotUnitConfig[] = rawLocalRobots
    ? JSON.parse(rawLocalRobots)
    : [];
  const mergedRobots = mergeRecordsSafely(localCustomRobots, cloudData.robots);
  writeScopedStorageItem(STORAGE_KEYS.ROBOTS, JSON.stringify(mergedRobots));
  await saveWorkspaceCategoryToCloud(uid, 'robots', mergedRobots);
  if (!checkValid()) return emptyResult;

  // 2. Custom Environments (preserving local preview URLs & IndexedDB file references)
  const rawLocalEnvs = readScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS);
  const localCustomEnvs: EnvironmentDefinition[] = rawLocalEnvs
    ? JSON.parse(rawLocalEnvs)
    : [];
  const mergedEnvs = mergeRecordsSafely(
    localCustomEnvs,
    cloudData.environments
  ).map((env) => syncEnvironmentDerivedStructures(env));
  if (!writeScopedStorageItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(mergedEnvs))) {
    writeScopedStorageItem(
      STORAGE_KEYS.ENVIRONMENTS,
      JSON.stringify(mergedEnvs.map(sanitizeEnvironmentForCloud))
    );
  }
  await saveWorkspaceCategoryToCloud(
    uid,
    'environments',
    mergedEnvs.map(sanitizeEnvironmentForCloud)
  );
  if (!checkValid()) return emptyResult;

  // 3. Custom Scenarios
  const rawLocalScens = readScopedStorageItem(STORAGE_KEYS.SCENARIOS);
  const localCustomScens: ScenarioConfig[] = rawLocalScens
    ? JSON.parse(rawLocalScens)
    : [];
  const mergedScens = mergeRecordsSafely(localCustomScens, cloudData.scenarios);
  writeScopedStorageItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(mergedScens));
  await saveWorkspaceCategoryToCloud(uid, 'scenarios', mergedScens);
  if (!checkValid()) return emptyResult;

  // 4. Experiments & Failures
  const localExps = loadStoredExperiments();
  const mergedExps = mergeRecordsSafely(localExps, cloudData.experiments);
  writeScopedStorageItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(mergedExps));
  const derivedFailures = deriveFailureRecordsFromExperiments(mergedExps);
  writeScopedStorageItem(STORAGE_KEYS.FAILURES, JSON.stringify(derivedFailures));
  await saveWorkspaceCategoryToCloud(uid, 'experiments', mergedExps);
  await saveWorkspaceCategoryToCloud(uid, 'failures', derivedFailures);
  if (!checkValid()) return emptyResult;

  // 5. Candidate Policy State & Training States (Never reset or overwrite a trained policy with an untrained one)
  const localCand = loadCandidatePolicyState();
  const cloudCand = (cloudData.candidatePolicy ??
    cloudData.trainingStates) as CandidatePolicyState | undefined;

  let activeCand = localCand;
  if (cloudCand && typeof cloudCand === 'object' && cloudCand.qTable) {
    const cloudStatesCount = Object.keys(cloudCand.qTable).length;
    const localStatesCount = Object.keys(localCand.qTable || {}).length;
    const cloudEpisodes = cloudCand.totalEpisodesTrained ?? 0;
    const localEpisodes = localCand.totalEpisodesTrained ?? 0;
    const cloudTs = extractRecordTimestampMs(cloudCand);
    const localTs = extractRecordTimestampMs(localCand);

    if (
      (cloudCand.isTrained && !localCand.isTrained) ||
      cloudEpisodes > localEpisodes ||
      (cloudEpisodes === localEpisodes &&
        cloudStatesCount >= localStatesCount &&
        cloudTs > localTs)
    ) {
      activeCand = cloudCand;
    }
  }
  writeScopedStorageItem(STORAGE_KEYS.CANDIDATE_POLICY, JSON.stringify(activeCand));
  await saveWorkspaceCategoryToCloud(uid, 'candidatePolicy', activeCand);
  await saveWorkspaceCategoryToCloud(uid, 'trainingStates', activeCand);
  if (!checkValid()) return emptyResult;

  // 6. Policies Metadata
  const localPols = loadPolicies();
  const mergedPols = mergeRecordsSafely(localPols, cloudData.policies);
  writeScopedStorageItem(STORAGE_KEYS.POLICIES, JSON.stringify(mergedPols));
  await saveWorkspaceCategoryToCloud(uid, 'policies', loadPolicies());
  if (!checkValid()) return emptyResult;

  // 7. Benchmarks, Cross-Robot Benchmarks & Failure-Driven Batches
  const localBench = loadBenchmarkHistory();
  const mergedBench = mergeRecordsSafely(localBench, cloudData.benchmarks);
  writeScopedStorageItem(STORAGE_KEYS.BENCHMARKS, JSON.stringify(mergedBench));
  await saveWorkspaceCategoryToCloud(uid, 'benchmarks', mergedBench);

  const localRobotBench = loadCrossRobotBenchmarkHistory();
  const mergedRobotBench = mergeRecordsSafely(
    localRobotBench,
    cloudData.robotBenchmarks
  );
  writeScopedStorageItem(
    STORAGE_KEYS.ROBOT_BENCHMARKS,
    JSON.stringify(mergedRobotBench)
  );
  await saveWorkspaceCategoryToCloud(uid, 'robotBenchmarks', mergedRobotBench);

  const localFdBatches = loadFailureDrivenBatches();
  const mergedFdBatches = mergeRecordsSafely(localFdBatches, cloudData.fdBatches);
  writeScopedStorageItem(STORAGE_KEYS.FD_BATCHES, JSON.stringify(mergedFdBatches));
  await saveWorkspaceCategoryToCloud(uid, 'fdBatches', mergedFdBatches);
  if (!checkValid()) return emptyResult;

  // 8. Preferences & Settings
  const cloudPrefs = (cloudData.settings ?? cloudData.preferences) as
    | {
        selectedRobotId?: string;
        selectedEnvironmentId?: string;
        selectedPolicyId?: string;
        demoPreviewEnabled?: boolean;
      }
    | undefined;
  if (
    cloudPrefs?.selectedRobotId &&
    !readScopedStorageItem(STORAGE_KEYS.SELECTED_ROBOT_ID)
  ) {
    writeScopedStorageItem(
      STORAGE_KEYS.SELECTED_ROBOT_ID,
      cloudPrefs.selectedRobotId
    );
  }
  if (
    cloudPrefs?.selectedEnvironmentId &&
    !readScopedStorageItem(STORAGE_KEYS.SELECTED_ENVIRONMENT_ID)
  ) {
    writeScopedStorageItem(
      STORAGE_KEYS.SELECTED_ENVIRONMENT_ID,
      cloudPrefs.selectedEnvironmentId
    );
  }
  if (
    cloudPrefs?.selectedPolicyId &&
    !readScopedStorageItem(STORAGE_KEYS.SELECTED_POLICY_ID)
  ) {
    writeScopedStorageItem(
      STORAGE_KEYS.SELECTED_POLICY_ID,
      cloudPrefs.selectedPolicyId
    );
  }
  if (
    typeof cloudPrefs?.demoPreviewEnabled === 'boolean' &&
    readScopedStorageItem(STORAGE_KEYS.DEMO_MODE) === null
  ) {
    writeScopedStorageItem(
      STORAGE_KEYS.DEMO_MODE,
      cloudPrefs.demoPreviewEnabled ? 'true' : 'false'
    );
  }

  const resolvedSettings = {
    selectedRobotId: loadSelectedRobotId(),
    selectedEnvironmentId: loadSelectedEnvironmentId(),
    selectedPolicyId: loadSelectedPolicyId(),
    demoPreviewEnabled: loadDemoPreviewPreference(),
  };

  await saveWorkspaceCategoryToCloud(uid, 'preferences', resolvedSettings);
  await saveWorkspaceCategoryToCloud(uid, 'settings', resolvedSettings);

  if (!checkValid()) return emptyResult;
  notifyStoreSubscribers();

  return {
    migratedCounts: {
      robots: mergedRobots.length,
      environments: mergedEnvs.length,
      scenarios: mergedScens.length,
      experiments: mergedExps.length,
      benchmarks: mergedBench.length + mergedRobotBench.length,
      localFilesClaimed: 0,
    },
  };
}

/**
 * Explicit, opt-in helper to import Guest Workspace records into the specified authenticated user's workspace.
 * Never invoked automatically on sign-in so Guest data is never duplicated across accounts.
 */
export async function migrateGuestWorkspaceToUser(uid: string): Promise<void> {
  if (!uid || typeof localStorage === 'undefined') return;
  const readGuest = <T>(baseKey: string, fallback: T): T => {
    try {
      const k = getScopedStorageKey(baseKey, { mode: 'guest' });
      const raw = k ? localStorage.getItem(k) : null;
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  setActiveWorkspaceScope('user', uid);

  const guestRobots = readGuest<RobotUnitConfig[]>(STORAGE_KEYS.ROBOTS, []);
  for (const r of guestRobots) {
    saveCustomRobot(r);
  }
  const guestEnvs = readGuest<EnvironmentDefinition[]>(
    STORAGE_KEYS.ENVIRONMENTS,
    []
  );
  for (const e of guestEnvs) {
    saveCustomEnvironment(e);
  }
  const guestScens = readGuest<ScenarioConfig[]>(STORAGE_KEYS.SCENARIOS, []);
  if (guestScens.length > 0) {
    saveCustomScenariosBatch(guestScens);
  }
  const guestExps = readGuest<ExperimentRecord[]>(STORAGE_KEYS.EXPERIMENTS, []);
  if (guestExps.length > 0) {
    saveStoredExperimentsBatch(guestExps);
  }
  await localEnvironmentFileStorage.claimGuestFilesForUser(uid);
  notifyStoreSubscribers();
}




