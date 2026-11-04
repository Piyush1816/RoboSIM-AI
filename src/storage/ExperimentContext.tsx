import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { analyzeWeaknessesFromExperiments } from '../simulation/failureIntelligence';
import {
  clearStoredExperiments,
  computeOverviewMetrics,
  computePolicyAnalytics,
  deleteCustomRobot,
  deriveFailureDiagnosesFromExperiments,
  deriveFailureRecordsFromExperiments,
  getActiveExperimentsList,
  loadBenchmarkHistory,
  loadCandidatePolicyState,
  loadCrossRobotBenchmarkHistory,
  loadDemoPreviewPreference,
  loadFailureDrivenBatches,
  loadPolicies,
  loadRobots,
  loadScenarios,
  loadSelectedRobotId,
  loadStoredExperiments,
  OverviewMetricsSummary,
  PolicyAnalyticsSummary,
  resetCandidatePolicyState,
  saveBenchmarkResult,
  saveCandidatePolicyState,
  saveCrossRobotBenchmarkResult,
  saveCustomRobot,
  saveCustomScenario,
  saveCustomScenariosBatch,
  saveDemoPreviewPreference,
  saveFailureDrivenBatch,
  savePolicies,
  saveSelectedRobotId,
  saveStoredExperiment,
  saveStoredExperimentsBatch,
  subscribeToStoreChanges,
} from './experimentStorage';
import {
  BenchmarkSuiteResult,
  CandidatePolicyState,
  CrossRobotBenchmarkResult,
  ExperimentRecord,
  FailureDiagnosisRecord,
  FailureDrivenGenerationBatch,
  FailureEventRecord,
  FailureWeaknessCluster,
  NavigationPolicyConfig,
  RobotUnitConfig,
  ScenarioConfig,
} from '../types/simulation';

interface ExperimentStoreContextValue {
  storedExperiments: ExperimentRecord[];
  experiments: ExperimentRecord[];
  failures: FailureEventRecord[];
  failureDiagnoses: FailureDiagnosisRecord[];
  weaknessClusters: FailureWeaknessCluster[];
  overviewMetrics: OverviewMetricsSummary;
  policyAnalytics: PolicyAnalyticsSummary[];
  scenarios: ScenarioConfig[];
  policies: NavigationPolicyConfig[];
  robots: RobotUnitConfig[];
  selectedRobotId: string;
  activeRobot: RobotUnitConfig;
  setSelectedRobotId: (robotId: string) => void;
  saveRobotProfile: (robot: RobotUnitConfig) => RobotUnitConfig[];
  deleteRobotProfile: (robotId: string) => RobotUnitConfig[];
  candidatePolicyState: CandidatePolicyState;
  benchmarkHistory: BenchmarkSuiteResult[];
  crossRobotBenchmarks: CrossRobotBenchmarkResult[];
  failureDrivenBatches: FailureDrivenGenerationBatch[];
  demoPreviewEnabled: boolean;
  setDemoPreviewEnabled: (enabled: boolean) => void;
  recordExperiment: (record: Omit<ExperimentRecord, 'id'> & { id?: string }) => ExperimentRecord;
  recordExperimentsBatch: (records: (Omit<ExperimentRecord, 'id'> & { id?: string })[]) => ExperimentRecord[];
  clearHistory: () => void;
  addCustomScenario: (scenario: ScenarioConfig) => void;
  addCustomScenariosBatch: (newScenarios: ScenarioConfig[]) => void;
  updatePolicies: (updated: NavigationPolicyConfig[]) => void;
  updateCandidatePolicyState: (nextState: CandidatePolicyState) => void;
  resetCandidatePolicy: () => CandidatePolicyState;
  recordBenchmarkResult: (result: BenchmarkSuiteResult) => void;
  recordCrossRobotBenchmark: (result: CrossRobotBenchmarkResult) => void;
  recordFailureDrivenBatch: (batch: FailureDrivenGenerationBatch) => void;
}

const ExperimentStoreContext = createContext<ExperimentStoreContextValue | null>(
  null
);

