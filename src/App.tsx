import { useCallback, useMemo, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopNavBar } from './components/layout/TopNavBar';
import {
  DELIVERY_LOCATIONS,
  formatRobotHardwareSummary,
} from './data/campusConfig';
import { ExperimentHistoryPage } from './pages/ExperimentHistoryPage';
import { FailureAnalysisPage } from './pages/FailureAnalysisPage';
import { OverviewPage } from './pages/OverviewPage';
import { PerformanceAnalyticsPage } from './pages/PerformanceAnalyticsPage';
import { PolicyBenchmarkingPage } from './pages/PolicyBenchmarkingPage';
import { RobotConfigPage } from './pages/RobotConfigPage';
import { RobotPoliciesPage } from './pages/RobotPoliciesPage';
import { ScenarioGeneratorPage } from './pages/ScenarioGeneratorPage';
import { SimulationLabPage } from './pages/SimulationLabPage';
import {
  ExperimentStoreProvider,
  useExperimentStore,
} from './storage/ExperimentContext';
import { SimulationCompletionPayload } from './three/CampusSceneManager';
import {
  LiveTelemetry,
  NavigationPolicyConfig,
  NavPageId,
  ScenarioConfig,
  SimulationLogEntry,
} from './types/simulation';

function RoboSimWorkspace() {
  const [activePage, setActivePage] = useState<NavPageId>('overview');

  // Single Source of Truth from Centralized Experiment Store
  const {
    experiments,
    failures,
    overviewMetrics,
    policyAnalytics,
    scenarios,
    policies,
    robots,
    selectedRobotId,
    activeRobot,
    setSelectedRobotId,
    demoPreviewEnabled,
    setDemoPreviewEnabled,
    recordExperiment,
    clearHistory,
    addCustomScenario,
    updatePolicies,
    candidatePolicyState,
    benchmarkHistory,
    crossRobotBenchmarks,
  } = useExperimentStore();

  // Active simulation selections
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    'scen-construction-detour'
  );
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('pol-hybrid-safe');

  // Live telemetry state
  const [telemetry, setTelemetry] = useState<LiveTelemetry>({
    simulationState: 'idle',
    robotId: activeRobot.id,
    robotName: activeRobot.name,
    robotStatus: 'Standby',
    originName: 'Robotics Lab North Dock',
    currentDestination: 'Hostel A Courtyard Locker (HST-N1)',
    batteryLevelPct: 98.0,
    currentSpeedMps: 0.0,
    navigationStatus: 'Ready at ENG-D1',
    distanceRemainingM: 76.4,
    distanceTraveledM: 0.0,
    elapsedTimeSec: 0.0,
    collisionsCount: 0,
    replanCount: 0,
    position: { x: -15, z: -20, headingRad: 0 },
    activeWaypointIndex: 0,
    totalWaypoints: 18,
    selectedBuildingName: null,
  });

  const [logs, setLogs] = useState<SimulationLogEntry[]>([]);

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0],
    [scenarios, selectedScenarioId]
  );

  const activePolicy = useMemo(
    () => policies.find((p) => p.id === selectedPolicyId) ?? policies[0],
    [policies, selectedPolicyId]
  );

  const handleLogEvent = useCallback((entry: SimulationLogEntry) => {
    setLogs((prev) => [entry, ...prev.slice(0, 49)]);
  }, []);

  const handleSimulationComplete = useCallback(
    (payload: SimulationCompletionPayload) => {
      const originLoc =
        DELIVERY_LOCATIONS.find((l) => l.id === activeScenario.originId) ??
        DELIVERY_LOCATIONS[1];
      const destLoc =
        DELIVERY_LOCATIONS.find((l) => l.id === activeScenario.destinationId) ??
        DELIVERY_LOCATIONS[5];

      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

      recordExperiment({
        timestamp: nowStr,
        scenarioId: payload.scenarioId || activeScenario.id,
        scenarioName: payload.scenarioName || activeScenario.name,
        scenarioGenerationSource: activeScenario.generationSource ?? 'Preset',
        scenarioSeed: payload.scenarioSeed ?? activeScenario.randomSeed ?? 101,
        robotId: payload.robotId || activeRobot.id,
        robotName: payload.robotName || activeRobot.name,
        robotHardwareSummary:
          payload.robotHardwareSummary ?? formatRobotHardwareSummary(activeRobot),
        payloadKg: payload.payloadKg,
        policyId: payload.policyId || activePolicy.id,
        policyName: payload.policyName || activePolicy.name,
        policyVersion: payload.policyVersion ?? activePolicy.version,
        isCandidatePolicy:
          payload.isCandidatePolicy ?? Boolean(activePolicy.isCandidatePolicy),
        runType: 'Interactive',
        originName: payload.originName || originLoc.name,
        destinationName: payload.destinationName || destLoc.name,
        status: payload.status,
        durationSec: payload.durationSec,
        distanceMeters: payload.distanceMeters,
        collisions: payload.collisions,
        replanCount: payload.replanCount,
        pedestrianDetectionsCount: payload.pedestrianDetectionsCount,
        predictedEncountersCount: payload.predictedEncountersCount,
        avoidedEncountersCount: payload.avoidedEncountersCount,
        unnecessaryStopsCount: payload.unnecessaryStopsCount,
        predictionAccuracyPct: payload.predictionAccuracyPct,
        pedestrianReplanCount: payload.pedestrianReplanCount,
        speedReductionEventsCount: payload.speedReductionEventsCount,
        reducedSpeedTimeSec: payload.reducedSpeedTimeSec,
        pedestrianWaitingTimeSec: payload.pedestrianWaitingTimeSec,
        speedBasedAvoidanceCount: payload.speedBasedAvoidanceCount,
        localBypassCount: payload.localBypassCount,
        globalReplanCount: payload.globalReplanCount,
        pedestrianDistribution: payload.pedestrianDistribution,
        predictionHorizonSec: payload.predictionHorizonSec,
        totalWaitingTimeSec: payload.totalWaitingTimeSec,
        elevatorWaitTimeSec: payload.elevatorWaitTimeSec,
        elevatorUsed: payload.elevatorUsed,
        elevatorStateEncountered: payload.elevatorStateEncountered,
        elevatorFaultMode: payload.elevatorFaultMode,
        elevatorReroutedToBackup: payload.elevatorReroutedToBackup,
        elevatorAssistanceRequested: payload.elevatorAssistanceRequested,
        elevatorEventsLog: payload.elevatorEventsLog,
        batteryConsumedPct: payload.batteryConsumedPct,
        failureReason: payload.failureReason,
        failureType: payload.failureType,
        obstacleType: payload.obstacleType,
        failureCoordinates: payload.failureCoordinates,
        decisionHistory: payload.decisionHistory,
        robotStateBeforeCompletion: payload.robotStateBeforeCompletion,
        environmentalConditionsSummary: payload.environmentalConditionsSummary,
        episodeReward: payload.episodeReward,
        rootCause:
          payload.rootCause ??
          payload.failureReason ??
          (payload.status === 'Failed'
            ? 'Robot encountered an impassable obstacle or collision boundary along the active corridor.'
            : undefined),
        mitigationSuggested:
          payload.mitigationSuggested ??
          (payload.status === 'Failed'
            ? payload.failureType === 'No Valid Route Available'
              ? 'Re-open at least one campus corridor in Scenario Generator or select an accessible destination dock.'
              : payload.failureType === 'Elevator Mechanical Failure'
              ? 'Dispatch facilities maintenance to reset trapped elevator cab and enable pre-boarding elevator telemetry diagnostics.'
              : payload.failureType === 'Elevator Unavailable'
              ? 'Restore backup elevator service or assign delivery to a ground-floor parcel locker.'
              : 'Activate Hybrid A* Safety-First v2.1 or Candidate Q-Learning Policy to increase safety clearance and replanning horizon.'
            : undefined),
      });
    },
    [
      activePolicy.id,
      activePolicy.isCandidatePolicy,
      activePolicy.name,
      activePolicy.version,
      activeRobot.id,
      activeRobot.name,
      activeScenario.destinationId,
      activeScenario.generationSource,
      activeScenario.id,
      activeScenario.name,
      activeScenario.originId,
      activeScenario.randomSeed,
      recordExperiment,
    ]
  );

  const handleLaunchScenarioInLab = useCallback((scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    setActivePage('simulation-lab');
  }, []);

  const handleCreateCustomScenario = useCallback(
    (newScenario: ScenarioConfig) => {
      addCustomScenario(newScenario);
      setSelectedScenarioId(newScenario.id);
    },
    [addCustomScenario]
  );

  const handleUpdatePolicies = useCallback(
    (updated: NavigationPolicyConfig[]) => {
      updatePolicies(updated);
    },
    [updatePolicies]
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#070b14] text-slate-100">
      {/* Persistent Left Sidebar */}
      <Sidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        totalExperimentsCount={experiments.length}
        failedCount={failures.length}
        isPolicyTrained={candidatePolicyState.isTrained}
        benchmarksCount={benchmarkHistory.length + crossRobotBenchmarks.length}
        robotsCount={robots.length}
      />

      {/* Right Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <TopNavBar
          activePage={activePage}
          simulationState={telemetry.simulationState}
          activeRobotName={activeRobot.name}
          activeScenarioName={activeScenario.name}
          onQuickOpenSimLab={() => setActivePage('simulation-lab')}
        />

        <main className="flex-1 min-h-0 overflow-hidden">
          {activePage === 'overview' && (
            <OverviewPage
              experiments={experiments}
              failures={failures}
              overviewMetrics={overviewMetrics}
              demoPreviewEnabled={demoPreviewEnabled}
              onToggleDemoPreview={setDemoPreviewEnabled}
              telemetry={telemetry}
              policies={policies}
              scenarios={scenarios}
              onNavigate={setActivePage}
              onLaunchScenarioInLab={handleLaunchScenarioInLab}
            />
          )}

          {activePage === 'simulation-lab' && (
            <SimulationLabPage
              scenarios={scenarios}
              policies={policies}
              selectedScenarioId={selectedScenarioId}
              selectedRobotId={selectedRobotId}
              selectedPolicyId={selectedPolicyId}
              onChangeScenario={setSelectedScenarioId}
              onChangeRobot={setSelectedRobotId}
              onChangePolicy={setSelectedPolicyId}
              onNavigate={setActivePage}
              telemetry={telemetry}
              onTelemetryUpdate={setTelemetry}
              logs={logs}
              onLogEvent={handleLogEvent}
              onSimulationComplete={handleSimulationComplete}
            />
          )}

          {activePage === 'robot-config' && (
            <div className="h-full overflow-y-auto p-6">
              <RobotConfigPage onNavigate={setActivePage} />
            </div>
          )}

          {activePage === 'scenario-generator' && (
            <ScenarioGeneratorPage
              scenarios={scenarios}
              activeScenarioId={selectedScenarioId}
              onCreateScenario={handleCreateCustomScenario}
              onLaunchScenarioInLab={handleLaunchScenarioInLab}
            />
          )}

          {activePage === 'robot-policies' && (
            <RobotPoliciesPage
              policies={policies}
              selectedPolicyId={selectedPolicyId}
              onSelectPolicy={setSelectedPolicyId}
              onUpdatePolicies={handleUpdatePolicies}
              onOpenSimLab={() => setActivePage('simulation-lab')}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'policy-benchmarking' && (
            <PolicyBenchmarkingPage
              onNavigate={setActivePage}
              onLaunchScenarioInLab={handleLaunchScenarioInLab}
            />
          )}

          {activePage === 'failure-analysis' && (
            <FailureAnalysisPage
              failures={failures}
              demoPreviewEnabled={demoPreviewEnabled}
              onToggleDemoPreview={setDemoPreviewEnabled}
              onApplyRecommendedMitigation={(policyId) => {
                setSelectedPolicyId(policyId);
                setActivePage('simulation-lab');
              }}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'performance-analytics' && (
            <PerformanceAnalyticsPage
              experiments={experiments}
              policyAnalytics={policyAnalytics}
              demoPreviewEnabled={demoPreviewEnabled}
              onToggleDemoPreview={setDemoPreviewEnabled}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'experiment-history' && (
            <ExperimentHistoryPage
              experiments={experiments}
              onClearHistory={clearHistory}
              onNavigate={setActivePage}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ExperimentStoreProvider>
      <RoboSimWorkspace />
    </ExperimentStoreProvider>
  );
}
