import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  BoxSelect,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Gauge,
  Grid,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radar,
  RotateCcw,
} from 'lucide-react';
import { DELIVERY_LOCATIONS, ROBOT_UNITS } from '../data/campusConfig';
import {
  CampusSceneManager,
  SimulationCompletionPayload,
} from '../three/CampusSceneManager';
import {
  CameraPresetId,
  ElevatorFaultMode,
  LiveTelemetry,
  NavigationPolicyConfig,
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
  telemetry: LiveTelemetry;
  onTelemetryUpdate: (telemetry: LiveTelemetry) => void;
  logs: SimulationLogEntry[];
  onLogEvent: (entry: SimulationLogEntry) => void;
  onSimulationComplete: (payload: SimulationCompletionPayload) => void;
}

export const SimulationLabPage: React.FC<SimulationLabPageProps> = ({
  scenarios,
  policies,
  selectedScenarioId,
  selectedRobotId,
  selectedPolicyId,
  onChangeScenario,
  onChangeRobot,
  onChangePolicy,
  telemetry,
  onTelemetryUpdate,
  logs,
  onLogEvent,
  onSimulationComplete,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneManagerRef = useRef<CampusSceneManager | null>(null);

  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('isometric');
  const [destinationOverrideId, setDestinationOverrideId] = useState<string>('');
  const [showNavGrid, setShowNavGrid] = useState<boolean>(false);
  const [showPathLine, setShowPathLine] = useState<boolean>(true);
  const [showSensorCone, setShowSensorCone] = useState<boolean>(true);
  const [showCollisionDebug, setShowCollisionDebug] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);

  const activeScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];
  const activePolicy =
    policies.find((p) => p.id === selectedPolicyId) ?? policies[0];
  const [showBuildingCutaway, setShowBuildingCutaway] = useState<boolean>(
    Boolean(activeScenario.requiresElevator)
  );

  const [predictionHorizon, setPredictionHorizon] = useState<PredictionHorizonSec>(
    activeScenario.predictionHorizonSec ?? 2
  );
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

  // Store latest callbacks in refs so WebGL scene never tears down on React state updates
  const callbacksRef = useRef({
    onTelemetryUpdate,
    onLogEvent,
    onSimulationComplete,
  });
  callbacksRef.current = {
    onTelemetryUpdate,
    onLogEvent,
    onSimulationComplete,
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
        onSimulationComplete: (p) => callbacksRef.current.onSimulationComplete(p),
      }
    );
    sceneManagerRef.current = manager;

    const handleResize = () => manager.resize();
    window.addEventListener('resize', handleResize);

    // Observe container size changes across browser zoom levels (100% - 175%)
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

  // Reset any manual destination override and sync scenario defaults whenever the active scenario changes
  useEffect(() => {
    setDestinationOverrideId('');
    setPredictionHorizon(activeScenario.predictionHorizonSec ?? 2);
    setPedDist(
      activeScenario.pedestrianDistribution ?? {
        commuterCount: Math.max(1, Math.round(activeScenario.dynamicObstacleCount * 0.4)),
        randomCount: Math.max(0, Math.round(activeScenario.dynamicObstacleCount * 0.25)),
        crossingCount: Math.max(0, Math.round(activeScenario.dynamicObstacleCount * 0.2)),
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
    setShowBuildingCutaway(Boolean(activeScenario.requiresElevator));
  }, [selectedScenarioId, activeScenario]);

  // Sync configuration changes without re-creating WebGLRenderer
  useEffect(() => {
    if (!sceneManagerRef.current) return;
    sceneManagerRef.current.setConfiguration(
      activeScenario,
      activePolicy,
      selectedRobotId,
      destinationOverrideId || null
    );
  }, [activeScenario, activePolicy, selectedRobotId, destinationOverrideId]);

  const handleStart = () => {
    sceneManagerRef.current?.startSimulation();
  };

  const handlePause = () => {
    sceneManagerRef.current?.pauseSimulation();
  };

  const handleReset = () => {
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

  return (
    <div className="h-full w-full flex flex-col lg:flex-row overflow-hidden bg-[#070b14]">
      {/* Left / Center: Interactive 3D Campus Viewport Container */}
      <div className="relative flex-1 min-w-0 h-full min-h-[300px] overflow-hidden select-none">
        {/* Dedicated isolated WebGL Mount Container */}
        <div ref={canvasMountRef} className="w-full h-full" />

        {/* Top-Left Spec & Camera Controls Overlay (Wraps gracefully on high zoom) */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex flex-col gap-2 pointer-events-none z-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="bg-[#0a0f1d]/95 border border-slate-800 rounded-lg px-3 py-1.5 pointer-events-auto flex flex-wrap items-center gap-2 text-xs max-w-full">
              <span className="font-display font-semibold text-slate-100">
                3D Campus Viewport
              </span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-400 hidden sm:inline">
                Drag: Rotate/Pan · Scroll: Zoom
              </span>
              {telemetry.currentGridCell && (
                <>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-emerald-400 tabular-nums">
                    Grid [{telemetry.currentGridCell.gx}, {telemetry.currentGridCell.gz}]
                  </span>
                </>
              )}
              {telemetry.selectedBuildingName && (
                <>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-cyan-400 font-medium truncate">
                    {telemetry.selectedBuildingName}
                  </span>
                </>
              )}
            </div>

            {/* Interactive Camera View Preset Controls */}
            <div className="bg-[#0a0f1d]/95 border border-slate-800 rounded-lg p-1 pointer-events-auto flex flex-wrap items-center gap-1 max-w-full">
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
                  { id: 'charging-station', label: 'Charging Bay' },
                  { id: 'construction-zone', label: 'Work Zone' },
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
              <button
                onClick={() => handleSelectCameraPreset('isometric')}
                title="Reset Camera to Default Isometric View"
                className="px-2 py-1 rounded text-xs font-medium text-slate-300 hover:bg-slate-800 border-l border-slate-800 cursor-pointer whitespace-nowrap"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Visual Debug Mode Legend & Route Status Banner */}
          {(showNavGrid ||
            showCollisionDebug ||
            telemetry.pathBlockedReason ||
            telemetry.detourActive ||
            telemetry.elevatorAssistanceRequested) && (
            <div className="flex flex-wrap items-center gap-2">
              {(showNavGrid || showCollisionDebug) && (
                <div className="bg-[#0a0f1d]/95 border border-slate-800 rounded-lg px-3 py-1.5 pointer-events-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                  <span className="font-semibold text-cyan-400">Debug Legend:</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-cyan-500 inline-block" />
                    <span>Walkable Road</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                    <span>Blocked Construction</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                    <span>Predicted Conflict</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400 inline-block" />
                    <span>Robot Cell</span>
                  </span>
                </div>
              )}

              {telemetry.elevatorAssistanceRequested && (
                <div className="bg-rose-950/95 border border-rose-500/60 rounded-lg px-3 py-1.5 pointer-events-auto flex items-center gap-2 text-xs text-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>
                    OPERATOR ALERT: Robot awaiting emergency assistance in elevator ({telemetry.elevatorState})
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
                    A* Obstacle & Predictive Detour Active: Path routed around hazards
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Centered Responsive Bottom Simulation Control Dock */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-2.5 sm:px-4 pb-2.5 sm:pb-3 pointer-events-none">
          <div className="w-full max-w-[960px] flex flex-col items-center">
            {/* Collapse / Expand Toggle Handle */}
            <button
              onClick={() => setDockCollapsed(!dockCollapsed)}
              className="pointer-events-auto bg-[#0a0f1d] border border-slate-700 rounded-t-lg px-3.5 py-1 text-xs font-medium text-slate-200 hover:text-white flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              {dockCollapsed ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Show Simulation Controls (H)</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Hide Controls (H)</span>
                </>
              )}
            </button>

            {/* Control Dock Panel — Responsive width, multi-row wrapping, and vertical scroll on high zoom */}
            {!dockCollapsed && (
              <div className="pointer-events-auto w-full bg-[#0a0f1d] border border-slate-700/90 rounded-xl p-2.5 sm:p-3.5 shadow-2xl max-h-[48vh] overflow-y-auto space-y-2.5">
                {/* Row 1: Primary Playback Controls + Speed + Layer Toggles */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Start / Pause / Reset */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={handleStart}
                      disabled={telemetry.simulationState === 'running'}
                      className={`min-h-[34px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        telemetry.simulationState === 'running'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 cursor-not-allowed'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span>
                        {telemetry.simulationState === 'paused'
                          ? 'Resume'
                          : 'Start'}
                      </span>
                    </button>

                    <button
                      onClick={handlePause}
                      disabled={telemetry.simulationState !== 'running'}
                      className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
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
                      className="min-h-[34px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Reset</span>
                    </button>
                  </div>

                  {/* Simulation Speed Multiplier */}
                  <div className="flex flex-wrap items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                    <span className="px-1.5 text-[11px] text-slate-400">
                      Speed:
                    </span>
                    {[0.5, 1.0, 2.0, 4.0].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => handleSpeedChange(spd)}
                        className={`min-h-[26px] px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                          simSpeed === spd
                            ? 'bg-cyan-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>

                  {/* 3D Visualization & Debug Overlays */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => handleToggleLayer('path')}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showPathLine
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Navigation className="w-3.5 h-3.5 shrink-0" />
                      <span>A* Path</span>
                    </button>

                    <button
                      onClick={() => handleToggleLayer('grid')}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showNavGrid
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5 shrink-0" />
                      <span>2D Grid</span>
                    </button>

                    <button
                      onClick={() => handleToggleLayer('sensor')}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showSensorCone
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Radar className="w-3.5 h-3.5 shrink-0" />
                      <span>LiDAR Cone</span>
                    </button>

                    <button
                      onClick={() => handleToggleLayer('debug')}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showCollisionDebug
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <BoxSelect className="w-3.5 h-3.5 shrink-0" />
                      <span>Collision Bounds</span>
                    </button>

                    <button
                      onClick={() => handleToggleLayer('cutaway')}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        showBuildingCutaway
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Compass className="w-3.5 h-3.5 shrink-0" />
                      <span>Building Cutaway</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Scenario, Robot, Policy & Destination Selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
                  {/* Scenario Selection */}
                  <div className="min-w-0">
                    <label className="block text-[11px] text-slate-400 mb-1 truncate">
                      Scenario Selection
                    </label>
                    <select
                      value={selectedScenarioId}
                      onChange={(e) => {
                        setDestinationOverrideId('');
                        onChangeScenario(e.target.value);
                      }}
                      className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {scenarios.map((scen) => (
                        <option key={scen.id} value={scen.id}>
                          {scen.name} ({scen.category})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Robot Selection */}
                  <div className="min-w-0">
                    <label className="block text-[11px] text-slate-400 mb-1 truncate">
                      Autonomous Robot Unit
                    </label>
                    <select
                      value={selectedRobotId}
                      onChange={(e) => onChangeRobot(e.target.value)}
                      className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {ROBOT_UNITS.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name} ({bot.maxSpeedMps} m/s)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Navigation Policy Selection */}
                  <div className="min-w-0">
                    <label className="block text-[11px] text-slate-400 mb-1 truncate">
                      Navigation Policy
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

                  {/* Destination Node Selector */}
                  <div className="min-w-0">
                    <label className="block text-[11px] text-slate-400 mb-1 truncate">
                      Delivery Destination
                    </label>
                    <select
                      value={destinationOverrideId || activeScenario.destinationId}
                      onChange={(e) => setDestinationOverrideId(e.target.value)}
                      className="w-full min-h-[34px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {DELIVERY_LOCATIONS.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} [{loc.code}]
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 3: Predictive Horizon, Pedestrian Behaviour Distribution & Elevator Fault Mode */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
                  {/* Prediction Horizon Selector */}
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
                          {h === 1 ? 'Short (1s)' : h === 2 ? 'Med (2s)' : 'Long (4s)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pedestrian Behaviour Distribution */}
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
                        <span className="text-cyan-300 block truncate" title="Predictable Commuters">
                          Commuter
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={6}
                          value={pedDist.commuterCount}
                          onChange={(e) =>
                            handlePedDistChange('commuterCount', Number(e.target.value))
                          }
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                        />
                      </div>
                      <div>
                        <span className="text-purple-300 block truncate" title="Random Walkers">
                          Random
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={6}
                          value={pedDist.randomCount}
                          onChange={(e) =>
                            handlePedDistChange('randomCount', Number(e.target.value))
                          }
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                        />
                      </div>
                      <div>
                        <span className="text-amber-300 block truncate" title="Crossing Pedestrians">
                          Crossing
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={6}
                          value={pedDist.crossingCount}
                          onChange={(e) =>
                            handlePedDistChange('crossingCount', Number(e.target.value))
                          }
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                        />
                      </div>
                      <div>
                        <span className="text-emerald-300 block truncate" title="Group Pedestrians">
                          Groups
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={6}
                          value={pedDist.groupCount}
                          onChange={(e) =>
                            handlePedDistChange('groupCount', Number(e.target.value))
                          }
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Elevator Fault & Recovery Test Mode */}
                  <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 flex flex-col justify-between gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-medium">
                        Elevator Recovery Test Mode
                      </span>
                      <span className="font-mono text-cyan-400">
                        {telemetry.elevatorState ?? 'Available'}
                      </span>
                    </div>
                    <select
                      value={elevatorFaultMode}
                      onChange={(e) =>
                        handleElevatorFaultChange(e.target.value as ElevatorFaultMode)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="none">Normal Operation (Available)</option>
                      <option value="unavailable-before-arrival">
                        Test 1: Out of Service → Reroute Backup Lift
                      </option>
                      <option value="stuck-during-journey">
                        Test 2: Stuck Mid-Travel → Request Assistance
                      </option>
                      <option value="delayed-reassess">
                        Test 3: Delayed Lift → Timeout & Reroute
                      </option>
                      <option value="no-alternative-available">
                        Test 9: All Lifts Out of Service → Safe Halt
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right-Side Telemetry Panel (Dedicated non-overlapping column) */}
      <aside className="w-full lg:w-76 xl:w-88 shrink-0 bg-[#0a0f1d] border-t lg:border-t-0 lg:border-l border-slate-800/90 flex flex-col justify-between overflow-y-auto max-h-[42vh] lg:max-h-full">
        <div className="p-4 space-y-3.5">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-100">
                Real-Time Robot Telemetry
              </h2>
              <p className="text-[11px] text-slate-400">
                Live kinematic & obstacle awareness stream
              </p>
            </div>
            <span className={`font-mono text-xs font-semibold ${statusColor}`}>
              {telemetry.robotStatus}
            </span>
          </div>

          {/* 6 Required Primary Telemetry Readouts */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* 1. Robot Status */}
            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Robot Status</span>
              </div>
              <div className={`font-semibold text-sm mt-1 truncate ${statusColor}`}>
                {telemetry.robotStatus}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                Unit: {telemetry.robotName}
              </div>
            </div>

            {/* 2. Current Speed */}
            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Current Speed</span>
              </div>
              <div className="font-mono font-bold text-lg text-slate-100 mt-1 tabular-nums">
                {telemetry.currentSpeedMps.toFixed(2)}{' '}
                <span className="text-xs font-normal text-slate-400">m/s</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                Elapsed: {telemetry.elapsedTimeSec.toFixed(1)}s
              </div>
            </div>

            {/* 3. Battery Level */}
            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Battery Level</span>
              </div>
              <div className="font-mono font-bold text-lg text-emerald-400 mt-1 tabular-nums">
                {telemetry.batteryLevelPct.toFixed(1)}%
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{ width: `${Math.min(100, telemetry.batteryLevelPct)}%` }}
                />
              </div>
            </div>

            {/* 4. Distance Remaining */}
            <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Distance Remaining</span>
              </div>
              <div className="font-mono font-bold text-lg text-sky-400 mt-1 tabular-nums">
                {telemetry.distanceRemainingM.toFixed(1)}{' '}
                <span className="text-xs font-normal text-slate-400">m</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                Traveled: {telemetry.distanceTraveledM.toFixed(1)}m
              </div>
            </div>
          </div>

          {/* 5. Current Destination & Origin */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Current Destination</span>
              </span>
              <span className="font-mono text-[11px] text-cyan-400 tabular-nums">
                Node {telemetry.activeWaypointIndex}/
                {Math.max(0, telemetry.totalWaypoints - 1)}
              </span>
            </div>
            <div className="text-xs font-semibold text-slate-100">
              {telemetry.currentDestination}
            </div>
            <div className="text-[11px] text-slate-400">
              Origin: <span className="text-slate-300">{telemetry.originName}</span>
            </div>
          </div>

          {/* 6. Current Navigation Status, Grid Cell & Obstacle Proximity */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Current Navigation Status</span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                X:{telemetry.position.x}m Z:{telemetry.position.z}m
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

            {telemetry.currentGridCell && (
              <div className="pt-1.5 border-t border-slate-800/70 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Active 2D Grid Cell</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  [{telemetry.currentGridCell.gx}, {telemetry.currentGridCell.gz}] ·{' '}
                  {telemetry.currentGridCell.walkable ? 'Walkable' : 'Blocked'}
                </span>
              </div>
            )}

            {telemetry.nearestObstacleDistanceM !== undefined &&
              telemetry.nearestObstacleDistanceM !== null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Nearest Pedestrian</span>
                  <span className="font-mono text-amber-300 tabular-nums">
                    {telemetry.nearestObstacleType} (Actual: {telemetry.nearestObstacleDistanceM}m
                    {telemetry.perceivedNearestDistanceM !== undefined &&
                    telemetry.perceivedNearestDistanceM !== null
                      ? ` · LiDAR: ${telemetry.perceivedNearestDistanceM}m`
                      : ''}
                    )
                  </span>
                </div>
              )}

            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Collisions</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    telemetry.collisionsCount > 0
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {telemetry.collisionsCount}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Replan Events</span>
                <span className="font-mono font-semibold text-slate-200 tabular-nums">
                  {telemetry.replanCount}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Heading</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {((telemetry.position.headingRad * 180) / Math.PI).toFixed(0)}°
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-800/70 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Pedestrian Detections</span>
                <span className="font-mono font-semibold text-amber-300 tabular-nums">
                  {telemetry.pedestrianDetectionsCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Total Waiting Time</span>
                <span className="font-mono font-semibold text-cyan-300 tabular-nums">
                  {(telemetry.totalWaitingTimeSec ?? 0).toFixed(1)}s
                </span>
              </div>
            </div>
          </div>

          {/* Hierarchical Pedestrian Avoidance & Speed Regulation Telemetry */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-slate-200 flex items-center justify-between gap-1">
              <span>5-Level Pedestrian Avoidance</span>
              <span className="font-mono text-[11px] text-cyan-400">
                Horizon: {telemetry.predictionHorizonSec ?? predictionHorizon}s
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded px-2 py-1 text-[11px]">
              <span className="text-slate-400">Active Hierarchy</span>
              <span
                className={`font-mono font-semibold ${
                  telemetry.activeAvoidanceLevel?.startsWith('Level 1')
                    ? 'text-emerald-400'
                    : telemetry.activeAvoidanceLevel?.startsWith('Level 2')
                    ? 'text-cyan-300'
                    : telemetry.activeAvoidanceLevel?.startsWith('Level 3')
                    ? 'text-amber-300'
                    : telemetry.activeAvoidanceLevel?.startsWith('Level 4')
                    ? 'text-purple-300'
                    : 'text-rose-300'
                }`}
              >
                {telemetry.activeAvoidanceLevel ?? 'Level 1: Maintain Path'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Speed Reg.</span>
                <span className="font-mono text-cyan-300 tabular-nums">
                  {telemetry.speedReductionEventsCount ?? 0} Events
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Slowed Time</span>
                <span className="font-mono text-sky-300 tabular-nums">
                  {(telemetry.reducedSpeedTimeSec ?? 0).toFixed(1)}s
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Ped Wait</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  {(telemetry.pedestrianWaitingTimeSec ?? 0).toFixed(1)}s
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-800/70 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Speed Avoided</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {telemetry.speedBasedAvoidanceCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Local Bypass</span>
                <span className="font-mono text-purple-300 tabular-nums">
                  {telemetry.localBypassCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Global Replan</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {telemetry.globalReplanCount ?? telemetry.replanCount}
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-800/70 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Predicted</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  {telemetry.predictedEncountersCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Unnec. Stops</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {telemetry.unnecessaryStopsCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Accuracy</span>
                <span className="font-mono text-cyan-300 tabular-nums">
                  {(telemetry.predictionAccuracyPct ?? 95.0).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Indoor Multi-Floor Building Elevator Telemetry */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-slate-200 flex items-center justify-between">
              <span>Indoor Building Elevator</span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  telemetry.elevatorState === 'Stuck' ||
                  telemetry.elevatorState === 'Out of Service' ||
                  telemetry.elevatorState === 'Emergency Assistance'
                    ? 'text-rose-400'
                    : telemetry.elevatorState === 'Delayed'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {telemetry.elevatorState ?? 'Available'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Floor Level</span>
                <span className="font-mono text-slate-200 tabular-nums truncate block">
                  {telemetry.currentFloorLabel ??
                    (telemetry.currentFloor === 2
                      ? '2F (7.2m)'
                      : telemetry.currentFloor === 1
                      ? '1F (3.6m)'
                      : 'Ground (0m)')}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Lift Wait</span>
                <span className="font-mono text-cyan-300 tabular-nums">
                  {(telemetry.elevatorWaitTimeSec ?? 0).toFixed(1)}s
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Assistance</span>
                <span
                  className={`font-mono tabular-nums ${
                    telemetry.elevatorAssistanceRequested
                      ? 'text-rose-400 font-semibold'
                      : 'text-slate-400'
                  }`}
                >
                  {telemetry.elevatorAssistanceRequested ? 'Requested' : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Scenario Hazard & Perception Conditions */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-slate-200 flex items-center justify-between">
              <span>Scenario & Perception Model</span>
              <span className="text-[11px] text-cyan-400">
                {activeScenario.category}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Work Zones</span>
                <span className="font-mono text-amber-400 tabular-nums">
                  {activeScenario.activeConstructionZones.length} Active
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Pedestrians</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {pedDist.commuterCount +
                    pedDist.randomCount +
                    pedDist.crossingCount +
                    pedDist.groupCount}{' '}
                  Agents
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Clearance</span>
                <span className="font-mono text-cyan-400 tabular-nums">
                  {activePolicy.safetyClearanceM.toFixed(1)}m
                </span>
              </div>
            </div>
            <div className="pt-1.5 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Visibility</span>
                <span className="font-mono text-sky-400 tabular-nums">
                  {telemetry.visibilityRangeM !== undefined
                    ? `${telemetry.visibilityRangeM.toFixed(1)}m`
                    : '28.0m'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">LiDAR Noise</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  ±
                  {telemetry.sensorNoiseStdM !== undefined
                    ? telemetry.sensorNoiseStdM.toFixed(2)
                    : '0.02'}
                  m
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Perceived Obs</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {telemetry.perceivedObstaclesCount ?? 0}/
                  {telemetry.totalEnvironmentalObstaclesCount ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Live Event Stream */}
          <div className="bg-[#0d1426] border border-slate-800/90 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-slate-200 flex items-center justify-between">
              <span>Simulation Event Log</span>
              <span className="font-mono text-[10px] text-slate-500">LIVE</span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="text-slate-500 py-2">
                  Press Start to stream navigation & obstacle telemetry...
                </div>
              ) : (
                logs.slice(0, 14).map((entry) => (
                  <div key={entry.id} className="leading-snug flex gap-2">
                    <span className="text-slate-500 shrink-0">{entry.time}</span>
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
      </aside>
    </div>
  );
};
