import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Box,
  CheckCircle2,
  Copy,
  Cpu,
  Edit3,
  Eye,
  Gauge,
  Layers,
  Play,
  Plus,
  Radar,
  Scale,
  ShieldCheck,
  Sliders,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { formatRobotHardwareSummary } from '../data/campusConfig';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  NavPageId,
  RobotCategory,
  RobotUnitConfig,
  WheelConfigurationType,
} from '../types/simulation';

interface RobotConfigPageProps {
  onNavigate?: (page: NavPageId) => void;
}

interface CustomRobotFormState {
  id: string;
  name: string;
  model: string;
  description: string;
  intendedApplication: string;
  category: RobotCategory;
  chassisColor: string;
  accentColor: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  weightKg: number;
  maxSpeedMps: number;
  accelerationMps2: number;
  decelerationMps2: number;
  emergencyBrakingMps2: number;
  turningRadiusM: number;
  wheelConfiguration: WheelConfigurationType;
  movementType: string;
  maxSlopeDeg: number;
  payloadCapacityKg: number;
  defaultPayloadKg: number;
  batteryCapacityWh: number;
  basePowerDrawW: number;
  lowBatteryThresholdPct: number;
  lidarType: string;
  lidarRangeM: number;
  lidarFovDeg: number;
  cameraType: string;
  cameraRangeM: number;
  ultrasonicRangeM: number;
  hasRadar: boolean;
  hasThermalCamera: boolean;
  hasImuFusion: boolean;
  sensorUpdateHz: number;
  baseSensorNoiseStdM: number;
  assignedPolicyId: string;
}

const DEFAULT_FORM_STATE: CustomRobotFormState = {
  id: '',
  name: 'ApexScout M3',
  model: 'AS-M3 Custom All-Terrain Courier',
  description:
    'Custom-configured autonomous delivery platform with extended solid-state LiDAR and high-torque 4WD drive.',
  intendedApplication: 'Custom Campus & Inter-Building Logistics',
  category: 'custom',
  chassisColor: '#e2e8f0',
  accentColor: '#8b5cf6',
  lengthM: 0.96,
  widthM: 0.68,
  heightM: 0.74,
  weightKg: 42,
  maxSpeedMps: 3.4,
  accelerationMps2: 2.0,
  decelerationMps2: 2.6,
  emergencyBrakingMps2: 5.5,
  turningRadiusM: 0.52,
  wheelConfiguration: 'Quad-Wheel Skid/Ackermann',
  movementType: '4WD Independent Brushless Hub Drive',
  maxSlopeDeg: 15,
  payloadCapacityKg: 28,
  defaultPayloadKg: 12,
  batteryCapacityWh: 920,
  basePowerDrawW: 115,
  lowBatteryThresholdPct: 20,
  lidarType: '360° Solid-State 64-Channel LiDAR',
  lidarRangeM: 30,
  lidarFovDeg: 360,
  cameraType: 'Stereo RGB-D + Wide-Angle Fisheye',
  cameraRangeM: 20,
  ultrasonicRangeM: 4.0,
  hasRadar: true,
  hasThermalCamera: false,
  hasImuFusion: true,
  sensorUpdateHz: 40,
  baseSensorNoiseStdM: 0.025,
  assignedPolicyId: 'pol-hybrid-safe',
};