export const ExperimentStoreProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [storedExperiments, setStoredExperiments] = useState<ExperimentRecord[]>(
    () => loadStoredExperiments()
  );
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>(() =>
    loadScenarios()
  );
  const [policies, setPolicies] = useState<NavigationPolicyConfig[]>(() =>
    loadPolicies()
  );
  const [robots, setRobots] = useState<RobotUnitConfig[]>(() => loadRobots());
  const [selectedRobotIdState, setSelectedRobotIdState] = useState<string>(() =>
    loadSelectedRobotId()
  );
  const [candidatePolicyState, setCandidatePolicyState] =
    useState<CandidatePolicyState>(() => loadCandidatePolicyState());
  const [benchmarkHistory, setBenchmarkHistory] = useState<
    BenchmarkSuiteResult[]
  >(() => loadBenchmarkHistory());
  const [crossRobotBenchmarks, setCrossRobotBenchmarks] = useState<
    CrossRobotBenchmarkResult[]
  >(() => loadCrossRobotBenchmarkHistory());
  const [failureDrivenBatches, setFailureDrivenBatches] = useState<
    FailureDrivenGenerationBatch[]
  >(() => loadFailureDrivenBatches());
  const [demoPreviewEnabled, setDemoPreviewState] = useState<boolean>(() =>
    loadDemoPreviewPreference()
  );

  // Sync whenever localStorage or same-tab/cross-tab pub/sub fires
  const syncFromStorage = useCallback(() => {
    setStoredExperiments(loadStoredExperiments());
    setScenarios(loadScenarios());
    setPolicies(loadPolicies());
    setRobots(loadRobots());
    setSelectedRobotIdState(loadSelectedRobotId());
    setCandidatePolicyState(loadCandidatePolicyState());
    setBenchmarkHistory(loadBenchmarkHistory());
    setCrossRobotBenchmarks(loadCrossRobotBenchmarkHistory());
    setFailureDrivenBatches(loadFailureDrivenBatches());
    setDemoPreviewState(loadDemoPreviewPreference());
  }, []);

  useEffect(() => {
    return subscribeToStoreChanges(syncFromStorage);
  }, [syncFromStorage]);

  const setDemoPreviewEnabled = useCallback((enabled: boolean) => {
    setDemoPreviewState(enabled);
    saveDemoPreviewPreference(enabled);
  }, []);

  const recordExperiment = useCallback(
    (input: Omit<ExperimentRecord, 'id'> & { id?: string }): ExperimentRecord => {
      const latestStored = loadStoredExperiments();
      let maxNum = latestStored.length;
      for (const item of latestStored) {
        const match = item.id.match(/^EXP-(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      const nextId = input.id || `EXP-${String(maxNum + 1).padStart(3, '0')}`;
      const fullRecord: ExperimentRecord = {
        ...input,
        id: nextId,
      };
      const updated = saveStoredExperiment(fullRecord);
      setStoredExperiments(updated);
      return fullRecord;
    },
    []
  );

  const recordExperimentsBatch = useCallback(
    (
      inputs: (Omit<ExperimentRecord, 'id'> & { id?: string })[]
    ): ExperimentRecord[] => {
      if (inputs.length === 0) return [];
      const latestStored = loadStoredExperiments();
      let maxNum = latestStored.length;
      for (const item of latestStored) {
        const match = item.id.match(/^EXP-(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      const assigned: ExperimentRecord[] = inputs.map((inp, idx) => {
        const nextId =
          inp.id && inp.id.startsWith('EXP-') && inp.id.length <= 9
            ? inp.id
            : `EXP-${String(maxNum + idx + 1).padStart(3, '0')}`;
        return {
          ...inp,
          id: nextId,
        };
      });
      const updated = saveStoredExperimentsBatch(assigned);
      setStoredExperiments(updated);
      return assigned;
    },
    []
  );

  const clearHistory = useCallback(() => {
    clearStoredExperiments();
    setStoredExperiments([]);
    setDemoPreviewState(false);
    saveDemoPreviewPreference(false);
  }, []);

  const addCustomScenario = useCallback((scenario: ScenarioConfig) => {
    const updated = saveCustomScenario(scenario);
    setScenarios(updated);
  }, []);

  const addCustomScenariosBatch = useCallback(
    (newScenarios: ScenarioConfig[]) => {
      const updated = saveCustomScenariosBatch(newScenarios);
      setScenarios(updated);
    },
    []
  );

  const updatePolicies = useCallback((updated: NavigationPolicyConfig[]) => {
    setPolicies(updated);
    savePolicies(updated);
  }, []);

  const updateCandidatePolicyState = useCallback(
    (nextState: CandidatePolicyState) => {
      setCandidatePolicyState(nextState);
      saveCandidatePolicyState(nextState);
      // Also sync the version string onto the 'pol-candidate-rl' policy card
      setPolicies((prev) => {
        const next = prev.map((p) =>
          p.id === 'pol-candidate-rl' ? { ...p, version: nextState.version } : p
        );
        savePolicies(next);
        return next;
      });
    },
    []
  );

  const resetCandidatePolicy = useCallback((): CandidatePolicyState => {
    const fresh = resetCandidatePolicyState();
    setCandidatePolicyState(fresh);
    return fresh;
  }, []);

  const recordBenchmarkResult = useCallback((result: BenchmarkSuiteResult) => {
    const updated = saveBenchmarkResult(result);
    setBenchmarkHistory(updated);
  }, []);

  const recordCrossRobotBenchmark = useCallback(
    (result: CrossRobotBenchmarkResult) => {
      const updated = saveCrossRobotBenchmarkResult(result);
      setCrossRobotBenchmarks(updated);
    },
    []
  );

  const setSelectedRobotId = useCallback((robotId: string) => {
    setSelectedRobotIdState(robotId);
    saveSelectedRobotId(robotId);
  }, []);

  const saveRobotProfile = useCallback(
    (robot: RobotUnitConfig): RobotUnitConfig[] => {
      const updated = saveCustomRobot(robot);
      setRobots(updated);
      return updated;
    },
    []
  );

  const deleteRobotProfile = useCallback(
    (robotId: string): RobotUnitConfig[] => {
      const updated = deleteCustomRobot(robotId);
      setRobots(updated);
      setSelectedRobotIdState(loadSelectedRobotId());
      return updated;
    },
    []
  );

  const activeRobot = useMemo(
    () =>
      robots.find((r) => r.id === selectedRobotIdState) ??
      robots[0],
    [robots, selectedRobotIdState]
  );

  const recordFailureDrivenBatch = useCallback(
    (batch: FailureDrivenGenerationBatch) => {
      const updated = saveFailureDrivenBatch(batch);
      setFailureDrivenBatches(updated);
    },
    []
  );

  const experiments = useMemo(
    () => getActiveExperimentsList(storedExperiments, demoPreviewEnabled),
    [storedExperiments, demoPreviewEnabled]
  );

  const failures = useMemo(
    () => deriveFailureRecordsFromExperiments(experiments),
    [experiments]
  );

  const failureDiagnoses = useMemo(
    () => deriveFailureDiagnosesFromExperiments(experiments, scenarios),
    [experiments, scenarios]
  );

  const weaknessClusters = useMemo(
    () => analyzeWeaknessesFromExperiments(experiments, scenarios),
    [experiments, scenarios]
  );

  const overviewMetrics = useMemo(
    () => computeOverviewMetrics(experiments),
    [experiments]
  );

  const policyAnalytics = useMemo(
    () => computePolicyAnalytics(experiments, policies),
    [experiments, policies]
  );

  const value = useMemo<ExperimentStoreContextValue>(
    () => ({
      storedExperiments,
      experiments,
      failures,
      failureDiagnoses,
      weaknessClusters,
      overviewMetrics,
      policyAnalytics,
      scenarios,
      policies,
      robots,
      selectedRobotId: selectedRobotIdState,
      activeRobot,
      setSelectedRobotId,
      saveRobotProfile,
      deleteRobotProfile,
      candidatePolicyState,
      benchmarkHistory,
      crossRobotBenchmarks,
      failureDrivenBatches,
      demoPreviewEnabled,
      setDemoPreviewEnabled,
      recordExperiment,
      recordExperimentsBatch,
      clearHistory,
      addCustomScenario,
      addCustomScenariosBatch,
      updatePolicies,
      updateCandidatePolicyState,
      resetCandidatePolicy,
      recordBenchmarkResult,
      recordCrossRobotBenchmark,
      recordFailureDrivenBatch,
    }),
    [
      storedExperiments,
      experiments,
      failures,
      failureDiagnoses,
      weaknessClusters,
      overviewMetrics,
      policyAnalytics,
      scenarios,
      policies,
      robots,
      selectedRobotIdState,
      activeRobot,
      setSelectedRobotId,
      saveRobotProfile,
      deleteRobotProfile,
      candidatePolicyState,
      benchmarkHistory,
      crossRobotBenchmarks,
      failureDrivenBatches,
      demoPreviewEnabled,
      setDemoPreviewEnabled,
      recordExperiment,
      recordExperimentsBatch,
      clearHistory,
      addCustomScenario,
      addCustomScenariosBatch,
      updatePolicies,
      updateCandidatePolicyState,
      resetCandidatePolicy,
      recordBenchmarkResult,
      recordCrossRobotBenchmark,
      recordFailureDrivenBatch,
    ]
  );

  return (
    <ExperimentStoreContext.Provider value={value}>
      {children}
    </ExperimentStoreContext.Provider>
  );
};

export function useExperimentStore(): ExperimentStoreContextValue {
  const ctx = useContext(ExperimentStoreContext);
  if (!ctx) {
    throw new Error(
      'useExperimentStore must be used inside an ExperimentStoreProvider'
    );
  }
  return ctx;
}
