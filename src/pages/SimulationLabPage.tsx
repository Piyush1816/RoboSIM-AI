import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  BoxSelect,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Filter,
  Gauge,
  Grid,
  Layers,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Settings2,
  Sliders,
} from 'lucide-react';
import {
  DELIVERY_LOCATIONS,
  ELEVATOR_VERIFICATION_CASES,
} from '../data/campusConfig';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  CampusSceneManager,
  SimulationCompletionPayload,
} from '../three/CampusSceneManager';
import {
  CameraPresetId,
  ElevatorFaultMode,
  LiveTelemetry,
  NavigationPolicyConfig,
  NavPageId,
  PedestrianDistributionConfig,
  PredictionHorizonSec,
  ScenarioConfig,
  SimulationLogEntry,
} from '../types/simulation';

interface SimulationLabPageProps {
  scenarios: ScenarioConfig[];
  policies: NavigationPolicyConfig[];
  selectedScenarioId: string;
  selectedRobotId: string;
  selectedPolicyId: string;
  onChangeScenario: (id: string) => void;
  onChangeRobot: (id: string) => void;
  onChangePolicy: (id: string) => void;
  onNavigate?: (page: NavPageId) => void;
  telemetry: LiveTelemetry;
  onTelemetryUpdate: (telemetry: LiveTelemetry) => void;
  logs: SimulationLogEntry[];
  onLogEvent: (entry: SimulationLogEntry) => void;
  onSimulationComplete: (payload: SimulationCompletionPayload) => void;
}

type ScenarioFilterTab =
  | 'all'
  | 'normal'
  | 'training'
  | 'testing'
  | 'failure-driven';

type DiagnosticStatus = 'Not Tested' | 'Running' | 'Passed' | 'Failed';