export const RobotConfigPage: React.FC<RobotConfigPageProps> = ({ onNavigate }) => {
  const {
    robots,
    selectedRobotId,
    activeRobot,
    setSelectedRobotId,
    saveRobotProfile,
    deleteRobotProfile,
    policies,
  } = useExperimentStore();

  const [inspectedRobotId, setInspectedRobotId] = useState<string>(selectedRobotId);
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [formState, setFormState] = useState<CustomRobotFormState>(DEFAULT_FORM_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const inspectedRobot = useMemo(
    () =>
      robots.find((r) => r.id === inspectedRobotId) ??
      activeRobot ??
      robots[0],
    [robots, inspectedRobotId, activeRobot]
  );

  const openCreateModal = () => {
    setEditingRobotId(null);
    setFormState({
      ...DEFAULT_FORM_STATE,
      id: `bot-custom-${Date.now().toString(36)}`,
    });
    setValidationError(null);
    setShowEditorModal(true);
  };

  const openDuplicateModal = (source: RobotUnitConfig) => {
    setEditingRobotId(null);
    setFormState({
      id: `bot-custom-${Date.now().toString(36)}`,
      name: `${source.name} (Custom)`,
      model: `${source.model} — Custom Variant`,
      description: source.description ?? DEFAULT_FORM_STATE.description,
      intendedApplication:
        source.intendedApplication ?? DEFAULT_FORM_STATE.intendedApplication,
      category: 'custom',
      chassisColor: source.chassisColor || '#e2e8f0',
      accentColor: source.accentColor || '#8b5cf6',
      lengthM: source.lengthM ?? 0.92,
      widthM: source.widthM ?? 0.64,
      heightM: source.heightM ?? 0.72,
      weightKg: source.weightKg ?? 38,
      maxSpeedMps: source.maxSpeedMps,
      accelerationMps2: source.accelerationMps2 ?? 1.85,
      decelerationMps2: source.decelerationMps2 ?? 2.4,
      emergencyBrakingMps2: source.emergencyBrakingMps2 ?? 5.2,
      turningRadiusM: source.turningRadiusM ?? 0.55,
      wheelConfiguration:
        source.wheelConfiguration ?? 'Quad-Wheel Skid/Ackermann',
      movementType: source.movementType ?? '4WD Independent Hub Drive',
      maxSlopeDeg: source.maxSlopeDeg ?? 14,
      payloadCapacityKg: source.payloadCapacityKg,
      defaultPayloadKg:
        source.defaultPayloadKg ?? Math.round(source.payloadCapacityKg * 0.4),
      batteryCapacityWh: source.batteryCapacityWh,
      basePowerDrawW: source.basePowerDrawW ?? 110,
      lowBatteryThresholdPct: source.lowBatteryThresholdPct ?? 20,
      lidarType: source.lidarType ?? '360° Solid-State LiDAR',
      lidarRangeM: source.lidarRangeM ?? 28,
      lidarFovDeg: source.lidarFovDeg ?? 360,
      cameraType: source.cameraType ?? 'Stereo RGB-D Depth Array',
      cameraRangeM: source.cameraRangeM ?? 18,
      ultrasonicRangeM: source.ultrasonicRangeM ?? 4.0,
      hasRadar: Boolean(source.hasRadar),
      hasThermalCamera: Boolean(source.hasThermalCamera),
      hasImuFusion: source.hasImuFusion ?? true,
      sensorUpdateHz: source.sensorUpdateHz ?? 30,
      baseSensorNoiseStdM: source.baseSensorNoiseStdM ?? 0.03,
      assignedPolicyId: source.assignedPolicyId || 'pol-hybrid-safe',
    });
    setValidationError(null);
    setShowEditorModal(true);
  };

  const openEditModal = (robot: RobotUnitConfig) => {
    setEditingRobotId(robot.id);
    setFormState({
      id: robot.id,
      name: robot.name,
      model: robot.model,
      description: robot.description ?? '',
      intendedApplication: robot.intendedApplication ?? '',
      category: robot.category ?? 'custom',
      chassisColor: robot.chassisColor,
      accentColor: robot.accentColor,
      lengthM: robot.lengthM ?? 0.92,
      widthM: robot.widthM ?? 0.64,
      heightM: robot.heightM ?? 0.72,
      weightKg: robot.weightKg ?? 38,
      maxSpeedMps: robot.maxSpeedMps,
      accelerationMps2: robot.accelerationMps2 ?? 1.85,
      decelerationMps2: robot.decelerationMps2 ?? 2.4,
      emergencyBrakingMps2: robot.emergencyBrakingMps2 ?? 5.2,
      turningRadiusM: robot.turningRadiusM ?? 0.55,
      wheelConfiguration:
        robot.wheelConfiguration ?? 'Quad-Wheel Skid/Ackermann',
      movementType: robot.movementType ?? '4WD Independent Hub Drive',
      maxSlopeDeg: robot.maxSlopeDeg ?? 14,
      payloadCapacityKg: robot.payloadCapacityKg,
      defaultPayloadKg:
        robot.defaultPayloadKg ?? Math.round(robot.payloadCapacityKg * 0.4),
      batteryCapacityWh: robot.batteryCapacityWh,
      basePowerDrawW: robot.basePowerDrawW ?? 110,
      lowBatteryThresholdPct: robot.lowBatteryThresholdPct ?? 20,
      lidarType: robot.lidarType ?? '360° Solid-State LiDAR',
      lidarRangeM: robot.lidarRangeM ?? 28,
      lidarFovDeg: robot.lidarFovDeg ?? 360,
      cameraType: robot.cameraType ?? 'Stereo RGB-D Depth Array',
      cameraRangeM: robot.cameraRangeM ?? 18,
      ultrasonicRangeM: robot.ultrasonicRangeM ?? 4.0,
      hasRadar: Boolean(robot.hasRadar),
      hasThermalCamera: Boolean(robot.hasThermalCamera),
      hasImuFusion: robot.hasImuFusion ?? true,
      sensorUpdateHz: robot.sensorUpdateHz ?? 30,
      baseSensorNoiseStdM: robot.baseSensorNoiseStdM ?? 0.03,
      assignedPolicyId: robot.assignedPolicyId || 'pol-hybrid-safe',
    });
    setValidationError(null);
    setShowEditorModal(true);
  };

  const handleSaveCustomRobot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) {
      setValidationError('Robot name is required.');
      return;
    }
    if (
      formState.lengthM <= 0.3 ||
      formState.lengthM > 2.2 ||
      formState.widthM <= 0.25 ||
      formState.widthM > 1.6 ||
      formState.heightM <= 0.25 ||
      formState.heightM > 1.8
    ) {
      setValidationError(
        'Physical dimensions must be positive and within realistic campus corridor bounds (Length 0.3–2.2m, Width 0.25–1.6m, Height 0.25–1.8m).'
      );
      return;
    }
    if (
      formState.maxSpeedMps <= 0.4 ||
      formState.maxSpeedMps > 6.5 ||
      formState.accelerationMps2 <= 0.2 ||
      formState.decelerationMps2 <= 0.2
    ) {
      setValidationError(
        'Max speed (0.5–6.5 m/s), acceleration (>0.2 m/s²), and deceleration (>0.2 m/s²) must be valid positive values.'
      );
      return;
    }
    if (formState.payloadCapacityKg <= 0 || formState.batteryCapacityWh < 150) {
      setValidationError(
        'Payload capacity (>0 kg) and battery capacity (≥150 Wh) must be valid positive values.'
      );
      return;
    }
    if (formState.lidarRangeM < 8 || formState.lidarRangeM > 60) {
      setValidationError('LiDAR range must be between 8m and 60m.');
      return;
    }

    const derivedRadius = Number(
      Math.max(
        0.44,
        Math.min(1.05, Math.hypot(formState.lengthM, formState.widthM) * 0.6)
      ).toFixed(2)
    );

    const sensorTags: string[] = [formState.lidarType, formState.cameraType];
    if (formState.hasRadar) sensorTags.push('mmWave Radar');
    if (formState.hasThermalCamera) sensorTags.push('Thermal Camera');
    if (formState.hasImuFusion) sensorTags.push('IMU Fusion');

    const newRobot: RobotUnitConfig = {
      ...formState,
      name: formState.name.trim(),
      model: formState.model.trim() || 'Custom Autonomous Unit',
      collisionRadiusM: derivedRadius,
      sensorSuite: sensorTags.join(' + '),
      isCustom: true,
    };

    saveRobotProfile(newRobot);
    setSelectedRobotId(newRobot.id);
    setInspectedRobotId(newRobot.id);
    setShowEditorModal(false);
    setStatusBanner(
      `${editingRobotId ? 'Updated' : 'Created'} robot configuration "${
        newRobot.name
      }" and selected it as the active simulation robot.`
    );
  };

  const handleSelectForSimulation = (robot: RobotUnitConfig, jumpToSim = false) => {
    setSelectedRobotId(robot.id);
    setInspectedRobotId(robot.id);
    setStatusBanner(
      `Selected "${robot.name}" (${formatRobotHardwareSummary(
        robot
      )}) as active robot across Simulation Lab, Policy Training, and Benchmarking.`
    );
    if (jumpToSim && onNavigate) {
      onNavigate('simulation-lab');
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 text-cyan-400 text-xs font-mono uppercase tracking-wider mb-1.5">
              <Cpu className="w-4 h-4" />
              <span>Multi-Robot Hardware Architecture & Sensor Suite Configuration</span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Robot Configuration & Hardware Profiles
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Configure physical chassis dimensions, kinematic limits, battery reserves, payload capacities, and perception sensor suites. Selecting a robot updates the 3D campus model, collision footprint, acceleration/braking dynamics, and LiDAR perception range in real time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-all shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Custom Robot Profile
            </button>
            {onNavigate && (
              <button
                onClick={() => onNavigate('simulation-lab')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold text-xs transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                Open Simulation Lab
              </button>
            )}
          </div>
        </div>

        {/* Hardware vs Software Policy Distinction Banner */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="bg-slate-950/60 border border-cyan-500/25 rounded-xl p-3.5 flex items-start gap-3">
            <Truck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-cyan-300">
                1. Robot Hardware Profile (Configured Here):
              </span>{' '}
              <span className="text-slate-300">
                Defines physical dimensions, collision radius, wheel layout, max speed, acceleration/deceleration, payload limit, battery capacity (Wh), and LiDAR/camera/radar sensors.
              </span>
            </div>
          </div>
          <div className="bg-slate-950/60 border border-emerald-500/25 rounded-xl p-3.5 flex items-start gap-3">
            <Layers className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-emerald-300">
                2. Software Navigation Policy (Evaluated on Selected Robot):
              </span>{' '}
              <span className="text-slate-300">
                Defines the decision-making algorithm (Baseline Hybrid A* vs. Trained Tabular Q-Learning Policy) that controls speed regulation, local bypass, and replanning on top of this hardware.
              </span>
            </div>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Robot Fleet Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {robots.map((robot) => {
          const isSelected = robot.id === selectedRobotId;
          const isInspected = robot.id === inspectedRobot.id;
          return (
            <div
              key={robot.id}
              onClick={() => setInspectedRobotId(robot.id)}
              className={`rounded-2xl p-5 border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-slate-900/95 border-cyan-500/60 shadow-lg shadow-cyan-500/10'
                  : isInspected
                  ? 'bg-slate-900/80 border-slate-600'
                  : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20"
                      style={{ backgroundColor: robot.accentColor }}
                    />
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        {robot.name}
                        {robot.isCustom && (
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Custom
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">{robot.model}</p>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="px-2.5 py-1 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[11px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active in Sim
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  {robot.description ||
                    'Autonomous delivery platform configured for multi-floor campus navigation and obstacle avoidance.'}
                </p>

                {/* Key Hardware Specs Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-slate-400 text-[11px] flex items-center gap-1">
                      <Gauge className="w-3 h-3 text-cyan-400" />
                      Max Speed / Accel
                    </div>
                    <div className="text-white font-mono font-semibold mt-0.5">
                      {robot.maxSpeedMps.toFixed(1)} m/s ·{' '}
                      {(robot.accelerationMps2 ?? 1.85).toFixed(2)} m/s²
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-slate-400 text-[11px] flex items-center gap-1">
                      <Scale className="w-3 h-3 text-emerald-400" />
                      Payload Capacity
                    </div>
                    <div className="text-white font-mono font-semibold mt-0.5">
                      {robot.payloadCapacityKg} kg (Default{' '}
                      {robot.defaultPayloadKg ?? Math.round(robot.payloadCapacityKg * 0.4)} kg)
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-slate-400 text-[11px] flex items-center gap-1">
                      <BatteryCharging className="w-3 h-3 text-amber-400" />
                      Battery / Draw
                    </div>
                    <div className="text-white font-mono font-semibold mt-0.5">
                      {robot.batteryCapacityWh} Wh · {robot.basePowerDrawW ?? 110} W
                    </div>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                    <div className="text-slate-400 text-[11px] flex items-center gap-1">
                      <Box className="w-3 h-3 text-purple-400" />
                      Dimensions / Radius
                    </div>
                    <div className="text-white font-mono font-semibold mt-0.5">
                      {(robot.lengthM ?? 0.92).toFixed(2)}×
                      {(robot.widthM ?? 0.64).toFixed(2)}m (r=
                      {(robot.collisionRadiusM ?? 0.68).toFixed(2)}m)
                    </div>
                  </div>
                </div>

                {/* Sensor Suite Pill */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 mb-4">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span className="flex items-center gap-1">
                      <Radar className="w-3 h-3 text-cyan-400" />
                      Perception Sensor Suite
                    </span>
                    <span className="font-mono text-cyan-300">
                      {robot.lidarRangeM ?? 28}m LiDAR ({robot.lidarFovDeg ?? 360}°)
                    </span>
                  </div>
                  <div className="text-xs text-slate-200 font-medium">
                    {robot.sensorSuite}
                  </div>
                </div>
              </div>

              {/* Card Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectForSimulation(robot, false);
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                  }`}
                >
                  {isSelected ? 'Selected for Simulation' : 'Select Robot'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectForSimulation(robot, true);
                  }}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-all cursor-pointer"
                  title="Select & launch in Simulation Lab"
                >
                  Run in Sim
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDuplicateModal(robot);
                  }}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                  title="Duplicate as Custom Robot"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {robot.isCustom && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(robot);
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-all cursor-pointer"
                      title="Edit Custom Robot"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDeleteId === robot.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 bg-rose-950/80 border border-rose-500/50 rounded-lg px-2 py-1"
                      >
                        <button
                          onClick={() => {
                            deleteRobotProfile(robot.id);
                            setConfirmDeleteId(null);
                            setInspectedRobotId(robots[0].id);
                          }}
                          className="text-[11px] font-semibold text-rose-300 hover:text-white px-1.5 cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-slate-400 hover:text-white px-1 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(robot.id);
                        }}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-rose-400 border border-slate-700 transition-all cursor-pointer"
                        title="Delete Custom Robot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed Hardware Blueprint & Kinematic Inspector */}
      {inspectedRobot && (
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-5 border-b border-slate-800/80">
            <div>
              <div className="text-xs font-mono uppercase text-cyan-400 flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5" />
                <span>Hardware Blueprint & Simulation Impact Inspector</span>
              </div>
              <h2 className="text-xl font-bold text-white mt-1">
                {inspectedRobot.name} — {inspectedRobot.model}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Intended Application:{' '}
                <span className="text-slate-200 font-medium">
                  {inspectedRobot.intendedApplication ??
                    'Autonomous Campus Delivery & Indoor Multi-Floor Logistics'}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => handleSelectForSimulation(inspectedRobot, true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Simulate with {inspectedRobot.name}
              </button>
              {onNavigate && (
                <button
                  onClick={() => onNavigate('policy-benchmarking')}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-all cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  Compare Across Robots
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
            {/* Left: Interactive Top-Down Chassis & Sensor Footprint Diagram */}
            <div className="lg:col-span-5 bg-slate-950/90 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-between">
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-mono uppercase text-[11px] text-slate-300">
                  Top-Down Footprint & LiDAR Envelope
                </span>
                <span className="font-mono text-cyan-400">
                  r = {(inspectedRobot.collisionRadiusM ?? 0.68).toFixed(2)}m
                </span>
              </div>

              <svg
                viewBox="-140 -140 280 280"
                className="w-full max-w-[290px] h-[250px]"
              >
                {/* Grid rings */}
                <circle
                  cx="0"
                  cy="0"
                  r="118"
                  fill="none"
                  stroke="#1e293b"
                  strokeDasharray="4 4"
                />
                <circle
                  cx="0"
                  cy="0"
                  r="82"
                  fill="none"
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                />
                {/* LiDAR Perception Cone */}
                <circle
                  cx="0"
                  cy="0"
                  r={Math.min(122, (inspectedRobot.lidarRangeM ?? 28) * 3.2)}
                  fill={inspectedRobot.accentColor || '#06b6d4'}
                  fillOpacity="0.09"
                  stroke={inspectedRobot.accentColor || '#06b6d4'}
                  strokeOpacity="0.35"
                  strokeWidth="1.5"
                />
                {/* Swept Collision Footprint Circle */}
                <circle
                  cx="0"
                  cy="0"
                  r={(inspectedRobot.collisionRadiusM ?? 0.68) * 72}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                />
                {/* Robot Wheels */}
                {(() => {
                  const wPx = (inspectedRobot.widthM ?? 0.64) * 70;
                  const lPx = (inspectedRobot.lengthM ?? 0.92) * 70;
                  const isSix =
                    inspectedRobot.wheelConfiguration ===
                      '6-Wheel Heavy Differential' ||
                    inspectedRobot.category === 'heavy-logistics';
                  const yOffsets = isSix
                    ? [-lPx * 0.34, 0, lPx * 0.34]
                    : [-lPx * 0.34, lPx * 0.34];
                  return (
                    <>
                      {yOffsets.map((yOff, idx) => (
                        <g key={idx}>
                          <rect
                            x={-wPx / 2 - 7}
                            y={yOff - 10}
                            width="7"
                            height="20"
                            rx="2"
                            fill="#334155"
                          />
                          <rect
                            x={wPx / 2}
                            y={yOff - 10}
                            width="7"
                            height="20"
                            rx="2"
                            fill="#334155"
                          />
                        </g>
                      ))}
                      {/* Chassis Body */}
                      <rect
                        x={-wPx / 2}
                        y={-lPx / 2}
                        width={wPx}
                        height={lPx}
                        rx="8"
                        fill={inspectedRobot.chassisColor || '#e2e8f0'}
                        stroke={inspectedRobot.accentColor || '#06b6d4'}
                        strokeWidth="3"
                      />
                      {/* Front Visor */}
                      <rect
                        x={-wPx * 0.36}
                        y={-lPx / 2 + 4}
                        width={wPx * 0.72}
                        height="7"
                        rx="2"
                        fill="#020617"
                      />
                      {/* LiDAR Turret */}
                      <circle
                        cx="0"
                        cy={-lPx * 0.15}
                        r="11"
                        fill="#0f172a"
                        stroke={inspectedRobot.accentColor || '#06b6d4'}
                        strokeWidth="2"
                      />
                      {isSix && (
                        <circle
                          cx="0"
                          cy={lPx * 0.22}
                          r="8"
                          fill="#0f172a"
                          stroke="#10b981"
                          strokeWidth="1.5"
                        />
                      )}
                    </>
                  );
                })()}
              </svg>

              <div className="w-full grid grid-cols-3 gap-2 text-center text-[11px] pt-2 border-t border-slate-800/80">
                <div>
                  <span className="text-slate-400 block">Wheel Layout</span>
                  <span className="text-slate-200 font-semibold">
                    {inspectedRobot.wheelConfiguration ?? 'Quad-Wheel'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Curb Weight</span>
                  <span className="text-slate-200 font-mono font-semibold">
                    {inspectedRobot.weightKg ?? 38} kg
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Turn Radius</span>
                  <span className="text-slate-200 font-mono font-semibold">
                    {(inspectedRobot.turningRadiusM ?? 0.55).toFixed(2)} m
                  </span>
                </div>
              </div>
            </div>

            {/* Right: 4 Structured Specification Groups */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                <div className="font-semibold text-cyan-300 flex items-center gap-2">
                  <Box className="w-4 h-4" />
                  <span>Physical Dimensions & Footprint</span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Length × Width × Height:</span>
                    <span className="font-mono text-white">
                      {(inspectedRobot.lengthM ?? 0.92).toFixed(2)}m ×{' '}
                      {(inspectedRobot.widthM ?? 0.64).toFixed(2)}m ×{' '}
                      {(inspectedRobot.heightM ?? 0.72).toFixed(2)}m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Collision Radius:</span>
                    <span className="font-mono text-emerald-300">
                      {(inspectedRobot.collisionRadiusM ?? 0.68).toFixed(2)} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Chassis Mass:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.weightKg ?? 38} kg
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Elevator Compatibility:</span>
                    <span className="font-mono text-cyan-300">
                      {(inspectedRobot.widthM ?? 0.64) <= 1.25
                        ? 'Cleared for Campus Lifts'
                        : 'Wide Load Caution'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                <div className="font-semibold text-emerald-300 flex items-center gap-2">
                  <Gauge className="w-4 h-4" />
                  <span>Mobility & Kinematic Dynamics</span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Maximum Cruise Speed:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.maxSpeedMps.toFixed(1)} m/s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Acceleration:</span>
                    <span className="font-mono text-white">
                      {(inspectedRobot.accelerationMps2 ?? 1.85).toFixed(2)} m/s²
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nominal / Emergency Brake:</span>
                    <span className="font-mono text-white">
                      {(inspectedRobot.decelerationMps2 ?? 2.4).toFixed(1)} /{' '}
                      {(inspectedRobot.emergencyBrakingMps2 ?? 5.2).toFixed(1)} m/s²
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Turning Radius / Max Slope:</span>
                    <span className="font-mono text-white">
                      {(inspectedRobot.turningRadiusM ?? 0.55).toFixed(2)}m ·{' '}
                      {inspectedRobot.maxSlopeDeg ?? 14}°
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                <div className="font-semibold text-amber-300 flex items-center gap-2">
                  <BatteryCharging className="w-4 h-4" />
                  <span>Payload & Energy Architecture</span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Payload Capacity:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.payloadCapacityKg} kg
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Default Mission Payload:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.defaultPayloadKg ??
                        Math.round(inspectedRobot.payloadCapacityKg * 0.4)}{' '}
                      kg
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Battery Pack Capacity:</span>
                    <span className="font-mono text-amber-300">
                      {inspectedRobot.batteryCapacityWh} Wh
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Base Power Draw / Reserve:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.basePowerDrawW ?? 110} W ·{' '}
                      {inspectedRobot.lowBatteryThresholdPct ?? 20}% reserve
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
                <div className="font-semibold text-purple-300 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  <span>Sensors & Perception Suite</span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Primary LiDAR:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.lidarRangeM ?? 28}m ({inspectedRobot.lidarFovDeg ?? 360}°)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Camera System:</span>
                    <span className="font-mono text-white truncate max-w-[175px]">
                      {inspectedRobot.cameraType ?? 'Stereo RGB-D'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">All-Weather Fusion:</span>
                    <span className="font-mono text-emerald-300">
                      {[
                        inspectedRobot.hasRadar ? 'Radar' : null,
                        inspectedRobot.hasThermalCamera ? 'Thermal' : null,
                        inspectedRobot.hasImuFusion !== false ? 'IMU' : null,
                      ]
                        .filter(Boolean)
                        .join(' + ') || 'Standard Optical'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Update Rate / Base Noise:</span>
                    <span className="font-mono text-white">
                      {inspectedRobot.sensorUpdateHz ?? 30} Hz · ±
                      {(inspectedRobot.baseSensorNoiseStdM ?? 0.03).toFixed(3)}m
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Robot Modal */}
      {showEditorModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {editingRobotId
                    ? `Edit Custom Robot — ${formState.name}`
                    : 'Create Custom Robot Hardware Profile'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  All physical parameters directly drive the 3D robot geometry, swept collision footprint, acceleration/braking, and LiDAR perception range.
                </p>
              </div>
              <button
                onClick={() => setShowEditorModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {validationError && (
              <div className="mt-4 bg-rose-500/10 border border-rose-500/40 rounded-xl p-3 flex items-center gap-2 text-xs text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCustomRobot} className="space-y-5 mt-4 text-xs">
              {/* Identity */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Robot Name *</label>
                  <input
                    type="text"
                    value={formState.name}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, name: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Model Designation</label>
                  <input
                    type="text"
                    value={formState.model}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, model: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Wheel Configuration</label>
                  <select
                    value={formState.wheelConfiguration}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        wheelConfiguration: e.target.value as WheelConfigurationType,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="Quad-Wheel Skid/Ackermann">
                      Quad-Wheel Skid/Ackermann
                    </option>
                    <option value="6-Wheel Heavy Differential">
                      6-Wheel Heavy Differential
                    </option>
                    <option value="Compact 4-Wheel Omni/Express">
                      Compact 4-Wheel Omni/Express
                    </option>
                  </select>
                </div>
              </div>

              {/* Dimensions & Mobility */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Length (m)</label>
                  <input
                    type="number"
                    step="0.02"
                    min="0.4"
                    max="2.0"
                    value={formState.lengthM}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        lengthM: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Width (m)</label>
                  <input
                    type="number"
                    step="0.02"
                    min="0.35"
                    max="1.4"
                    value={formState.widthM}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        widthM: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Height (m)</label>
                  <input
                    type="number"
                    step="0.02"
                    min="0.35"
                    max="1.5"
                    value={formState.heightM}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        heightM: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Weight (kg)</label>
                  <input
                    type="number"
                    step="1"
                    min="10"
                    max="150"
                    value={formState.weightKg}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        weightKg: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              {/* Speed, Accel, Payload, Battery */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Max Speed (m/s)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.8"
                    max="6.0"
                    value={formState.maxSpeedMps}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        maxSpeedMps: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Accel (m/s²)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="5.0"
                    value={formState.accelerationMps2}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        accelerationMps2: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Payload Cap (kg)</label>
                  <input
                    type="number"
                    step="1"
                    min="2"
                    max="100"
                    value={formState.payloadCapacityKg}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        payloadCapacityKg: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Battery (Wh)</label>
                  <input
                    type="number"
                    step="20"
                    min="200"
                    max="2400"
                    value={formState.batteryCapacityWh}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        batteryCapacityWh: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              {/* Sensors & Colors */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">LiDAR Range (m)</label>
                  <input
                    type="number"
                    step="1"
                    min="10"
                    max="55"
                    value={formState.lidarRangeM}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        lidarRangeM: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Turning Radius (m)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.25"
                    max="1.5"
                    value={formState.turningRadiusM}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        turningRadiusM: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Accent Color</label>
                  <input
                    type="color"
                    value={formState.accentColor}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, accentColor: e.target.value }))
                    }
                    className="w-full h-9 bg-slate-950 border border-slate-700 rounded-lg px-1.5 py-1 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Default Policy</label>
                  <select
                    value={formState.assignedPolicyId}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        assignedPolicyId: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
                  >
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.hasRadar}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, hasRadar: e.target.checked }))
                    }
                  />
                  <span>Include mmWave Radar (Low-Visibility Resilience)</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.hasThermalCamera}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        hasThermalCamera: e.target.checked,
                      }))
                    }
                  />
                  <span>Include LWIR Thermal Camera</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Save & Select Robot Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
