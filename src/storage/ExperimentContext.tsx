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
  deleteCustomEnvironment,
  deleteCustomRobot,
  deriveFailureDiagnosesFromExperiments,
  deriveFailureRecordsFromExperiments,
  getActiveExperimentsList,
  loadBenchmarkHistory,
  loadCandidatePolicyState,
  loadCrossRobotBenchmarkHistory,
  loadDemoPreviewPreference,
  loadEnvironments,
  loadFailureDrivenBatches,
  loadPolicies,
  loadRobots,
  loadScenarios,
  loadSelectedEnvironmentId,
  loadSelectedPolicyId,
  loadSelectedRobotId,
  loadStoredExperiments,
  OverviewMetricsSummary,
  PolicyAnalyticsSummary,
  resetCandidatePolicyState,
  saveBenchmarkResult,
  saveCandidatePolicyState,
  saveCrossRobotBenchmarkResult,
  saveCustomEnvironment,
  saveCustomRobot,
  saveCustomScenario,
  saveCustomScenariosBatch,
  saveDemoPreviewPreference,
  saveFailureDrivenBatch,
  savePolicies,
  saveSelectedEnvironmentId,
  saveSelectedPolicyId,
  saveSelectedRobotId,
  saveStoredExperiment,
  saveStoredExperimentsBatch,
  subscribeToStoreChanges,
  validateAndSaveAndActivateCandidatePolicy,
} from './experimentStorage';
import {
  BenchmarkSuiteResult,
  CandidatePolicyState,
  CrossRobotBenchmarkResult,
  EnvironmentDefinition,
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
  selectedPolicyId: string;
  setSelectedPolicyId: (policyId: string) => void;
  saveAndActivateCandidatePolicy: (candidateOverride?: CandidatePolicyState) => {
    success: boolean;
    error?: string;
    candidateState: CandidatePolicyState;
  };
  environments: EnvironmentDefinition[];
  selectedEnvironmentId: string;
  activeEnvironment: EnvironmentDefinition;
  setSelectedEnvironmentId: (envId: string) => void;
  saveEnvironmentProfile: (env: EnvironmentDefinition) => EnvironmentDefinition[];
  deleteEnvironmentProfile: (envId: string) => EnvironmentDefinition[];
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

function setIfChanged<T>(
  setter: React.Dispatch<React.SetStateAction<T>>,
  nextValue: T
): void {
  setter((prev) => {
    try {
      if (JSON.stringify(prev) === JSON.stringify(nextValue)) {
        return prev;
      }
    } catch {
      // Fallback to nextValue if serialization fails
    }
    return nextValue;
  });
}

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
  const [selectedPolicyIdState, setSelectedPolicyIdState] = useState<string>(() =>
    loadSelectedPolicyId()
  );
  const [environments, setEnvironments] = useState<EnvironmentDefinition[]>(() =>
    loadEnvironments()
  );
  const [selectedEnvironmentIdState, setSelectedEnvironmentIdState] =
    useState<string>(() => loadSelectedEnvironmentId());
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

  // Sync whenever localStorage or same-tab/cross-tab pub/sub fires.
  // Use setIfChanged so recording an experiment does not re-allocate environments, scenarios, or policies.
  const syncFromStorage = useCallback(() => {
    setIfChanged(setStoredExperiments, loadStoredExperiments());
    setIfChanged(setScenarios, loadScenarios());
    setIfChanged(setPolicies, loadPolicies());
    setSelectedPolicyIdState(loadSelectedPolicyId());
    setIfChanged(setEnvironments, loadEnvironments());
    setSelectedEnvironmentIdState(loadSelectedEnvironmentId());
    setIfChanged(setRobots, loadRobots());
    setSelectedRobotIdState(loadSelectedRobotId());
    setIfChanged(setCandidatePolicyState, loadCandidatePolicyState());
    setIfChanged(setBenchmarkHistory, loadBenchmarkHistory());
    setIfChanged(setCrossRobotBenchmarks, loadCrossRobotBenchmarkHistory());
    setIfChanged(setFailureDrivenBatches, loadFailureDrivenBatches());
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

  const setSelectedPolicyId = useCallback((policyId: string) => {
    setSelectedPolicyIdState(policyId);
    saveSelectedPolicyId(policyId);
    setCandidatePolicyState((prev) => ({
      ...prev,
      isActive: policyId === 'pol-candidate-rl',
      activatedAt:
        policyId === 'pol-candidate-rl'
          ? prev.activatedAt || new Date().toISOString()
          : prev.activatedAt,
    }));
    setPolicies((prev) =>
      prev.map((p) => ({
        ...p,
        isActive: p.id === policyId,
      }))
    );
  }, []);

  const updateCandidatePolicyState = useCallback(
    (nextState: CandidatePolicyState) => {
      const history = Array.isArray(nextState.trainingHistory)
        ? nextState.trainingHistory
        : [];
      const episodesCompleted =
        history.length > 0 ? history.length : nextState.totalEpisodesTrained;
      const successCount = history.filter((ep) => ep.status === 'Success').length;
      const failureCount = history.length - successCount;
      const successRatePct =
        history.length > 0
          ? Number(((successCount / history.length) * 100).toFixed(1))
          : 0;
      const meanReward =
        history.length > 0
          ? Number(
              (
                history.reduce((acc, ep) => acc + ep.totalReward, 0) /
                history.length
              ).toFixed(1)
            )
          : 0;
      const safetyInterventions = history.reduce(
        (acc, ep) => acc + (ep.safetyInterventionCount ?? 0),
        0
      );
      const qTableCount = nextState.qTable
        ? Object.keys(nextState.qTable).length
        : 0;

      const enriched: CandidatePolicyState = {
        ...nextState,
        createdAt:
          nextState.createdAt ??
          nextState.lastTrainedAt ??
          new Date().toISOString(),
        isActive: loadSelectedPolicyId() === 'pol-candidate-rl',
        trainingMetricsSummary: {
          episodesCompleted,
          successCount,
          failureCount,
          successRatePct,
          meanReward,
          safetyInterventions,
          learnedStatesCount: qTableCount,
        },
      };

      setCandidatePolicyState(enriched);
      saveCandidatePolicyState(enriched);
      // Also sync the version string and metadata onto the 'pol-candidate-rl' policy card
      setPolicies((prev) => {
        const next = prev.map((p) =>
          p.id === 'pol-candidate-rl'
            ? {
                ...p,
                name: enriched.name || p.name,
                version: enriched.version,
                createdAt: enriched.createdAt ?? p.createdAt,
                activatedAt: enriched.activatedAt ?? p.activatedAt,
                isActive: enriched.isActive,
                trainedRobotId: enriched.trainedRobotId,
                trainedRobotName: enriched.trainedRobotName,
                trainedEnvironmentId: enriched.trainedEnvironmentId,
                trainedEnvironmentName: enriched.trainedEnvironmentName,
                totalEpisodesTrained: enriched.totalEpisodesTrained,
                meanEpisodeReward: meanReward,
              }
            : p
        );
        savePolicies(next);
        return next;
      });
    },
    []
  );

  const saveAndActivateCandidatePolicy = useCallback(
    (candidateOverride?: CandidatePolicyState) => {
      const result = validateAndSaveAndActivateCandidatePolicy(
        candidateOverride ?? candidatePolicyState
      );
      if (result.success) {
        setCandidatePolicyState(result.candidateState);
        setPolicies(result.policies);
        setSelectedPolicyIdState(result.activePolicyId);
      }
      return {
        success: result.success,
        error: result.error,
        candidateState: result.candidateState,
      };
    },
    [candidatePolicyState]
  );

  const resetCandidatePolicy = useCallback((): CandidatePolicyState => {
    const fresh = resetCandidatePolicyState();
    setCandidatePolicyState(fresh);
    setPolicies((prev) => {
      const next = prev.map((p) =>
        p.id === 'pol-candidate-rl'
          ? {
              ...p,
              version: fresh.version,
              isActive: false,
              activatedAt: undefined,
              totalEpisodesTrained: 0,
              meanEpisodeReward: undefined,
            }
          : p
      );
      savePolicies(next);
      return next;
    });
    if (loadSelectedPolicyId() === 'pol-candidate-rl') {
      setSelectedPolicyIdState('pol-hybrid-safe');
      saveSelectedPolicyId('pol-hybrid-safe');
    }
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

  const setSelectedEnvironmentId = useCallback((envId: string) => {
    setSelectedEnvironmentIdState(envId);
    saveSelectedEnvironmentId(envId);
  }, []);

  const saveEnvironmentProfile = useCallback(
    (env: EnvironmentDefinition): EnvironmentDefinition[] => {
      const updated = saveCustomEnvironment(env);
      setEnvironments(updated);
      return updated;
    },
    []
  );

  const deleteEnvironmentProfile = useCallback(
    (envId: string): EnvironmentDefinition[] => {
      const updated = deleteCustomEnvironment(envId);
      setEnvironments(updated);
      setSelectedEnvironmentIdState(loadSelectedEnvironmentId());
      return updated;
    },
    []
  );

  const activeEnvironment = useMemo(
    () =>
      environments.find((e) => e.id === selectedEnvironmentIdState) ??
      environments[0],
    [environments, selectedEnvironmentIdState]
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
      selectedPolicyId: selectedPolicyIdState,
      setSelectedPolicyId,
      saveAndActivateCandidatePolicy,
      environments,
      selectedEnvironmentId: selectedEnvironmentIdState,
      activeEnvironment,
      setSelectedEnvironmentId,
      saveEnvironmentProfile,
      deleteEnvironmentProfile,
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
      selectedPolicyIdState,
      setSelectedPolicyId,
      saveAndActivateCandidatePolicy,
      environments,
      selectedEnvironmentIdState,
      activeEnvironment,
      setSelectedEnvironmentId,
      saveEnvironmentProfile,
      deleteEnvironmentProfile,
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