export const SimulationLabPage: React.FC<SimulationLabPageProps> = ({
  scenarios,
  policies,
  selectedScenarioId,
  selectedRobotId,
  selectedPolicyId,
  onChangeScenario,
  onChangeRobot,
  onChangePolicy,
  onNavigate,
  telemetry,
  onTelemetryUpdate,
  logs,
  onLogEvent,
  onSimulationComplete,
}) => {
  const { robots, activeRobot } = useExperimentStore();
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneManagerRef = useRef<CampusSceneManager | null>(null);

  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('isometric');
  const [destinationOverrideId, setDestinationOverrideId] = useState<string>('');
  const [originOverrideId, setOriginOverrideId] = useState<string>('');
  const [activeElevatorCaseId, setActiveElevatorCaseId] = useState<string>('');
  const [diagnosticStatuses, setDiagnosticStatuses] = useState<
    Record<string, { status: DiagnosticStatus; summary?: string }>
  >({});

  // Scenario filter in Simulation Setup so failed/synthetic cases never clutter normal operation
  const [scenarioFilter, setScenarioFilter] =
    useState<ScenarioFilterTab>('all');

  // Collapsible sections (Closed by default so Simulation Lab is immediately clean & readable)
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [showElevatorDiagnostics, setShowElevatorDiagnostics] =
    useState<boolean>(false);
  const [showAdvancedSettings, setShowAdvancedSettings] =
    useState<boolean>(false);
  const [showAdvancedTelemetry, setShowAdvancedTelemetry] =
    useState<boolean>(false);

  // Visual layer toggles
  const [showNavGrid, setShowNavGrid] = useState<boolean>(false);
  const [showPathLine, setShowPathLine] = useState<boolean>(true);
  const [showSensorCone, setShowSensorCone] = useState<boolean>(true);
  const [showCollisionDebug, setShowCollisionDebug] = useState<boolean>(false);

  const filteredScenarios = useMemo(() => {
    const filtered = scenarios.filter((s) => {
      if (scenarioFilter === 'normal') {
        return !s.isCustom && (s.elevatorFaultMode ?? 'none') === 'none';
      }
      if (scenarioFilter === 'training') {
        return (s.datasetSplit ?? 'train') === 'train';
      }
      if (scenarioFilter === 'testing') {
        return s.datasetSplit === 'test';
      }
      if (scenarioFilter === 'failure-driven') {
        return s.generationSource === 'Failure-Driven';
      }
      return true;
    });
    return filtered.length > 0 ? filtered : scenarios;
  }, [scenarios, scenarioFilter]);

  const activeScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];
  const activePolicy =
    policies.find((p) => p.id === selectedPolicyId) ?? policies[0];

  const [showBuildingCutaway, setShowBuildingCutaway] = useState<boolean>(
    Boolean(activeScenario.requiresElevator)
  );

  const [predictionHorizon, setPredictionHorizon] =
    useState<PredictionHorizonSec>(activeScenario.predictionHorizonSec ?? 2);
  const [pedDist, setPedDist] = useState<PedestrianDistributionConfig>(
    activeScenario.pedestrianDistribution ?? {
      commuterCount: 2,
      randomCount: 1,
      crossingCount: 1,
      groupCount: 0,
    }
  );
  const [elevatorFaultMode, setElevatorFaultMode] = useState<ElevatorFaultMode>(
    activeScenario.elevatorFaultMode ?? 'none'
  );

  // Keep track of active diagnostic test ID in a ref so completion handler can score it and restore normal mode
  const activeDiagnosticCaseRef = useRef<string>('');
  activeDiagnosticCaseRef.current = activeElevatorCaseId;

  const evaluateDiagnosticOutcome = (
    caseId: string,
    payload: SimulationCompletionPayload
  ): { passed: boolean; summary: string } => {
    switch (caseId) {
      case 'case-1-g-to-1f':
      case 'case-2-1f-to-2f':
      case 'case-3-2f-to-g':
        return {
          passed: payload.status === 'Success' && Boolean(payload.elevatorUsed),
          summary:
            payload.status === 'Success'
              ? `Completed in ${payload.durationSec}s via elevator`
              : payload.failureReason || 'Did not complete floor transition',
        };
      case 'case-4-same-floor':
      case 'case-5-outdoor':
        return {
          passed: payload.status === 'Success' && !payload.elevatorUsed,
          summary:
            payload.status === 'Success' && !payload.elevatorUsed
              ? `Direct route completed in ${payload.durationSec}s (No elevator used)`
              : 'Unexpected route or failure',
        };
      case 'case-6-primary-out-backup':
        return {
          passed:
            payload.status === 'Success' &&
            Boolean(payload.elevatorReroutedToBackup),
          summary:
            payload.status === 'Success' && payload.elevatorReroutedToBackup
              ? `Rerouted to Backup Lift B & delivered in ${payload.durationSec}s`
              : payload.failureReason || 'Backup reroute not completed',
        };
      case 'case-7-both-unavailable':
        return {
          passed:
            payload.status === 'Failed' &&
            payload.failureType === 'Elevator Unavailable' &&
            payload.collisions === 0,
          summary:
            payload.failureType === 'Elevator Unavailable'
              ? 'Safe halt verified: Both elevators detected unavailable (0 collisions)'
              : 'Unexpected outcome',
        };
      case 'case-8-stuck-mid-shaft':
        return {
          passed:
            payload.status === 'Failed' &&
            payload.failureType === 'Elevator Mechanical Failure' &&
            payload.elevatorStateEncountered === 'Stuck',
          summary:
            payload.failureType === 'Elevator Mechanical Failure'
              ? 'Safe mid-shaft halt verified: Doors locked closed & assistance requested'
              : 'Unexpected outcome',
        };
      default:
        return {
          passed: payload.status === 'Success',
          summary: `${payload.status} (${payload.durationSec}s)`,
        };
    }
  };

  // Store latest callbacks in refs so WebGL scene never tears down on React state updates
  const callbacksRef = useRef({
    onTelemetryUpdate,
    onLogEvent,
    onSimulationComplete,
  });
  callbacksRef.current = {
    onTelemetryUpdate,
    onLogEvent,
    onSimulationComplete: (payload: SimulationCompletionPayload) => {
      const diagId = activeDiagnosticCaseRef.current;
      if (diagId) {
        const res = evaluateDiagnosticOutcome(diagId, payload);
        setDiagnosticStatuses((prev) => ({
          ...prev,
          [diagId]: {
            status: res.passed ? 'Passed' : 'Failed',
            summary: res.summary,
          },
        }));
      }
      onSimulationComplete(payload);
    },
  };

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const manager = new CampusSceneManager(
      mountEl,
      activeScenario,
      activePolicy,
      selectedRobotId,
      {
        onTelemetryUpdate: (t) => callbacksRef.current.onTelemetryUpdate(t),
        onLogEvent: (l) => callbacksRef.current.onLogEvent(l),
        onSimulationComplete: (p) =>
          callbacksRef.current.onSimulationComplete(p),
      }
    );
    sceneManagerRef.current = manager;

    const handleResize = () => manager.resize();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        manager.resize();
      });
      resizeObserver.observe(mountEl);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key.toLowerCase() === 'h') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      if (resizeObserver) resizeObserver.disconnect();
      manager.dispose();
      sceneManagerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset any manual overrides and sync scenario defaults whenever the active scenario changes
  useEffect(() => {
    setDestinationOverrideId('');
    setOriginOverrideId('');
    setActiveElevatorCaseId('');
    setPredictionHorizon(activeScenario.predictionHorizonSec ?? 2);
    setPedDist(
      activeScenario.pedestrianDistribution ?? {
        commuterCount: Math.max(
          1,
          Math.round(activeScenario.dynamicObstacleCount * 0.4)
        ),
        randomCount: Math.max(
          0,
          Math.round(activeScenario.dynamicObstacleCount * 0.25)
        ),
        crossingCount: Math.max(
          0,
          Math.round(activeScenario.dynamicObstacleCount * 0.2)
        ),
        groupCount: Math.max(
          0,
          activeScenario.dynamicObstacleCount -
            Math.max(1, Math.round(activeScenario.dynamicObstacleCount * 0.4)) -
            Math.max(0, Math.round(activeScenario.dynamicObstacleCount * 0.25)) -
            Math.max(0, Math.round(activeScenario.dynamicObstacleCount * 0.2))
        ),
      }
    );
    setElevatorFaultMode(activeScenario.elevatorFaultMode ?? 'none');
    const needsCutaway = Boolean(
      activeScenario.requiresElevator ||
        (activeScenario.originFloor ?? 0) !==
          (activeScenario.destinationFloor ?? 0)
    );
    setShowBuildingCutaway(needsCutaway);
    sceneManagerRef.current?.setVisualLayers({
      showBuildingCutaway: needsCutaway,
    });
  }, [selectedScenarioId, activeScenario]);

  // Sync configuration changes without re-creating WebGLRenderer
  useEffect(() => {
    if (!sceneManagerRef.current) return;
    const effectiveScenario: ScenarioConfig = originOverrideId
      ? {
          ...activeScenario,
          originId: originOverrideId,
          elevatorFaultMode,
        }
      : {
          ...activeScenario,
          elevatorFaultMode,
        };
    sceneManagerRef.current.setConfiguration(
      effectiveScenario,
      activePolicy,
      selectedRobotId,
      destinationOverrideId || null
    );
  }, [
    activeScenario,
    activePolicy,
    selectedRobotId,
    destinationOverrideId,
    originOverrideId,
    elevatorFaultMode,
  ]);

  const handleReturnToNormalOperation = () => {
    setActiveElevatorCaseId('');
    setOriginOverrideId('');
    setDestinationOverrideId('');
    setElevatorFaultMode(activeScenario.elevatorFaultMode ?? 'none');
    const needsCutaway = Boolean(activeScenario.requiresElevator);
    setShowBuildingCutaway(needsCutaway);
    sceneManagerRef.current?.setVisualLayers({
      showBuildingCutaway: needsCutaway,
    });
    handleSelectCameraPreset(
      needsCutaway ? 'elevator-interior' : 'isometric'
    );
  };

  const handleRunNormalElevatorTrip = () => {
    setActiveElevatorCaseId('');
    setOriginOverrideId('');
    setDestinationOverrideId('');
    setElevatorFaultMode('none');
    setSimSpeed(1.0);
    sceneManagerRef.current?.setSimulationSpeed(1.0);
    setShowBuildingCutaway(true);
    sceneManagerRef.current?.setVisualLayers({ showBuildingCutaway: true });
    handleSelectCameraPreset('elevator-interior');
    if (selectedScenarioId !== 'scen-elevator-normal') {
      onChangeScenario('scen-elevator-normal');
    }
    window.setTimeout(() => {
      sceneManagerRef.current?.resetSimulationState(false);
      sceneManagerRef.current?.startSimulation();
    }, 60);
  };

  const handleRunElevatorVerificationCase = (
    testCase: (typeof ELEVATOR_VERIFICATION_CASES)[number]
  ) => {
    setActiveElevatorCaseId(testCase.id);
    setOriginOverrideId(testCase.originId);
    setDestinationOverrideId(testCase.destinationId);
    setElevatorFaultMode(testCase.elevatorFaultMode);
    setDiagnosticStatuses((prev) => ({
      ...prev,
      [testCase.id]: {
        status: 'Running',
        summary: 'Executing verification case...',
      },
    }));

    if (testCase.requiresElevator || testCase.originFloor > 0) {
      setShowBuildingCutaway(true);
      sceneManagerRef.current?.setVisualLayers({ showBuildingCutaway: true });
      handleSelectCameraPreset('elevator-interior');
    } else {
      setShowBuildingCutaway(false);
      sceneManagerRef.current?.setVisualLayers({ showBuildingCutaway: false });
      handleSelectCameraPreset('isometric');
    }

    // Start simulation automatically after configuration syncs
    window.setTimeout(() => {
      sceneManagerRef.current?.resetSimulationState(false);
      sceneManagerRef.current?.startSimulation();
    }, 60);
  };

  const handleStart = () => {
    sceneManagerRef.current?.startSimulation();
  };

  const handlePause = () => {
    sceneManagerRef.current?.pauseSimulation();
  };

  const handleReset = () => {
    if (activeElevatorCaseId) {
      handleReturnToNormalOperation();
    }
    sceneManagerRef.current?.resetSimulationState(true);
  };

  const handleSpeedChange = (speed: number) => {
    setSimSpeed(speed);
    sceneManagerRef.current?.setSimulationSpeed(speed);
  };

  const handleSelectCameraPreset = (preset: CameraPresetId) => {
    setCameraPreset(preset);
    sceneManagerRef.current?.setCameraPreset(preset);
  };

  const handleHorizonChange = (horizon: PredictionHorizonSec) => {
    setPredictionHorizon(horizon);
    sceneManagerRef.current?.setPredictionHorizon(horizon);
  };

  const handlePedDistChange = (
    key: keyof PedestrianDistributionConfig,
    val: number
  ) => {
    const next: PedestrianDistributionConfig = {
      ...pedDist,
      [key]: Math.max(0, Math.min(8, val)),
    };
    setPedDist(next);
    sceneManagerRef.current?.setPedestrianDistribution(next);
  };

  const handleElevatorFaultChange = (mode: ElevatorFaultMode) => {
    setElevatorFaultMode(mode);
    sceneManagerRef.current?.setElevatorFaultMode(mode);
  };

  const handleToggleLayer = (
    layer: 'grid' | 'path' | 'sensor' | 'debug' | 'cutaway'
  ) => {
    if (layer === 'grid') {
      const next = !showNavGrid;
      setShowNavGrid(next);
      sceneManagerRef.current?.setVisualLayers({ showNavGrid: next });
    } else if (layer === 'path') {
      const next = !showPathLine;
      setShowPathLine(next);
      sceneManagerRef.current?.setVisualLayers({ showPathLine: next });
    } else if (layer === 'sensor') {
      const next = !showSensorCone;
      setShowSensorCone(next);
      sceneManagerRef.current?.setVisualLayers({ showSensorCone: next });
    } else if (layer === 'debug') {
      const next = !showCollisionDebug;
      setShowCollisionDebug(next);
      sceneManagerRef.current?.setVisualLayers({ showCollisionDebug: next });
    } else if (layer === 'cutaway') {
      const next = !showBuildingCutaway;
      setShowBuildingCutaway(next);
      sceneManagerRef.current?.setVisualLayers({ showBuildingCutaway: next });
    }
  };

  const statusColor =
    telemetry.simulationState === 'running'
      ? 'text-cyan-400'
      : telemetry.simulationState === 'completed'
      ? 'text-emerald-400'
      : telemetry.simulationState === 'failed'
      ? 'text-rose-400'
      : telemetry.simulationState === 'paused'
      ? 'text-amber-400'
      : 'text-slate-300';

  const totalDistanceEstimate =
    telemetry.distanceTraveledM + telemetry.distanceRemainingM;
  const deliveryProgressPct =
    telemetry.simulationState === 'completed'
      ? 100
      : totalDistanceEstimate > 0.1
      ? Math.min(
          99,
          Math.max(
            0,
            Math.round(
              (telemetry.distanceTraveledM / totalDistanceEstimate) * 100
            )
          )
        )
      : 0;

  const isElevatorRelevant = Boolean(
    telemetry.requiresElevator ||
      (telemetry.originFloor ?? 0) !== (telemetry.destinationFloor ?? 0) ||
      activeElevatorCaseId
  );

  const floorDisplayLabel =
    telemetry.currentFloorLabel ??
    (telemetry.currentFloor === 2
      ? 'Second Floor (2F · 7.2m)'
      : telemetry.currentFloor === 1
      ? 'First Floor (1F · 3.6m)'
      : 'Ground Floor (G · 0.0m)');

  return (
    <div className="h-full w-full flex flex-col lg:flex-row overflow-hidden bg-[#070b14]">
      {/* =====================================================================
          AREA B: 3D SIMULATION VIEW (Main Focus) + OVERLAYS + CONTROLS DOCK
         ===================================================================== */}
      <div className="relative flex-1 min-w-0 h-full min-h-[320px] overflow-hidden select-none">
        {/* Dedicated isolated WebGL Mount Container */}
        <div ref={canvasMountRef} className="w-full h-full" />

        {/* Top Task Banner & Camera Controls Overlay */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex flex-col gap-2 pointer-events-none z-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Clear Current Task, Route & Next Waypoint Summary */}
            <div className="bg-[#0a0f1d]/95 border border-slate-800 rounded-lg px-3 py-2 pointer-events-auto flex flex-wrap items-center gap-2.5 text-xs max-w-full shadow-lg">
              <span className="font-display font-semibold text-slate-100 flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Task:</span>
              </span>
              <span className="text-slate-300 font-medium truncate">
                {telemetry.originName} ({telemetry.originFloor ?? 0}F)
              </span>
              <span className="text-cyan-400 font-bold">→</span>
              <span className="text-cyan-300 font-semibold truncate">
                {telemetry.currentDestination} ({telemetry.destinationFloor ?? 0}F)
              </span>
              <span className="text-slate-700 hidden sm:inline">|</span>
              <span className="font-mono text-[11px] text-amber-300 tabular-nums">
                Next Waypoint: {telemetry.activeWaypointIndex}/
                {Math.max(1, telemetry.totalWaypoints - 1)}
              </span>
              {isElevatorRelevant && (
                <>
                  <span className="text-slate-700 hidden md:inline">|</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 font-mono text-[11px] text-cyan-300">
                    Lift: {telemetry.activeElevatorMachineState ?? telemetry.elevatorState ?? 'IDLE'}
                  </span>
                </>
              )}
            </div>

            {/* Interactive Camera View Preset Controls */}
            <div className="bg-[#0a0f1d]/95 border border-slate-800 rounded-lg p-1 pointer-events-auto flex flex-wrap items-center gap-1 max-w-full shadow-lg">
              <span className="px-1.5 text-[11px] text-slate-400 flex items-center gap-1">
                <Camera className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="hidden xl:inline">Camera:</span>
              </span>
              {(
                [
                  { id: 'isometric', label: 'Isometric' },
                  { id: 'follow', label: 'Follow Robot' },
                  { id: 'top-down', label: 'Top-Down' },
                  { id: 'elevator-interior', label: 'Elevator Cutaway' },
                ] as { id: CameraPresetId; label: string }[]
              ).map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => handleSelectCameraPreset(cam.id)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    cameraPreset === cam.id
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alerts / Diagnostic Mode Banner */}
          {(activeElevatorCaseId ||
            telemetry.pathBlockedReason ||
            telemetry.detourActive ||
            telemetry.elevatorAssistanceRequested) && (
            <div className="flex flex-wrap items-center gap-2">
              {activeElevatorCaseId && (
                <div className="bg-cyan-950/95 border border-cyan-500/50 rounded-lg px-3 py-1.5 pointer-events-auto flex items-center gap-2.5 text-xs text-cyan-200 shadow-md">
                  <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>
                    Diagnostic Preset Active:{' '}
                    <strong>
                      {
                        ELEVATOR_VERIFICATION_CASES.find(
                          (c) => c.id === activeElevatorCaseId
                        )?.label
                      }
                    </strong>
                  </span>
                  <button
                    onClick={handleReturnToNormalOperation}
                    className="ml-1 px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-semibold cursor-pointer"
                  >
                    Return to Normal Operation
                  </button>
                </div>
              )}

              {telemetry.elevatorAssistanceRequested && (
                <div className="bg-rose-950/95 border border-rose-500/60 rounded-lg px-3 py-1.5 pointer-events-auto flex items-center gap-2 text-xs text-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>
                    OPERATOR ALERT: Robot awaiting emergency assistance in elevator (
                    {telemetry.elevatorState})
                  </span>
                </div>
              )}

              {telemetry.pathBlockedReason && (
                <div className="bg-rose-950/95 border border-rose-500/50 rounded-lg px-3 py-1.5 pointer-events-auto flex items-center gap-2 text-xs text-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{telemetry.pathBlockedReason}</span>
                </div>
              )}

              {!telemetry.pathBlockedReason && telemetry.detourActive && (
                <div className="bg-emerald-950/95 border border-emerald-500/40 rounded-lg px-3 py-1.5 pointer-events-auto flex items-center gap-2 text-xs text-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>
                    A* Detour Active: Path routed safely around obstacles
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===================================================================
            AREA A (SIMULATION SETUP) & AREA D (SIMULATION CONTROLS) DOCK
           =================================================================== */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-2.5 sm:px-4 pb-2.5 sm:pb-3 pointer-events-none">
          <div className="w-full max-w-[980px] flex flex-col items-center">
            <button
              onClick={() => setDockCollapsed(!dockCollapsed)}
              className="pointer-events-auto bg-[#0a0f1d] border border-slate-700 rounded-t-lg px-3.5 py-1 text-xs font-medium text-slate-200 hover:text-white flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              {dockCollapsed ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Show Simulation Setup & Controls (H)</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Minimize Controls (H)</span>
                </>
              )}
            </button>

            {!dockCollapsed && (
              <div className="pointer-events-auto w-full bg-[#0a0f1d]/95 backdrop-blur-md border border-slate-700/90 rounded-xl p-3 sm:p-4 shadow-2xl max-h-[50vh] overflow-y-auto space-y-3">
                {/* AREA D: Primary Simulation Controls (Start, Pause, Reset) + Secondary Speed */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/90">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleStart}
                      disabled={telemetry.simulationState === 'running'}
                      className={`min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm ${
                        telemetry.simulationState === 'running'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 cursor-not-allowed'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span>
                        {telemetry.simulationState === 'paused'
                          ? 'Resume Simulation'
                          : 'Start Simulation'}
                      </span>
                    </button>

                    <button
                      onClick={handlePause}
                      disabled={telemetry.simulationState !== 'running'}
                      className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        telemetry.simulationState === 'running'
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                          : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                    >
                      <Pause className="w-3.5 h-3.5 shrink-0" />
                      <span>Pause</span>
                    </button>

                    <button
                      onClick={handleReset}
                      className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Reset</span>
                    </button>

                    {/* Quick 1x Normal Multi-Floor Delivery Test Button */}
                    <button
                      onClick={handleRunNormalElevatorTrip}
                      title="Selects normal multi-floor delivery (Ground → 2F Skybridge Suite) at 1x speed and starts simulation"
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Run Normal Multi-Floor Lift (1x)</span>
                    </button>
                  </div>

                  {/* Secondary Controls: Playback Speed + Expandable Diagnostics & Settings */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-lg p-1">
                      <span className="px-1.5 text-[11px] text-slate-400">
                        Speed:
                      </span>
                      {[0.5, 1.0, 2.0, 4.0].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => handleSpeedChange(spd)}
                          className={`min-h-[26px] px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                            simSpeed === spd
                              ? 'bg-slate-700 text-cyan-300 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() =>
                        setShowElevatorDiagnostics((prev) => !prev)
                      }
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showElevatorDiagnostics || activeElevatorCaseId
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Advanced Elevator Diagnostics</span>
                      {showElevatorDiagnostics ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => setShowAdvancedSettings((prev) => !prev)}
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showAdvancedSettings
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5 shrink-0" />
                      <span>Advanced Settings</span>
                      {showAdvancedSettings ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* AREA A: Simulation Setup (Scenario Filter + 4 Clean Selectors) */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Filter className="w-3 h-3 text-cyan-400" />
                      <span className="font-semibold text-slate-300">
                        Simulation Setup
                      </span>
                      <span>— Filter Scenario Library:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { id: 'all', label: 'All Scenarios' },
                          { id: 'normal', label: 'Normal' },
                          { id: 'training', label: 'Training' },
                          { id: 'testing', label: 'Testing' },
                          { id: 'failure-driven', label: 'Failure-Driven' },
                        ] as { id: ScenarioFilterTab; label: string }[]
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setScenarioFilter(tab.id);
                            const nextList = scenarios.filter((s) => {
                              if (tab.id === 'normal')
                                return (
                                  !s.isCustom &&
                                  (s.elevatorFaultMode ?? 'none') === 'none'
                                );
                              if (tab.id === 'training')
                                return (s.datasetSplit ?? 'train') === 'train';
                              if (tab.id === 'testing')
                                return s.datasetSplit === 'test';
                              if (tab.id === 'failure-driven')
                                return s.generationSource === 'Failure-Driven';
                              return true;
                            });
                            if (
                              nextList.length > 0 &&
                              !nextList.some((s) => s.id === selectedScenarioId)
                            ) {
                              onChangeScenario(nextList[0].id);
                            }
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            scenarioFilter === tab.id
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                    {/* 1. Scenario Selection */}
                    <div className="min-w-0">
                      <label className="block text-[11px] text-slate-400 mb-1 truncate">
                        1. Scenario ({filteredScenarios.length} available)
                      </label>
                      <select
                        value={selectedScenarioId}
                        onChange={(e) => {
                          setDestinationOverrideId('');
                          setOriginOverrideId('');
                          setActiveElevatorCaseId('');
                          onChangeScenario(e.target.value);
                        }}
                        className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                      >
                        {filteredScenarios.map((scen) => (
                          <option key={scen.id} value={scen.id}>
                            {scen.name}{' '}
                            {scen.generationSource === 'Failure-Driven'
                              ? '[Failure-Driven]'
                              : `(${scen.category})`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 2. Robot Selection */}
                    <div className="min-w-0">
                      <label className="block text-[11px] text-slate-400 mb-1 truncate">
                        2. Robot Unit
                      </label>
                      <select
                        value={selectedRobotId}
                        onChange={(e) => onChangeRobot(e.target.value)}
                        className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                      >
                        {robots.map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            {bot.name} ({bot.maxSpeedMps} m/s · {bot.payloadCapacityKg}kg)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 3. Delivery Destination Selection */}
                    <div className="min-w-0">
                      <label className="block text-[11px] text-slate-400 mb-1 truncate">
                        3. Delivery Destination (Auto-selects Lift if Multi-Floor)
                      </label>
                      <select
                        value={
                          destinationOverrideId || activeScenario.destinationId
                        }
                        onChange={(e) => {
                          setActiveElevatorCaseId('');
                          setOriginOverrideId('');
                          setElevatorFaultMode('none');
                          setDestinationOverrideId(e.target.value);
                          const loc = DELIVERY_LOCATIONS.find(
                            (l) => l.id === e.target.value
                          );
                          const needsLift =
                            (loc?.floor ?? 0) !==
                            (activeScenario.originFloor ?? 0);
                          setShowBuildingCutaway(needsLift);
                          sceneManagerRef.current?.setVisualLayers({
                            showBuildingCutaway: needsLift,
                          });
                        }}
                        className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                      >
                        {DELIVERY_LOCATIONS.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} [{loc.code} · Floor {loc.floor ?? 0}]
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 4. Navigation Policy Selection */}
                    <div className="min-w-0">
                      <label className="block text-[11px] text-slate-400 mb-1 truncate">
                        4. Navigation Policy
                      </label>
                      <select
                        value={selectedPolicyId}
                        onChange={(e) => onChangePolicy(e.target.value)}
                        className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                      >
                        {policies.map((pol) => (
                          <option key={pol.id} value={pol.id}>
                            {pol.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* ===============================================================
                    PRIORITY 2: COLLAPSIBLE "ADVANCED ELEVATOR DIAGNOSTICS"
                   =============================================================== */}
                {showElevatorDiagnostics && (
                  <div className="pt-3 border-t border-slate-800 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>
                            Advanced Elevator Diagnostics (8 Verification Cases)
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Run individual floor-transition and fault-recovery tests. Normal simulation uses Normal Operation automatically.
                        </p>
                      </div>
                      {activeElevatorCaseId && (
                        <button
                          onClick={handleReturnToNormalOperation}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-cyan-300 font-medium cursor-pointer"
                        >
                          Return to Normal Operation
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                      {ELEVATOR_VERIFICATION_CASES.map((tc) => {
                        const isActive = activeElevatorCaseId === tc.id;
                        const diag = diagnosticStatuses[tc.id] ?? {
                          status: 'Not Tested' as DiagnosticStatus,
                        };
                        const badgeClass =
                          diag.status === 'Passed'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : diag.status === 'Failed'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : diag.status === 'Running'
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700';

                        return (
                          <div
                            key={tc.id}
                            className={`rounded-lg border p-2.5 flex flex-col justify-between gap-2 transition-colors ${
                              isActive
                                ? 'bg-cyan-950/30 border-cyan-500/60'
                                : 'bg-slate-900/80 border-slate-800'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-1.5">
                                <span className="text-xs font-semibold text-slate-100 leading-snug">
                                  {tc.label}
                                </span>
                                <span
                                  className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${badgeClass}`}
                                >
                                  {diag.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                {tc.description}
                              </p>
                              {diag.summary && (
                                <p className="text-[10px] font-mono text-cyan-300 pt-0.5">
                                  {diag.summary}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                              <span className="text-[10px] font-mono text-slate-400">
                                {tc.expectedOutcome}
                              </span>
                              <button
                                onClick={() =>
                                  handleRunElevatorVerificationCase(tc)
                                }
                                className="px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Run Test</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ===============================================================
                    PRIORITY 3D: COLLAPSIBLE "ADVANCED SETTINGS"
                   =============================================================== */}
                {showAdvancedSettings && (
                  <div className="pt-3 border-t border-slate-800 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
                        <span>
                          Advanced Visualization Overlays & Environmental Tuning
                        </span>
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => handleToggleLayer('path')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                            showPathLine
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Route Line</span>
                        </button>
                        <button
                          onClick={() => handleToggleLayer('sensor')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                            showSensorCone
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <Radar className="w-3.5 h-3.5" />
                          <span>LiDAR Cone</span>
                        </button>
                        <button
                          onClick={() => handleToggleLayer('cutaway')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                            showBuildingCutaway
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <Compass className="w-3.5 h-3.5" />
                          <span>Building Cutaway</span>
                        </button>
                        <button
                          onClick={() => handleToggleLayer('grid')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                            showNavGrid
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <Grid className="w-3.5 h-3.5" />
                          <span>2D Grid</span>
                        </button>
                        <button
                          onClick={() => handleToggleLayer('debug')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                            showCollisionDebug
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <BoxSelect className="w-3.5 h-3.5" />
                          <span>Collision Bounds</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      {/* Prediction Horizon */}
                      <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 flex flex-col justify-between gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-medium">
                            Prediction Horizon
                          </span>
                          <span className="font-mono text-cyan-400">
                            {predictionHorizon}s Lookahead
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {([1, 2, 4] as PredictionHorizonSec[]).map((h) => (
                            <button
                              key={h}
                              onClick={() => handleHorizonChange(h)}
                              className={`py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                                predictionHorizon === h
                                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {h === 1
                                ? 'Short (1s)'
                                : h === 2
                                ? 'Med (2s)'
                                : 'Long (4s)'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Pedestrian Behaviour Mix */}
                      <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-medium">
                            Pedestrian Behaviour Mix
                          </span>
                          <span className="font-mono text-amber-300">
                            {pedDist.commuterCount +
                              pedDist.randomCount +
                              pedDist.crossingCount +
                              pedDist.groupCount}{' '}
                            Total
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                          <div>
                            <span className="text-cyan-300 block truncate">
                              Commuter
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={6}
                              value={pedDist.commuterCount}
                              onChange={(e) =>
                                handlePedDistChange(
                                  'commuterCount',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                            />
                          </div>
                          <div>
                            <span className="text-purple-300 block truncate">
                              Random
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={6}
                              value={pedDist.randomCount}
                              onChange={(e) =>
                                handlePedDistChange(
                                  'randomCount',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                            />
                          </div>
                          <div>
                            <span className="text-amber-300 block truncate">
                              Crossing
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={6}
                              value={pedDist.crossingCount}
                              onChange={(e) =>
                                handlePedDistChange(
                                  'crossingCount',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                            />
                          </div>
                          <div>
                            <span className="text-emerald-300 block truncate">
                              Groups
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={6}
                              value={pedDist.groupCount}
                              onChange={(e) =>
                                handlePedDistChange(
                                  'groupCount',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Manual Fault Override */}
                      <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 flex flex-col justify-between gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-medium">
                            Manual Elevator Fault Override
                          </span>
                          <span className="font-mono text-cyan-400">
                            {elevatorFaultMode === 'none' ? 'Normal' : 'Fault'}
                          </span>
                        </div>
                        <select
                          value={elevatorFaultMode}
                          onChange={(e) => {
                            setActiveElevatorCaseId('');
                            handleElevatorFaultChange(
                              e.target.value as ElevatorFaultMode
                            );
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="none">
                            Normal Operation (Available)
                          </option>
                          <option value="unavailable-before-arrival">
                            Primary Out → Backup Lift Reroute
                          </option>
                          <option value="stuck-during-journey">
                            Stuck Mid-Shaft → Safe Halt
                          </option>
                          <option value="delayed-reassess">
                            Delayed Lift → Timeout & Reroute
                          </option>
                          <option value="no-alternative-available">
                            All Elevators Unavailable
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =====================================================================
          AREA C: LIVE ROBOT STATUS (Clean Primary Indicators + Expandable Advanced Telemetry)
         ===================================================================== */}
      <aside className="w-full lg:w-80 xl:w-92 shrink-0 bg-[#0a0f1d] border-t lg:border-t-0 lg:border-l border-slate-800/90 flex flex-col justify-between overflow-y-auto max-h-[42vh] lg:max-h-full">
        <div className="p-4 space-y-3.5">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-100">
                Live Robot Status
              </h2>
              <p className="text-[11px] text-slate-400">
                Real-time mission & floor-transition progress
              </p>
            </div>
            <span
              className={`px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-xs font-semibold ${statusColor}`}
            >
              {telemetry.simulationState.toUpperCase()}
            </span>
          </div>

          {/* Active Robot Hardware Profile Summary */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: activeRobot.accentColor }}
                />
                {activeRobot.name}
              </span>
              <span className="font-mono text-cyan-400">
                r={(activeRobot.collisionRadiusM ?? 0.68).toFixed(2)}m ·{' '}
                {activeRobot.lidarRangeM ?? 28}m LiDAR
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
              <span>
                {activeRobot.maxSpeedMps.toFixed(1)} m/s ·{' '}
                {(activeRobot.accelerationMps2 ?? 1.85).toFixed(2)} m/s²
              </span>
              <span>
                {activeRobot.payloadCapacityKg} kg · {activeRobot.batteryCapacityWh} Wh
              </span>
            </div>
          </div>

          {/* 1. Delivery Progress (%) */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">
                Delivery Progress
              </span>
              <span className="font-mono font-bold text-cyan-400 tabular-nums">
                {deliveryProgressPct}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
                style={{ width: `${deliveryProgressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums pt-0.5">
              <span>Traveled: {telemetry.distanceTraveledM.toFixed(1)}m</span>
              <span>Remaining: {telemetry.distanceRemainingM.toFixed(1)}m</span>
            </div>
          </div>

          {/* 2. Current Floor & 3. Current Robot Action */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Current Floor</span>
              </div>
              <div className="font-semibold text-xs text-slate-100 mt-1">
                {floorDisplayLabel}
              </div>
              <div className="text-[11px] font-mono text-cyan-400 mt-0.5">
                Altitude y = {telemetry.robotAltitudeY ?? 0}m
              </div>
            </div>

            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Current Action</span>
              </div>
              <div className={`font-semibold text-xs mt-1 truncate ${statusColor}`}>
                {telemetry.robotStatus}
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                Speed: {telemetry.currentSpeedMps.toFixed(2)} m/s
              </div>
            </div>
          </div>

          {/* 4. Current Destination */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Current Destination</span>
              </span>
              <span className="font-mono text-cyan-300">
                Floor {telemetry.originFloor ?? 0} → Floor{' '}
                {telemetry.destinationFloor ?? 0}
              </span>
            </div>
            <div className="text-xs font-semibold text-slate-100">
              {telemetry.currentDestination}
            </div>
            <div className="text-[11px] text-slate-400">
              Origin: <span className="text-slate-300">{telemetry.originName}</span>
            </div>
          </div>

          {/* 5. Navigation Status */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Navigation Status</span>
              <span className="font-mono text-amber-300 tabular-nums">
                Waypoint {telemetry.activeWaypointIndex}/
                {Math.max(1, telemetry.totalWaypoints - 1)}
              </span>
            </div>
            <div
              className={`text-xs font-medium leading-snug ${
                telemetry.pathBlockedReason
                  ? 'text-rose-400'
                  : telemetry.detourActive
                  ? 'text-emerald-300'
                  : 'text-cyan-300'
              }`}
            >
              {telemetry.navigationStatus}
            </div>
          </div>

          {/* 6. Elevator Status (Shown when relevant to multi-floor mission or diagnostics) */}
          {isElevatorRelevant && (
            <div className="bg-cyan-950/25 border border-cyan-500/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-cyan-200 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Elevator Status</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                    telemetry.activeElevatorMachineState === 'STUCK' ||
                    telemetry.activeElevatorMachineState === 'OUT_OF_SERVICE'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : telemetry.activeElevatorMachineState === 'MOVING_UP' ||
                        telemetry.activeElevatorMachineState === 'MOVING_DOWN'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  }`}
                >
                  {telemetry.activeElevatorMachineState ??
                    telemetry.elevatorState ??
                    'IDLE'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Cabin Floor</span>
                  <span className="font-mono text-slate-100 font-semibold">
                    {telemetry.currentFloorLabel}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Wait Time</span>
                  <span className="font-mono text-cyan-300">
                    {(telemetry.elevatorWaitTimeSec ?? 0).toFixed(1)}s
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Assistance</span>
                  <span
                    className={`font-mono ${
                      telemetry.elevatorAssistanceRequested
                        ? 'text-rose-400 font-semibold'
                        : 'text-emerald-400'
                    }`}
                  >
                    {telemetry.elevatorAssistanceRequested
                      ? 'Requested'
                      : 'Normal'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Advanced Telemetry Toggle */}
          <div className="pt-1">
            <button
              onClick={() => setShowAdvancedTelemetry((prev) => !prev)}
              className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 flex items-center justify-between cursor-pointer"
            >
              <span>Advanced Telemetry & Event Stream</span>
              {showAdvancedTelemetry ? (
                <ChevronUp className="w-4 h-4 text-cyan-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-cyan-400" />
              )}
            </button>

            {showAdvancedTelemetry && (
              <div className="mt-2.5 space-y-3">
                {/* Battery, Safety & Collisions */}
                <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1">
                      <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Battery Level</span>
                    </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {telemetry.batteryLevelPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-800/80">
                    <div>
                      <span className="text-slate-500 block">Collisions</span>
                      <span
                        className={`font-mono font-semibold ${
                          telemetry.collisionsCount > 0
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {telemetry.collisionsCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Replans</span>
                      <span className="font-mono font-semibold text-slate-200">
                        {telemetry.replanCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        Safety Overrides
                      </span>
                      <span className="font-mono font-semibold text-cyan-300">
                        {telemetry.safetyInterventionCount ?? 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5-Level Pedestrian Avoidance */}
                <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">
                      Avoidance Level
                    </span>
                    <span className="font-mono text-cyan-300">
                      {telemetry.activeAvoidanceLevel ??
                        'Level 1: Maintain Path'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-800/80">
                    <div>
                      <span className="text-slate-500 block">Speed Reg.</span>
                      <span className="font-mono text-cyan-300">
                        {telemetry.speedReductionEventsCount ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Local Bypass</span>
                      <span className="font-mono text-purple-300">
                        {telemetry.localBypassCount ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Wait Time</span>
                      <span className="font-mono text-amber-300">
                        {(telemetry.totalWaitingTimeSec ?? 0).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live Event Stream */}
                <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-medium text-slate-200 flex items-center justify-between">
                    <span>Simulation Event Log</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      LIVE
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
                    {logs.length === 0 ? (
                      <div className="text-slate-500 py-2">
                        Press Start Simulation to stream navigation events...
                      </div>
                    ) : (
                      logs.slice(0, 14).map((entry) => (
                        <div key={entry.id} className="leading-snug flex gap-2">
                          <span className="text-slate-500 shrink-0">
                            {entry.time}
                          </span>
                          <span
                            className={
                              entry.level === 'error'
                                ? 'text-rose-400'
                                : entry.level === 'warn'
                                ? 'text-amber-300'
                                : entry.level === 'success'
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }
                          >
                            {entry.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
