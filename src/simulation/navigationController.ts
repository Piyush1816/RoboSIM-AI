import {
  CAMPUS_ELEVATORS,
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
  formatRobotHardwareSummary,
  ROBOT_UNITS,
} from '../data/campusConfig';
import { loadRobots } from '../storage/experimentStorage';
import {
  AvoidanceHierarchyLevel,
  CampusElevatorConfig,
  CandidatePolicyState,
  CustomStartPosition,
  DeliveryLocation,
  ElevatorFaultMode,
  ElevatorMachineState,
  ElevatorState,
  ElevatorUnitStatus,
  EnvironmentDefinition,
  FailureType,
  LiveTelemetry,
  NavigationPolicyConfig,
  PedestrianDistributionConfig,
  PredictedConflictPoint,
  PredictionHorizonSec,
  QLearningAction,
  QLearningObservation,
  RobotOperationalState,
  RobotUnitConfig,
  ScenarioConfig,
   SimulationLogEntry,
  SimulationRunState,
  StartPositionValidationResult,
  TrajectoryPointSample,
  Vector2D,
} from '../types/simulation';
import {
  buildIndoorElevatorRouteWaypoints,
  buildNavigationGrid,
  calculatePathDistance,
  checkSweptRobotCollision,
  CollisionCircle,
  computeAStarPathWithDiagnostics,
  computeLocalBypassWaypoints,
  computePerceptionProfile,
  createScenarioPedestrianAgents,
  derivePedestrianDistribution,
  evaluateActivePathPedestrianHazard,
  evaluatePredictiveConflicts,
  GridNode,
  PathfindingDiagnosticsResult,
  PedestrianSimAgent,
  PerceptionProfile,
  PredictedGridPenaltyZone,
  ROBOT_COLLISION_RADIUS,
  setActiveRuntimeEnvironment,
  setActiveScenarioCustomObstacles,
  stepDynamicPedestrians,
  worldToGridCoords,
} from './pathfinding';
import {
  computeStepReward,
  computeTerminalEpisodeReward,
  encodeObservationToStateKey,
  QL_ACTION_LABELS,
  selectQLearningAction,
  updateQTableStep,
} from './policyLearner';
import { createSeededRng } from './scenarioFactory';

export interface SimulationCompletionData {
  runSessionId: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  scenarioId: string;
  scenarioName: string;
  scenarioSeed?: number;
  robotId: string;
  robotName: string;
  robotConfigSnapshot?: RobotUnitConfig;
  policyId: string;
  policyName: string;
  policyVersion?: string;
  isCandidatePolicy?: boolean;
  originName: string;
  destinationName: string;
  originFloor?: number;
  destinationFloor?: number;
  originCoordinates?: { x: number; z: number; y?: number; floor?: number; headingRad?: number };
  destinationCoordinates?: { x: number; z: number; y?: number; floor?: number };
  robotHardwareSummary?: string;
  payloadKg?: number;
  status: 'Success' | 'Failed';
  durationSec: number;
  distanceMeters: number;
  collisions: number;
  replanCount: number;
  unnecessaryReplanCount: number;
  deadlockCount: number;
  safetyInterventionCount?: number;
  episodeReward: number;
  qTableUpdatesCount?: number;
  trajectorySamples?: TrajectoryPointSample[];
  decisionHistory: string[];
  robotStateBeforeCompletion: string;
  environmentalConditionsSummary: string;
  episodeActionCounts: Record<QLearningAction, number>;
  pedestrianDetectionsCount: number;
  predictedEncountersCount: number;
  avoidedEncountersCount: number;
  unnecessaryStopsCount: number;
  predictionAccuracyPct: number;
  pedestrianReplanCount: number;
  speedReductionEventsCount: number;
  reducedSpeedTimeSec: number;
  pedestrianWaitingTimeSec: number;
  speedBasedAvoidanceCount: number;
  localBypassCount: number;
  globalReplanCount: number;
  pedestrianDistribution?: PedestrianDistributionConfig;
  predictionHorizonSec?: PredictionHorizonSec;
  totalWaitingTimeSec: number;
  elevatorWaitTimeSec: number;
  elevatorUsed?: boolean;
  elevatorStateEncountered?: ElevatorState;
  elevatorFaultMode?: ElevatorFaultMode;
  elevatorReroutedToBackup?: boolean;
  elevatorAssistanceRequested?: boolean;
  elevatorEventsLog?: string[];
  batteryConsumedPct: number;
  failureType?: FailureType;
  obstacleType?: string;
  failureReason?: string;
  failureCoordinates?: { x: number; z: number };
  rootCause?: string;
  mitigationSuggested?: string;
}

export interface PathUpdateEvent {
  waypoints: Vector2D[];
  diagnostics: PathfindingDiagnosticsResult;
  replanCount: number;
}

export interface NavigationControllerCallbacks {
  onPathUpdated?: (event: PathUpdateEvent | null) => void;
  onStatusChanged?: (opState: RobotOperationalState, statusText: string) => void;
  onLogEvent?: (level: SimulationLogEntry['level'], message: string) => void;
  onComplete?: (payload: SimulationCompletionData) => void;
}

interface PendingPredictionSample {
  pedId: string;
  targetTimeSec: number;
  predictedPos: Vector2D;
  toleranceM: number;
}

export type ElevatorMissionPhase =
  | 'not-required'
  | 'approaching-building-entrance'
  | 'calling-elevator-to-origin'
  | 'waiting-in-lobby'
  | 'doors-opening-ground'
  | 'boarding-cabin'
  | 'doors-closing-ground'
  | 'in-elevator-transit'
  | 'doors-opening-upper'
  | 'exiting-to-destination'
  | 'failed-in-elevator';

/**
 * Core Autonomous Navigation, 5-Level Hierarchical Pedestrian Avoidance,
 * Intelligent Speed Regulation, Local Bypass, Global A* Replanning,
 * and Multi-Floor Indoor Building Elevator Engine.
 */
export class AutonomousNavigationController {
  public runState: SimulationRunState = 'idle';
  public activeRunSessionId = '';
  public completionEmittedForSession = false;

  public currentEnvironment: EnvironmentDefinition | null = null;
  public currentScenario: ScenarioConfig;
  public currentPolicy: NavigationPolicyConfig;
  public currentRobotId: string;
  public originOverrideId: string | null = null;
  public destinationOverrideId: string | null = null;
  public customStartPosition: CustomStartPosition | null = null;
  public initialStartCoords: {
    x: number;
    z: number;
    y: number;
    floor: number;
    headingRad: number;
  } = { x: -15, z: -20, y: 0, floor: 0, headingRad: 0 };

  /**
   * Optional flag to run pre-Part-1 legacy eager-replanning behavior for
   * reproducible before-vs-after validation benchmarks on identical seeds.
   */
  public useLegacyAvoidance = false;

  public predictionHorizonSec: PredictionHorizonSec = 2;
  public pedestrianDistributionOverride: PedestrianDistributionConfig | null = null;
  public elevatorFaultModeOverride: ElevatorFaultMode | null = null;

  public perceptionProfile: PerceptionProfile = computePerceptionProfile(0.05);
  public perceivedConstructionZoneIds = new Set<string>();
  public perceivedObstaclesCount = 0;
  public totalEnvironmentalObstaclesCount = 0;
  public perceivedNearestDist: number | null = null;

  public cachedStaticGrid: GridNode[][] = [];
  public pathDiagnostics: PathfindingDiagnosticsResult = {
    path: [],
    reachable: true,
    detourActive: false,
    blockedZonesOnDirectPath: [],
    failureReason: null,
  };
  public waypoints: Vector2D[] = [];
  public currentWaypointIdx = 0;

  public robotPos: Vector2D = { x: -15, z: -20, y: 0, floor: 0 };
  public robotAltitudeY = 0;
  public currentFloor = 0; // 0 = Ground Floor (G), 1 = First Floor (1F), 2 = Second Floor (2F)
  public originFloor = 0;
  public targetFloor = 0;
  public isRobotIndoor = false;
  public robotHeading = 0;
  public currentSpeedMps = 0;
  public targetSpeedMps = 0;
  public batteryPct = 98.0;
  public initialBatteryPct = 98.0;
  public distanceTraveledM = 0;
  public distanceRemainingM = 0;
  public elapsedTimeSec = 0;
  public collisionsCount = 0;
  public replanCount = 0;
  public safetyInterventionCount = 0;
  public pedestrianDetectionsCount = 0;
  public totalWaitingTimeSec = 0;

  // Part 1: 5-Level Hierarchical Avoidance & Speed Regulation Telemetry
  public activeAvoidanceLevel: AvoidanceHierarchyLevel = 'Level 1: Maintain Path';
  public speedReductionEventsCount = 0;
  public reducedSpeedTimeSec = 0;
  public pedestrianWaitingTimeSec = 0;
  public speedBasedAvoidanceCount = 0;
  public localBypassCount = 0;
  public globalReplanCount = 0;
  public closestApproachDistanceM: number | null = null;
  public estimatedTtcSec: number | null = null;
  private inSpeedReductionEpisode = false;
  private inSafetyInterventionEpisode = false;
  private safetyInterventionCooldownSec = 0;
  private activeConflictHadStopOrReplan = false;
  private activeConflictPedId: string | null = null;
  private localBypassCooldownSec = 0;

  // Predictive Avoidance Metrics
  public predictedEncountersCount = 0;
  public avoidedEncountersCount = 0;
  public unnecessaryStopsCount = 0;
  public pedestrianReplanCount = 0;
  public predictionAccuracyPct = 94.0;
  public activePredictedConflicts: PredictedConflictPoint[] = [];
  private recordedConflictKeys = new Set<string>();
  private recordedAvoidedKeys = new Set<string>();
  private pendingPredictionSamples: PendingPredictionSample[] = [];
  private verifiedPredictionsTotal = 0;
  private verifiedPredictionsAccurate = 0;
  private lastPredictionSampleTimeSec = 0;
  private stopStartedWithoutClosePed = false;

  // Part 2: Multi-Floor Indoor Building & Elevator Simulation State
  public requiresElevator = false;
  public elevatorFaultMode: ElevatorFaultMode = 'none';
  public elevatorTimeoutSec = 3.2;
  public elevatorUnits: ElevatorUnitStatus[] = [];
  public activeElevatorId: string | null = null;
  public elevatorMissionPhase: ElevatorMissionPhase = 'not-required';
  public elevatorPhaseTimerSec = 0;
  public elevatorCallStartFloor = 0;
  public elevatorTransitStartFloor = 0;
  public elevatorWaitTimeSec = 0;
  public elevatorReroutedToBackup = false;
  public elevatorStateEncountered: ElevatorState = 'Available';
  public elevatorEventsLog: string[] = [];

  public robotOpState: RobotOperationalState = 'Standby';
  public navStatusText = 'Awaiting dispatch command';

  public pedestrianAgents: PedestrianSimAgent[] = [];
  public pedestrianYieldTimerSec = 0;
  public replanCooldownSec = 0;
  public deadlockWaitTimerSec = 0;
  public deadlockRetryCount = 0;
  public maxDeadlockRetries = 6;
  public maxDeadlockWaitSec = 5.5;

  public nearestObstacleDist: number | null = null;
  public nearestObstacleLabel: string | null = null;

  // Section 7: Candidate Tabular Q-Learning Policy & Episode Diagnostics
  public candidatePolicyState: CandidatePolicyState | null = null;
  public isTrainingEpisode = false;
  public unnecessaryReplanCount = 0;
  public deadlockCount = 0;
  public episodeReward = 0;
  public qTableUpdatesCount = 0;
  public consecutiveStopsCount = 0;
  public consecutiveReplansCount = 0;
  public trajectorySamples: TrajectoryPointSample[] = [];
  private lastTrajectorySampleTimeSec = -1;
  public decisionHistory: string[] = [];
  public episodeActionCounts: Record<QLearningAction, number> = {
    MAINTAIN_SPEED: 0,
    REDUCE_SPEED: 0,
    STOP_TEMPORARILY: 0,
    LOCAL_AVOIDANCE: 0,
    GLOBAL_REPLAN: 0,
  };
  private rlDecisionTimerSec = 0;
  private lastRlStateKey: string | null = null;
  private lastRlAction: QLearningAction | null = null;
  private lastRlObs: QLearningObservation | null = null;
  private lastRlRobotPos: Vector2D = { x: 0, z: 0 };
  private episodeTrajectoryTrace: { stateKey: string; action: QLearningAction }[] = [];
  private episodeRng: () => number = Math.random;

  private callbacks: NavigationControllerCallbacks;

  constructor(
    scenario: ScenarioConfig,
    policy: NavigationPolicyConfig,
    robotId: string,
    callbacks: NavigationControllerCallbacks = {},
    environment: EnvironmentDefinition | null = null
  ) {
    this.currentScenario = scenario;
    this.currentPolicy = policy;
    this.currentRobotId = robotId;
    this.callbacks = callbacks;
    this.currentEnvironment = environment;
    this.reset(false, false);
  }

  public setCallbacks(callbacks: NavigationControllerCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCandidatePolicyState(
    state: CandidatePolicyState | null,
    isTraining = false
  ): void {
    this.candidatePolicyState = state;
    this.isTrainingEpisode = isTraining;
  }

  public setPredictionHorizon(horizonSec: PredictionHorizonSec): void {
    this.predictionHorizonSec = horizonSec;
    this.currentScenario = {
      ...this.currentScenario,
      predictionHorizonSec: horizonSec,
    };
  }

  public setPedestrianDistribution(dist: PedestrianDistributionConfig): void {
    this.pedestrianDistributionOverride = dist;
    const total =
      dist.commuterCount + dist.randomCount + dist.crossingCount + dist.groupCount;
    this.currentScenario = {
      ...this.currentScenario,
      dynamicObstacleCount: total,
      pedestrianDistribution: dist,
    };
    this.reset(false);
  }

  public setElevatorFaultMode(
    faultMode: ElevatorFaultMode,
    requiresElevator?: boolean
  ): void {
    this.elevatorFaultModeOverride = faultMode;
    const targetLoc = this.getTargetLocation();
    const originLoc = this.getOriginLocation();
    const oFloor = originLoc.floor ?? this.currentScenario.originFloor ?? 0;
    const tFloor =
      this.destinationOverrideId !== null
        ? targetLoc.floor ?? 0
        : targetLoc.floor !== undefined && targetLoc.floor > 0
        ? targetLoc.floor
        : this.currentScenario.destinationFloor ??
          (requiresElevator ?? this.currentScenario.requiresElevator ? 2 : 0);

    this.currentScenario = {
      ...this.currentScenario,
      requiresElevator: oFloor !== tFloor,
      elevatorFaultMode: faultMode,
    };
    this.reset(false);
  }

  public getPathUpdateEvent(): PathUpdateEvent {
    return {
      waypoints: this.waypoints,
      diagnostics: this.pathDiagnostics,
      replanCount: this.replanCount,
    };
  }

  private emitPathUpdate(): void {
    this.callbacks.onPathUpdated?.(this.getPathUpdateEvent());
  }

  public getCurrentRobot(): RobotUnitConfig {
    if (this.customRobotOverride && this.customRobotOverride.id === this.currentRobotId) {
      return this.customRobotOverride;
    }
    const allRobots = loadRobots();
    return (
      allRobots.find((r) => r.id === this.currentRobotId) ??
      ROBOT_UNITS.find((r) => r.id === this.currentRobotId) ??
      ROBOT_UNITS[0]
    );
  }

  public customRobotOverride: RobotUnitConfig | null = null;
  public activePayloadKg: number | null = null;

  public setRobotHardwareConfig(robot: RobotUnitConfig): void {
    this.customRobotOverride = robot;
    this.currentRobotId = robot.id;
    this.perceptionProfile = computePerceptionProfile(
      this.currentScenario.sensorNoiseLevel,
      robot
    );
  }

  public setPayloadKg(payloadKg: number | null): void {
    this.activePayloadKg = payloadKg;
  }

  public setEnvironment(env: EnvironmentDefinition | null): void {
    this.currentEnvironment = env;
    setActiveRuntimeEnvironment(env);
  }

  public getActiveLocations(): DeliveryLocation[] {
    if (
      this.currentEnvironment &&
      Array.isArray(this.currentEnvironment.locations) &&
      this.currentEnvironment.locations.length > 0
    ) {
      return this.currentEnvironment.locations;
    }
    return DELIVERY_LOCATIONS;
  }

  public getActiveElevators(): CampusElevatorConfig[] {
    if (
      this.currentEnvironment &&
      this.currentEnvironment.id !== 'env-campus-main'
    ) {
      return this.currentEnvironment.elevators ?? [];
    }
    return CAMPUS_ELEVATORS;
  }

  public getOriginLocation(): DeliveryLocation {
    if (this.customStartPosition) {
      const cPos = this.customStartPosition;
      const cFloor = cPos.floor ?? 0;
      const elevs = this.getActiveElevators();
      let matchedElev: CampusElevatorConfig | undefined;
      for (const e of elevs) {
        const inCorridor =
          Math.abs(cPos.x - e.cabinPos.x) <= 9.5 &&
          cPos.z >= e.cabinPos.z - 2.4 &&
          cPos.z <= e.outdoorApproachPos.z + 1.8;
        if (inCorridor || cFloor > 0) {
          matchedElev = e;
          if (inCorridor) break;
        }
      }
      const floorCode = cFloor === 0 ? 'G' : `${cFloor}F`;
      return {
        id: 'custom-start-pos',
        name:
          cPos.label ||
          `Custom Start (${cPos.x.toFixed(1)}, ${cPos.z.toFixed(1)}, ${floorCode})`,
        code: `CUST-${floorCode}`,
        buildingId: matchedElev?.buildingId || 'outdoor-custom',
        position: [cPos.x, Number((cFloor * 3.6).toFixed(2)), cPos.z],
        type: 'delivery',
        priority: 'Standard',
        floor: cFloor,
        isIndoor: Boolean(cFloor > 0 || matchedElev),
        elevatorId: matchedElev?.id,
      };
    }
    const locs = this.getActiveLocations();
    const origId = this.originOverrideId || this.currentScenario.originId;
    return (
      locs.find((l) => l.id === origId) ??
      locs.find((l) => l.type === 'charging') ??
      locs[0] ??
      DELIVERY_LOCATIONS[1]
    );
  }

  public getTargetLocation(): DeliveryLocation {
    const locs = this.getActiveLocations();
    const destId = this.destinationOverrideId || this.currentScenario.destinationId;
    const origin = this.getOriginLocation();
    return (
      locs.find((l) => l.id === destId) ??
      locs.find((l) => l.id !== origin.id && l.type === 'delivery') ??
      locs[locs.length - 1] ??
      DELIVERY_LOCATIONS[5]
    );
  }

  public getActiveElevatorUnit(): ElevatorUnitStatus | null {
    if (!this.activeElevatorId) return null;
    return (
      this.elevatorUnits.find((e) => e.id === this.activeElevatorId) ?? null
    );
  }

  public getActiveElevatorConfig(): CampusElevatorConfig | null {
    if (!this.activeElevatorId) return null;
    const elevs = this.getActiveElevators();
    return elevs.find((e) => e.id === this.activeElevatorId) ?? null;
  }

  public getFloorLabel(floorNum: number): string {
    const rounded = Math.round(floorNum);
    if (Math.abs(floorNum - rounded) > 0.15) {
      return `Between F${Math.floor(floorNum)} & F${Math.ceil(floorNum)}`;
    }
    if (rounded <= 0) return 'Ground Floor (G)';
    if (rounded === 1) return 'First Floor (1F)';
    return 'Second Floor (2F)';
  }

  public getTargetDestinationRoomCoords(elevCfg: CampusElevatorConfig): Vector2D {
    const targetLoc = this.getTargetLocation();
    const fh = elevCfg.floorHeightM;
    const destY = Number((this.targetFloor * fh).toFixed(2));
    if (
      targetLoc.isIndoor &&
      targetLoc.buildingId === elevCfg.buildingId &&
      (targetLoc.floor ?? 0) === this.targetFloor
    ) {
      return {
        x: targetLoc.position[0],
        z: targetLoc.position[2],
        y: destY,
        floor: this.targetFloor,
      };
    }
    if (this.targetFloor === 1 && elevCfg.firstFloorRoomPos) {
      return { ...elevCfg.firstFloorRoomPos, y: destY, floor: 1 };
    }
    if (this.targetFloor === 0) {
      return {
        x: targetLoc.position[0],
        z: targetLoc.position[2],
        y: 0,
        floor: 0,
      };
    }
    return { ...elevCfg.destinationRoomPos, y: destY, floor: this.targetFloor };
  }

  public getTargetDestinationRoomName(elevCfg: CampusElevatorConfig | null): string {
    const targetLoc = this.getTargetLocation();
    if (targetLoc.isIndoor && (targetLoc.floor ?? 0) === this.targetFloor) {
      return targetLoc.name;
    }
    if (this.targetFloor === 0) {
      return targetLoc.name;
    }
    if (elevCfg) {
      if (this.targetFloor === 1 && elevCfg.firstFloorRoomName) {
        return `${elevCfg.firstFloorRoomName} (${elevCfg.buildingName})`;
      }
      return `${elevCfg.destinationRoomName} (${elevCfg.buildingName})`;
    }
    return targetLoc.name;
  }

  public setConfiguration(
    scenario: ScenarioConfig,
    policy: NavigationPolicyConfig,
    robotId: string,
    destinationOverrideId: string | null = null,
    originOverrideId: string | null = null,
    environment?: EnvironmentDefinition | null,
    customStartPosition?: CustomStartPosition | null
  ): void {
    if (environment !== undefined) {
      this.setEnvironment(environment);
    }
    this.currentScenario = scenario;
    this.currentPolicy = policy;
    this.currentRobotId = robotId;
    this.originOverrideId = originOverrideId;
    this.destinationOverrideId = destinationOverrideId;
    if (customStartPosition !== undefined) {
      this.customStartPosition = customStartPosition;
    } else if (originOverrideId !== null) {
      this.customStartPosition = null;
    }
    this.pedestrianDistributionOverride = null;
    this.elevatorFaultModeOverride = null;
    this.reset(false);
  }

  /**
   * Updates only the active navigation policy and/or candidate Q-table without resetting
   * the robot's physical transform or clearing a completed/failed/paused simulation state.
   */
  public updatePolicyOnly(
    policy: NavigationPolicyConfig,
    candidateState?: CandidatePolicyState | null
  ): void {
    this.currentPolicy = policy;
    if (candidateState !== undefined) {
      this.candidatePolicyState = candidateState;
    }
  }

  /**
   * Validates whether a candidate (x, z, floor) starting position is in a walkable area,
   * respects the active robot's collision footprint against buildings/barriers/props,
   * and has a valid collision-free A* route to the active destination.
   */
  public validateStartPosition(
    candidateX: number,
    candidateZ: number,
    candidateFloor = 0
  ): StartPositionValidationResult {
    setActiveRuntimeEnvironment(this.currentEnvironment);
    setActiveScenarioCustomObstacles(this.currentScenario.customObstacles);
    const floorY = Number((candidateFloor * 3.6).toFixed(2));
    const basePos = {
      x: Number(candidateX.toFixed(2)),
      z: Number(candidateZ.toFixed(2)),
      y: floorY,
      floor: candidateFloor,
    };

    const envWidth = this.currentEnvironment?.widthM ?? 80;
    const envDepth = this.currentEnvironment?.depthM ?? 80;
    const halfW = Math.min(37, envWidth / 2 - 1.5);
    const halfD = Math.min(37, envDepth / 2 - 1.5);

    if (Math.abs(candidateX) > halfW || Math.abs(candidateZ) > halfD) {
      return {
        valid: false,
        reason: `Coordinates (${candidateX.toFixed(1)}, ${candidateZ.toFixed(
          1
        )}) are outside the navigable environment boundaries (±${halfW.toFixed(
          0
        )}m × ±${halfD.toFixed(0)}m).`,
        position: basePos,
        routeReachable: false,
        routeWaypointsCount: 0,
      };
    }

    const validFloors =
      this.currentEnvironment &&
      Array.isArray(this.currentEnvironment.floors) &&
      this.currentEnvironment.floors.length > 0
        ? this.currentEnvironment.floors.map((f) => f.floor)
        : [0, 1, 2];

    if (!validFloors.includes(candidateFloor)) {
      return {
        valid: false,
        reason: `Floor ${candidateFloor}F does not exist in ${
          this.currentEnvironment?.name ?? 'the current environment'
        }.`,
        position: basePos,
        routeReachable: false,
        routeWaypointsCount: 0,
      };
    }

    const bot = this.getCurrentRobot();
    const botRadius = bot.collisionRadiusM ?? ROBOT_COLLISION_RADIUS;
    const activeElevs = this.getActiveElevators();

    // Check if inside an elevator-equipped building corridor/room
    let matchedElev: CampusElevatorConfig | null = null;
    for (const elev of activeElevs) {
      const inGroundCorridor =
        Math.abs(candidateX - elev.cabinPos.x) <= 9.5 &&
        candidateZ >= elev.cabinPos.z - 2.4 &&
        candidateZ <= elev.outdoorApproachPos.z + 1.8;
      const dest = elev.destinationRoomPos;
      const minUpperX = Math.min(elev.cabinPos.x - 8.5, dest.x) - 2.2;
      const maxUpperX = Math.max(elev.cabinPos.x + 8.5, dest.x) + 2.2;
      const minUpperZ = Math.min(elev.cabinPos.z, elev.lobbyPos.z, dest.z) - 2.4;
      const maxUpperZ = Math.max(elev.cabinPos.z, elev.lobbyPos.z, dest.z) + 2.4;
      const inUpperCorridor =
        candidateX >= minUpperX &&
        candidateX <= maxUpperX &&
        candidateZ >= minUpperZ &&
        candidateZ <= maxUpperZ;

      if (
        (candidateFloor === 0 && inGroundCorridor) ||
        (candidateFloor > 0 && inUpperCorridor)
      ) {
        matchedElev = elev;
        break;
      }
    }

    if (candidateFloor > 0 && !matchedElev) {
      return {
        valid: false,
        reason: `Upper-floor position (${candidateX.toFixed(
          1
        )}, ${candidateZ.toFixed(
          1
        )}) on Floor ${candidateFloor}F is outside valid indoor building floor slabs and elevator corridors.`,
        position: basePos,
        routeReachable: false,
        routeWaypointsCount: 0,
      };
    }

    // Check physical collision footprint (buildings, walls, props, active construction barriers)
    const hit = checkSweptRobotCollision(
      basePos,
      basePos,
      botRadius,
      this.currentScenario.activeConstructionZones,
      [],
      matchedElev,
      true
    );

    if (hit && hit.collided) {
      return {
        valid: false,
        reason: `Invalid Starting Position (${candidateX.toFixed(
          1
        )}, ${candidateZ.toFixed(1)}): Overlaps ${hit.obstacleType} "${
          hit.obstacleName
        }" within ${bot.name} collision footprint (r=${botRadius.toFixed(2)}m).`,
        position: basePos,
        routeReachable: false,
        routeWaypointsCount: 0,
      };
    }

    // Check navigation grid walkability on Ground Floor (0F) when outdoors
    const grid =
      this.cachedStaticGrid.length > 0
        ? this.cachedStaticGrid
        : buildNavigationGrid(
            this.currentScenario.activeConstructionZones,
            this.currentPolicy.constructionAvoidanceWeight,
            []
          );
    const { gx, gz } = worldToGridCoords(candidateX, candidateZ);
    const cell = grid[gx]?.[gz];

    if (candidateFloor === 0 && !matchedElev) {
      if (!cell || !cell.walkable) {
        const blockDetail =
          cell?.obstacleName ||
          (cell?.blockReason === 'off-road'
            ? 'off-pathway grass/terrain (must be on a navigable pathway or corridor)'
            : cell?.blockReason || 'non-walkable cell');
        return {
          valid: false,
          reason: `Invalid Starting Position (${candidateX.toFixed(
            1
          )}, ${candidateZ.toFixed(1)}): Location is blocked by ${blockDetail}.`,
          position: basePos,
          routeReachable: false,
          routeWaypointsCount: 0,
        };
      }
    }

    // Verify a valid A* route exists to the active destination
    const targetLoc = this.getTargetLocation();
    const tFloor =
      this.destinationOverrideId !== null
        ? targetLoc.floor ?? 0
        : targetLoc.floor !== undefined && targetLoc.floor > 0
        ? targetLoc.floor
        : this.currentScenario.destinationFloor ??
          (this.currentScenario.requiresElevator ? 2 : targetLoc.floor ?? 0);

    let routeDiag: PathfindingDiagnosticsResult;
    if (candidateFloor !== tFloor && activeElevs.length > 0) {
      const targetElev =
        (targetLoc.elevatorId
          ? activeElevs.find((e) => e.id === targetLoc.elevatorId)
          : undefined) ??
        matchedElev ??
        activeElevs.find((e) => e.isPrimary) ??
        activeElevs[0];
      routeDiag = this.computeMultiFloorApproachRoute(basePos, targetElev, []);
    } else if (
      candidateFloor === tFloor &&
      (matchedElev || targetLoc.isIndoor) &&
      activeElevs.length > 0
    ) {
      const bldgElev =
        matchedElev ??
        activeElevs.find((e) => e.buildingId === targetLoc.buildingId) ??
        activeElevs[0];
      if (candidateFloor > 0 || (matchedElev && targetLoc.isIndoor)) {
        const wps = buildIndoorElevatorRouteWaypoints(
          bldgElev,
          'same-floor-indoor',
          candidateFloor,
          {
            x: targetLoc.position[0],
            z: targetLoc.position[2],
            y: floorY,
            floor: tFloor,
          },
          basePos
        );
        routeDiag = {
          path: wps,
          reachable: wps.length >= 2,
          detourActive: false,
          blockedZonesOnDirectPath: [],
          failureReason: wps.length >= 2 ? null : 'No indoor corridor path found.',
        };
      } else if (!matchedElev && targetLoc.isIndoor) {
        routeDiag = computeAStarPathWithDiagnostics(
          basePos,
          bldgElev.outdoorApproachPos,
          this.currentScenario.activeConstructionZones,
          this.currentPolicy.constructionAvoidanceWeight,
          []
        );
      } else {
        routeDiag = computeAStarPathWithDiagnostics(
          bldgElev.outdoorApproachPos,
          { x: targetLoc.position[0], z: targetLoc.position[2], y: 0, floor: 0 },
          this.currentScenario.activeConstructionZones,
          this.currentPolicy.constructionAvoidanceWeight,
          []
        );
      }
    } else {
      routeDiag = computeAStarPathWithDiagnostics(
        basePos,
        { x: targetLoc.position[0], z: targetLoc.position[2], y: 0, floor: 0 },
        this.currentScenario.activeConstructionZones,
        this.currentPolicy.constructionAvoidanceWeight,
        []
      );
    }

    if (!routeDiag.reachable || routeDiag.path.length < 2) {
      return {
        valid: false,
        reason:
          routeDiag.failureReason ||
          `Invalid Starting Position (${candidateX.toFixed(
            1
          )}, ${candidateZ.toFixed(
            1
          )}): No reachable A* route to destination "${targetLoc.name}".`,
        position: basePos,
        routeReachable: false,
        routeWaypointsCount: 0,
      };
    }

    return {
      valid: true,
      reason: null,
      position: basePos,
      routeReachable: true,
      routeWaypointsCount: routeDiag.path.length,
    };
  }

  public setCustomStartPosition(
    customPos: CustomStartPosition | null
  ): StartPositionValidationResult | null {
    if (!customPos) {
      this.customStartPosition = null;
      this.reset(true);
      return null;
    }

    const validation = this.validateStartPosition(
      customPos.x,
      customPos.z,
      customPos.floor ?? 0
    );

    if (!validation.valid) {
      // Do NOT overwrite previous valid start position or silently fall back to hardcoded origin
      this.callbacks.onLogEvent?.(
        'warn',
        validation.reason || 'Rejected invalid custom starting position.'
      );
      return validation;
    }

    this.customStartPosition = {
      ...customPos,
      x: validation.position.x,
      z: validation.position.z,
      y: validation.position.y,
      floor: validation.position.floor,
    };
    this.originOverrideId = null;
    this.reset(true);
    return validation;
  }

  public setCustomPedestrianAgents(agents: PedestrianSimAgent[]): void {
    this.pedestrianAgents = agents;
    this.evaluatePerception(0);
  }

  public get dynamicObstacles(): PedestrianSimAgent[] {
    return this.pedestrianAgents;
  }

  public get cachedGrid(): GridNode[][] {
    return this.cachedStaticGrid;
  }

  public step(subDt: number): void {
    this.stepSimulationSubStep(subDt);
  }

  /**
   * Builds the full multi-layer route from current `startPos` to the target elevator's
   * Indoor Lobby (`Outdoor A* -> Building Entrance -> Ground Internal Corridor -> Elevator Lobby`,
   * or Upper-Floor Corridor -> Upper-Floor Elevator Lobby when `originFloor > 0`).
   */
  private computeMultiFloorApproachRoute(
    startPos: Vector2D,
    elevCfg: CampusElevatorConfig,
    dynamicPedPositions: Vector2D[] = [],
    predictedPenaltyZones: PredictedGridPenaltyZone[] = []
  ): PathfindingDiagnosticsResult {
    const startFloor = startPos.floor ?? this.originFloor;

    // If starting on an upper floor (1F or 2F) inside the building, route directly along that floor's corridor to the elevator lobby
    if (startFloor > 0) {
      const upperToLobby = buildIndoorElevatorRouteWaypoints(
        elevCfg,
        'enter-to-lobby',
        startFloor,
        undefined,
        startPos
      );
      return {
        path: upperToLobby,
        reachable: true,
        detourActive: false,
        blockedZonesOnDirectPath: [],
        failureReason: null,
      };
    }

    // If robot is currently inside another building's ground corridor (e.g., rerouting from primary lobby to backup elevator),
    // first exit that building's front entrance back to its outdoor approach node before running outdoor A*.
    let outdoorStart: Vector2D = { x: startPos.x, z: startPos.z, y: 0, floor: 0 };
    const exitPrefix: Vector2D[] = [];

    for (const otherElev of CAMPUS_ELEVATORS) {
      if (otherElev.id === elevCfg.id) continue;
      const inOtherBuildingOrEntrance =
        Math.abs(startPos.x - otherElev.cabinPos.x) <= 2.4 &&
        startPos.z <= otherElev.outdoorApproachPos.z + 0.5 &&
        startPos.z >= otherElev.cabinPos.z - 1.5;
      if (inOtherBuildingOrEntrance) {
        exitPrefix.push({ x: startPos.x, z: startPos.z, y: 0, floor: 0 });
        if (startPos.z < otherElev.entrancePos.z - 0.2) {
          exitPrefix.push({ ...otherElev.entrancePos, y: 0, floor: 0 });
        }
        exitPrefix.push({ ...otherElev.outdoorApproachPos, y: 0, floor: 0 });
        outdoorStart = { ...otherElev.outdoorApproachPos, y: 0, floor: 0 };
        break;
      }
    }

    const outdoorDiag = computeAStarPathWithDiagnostics(
      outdoorStart,
      elevCfg.outdoorApproachPos,
      this.currentScenario.activeConstructionZones,
      this.currentPolicy.constructionAvoidanceWeight,
      dynamicPedPositions,
      predictedPenaltyZones
    );

    if (!outdoorDiag.reachable || outdoorDiag.path.length === 0) {
      return outdoorDiag;
    }

    const indoorToLobby = buildIndoorElevatorRouteWaypoints(
      elevCfg,
      'enter-to-lobby',
      0
    );
    const combinedPath: Vector2D[] = [
      ...exitPrefix,
      ...outdoorDiag.path.map((p) => ({ ...p, y: 0, floor: 0 })),
      ...indoorToLobby.slice(1),
    ];

    return {
      ...outdoorDiag,
      path: combinedPath,
    };
  }

  public getTelemetrySnapshot(selectedBuildingName: string | null = null): LiveTelemetry {
    const bot = this.getCurrentRobot();
    const origin = this.getOriginLocation();
    const target = this.getTargetLocation();
    const { gx, gz } = worldToGridCoords(this.robotPos.x, this.robotPos.z);
    const cell = this.cachedStaticGrid[gx]?.[gz];
    const activeElev = this.getActiveElevatorUnit();
    const activeElevCfg = this.getActiveElevatorConfig();

    const destinationLabel = this.requiresElevator
      ? this.getTargetDestinationRoomName(activeElevCfg)
      : `${target.name} (${target.code})`;

    return {
      simulationState: this.runState,
      environmentId: this.currentEnvironment?.id ?? 'env-campus-main',
      environmentName:
        this.currentEnvironment?.name ?? 'University Innovation Campus (Multi-Floor)',
      robotId: bot.id,
      robotName: bot.name,
      robotStatus: this.robotOpState,
      activeAvoidanceLevel: this.activeAvoidanceLevel,
      originName: origin.name,
      currentDestination: destinationLabel,
      originFloor: this.originFloor,
      destinationFloor: this.targetFloor,
      originCoordinates: { ...this.initialStartCoords },
      destinationCoordinates: {
        x: Number(target.position[0].toFixed(1)),
        z: Number(target.position[2].toFixed(1)),
        y: Number(((this.targetFloor ?? 0) * 3.6).toFixed(2)),
        floor: this.targetFloor,
      },
      batteryLevelPct: Number(this.batteryPct.toFixed(1)),
      currentSpeedMps: Number(this.currentSpeedMps.toFixed(2)),
      targetSpeedMps: Number(this.targetSpeedMps.toFixed(2)),
      navigationStatus: this.navStatusText,
      distanceRemainingM: Number(this.distanceRemainingM.toFixed(1)),
      distanceTraveledM: Number(this.distanceTraveledM.toFixed(1)),
      elapsedTimeSec: Number(this.elapsedTimeSec.toFixed(1)),
      collisionsCount: this.collisionsCount,
      replanCount: this.replanCount,
      safetyInterventionCount: this.safetyInterventionCount,
      pedestrianDetectionsCount: this.pedestrianDetectionsCount,
      predictedEncountersCount: this.predictedEncountersCount,
      avoidedEncountersCount: this.avoidedEncountersCount,
      unnecessaryStopsCount: this.unnecessaryStopsCount,
      predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
      pedestrianReplanCount: this.pedestrianReplanCount,
      speedReductionEventsCount: this.speedReductionEventsCount,
      reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
      pedestrianWaitingTimeSec: Number(this.pedestrianWaitingTimeSec.toFixed(1)),
      speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
      localBypassCount: this.localBypassCount,
      globalReplanCount: this.globalReplanCount,
      closestApproachDistanceM:
        this.closestApproachDistanceM !== null
          ? Number(this.closestApproachDistanceM.toFixed(2))
          : null,
      estimatedTtcSec:
        this.estimatedTtcSec !== null
          ? Number(this.estimatedTtcSec.toFixed(2))
          : null,
      predictionHorizonSec: this.predictionHorizonSec,
      activePredictedConflicts: this.activePredictedConflicts,
      predictedConflictPoints: this.activePredictedConflicts,
      totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
      elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
      requiresElevator: this.requiresElevator,
      activeElevatorId: this.activeElevatorId,
      activeElevatorState: activeElev ? activeElev.state : null,
      activeElevatorMachineState: activeElev?.machineState ?? null,
      elevatorState: activeElev ? activeElev.state : 'Available',
      currentFloor: this.currentFloor,
      currentFloorLabel: this.getFloorLabel(
        activeElev && activeElev.robotInside
          ? activeElev.currentFloor
          : this.currentFloor
      ),
      robotAltitudeY: Number(this.robotAltitudeY.toFixed(2)),
      isRobotIndoor: this.isRobotIndoor,
      elevatorAssistanceRequested: Boolean(
        activeElev?.assistanceRequested ||
          this.robotOpState === 'Awaiting Assistance'
      ),
      elevatorFaultMode: this.elevatorFaultMode,
      elevatorUnits: this.elevatorUnits.map((u) => ({
        ...u,
        isBackup: !u.isPrimary,
      })),
      position: {
        x: Number(this.robotPos.x.toFixed(1)),
        z: Number(this.robotPos.z.toFixed(1)),
        y: Number(this.robotAltitudeY.toFixed(2)),
        headingRad: Number(this.robotHeading.toFixed(2)),
      },
      activeWaypointIndex: this.currentWaypointIdx,
      totalWaypoints: this.waypoints.length,
      selectedBuildingName,
      currentGridCell: {
        gx,
        gz,
        walkable: this.isRobotIndoor ? true : cell ? cell.walkable : false,
        blockReason: this.isRobotIndoor
          ? 'indoor-corridor'
          : cell
          ? cell.blockReason
          : 'none',
      },
      pathBlockedReason: this.pathDiagnostics.failureReason,
      detourActive: this.pathDiagnostics.detourActive,
      nearestObstacleDistanceM:
        this.nearestObstacleDist !== null
          ? Number(this.nearestObstacleDist.toFixed(2))
          : null,
      perceivedNearestDistanceM:
        this.perceivedNearestDist !== null
          ? Number(this.perceivedNearestDist.toFixed(2))
          : null,
      nearestObstacleType: this.nearestObstacleLabel,
      visibilityRangeM: this.perceptionProfile.visibilityRangeM,
      sensorNoiseStdM: this.perceptionProfile.sensorNoiseStdM,
      perceivedObstaclesCount: this.perceivedObstaclesCount,
      totalEnvironmentalObstaclesCount: this.totalEnvironmentalObstaclesCount,
    };
  }

  public reset(emitResetLog = true, notifyCallbacks = true): void {
    setActiveRuntimeEnvironment(this.currentEnvironment);
    setActiveScenarioCustomObstacles(this.currentScenario.customObstacles);
    this.runState = 'idle';
    this.activeRunSessionId = '';
    this.completionEmittedForSession = false;
    this.currentSpeedMps = 0;
    this.targetSpeedMps = 0;
    this.elapsedTimeSec = 0;
    this.distanceTraveledM = 0;
    this.collisionsCount = 0;
    this.replanCount = 0;
    this.safetyInterventionCount = 0;
    this.inSafetyInterventionEpisode = false;
    this.safetyInterventionCooldownSec = 0;
    this.pedestrianDetectionsCount = 0;
    this.totalWaitingTimeSec = 0;
    this.initialBatteryPct = this.currentScenario.initialBatteryPct ?? 98.0;
    this.batteryPct = this.initialBatteryPct;
    this.pedestrianYieldTimerSec = 0;
    this.replanCooldownSec = 0;
    this.deadlockWaitTimerSec = 0;
    this.deadlockRetryCount = 0;
    this.nearestObstacleDist = null;
    this.perceivedNearestDist = null;
    this.nearestObstacleLabel = null;
    this.perceivedConstructionZoneIds.clear();

    // Reset Q-learning episode tracking
    this.unnecessaryReplanCount = 0;
    this.deadlockCount = 0;
    this.episodeReward = 0;
    this.qTableUpdatesCount = 0;
    this.consecutiveStopsCount = 0;
    this.consecutiveReplansCount = 0;
    this.trajectorySamples = [];
    this.lastTrajectorySampleTimeSec = -1;
    this.decisionHistory = [];
    this.episodeActionCounts = {
      MAINTAIN_SPEED: 0,
      REDUCE_SPEED: 0,
      STOP_TEMPORARILY: 0,
      LOCAL_AVOIDANCE: 0,
      GLOBAL_REPLAN: 0,
    };
    this.rlDecisionTimerSec = 0;
    this.lastRlStateKey = null;
    this.lastRlAction = null;
    this.lastRlObs = null;
    this.episodeTrajectoryTrace = [];
    const seed =
      this.currentScenario.randomSeed ??
      this.currentScenario.pedestrianDistribution?.randomSeed ??
      101;
    this.episodeRng = createSeededRng(seed);

    // Reset Part 1 Hierarchical Avoidance & Speed Regulation metrics
    this.activeAvoidanceLevel = 'Level 1: Maintain Path';
    this.speedReductionEventsCount = 0;
    this.reducedSpeedTimeSec = 0;
    this.pedestrianWaitingTimeSec = 0;
    this.speedBasedAvoidanceCount = 0;
    this.localBypassCount = 0;
    this.globalReplanCount = 0;
    this.closestApproachDistanceM = null;
    this.estimatedTtcSec = null;
    this.inSpeedReductionEpisode = false;
    this.activeConflictHadStopOrReplan = false;
    this.activeConflictPedId = null;
    this.localBypassCooldownSec = 0;

    // Reset predictive metrics
    this.predictionHorizonSec = this.currentScenario.predictionHorizonSec ?? 2;
    this.predictedEncountersCount = 0;
    this.avoidedEncountersCount = 0;
    this.unnecessaryStopsCount = 0;
    this.pedestrianReplanCount = 0;
    this.predictionAccuracyPct = 92.5;
    this.activePredictedConflicts = [];
    this.recordedConflictKeys.clear();
    this.recordedAvoidedKeys.clear();
    this.pendingPredictionSamples = [];
    this.verifiedPredictionsTotal = 0;
    this.verifiedPredictionsAccurate = 0;
    this.lastPredictionSampleTimeSec = 0;
    this.stopStartedWithoutClosePed = false;

    const originLoc = this.getOriginLocation();
    const targetLoc = this.getTargetLocation();

    // Destination-aware floor & elevator resolution:
    // Only use an elevator when originFloor !== targetFloor!
    this.originFloor = originLoc.floor ?? this.currentScenario.originFloor ?? 0;
    if (this.destinationOverrideId !== null) {
      this.targetFloor = targetLoc.floor ?? 0;
    } else if (targetLoc.floor !== undefined && targetLoc.floor > 0) {
      this.targetFloor = targetLoc.floor;
    } else {
      this.targetFloor =
        this.currentScenario.destinationFloor ??
        (this.currentScenario.requiresElevator ? 2 : targetLoc.floor ?? 0);
    }

    this.requiresElevator = this.originFloor !== this.targetFloor;
    this.elevatorFaultMode =
      this.elevatorFaultModeOverride ??
      this.currentScenario.elevatorFaultMode ??
      'none';
    this.elevatorTimeoutSec = this.currentScenario.elevatorTimeoutSec ?? 3.2;
    this.elevatorPhaseTimerSec = 0;
    this.elevatorCallStartFloor = 0;
    this.elevatorTransitStartFloor = this.originFloor;
    this.elevatorWaitTimeSec = 0;
    this.elevatorReroutedToBackup = false;
    this.elevatorStateEncountered = 'Available';
    this.elevatorEventsLog = [];

    this.currentFloor = this.originFloor;
    this.robotAltitudeY = Number((this.originFloor * 3.6).toFixed(2));
    this.isRobotIndoor = Boolean(originLoc.isIndoor || this.originFloor > 0);

    const activeElevatorsList = this.getActiveElevators();

    this.elevatorUnits = activeElevatorsList.map((cfg) => {
      let initialState: ElevatorState = 'Available';
      let initialMachineState: ElevatorMachineState = 'IDLE';
      if (this.requiresElevator) {
        if (
          cfg.isPrimary &&
          (this.elevatorFaultMode === 'unavailable-before-arrival' ||
            this.elevatorFaultMode === 'no-alternative-available')
        ) {
          initialState = 'Out of Service';
          initialMachineState = 'OUT_OF_SERVICE';
        } else if (
          !cfg.isPrimary &&
          this.elevatorFaultMode === 'no-alternative-available'
        ) {
          initialState = 'Out of Service';
          initialMachineState = 'OUT_OF_SERVICE';
        } else if (
          cfg.isPrimary &&
          this.elevatorFaultMode === 'delayed-reassess'
        ) {
          initialState = 'Delayed';
          initialMachineState = 'IDLE';
        }
      }

      return {
        id: cfg.id,
        name: cfg.name,
        buildingId: cfg.buildingId,
        buildingName: cfg.buildingName,
        position: { ...cfg.position },
        outdoorApproachPos: { ...cfg.outdoorApproachPos },
        entrancePos: { ...cfg.entrancePos },
        lobbyPos: { ...cfg.lobbyPos },
        doorwayPos: { ...cfg.doorwayPos },
        cabinPos: { ...cfg.cabinPos },
        destinationRoomPos: { ...cfg.destinationRoomPos },
        destinationRoomName: cfg.destinationRoomName,
        doorwayFacing: cfg.doorwayFacing,
        doorOpenProgress: 0,
        state: initialState,
        machineState: initialMachineState,
        currentFloor: 0, // Cabin starts at Ground Floor (0) and travels to originFloor if called from 1F/2F
        targetFloor: this.targetFloor,
        floorHeightM: cfg.floorHeightM,
        isPrimary: cfg.isPrimary,
        robotInside: false,
        waitElapsedSec: 0,
        assistanceRequested: false,
      };
    });

    this.perceptionProfile = computePerceptionProfile(
      this.currentScenario.sensorNoiseLevel,
      this.getCurrentRobot()
    );

    this.robotPos = {
      x: originLoc.position[0],
      z: originLoc.position[2],
      y: this.robotAltitudeY,
      floor: this.originFloor,
    };

    this.cachedStaticGrid = buildNavigationGrid(
      this.currentScenario.activeConstructionZones,
      this.currentPolicy.constructionAvoidanceWeight,
      []
    );

    if (this.requiresElevator && this.elevatorUnits.length > 0) {
      let initialElevCfg =
        activeElevatorsList.find((e) => e.isPrimary) ?? activeElevatorsList[0];

      if (this.originFloor > 0 && originLoc.elevatorId) {
        initialElevCfg =
          activeElevatorsList.find((e) => e.id === originLoc.elevatorId) ??
          initialElevCfg;
      } else if (
        this.elevatorFaultMode === 'none' &&
        targetLoc.elevatorId
      ) {
        initialElevCfg =
          activeElevatorsList.find((e) => e.id === targetLoc.elevatorId) ??
          initialElevCfg;
      }

      this.activeElevatorId = initialElevCfg.id;
      this.elevatorMissionPhase = 'approaching-building-entrance';
      this.pathDiagnostics = this.computeMultiFloorApproachRoute(
        this.robotPos,
        initialElevCfg,
        []
      );
    } else if (
      this.originFloor === this.targetFloor &&
      (originLoc.isIndoor || targetLoc.isIndoor) &&
      activeElevatorsList.length > 0
    ) {
      // Same-floor destination involving an indoor location: NEVER use the elevator!
      this.activeElevatorId = null;
      this.elevatorMissionPhase = 'not-required';
      const bldgElevCfg =
        activeElevatorsList.find(
          (e) =>
            e.buildingId === originLoc.buildingId ||
            e.buildingId === targetLoc.buildingId
        ) ?? activeElevatorsList[0];

      if (this.originFloor > 0 || (originLoc.isIndoor && targetLoc.isIndoor)) {
        const sameFloorWps = buildIndoorElevatorRouteWaypoints(
          bldgElevCfg,
          'same-floor-indoor',
          this.originFloor,
          {
            x: targetLoc.position[0],
            z: targetLoc.position[2],
            y: this.robotAltitudeY,
            floor: this.targetFloor,
          },
          this.robotPos
        );
        this.pathDiagnostics = {
          path: sameFloorWps,
          reachable: true,
          detourActive: false,
          blockedZonesOnDirectPath: [],
          failureReason: null,
        };
      } else if (!originLoc.isIndoor && targetLoc.isIndoor) {
        // Outdoor Ground Floor -> Indoor Ground Floor Atrium (no elevator needed)
        const outdoorDiag = computeAStarPathWithDiagnostics(
          this.robotPos,
          bldgElevCfg.outdoorApproachPos,
          this.currentScenario.activeConstructionZones,
          this.currentPolicy.constructionAvoidanceWeight,
          []
        );
        const indoorGroundWps: Vector2D[] = [
          { ...bldgElevCfg.entrancePos, y: 0, floor: 0 },
          { x: bldgElevCfg.lobbyPos.x, z: targetLoc.position[2], y: 0, floor: 0 },
          {
            x: targetLoc.position[0],
            z: targetLoc.position[2],
            y: 0,
            floor: 0,
          },
        ];
        this.pathDiagnostics = {
          ...outdoorDiag,
          path: outdoorDiag.reachable
            ? [
                ...outdoorDiag.path.map((p) => ({ ...p, y: 0, floor: 0 })),
                ...indoorGroundWps,
              ]
            : [],
        };
      } else {
        // Indoor Ground Floor -> Outdoor Ground Floor
        const outdoorDiag = computeAStarPathWithDiagnostics(
          bldgElevCfg.outdoorApproachPos,
          { x: targetLoc.position[0], z: targetLoc.position[2], y: 0, floor: 0 },
          this.currentScenario.activeConstructionZones,
          this.currentPolicy.constructionAvoidanceWeight,
          []
        );
        this.pathDiagnostics = {
          ...outdoorDiag,
          path: outdoorDiag.reachable
            ? [
                { ...this.robotPos },
                { x: bldgElevCfg.lobbyPos.x, z: this.robotPos.z, y: 0, floor: 0 },
                { ...bldgElevCfg.entrancePos, y: 0, floor: 0 },
                ...outdoorDiag.path.map((p) => ({ ...p, y: 0, floor: 0 })),
              ]
            : [],
        };
      }
    } else {
      // Standard Outdoor Ground-to-Ground Navigation (Never uses elevator)
      this.activeElevatorId = null;
      this.elevatorMissionPhase = 'not-required';
      const initialGoalPos: Vector2D = {
        x: targetLoc.position[0],
        z: targetLoc.position[2],
        y: 0,
        floor: 0,
      };
      this.pathDiagnostics = computeAStarPathWithDiagnostics(
        this.robotPos,
        initialGoalPos,
        this.currentScenario.activeConstructionZones,
        this.currentPolicy.constructionAvoidanceWeight,
        []
      );
    }

    this.waypoints = Array.isArray(this.pathDiagnostics.path)
      ? this.pathDiagnostics.path
      : [];
    this.currentWaypointIdx = Math.min(1, Math.max(0, this.waypoints.length - 1));

    if (
      this.customStartPosition &&
      typeof this.customStartPosition.headingRad === 'number'
    ) {
      this.robotHeading = this.customStartPosition.headingRad;
    } else if (this.waypoints.length > 1) {
      const dx = this.waypoints[1].x - this.robotPos.x;
      const dz = this.waypoints[1].z - this.robotPos.z;
      this.robotHeading = Math.atan2(dx, dz);
    }

    this.initialStartCoords = {
      x: Number(this.robotPos.x.toFixed(2)),
      z: Number(this.robotPos.z.toFixed(2)),
      y: Number(this.robotAltitudeY.toFixed(2)),
      floor: this.originFloor,
      headingRad: Number(this.robotHeading.toFixed(2)),
    };

    this.distanceRemainingM = calculatePathDistance(this.waypoints);
    this.robotOpState = 'Standby';

    if (!this.pathDiagnostics.reachable) {
      this.navStatusText =
        this.pathDiagnostics.failureReason ||
        'Route Blocked: No valid path to destination';
    } else if (this.requiresElevator) {
      const primaryElev = this.getActiveElevatorUnit();
      this.navStatusText = `Ready at ${originLoc.code} (F${this.originFloor}) → ${
        primaryElev?.name ?? 'Elevator'
      } → F${this.targetFloor} (${this.waypoints.length} nodes)`;
    } else if (this.originFloor > 0 && this.originFloor === this.targetFloor) {
      this.navStatusText = `Ready on ${this.getFloorLabel(
        this.originFloor
      )}: Same-floor indoor route (No Elevator Needed)`;
    } else if (this.pathDiagnostics.detourActive) {
      this.replanCount = 1;
      this.globalReplanCount = 1;
      this.navStatusText = `Detour computed around ${this.pathDiagnostics.blockedZonesOnDirectPath.join(
        ', '
      )} (${this.waypoints.length} A* nodes)`;
    } else {
      this.navStatusText = `Ready at ${originLoc.code} (${this.waypoints.length} A* nodes)`;
    }

    const activeDist =
      this.pedestrianDistributionOverride ??
      this.currentScenario.pedestrianDistribution;
    this.pedestrianAgents = createScenarioPedestrianAgents(
      this.currentScenario.dynamicObstacleCount,
      activeDist,
      this.currentScenario.activeConstructionZones
    );
    this.evaluatePerception(0);

    if (notifyCallbacks) {
      this.emitPathUpdate();
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
    }

    if (emitResetLog && notifyCallbacks) {
      this.callbacks.onLogEvent?.(
        'info',
        this.pathDiagnostics.reachable
          ? `Simulation reset to ${originLoc.name} (Floor ${this.originFloor} → Floor ${this.targetFloor}, Elevator: ${
              this.requiresElevator ? 'Required' : 'Not Used'
            }).`
          : `Route check failed at ${originLoc.name}: ${this.pathDiagnostics.failureReason}`
      );
    }
  }

  public start(): void {
    if (this.runState === 'completed' || this.runState === 'failed') {
      this.reset(false);
    }

    if (!this.activeRunSessionId) {
      this.activeRunSessionId = `RUN-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      this.completionEmittedForSession = false;
    }

    if (!this.pathDiagnostics.reachable || this.waypoints.length < 2) {
      const reason =
        this.pathDiagnostics.failureReason ||
        'Navigation Failure: No valid traversable route available to destination.';
      this.runState = 'failed';
      this.currentSpeedMps = 0;
      this.replanCount += 1;
      this.globalReplanCount += 1;
      this.robotOpState = 'Emergency Stop';
      this.navStatusText = reason;
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.('error', reason);
      this.emitCompletion({
        status: 'Failed',
        durationSec: 0.5,
        distanceMeters: 0.0,
        collisions: 0,
        replanCount: this.replanCount,
        pedestrianDetectionsCount: this.pedestrianDetectionsCount,
        predictedEncountersCount: this.predictedEncountersCount,
        avoidedEncountersCount: this.avoidedEncountersCount,
        unnecessaryStopsCount: this.unnecessaryStopsCount,
        predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
        pedestrianReplanCount: this.pedestrianReplanCount,
        speedReductionEventsCount: this.speedReductionEventsCount,
        reducedSpeedTimeSec: 0.0,
        pedestrianWaitingTimeSec: 0.0,
        speedBasedAvoidanceCount: 0,
        localBypassCount: 0,
        globalReplanCount: this.globalReplanCount,
        totalWaitingTimeSec: 0.0,
        elevatorWaitTimeSec: 0.0,
        batteryConsumedPct: 0.1,
        failureType: 'No Valid Route Available',
        obstacleType: 'Construction Barrier',
        failureReason: reason,
        rootCause: reason,
        mitigationSuggested:
          'Re-open at least one campus corridor in Scenario Generator or select an accessible destination dock.',
        failureCoordinates: {
          x: Number(this.robotPos.x.toFixed(1)),
          z: Number(this.robotPos.z.toFixed(1)),
        },
      });
      return;
    }

    this.runState = 'running';
    this.robotOpState = 'Navigating';
    if (this.requiresElevator) {
      const elev = this.getActiveElevatorUnit();
      this.navStatusText =
        this.originFloor > 0
          ? `Navigating ${this.getFloorLabel(this.originFloor)} Corridor → ${
              elev?.name ?? 'Elevator Lobby'
            }`
          : `Approaching ${elev?.buildingName ?? 'Building'} Entrance → ${
              elev?.name ?? 'Elevator Lobby'
            }`;
    } else if (this.originFloor > 0 && this.originFloor === this.targetFloor) {
      this.navStatusText = `Same-Floor Indoor Navigation on ${this.getFloorLabel(
        this.originFloor
      )} (No Elevator)`;
    } else if (this.pathDiagnostics.detourActive) {
      const zones = this.pathDiagnostics.blockedZonesOnDirectPath.join(', ');
      this.navStatusText = `Detouring around ${zones} (${this.waypoints.length} nodes)`;
      this.callbacks.onLogEvent?.(
        'warn',
        `A* detour active: Avoiding blocked cells at ${zones}.`
      );
    } else {
      this.navStatusText = `Following ${this.currentPolicy.algorithm} trajectory`;
    }
    this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
    this.callbacks.onLogEvent?.(
      'info',
      `Dispatched ${this.getCurrentRobot().name} from ${
        this.getOriginLocation().name
      } (F${this.originFloor}) toward ${
        this.requiresElevator
          ? this.getTargetDestinationRoomName(this.getActiveElevatorConfig())
          : this.getTargetLocation().name
      } (F${this.targetFloor}).`
    );
  }

  public pause(): void {
    if (this.runState === 'running') {
      this.runState = 'paused';
      this.currentSpeedMps = 0;
      this.robotOpState = 'Standby';
      this.navStatusText = 'Simulation paused by operator';
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.('warn', 'Simulation paused by operator.');
    }
  }

  public evaluatePerception(elapsedSec: number): void {
    const visRange = this.perceptionProfile.visibilityRangeM;
    let perceivedCount = 0;
    const totalEnv =
      this.currentScenario.activeConstructionZones.length +
      this.pedestrianAgents.length;

    for (const czId of this.currentScenario.activeConstructionZones) {
      const cz = CONSTRUCTION_ZONES.find((z) => z.id === czId);
      if (!cz) continue;
      const dist = Math.hypot(
        cz.position[0] - this.robotPos.x,
        cz.position[2] - this.robotPos.z
      );
      if (dist <= visRange + Math.max(cz.size[0], cz.size[1]) / 2) {
        perceivedCount += 1;
        if (
          !this.perceivedConstructionZoneIds.has(czId) &&
          this.runState === 'running'
        ) {
          this.perceivedConstructionZoneIds.add(czId);
          this.callbacks.onLogEvent?.(
            'warn',
            `LiDAR perceived ${cz.name} at ${dist.toFixed(
              1
            )}m (Visibility range: ${visRange}m, Noise: ±${
              this.perceptionProfile.sensorNoiseStdM
            }m).`
          );
        }
      }
    }

    for (const ped of this.pedestrianAgents) {
      const dist = Math.hypot(
        ped.currentPos.x - this.robotPos.x,
        ped.currentPos.z - this.robotPos.z
      );
      if (dist <= visRange) {
        perceivedCount += 1;
      }
      if (elapsedSec === 0) {
        ped.isPerceived = false;
      }
    }

    this.perceivedObstaclesCount = perceivedCount;
    this.totalEnvironmentalObstaclesCount = totalEnv;
  }

  private getCurrentActiveGoalCoords(): Vector2D {
    if (
      this.requiresElevator &&
      (this.elevatorMissionPhase === 'approaching-building-entrance' ||
        this.elevatorMissionPhase === 'waiting-in-lobby')
    ) {
      const elevCfg = this.getActiveElevatorConfig();
      if (elevCfg) return { ...elevCfg.outdoorApproachPos };
    }
    const targetLoc = this.getTargetLocation();
    return {
      x: targetLoc.position[0],
      z: targetLoc.position[2],
      y: this.targetFloor * 3.6,
      floor: this.targetFloor,
    };
  }

  /**
   * LEVEL 5: GLOBAL REPLANNING
   * Recalculates the full A* route only when the original corridor is genuinely blocked
   * and speed regulation (Level 2), temporary waiting (Level 3), and local bypass (Level 4)
   * cannot safely resolve the obstruction.
   */
  public attemptDynamicReplanAroundPedestrians(
    blockingPedName: string,
    predictedPenaltyZones: PredictedGridPenaltyZone[] = [],
    isPredictiveReplan = false
  ): boolean {
    if (this.isRobotIndoor) {
      // Do not run outdoor 2D grid replanning while inside the indoor building corridor or cabin
      return false;
    }

    const perceivedPedPositions: Vector2D[] = [];
    for (const o of this.pedestrianAgents) {
      const dist = Math.hypot(
        o.currentPos.x - this.robotPos.x,
        o.currentPos.z - this.robotPos.z
      );
      if (dist <= this.perceptionProfile.visibilityRangeM) {
        perceivedPedPositions.push({
          x: o.currentPos.x,
          z: o.currentPos.z,
        });
        if (Math.hypot(o.velocity.x, o.velocity.z) > 0.05) {
          perceivedPedPositions.push({
            x: o.currentPos.x + o.velocity.x * 0.45,
            z: o.currentPos.z + o.velocity.z * 0.45,
          });
        }
      }
    }

    let replanned: PathfindingDiagnosticsResult;
    const elevCfg = this.getActiveElevatorConfig();
    if (
      this.requiresElevator &&
      elevCfg &&
      this.elevatorMissionPhase === 'approaching-building-entrance'
    ) {
      replanned = this.computeMultiFloorApproachRoute(
        this.robotPos,
        elevCfg,
        perceivedPedPositions,
        predictedPenaltyZones
      );
    } else {
      const goalCoords = this.getCurrentActiveGoalCoords();
      replanned = computeAStarPathWithDiagnostics(
        this.robotPos,
        goalCoords,
        this.currentScenario.activeConstructionZones,
        this.currentPolicy.constructionAvoidanceWeight,
        perceivedPedPositions,
        predictedPenaltyZones
      );
    }

    if (replanned.reachable && replanned.path.length > 1) {
      let nextIdx = 1;
      while (
        nextIdx < replanned.path.length - 1 &&
        Math.hypot(
          replanned.path[nextIdx].x - this.robotPos.x,
          replanned.path[nextIdx].z - this.robotPos.z
        ) < 0.35
      ) {
        nextIdx += 1;
      }

      const pedCircles: CollisionCircle[] = this.pedestrianAgents.map((o) => ({
        id: o.id,
        name: o.name,
        type: 'Dynamic Pedestrian',
        x: o.currentPos.x,
        z: o.currentPos.z,
        radius: o.radius,
      }));
      const firstWp = replanned.path[nextIdx];
      const segDx = firstWp.x - this.robotPos.x;
      const segDz = firstWp.z - this.robotPos.z;
      const segLen = Math.hypot(segDx, segDz);
      if (segLen > 0.01) {
        const probePos: Vector2D = {
          x: this.robotPos.x + (segDx / segLen) * Math.min(segLen, 0.8),
          z: this.robotPos.z + (segDz / segLen) * Math.min(segLen, 0.8),
        };
        const immediateHit = checkSweptRobotCollision(
          this.robotPos,
          probePos,
          ROBOT_COLLISION_RADIUS,
          this.currentScenario.activeConstructionZones,
          pedCircles,
          elevCfg,
          false
        );
        if (immediateHit && immediateHit.collided) {
          return false;
        }
      }

      this.waypoints = replanned.path;
      this.currentWaypointIdx = nextIdx;
      this.pathDiagnostics = {
        ...replanned,
        detourActive: true,
      };
      this.replanCount += 1;
      this.globalReplanCount += 1;
      this.pedestrianReplanCount += 1;
      this.activeConflictHadStopOrReplan = true;
      // Global A* trajectory handoff incurs realistic onboard re-indexing deceleration & compute overhead
      this.currentSpeedMps *= 0.35;
      this.totalWaitingTimeSec += 0.35;
      this.batteryPct = Math.max(
        0,
        this.batteryPct - 0.32 * this.currentScenario.batteryDrainMultiplier
      );
      // Replanning hysteresis: prevent repeated route switching
      this.replanCooldownSec = this.useLegacyAvoidance ? 1.45 : 3.2;
      this.deadlockWaitTimerSec = 0;
      this.deadlockRetryCount = 0;
      this.activeAvoidanceLevel = 'Level 5: Global Replanning';
      this.robotOpState = 'Replanning Path';
      this.navStatusText = isPredictiveReplan
        ? `Level 5 Global Replan: Avoiding trajectory of ${blockingPedName}`
        : `Level 5 Global Replan: Detouring around blocked corridor (${blockingPedName})`;
      this.emitPathUpdate();
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.(
        'warn',
        `Level 5 Global A* Replan #${this.replanCount}: Corridor obstructed by ${blockingPedName}; computed alternative route.`
      );
      return true;
    }

    return false;
  }

  private updatePredictionAccuracyTracking(): void {
    const remaining: PendingPredictionSample[] = [];
    for (const sample of this.pendingPredictionSamples) {
      if (this.elapsedTimeSec >= sample.targetTimeSec) {
        const ped = this.pedestrianAgents.find((p) => p.id === sample.pedId);
        if (ped) {
          const errorM = Math.hypot(
            ped.currentPos.x - sample.predictedPos.x,
            ped.currentPos.z - sample.predictedPos.z
          );
          this.verifiedPredictionsTotal += 1;
          if (errorM <= sample.toleranceM) {
            this.verifiedPredictionsAccurate += 1;
          }
        }
      } else {
        remaining.push(sample);
      }
    }
    this.pendingPredictionSamples = remaining;

    if (this.verifiedPredictionsTotal > 0) {
      this.predictionAccuracyPct =
        (this.verifiedPredictionsAccurate / this.verifiedPredictionsTotal) * 100;
    }

    if (this.elapsedTimeSec - this.lastPredictionSampleTimeSec >= 0.5) {
      this.lastPredictionSampleTimeSec = this.elapsedTimeSec;
      for (const ped of this.pedestrianAgents) {
        if (ped.predictedTrajectory && ped.predictedTrajectory.length >= 2) {
          const predPt = ped.predictedTrajectory[1];
          const tol = ped.behaviorClass === 'random' ? 1.15 : 0.92;
          this.pendingPredictionSamples.push({
            pedId: ped.id,
            targetTimeSec: this.elapsedTimeSec + 0.8,
            predictedPos: { x: predPt.x, z: predPt.z },
            toleranceM: tol,
          });
        }
      }
    }
  }

  /**
   * Reroutes the robot from the primary building elevator lobby/entrance to the
   * backup building's indoor elevator lobby when the primary elevator is Out of Service
   * before boarding (Case 6) or Delayed beyond timeout.
   */
  private attemptRerouteToBackupElevator(reasonLabel: string): boolean {
    const currentElev = this.getActiveElevatorUnit();
    if (currentElev) {
      currentElev.machineState = 'OUT_OF_SERVICE';
    }

    const backupElev =
      this.originFloor === 0
        ? this.elevatorUnits.find(
            (e) =>
              !e.isPrimary &&
              e.state !== 'Out of Service' &&
              e.state !== 'Stuck' &&
              e.machineState !== 'OUT_OF_SERVICE' &&
              e.machineState !== 'STUCK'
          )
        : undefined;
    const backupCfg = CAMPUS_ELEVATORS.find((e) => e.id === backupElev?.id);

    if (!backupElev || !backupCfg) {
      // Case 7: Both elevators unavailable (or robot is on upper floor of a building whose elevator is out of service)
      const destLabel = this.getTargetDestinationRoomName(
        this.getActiveElevatorConfig()
      );
      const failMsg =
        this.originFloor > 0
          ? `Elevator Unavailable: ${reasonLabel}. Robot is on ${this.getFloorLabel(
              this.originFloor
            )} and cannot use stairs to reach ${destLabel}.`
          : `Elevator Unavailable: ${reasonLabel}, and backup lift is Out of Service. Ground delivery robot cannot use stairs to reach ${destLabel}.`;
      this.elevatorEventsLog.push(failMsg);
      this.runState = 'failed';
      this.currentSpeedMps = 0;
      this.robotOpState = 'Emergency Stop';
      this.navStatusText = failMsg;
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.('error', failMsg);
      this.emitCompletion({
        status: 'Failed',
        durationSec: Number(this.elapsedTimeSec.toFixed(1)),
        distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
        collisions: this.collisionsCount,
        replanCount: this.replanCount,
        pedestrianDetectionsCount: this.pedestrianDetectionsCount,
        predictedEncountersCount: this.predictedEncountersCount,
        avoidedEncountersCount: this.avoidedEncountersCount,
        unnecessaryStopsCount: this.unnecessaryStopsCount,
        predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
        pedestrianReplanCount: this.pedestrianReplanCount,
        speedReductionEventsCount: this.speedReductionEventsCount,
        reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
        pedestrianWaitingTimeSec: Number(this.pedestrianWaitingTimeSec.toFixed(1)),
        speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
        localBypassCount: this.localBypassCount,
        globalReplanCount: this.globalReplanCount,
        totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
        elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
        elevatorUsed: false,
        elevatorStateEncountered: 'Out of Service',
        elevatorFaultMode: this.elevatorFaultMode,
        elevatorReroutedToBackup: false,
        elevatorEventsLog: [...this.elevatorEventsLog],
        batteryConsumedPct: Number(
          (this.initialBatteryPct - this.batteryPct).toFixed(1)
        ),
        failureType: 'Elevator Unavailable',
        obstacleType: 'Elevator Shaft',
        failureReason: failMsg,
        rootCause: failMsg,
        mitigationSuggested:
          'Restore at least one campus building elevator unit or assign delivery to a ground-level parcel locker.',
        failureCoordinates: {
          x: Number(this.robotPos.x.toFixed(1)),
          z: Number(this.robotPos.z.toFixed(1)),
        },
      });
      return false;
    }

    this.activeElevatorId = backupElev.id;
    this.elevatorReroutedToBackup = true;
    this.elevatorMissionPhase = 'approaching-building-entrance';

    const rerouteDiag = this.computeMultiFloorApproachRoute(
      this.robotPos,
      backupCfg,
      []
    );

    if (rerouteDiag.reachable && rerouteDiag.path.length > 1) {
      this.waypoints = rerouteDiag.path;
      this.currentWaypointIdx = 1;
      this.pathDiagnostics = { ...rerouteDiag, detourActive: true };
      this.replanCount += 1;
      this.globalReplanCount += 1;
      this.robotOpState = 'Replanning Path';
      const msg = `${reasonLabel} — Rerouting to ${backupElev.buildingName} Entrance → ${backupElev.name}.`;
      this.elevatorEventsLog.push(msg);
      this.navStatusText = `Rerouting to ${backupElev.buildingName} (${backupElev.name})`;
      this.emitPathUpdate();
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.('warn', msg);
      return true;
    }

    return false;
  }

  /**
   * PART 2: MULTI-FLOOR INDOOR BUILDING & 10-STATE ELEVATOR STATE MACHINE
   * Explicit 10 states:
   * 1. IDLE
   * 2. DOORS_OPENING
   * 3. BOARDING
   * 4. DOORS_CLOSING
   * 5. MOVING_UP
   * 6. MOVING_DOWN
   * 7. DOORS_OPENING_AT_DESTINATION
   * 8. EXITING
   * 9. OUT_OF_SERVICE
   * 10. STUCK
   *
   * Supports Ground (0), First (1), and Second (2) floors in both upward and downward directions.
   * Returns `true` when the robot is stationary inside the lobby or cabin waiting for doors/lift motion,
   * or `false` when the robot should physically drive along `this.waypoints`.
   */
  private stepElevatorStateMachine(subDt: number): boolean {
    const activeElev = this.getActiveElevatorUnit();
    const elevCfg = this.getActiveElevatorConfig();

    if (!this.requiresElevator || this.elevatorMissionPhase === 'not-required') {
      const originLoc = this.getOriginLocation();
      const targetLoc = this.getTargetLocation();
      const fh = elevCfg?.floorHeightM ?? 3.6;
      this.currentFloor = this.originFloor;
      this.robotAltitudeY = Number((this.originFloor * fh).toFixed(2));
      this.isRobotIndoor = Boolean(
        originLoc.isIndoor || targetLoc.isIndoor || this.originFloor > 0
      );
      return false;
    }

    if (!activeElev || !elevCfg) return false;
    const fh = elevCfg.floorHeightM;
    const originY = Number((this.originFloor * fh).toFixed(2));
    const destY = Number((this.targetFloor * fh).toFixed(2));

    // Check if robot is currently inside the building footprint
    const inBuildingCorridor =
      Math.abs(this.robotPos.x - elevCfg.cabinPos.x) <= 7.5 &&
      this.robotPos.z <= elevCfg.entrancePos.z + 0.35 &&
      this.robotPos.z >= elevCfg.cabinPos.z - 2.2;
    this.isRobotIndoor =
      inBuildingCorridor ||
      this.currentFloor > 0 ||
      this.elevatorMissionPhase === 'calling-elevator-to-origin' ||
      this.elevatorMissionPhase === 'boarding-cabin' ||
      this.elevatorMissionPhase === 'doors-closing-ground' ||
      this.elevatorMissionPhase === 'in-elevator-transit' ||
      this.elevatorMissionPhase === 'doors-opening-upper' ||
      (this.elevatorMissionPhase === 'exiting-to-destination' &&
        this.robotPos.z <= elevCfg.entrancePos.z + 0.35);

    // 1. Approaching Building Entrance / Indoor Corridor -> Origin Floor Elevator Lobby
    if (this.elevatorMissionPhase === 'approaching-building-entrance') {
      this.currentFloor = this.originFloor;
      this.robotAltitudeY = originY;
      this.robotPos.y = originY;
      this.robotPos.floor = this.originFloor;

      const distToEntrance = Math.hypot(
        elevCfg.entrancePos.x - this.robotPos.x,
        elevCfg.entrancePos.z - this.robotPos.z
      );
      const distToLobby = Math.hypot(
        elevCfg.lobbyPos.x - this.robotPos.x,
        elevCfg.lobbyPos.z - this.robotPos.z
      );

      // Update status when entering building front entrance on Ground Floor
      if (
        this.originFloor === 0 &&
        inBuildingCorridor &&
        this.robotOpState === 'Navigating'
      ) {
        this.robotOpState = 'Entering Building';
        this.navStatusText = `Inside ${elevCfg.buildingName}: Ground Corridor → ${activeElev.name} Lobby`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      }

      // Check if primary elevator is Out of Service as robot approaches building entrance or lobby (Case 6 & Case 7)
      if (
        (activeElev.state === 'Out of Service' ||
          activeElev.machineState === 'OUT_OF_SERVICE') &&
        (distToEntrance <= 4.5 || distToLobby <= 6.5)
      ) {
        this.elevatorStateEncountered = 'Out of Service';
        activeElev.machineState = 'OUT_OF_SERVICE';
        this.attemptRerouteToBackupElevator(
          `${activeElev.name} in ${elevCfg.buildingName} is Out of Service before boarding`
        );
        return this.runState !== 'running';
      }

      if (distToLobby <= 4.5 && activeElev.state === 'Available') {
        activeElev.state = 'Approaching';
        activeElev.machineState = 'IDLE';
      }

      // Check arrival at Origin Floor Elevator Lobby directly in front of the single doorway
      if (distToLobby <= 0.55) {
        this.robotPos = {
          ...elevCfg.lobbyPos,
          y: originY,
          floor: this.originFloor,
        };
        this.currentSpeedMps = 0;
        this.elevatorPhaseTimerSec = 0;

        if (activeElev.state === 'Delayed') {
          this.elevatorStateEncountered = 'Delayed';
          activeElev.machineState = 'IDLE';
          this.elevatorMissionPhase = 'waiting-in-lobby';
          this.robotOpState = 'Waiting for Elevator';
          const msg = `Arrived at ${elevCfg.buildingName} ${this.getFloorLabel(
            this.originFloor
          )} Lobby: ${
            activeElev.name
          } is Delayed. Waiting up to ${this.elevatorTimeoutSec.toFixed(
            1
          )}s before reassessing.`;
          this.elevatorEventsLog.push(msg);
          this.navStatusText = `Lobby Wait: ${activeElev.name} Delayed`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          this.callbacks.onLogEvent?.('warn', msg);
          return true;
        }

        // If the cabin is not yet at originFloor (e.g., origin is 1F or 2F and cabin is at Ground), call cabin to originFloor first!
        if (Math.abs(activeElev.currentFloor - this.originFloor) > 0.05) {
          this.elevatorCallStartFloor = activeElev.currentFloor;
          const callingUp = this.originFloor > activeElev.currentFloor;
          activeElev.state = callingUp ? 'Moving Up' : 'Moving Down';
          activeElev.machineState = callingUp ? 'MOVING_UP' : 'MOVING_DOWN';
          activeElev.doorOpenProgress = 0;
          this.elevatorMissionPhase = 'calling-elevator-to-origin';
          this.robotOpState = 'Waiting for Elevator';
          const callMsg = `Calling ${activeElev.name} cabin to ${this.getFloorLabel(
            this.originFloor
          )} Lobby.`;
          this.elevatorEventsLog.push(callMsg);
          this.navStatusText = `${activeElev.name}: Calling Cabin to ${this.getFloorLabel(
            this.originFloor
          )}`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          this.callbacks.onLogEvent?.('info', callMsg);
          return true;
        }

        // Start opening the single elevator doorway on originFloor
        activeElev.state = 'Doors Opening';
        activeElev.machineState = 'DOORS_OPENING';
        activeElev.doorOpenProgress = 0.05;
        this.elevatorMissionPhase = 'doors-opening-ground';
        this.robotOpState = 'Waiting for Elevator';
        const msg = `Arrived at ${elevCfg.buildingName} ${this.getFloorLabel(
          this.originFloor
        )} Lobby: ${activeElev.name} single doorway opening [DOORS_OPENING].`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `${activeElev.name}: Doors Opening at ${this.getFloorLabel(
          this.originFloor
        )} Lobby`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
        return true;
      }

      return false;
    }

    // 1b. Calling Elevator Cabin to Origin Floor (when robot starts on 1F or 2F and calls lift)
    if (this.elevatorMissionPhase === 'calling-elevator-to-origin') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      this.elevatorWaitTimeSec += subDt;
      const callDurationSec = 0.85;
      const progress = Math.min(1, this.elevatorPhaseTimerSec / callDurationSec);
      const currentContFloor =
        this.elevatorCallStartFloor +
        (this.originFloor - this.elevatorCallStartFloor) * progress;
      activeElev.currentFloor = Number(currentContFloor.toFixed(2));
      const callingUp = this.originFloor >= this.elevatorCallStartFloor;
      activeElev.state = callingUp ? 'Moving Up' : 'Moving Down';
      activeElev.machineState = callingUp ? 'MOVING_UP' : 'MOVING_DOWN';

      if (progress >= 1) {
        activeElev.currentFloor = this.originFloor;
        activeElev.state = 'Doors Opening';
        activeElev.machineState = 'DOORS_OPENING';
        activeElev.doorOpenProgress = 0.05;
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'doors-opening-ground';
        this.navStatusText = `${activeElev.name}: Doors Opening at ${this.getFloorLabel(
          this.originFloor
        )} Lobby`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      }
      return true;
    }

    // 2. Waiting in Indoor Lobby for Delayed Elevator
    if (this.elevatorMissionPhase === 'waiting-in-lobby') {
      this.currentSpeedMps = 0;
      this.totalWaitingTimeSec += subDt;
      this.elevatorWaitTimeSec += subDt;
      activeElev.waitElapsedSec += subDt;
      activeElev.machineState = 'IDLE';

      this.navStatusText = `Indoor Lobby Wait: ${activeElev.name} (${activeElev.waitElapsedSec.toFixed(
        1
      )}s / ${this.elevatorTimeoutSec.toFixed(1)}s timeout)`;

      if (activeElev.waitElapsedSec >= this.elevatorTimeoutSec) {
        this.attemptRerouteToBackupElevator(
          `${activeElev.name} delay exceeded ${this.elevatorTimeoutSec.toFixed(
            1
          )}s timeout`
        );
        return false;
      }
      return true;
    }

    // 3. DOORS_OPENING at Origin Floor Lobby
    if (this.elevatorMissionPhase === 'doors-opening-ground') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      this.elevatorWaitTimeSec += subDt * 0.5;
      activeElev.state = 'Doors Opening';
      activeElev.machineState = 'DOORS_OPENING';
      activeElev.currentFloor = this.originFloor;
      activeElev.doorOpenProgress = Math.min(
        1,
        this.elevatorPhaseTimerSec / 0.65
      );
      this.navStatusText = `${activeElev.name}: Doorway Opening on ${this.getFloorLabel(
        this.originFloor
      )} (${Math.round(activeElev.doorOpenProgress * 100)}%)`;

      if (activeElev.doorOpenProgress >= 1) {
        // Doorway is fully open and cabin is at originFloor!
        // Unlock the single doorway edge: Lobby -> Single Doorway -> Cabin
        activeElev.state = 'Boarding';
        activeElev.machineState = 'BOARDING';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'boarding-cabin';
        this.robotOpState = 'Boarding Elevator';
        this.waypoints = buildIndoorElevatorRouteWaypoints(
          elevCfg,
          'board-cabin',
          this.originFloor
        );
        this.currentWaypointIdx = 1;
        this.navStatusText = `Boarding ${activeElev.name} Cabin on ${this.getFloorLabel(
          this.originFloor
        )} [BOARDING]`;
        this.emitPathUpdate();
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        return false; // Let robot physically drive through the single doorway into cabinPos!
      }
      return true;
    }

    // 4. BOARDING: Robot Physically Driving Through Single Doorway Into Elevator Cabin
    if (this.elevatorMissionPhase === 'boarding-cabin') {
      activeElev.state = 'Boarding';
      activeElev.machineState = 'BOARDING';
      activeElev.doorOpenProgress = 1;
      this.currentFloor = this.originFloor;
      this.robotAltitudeY = originY;
      this.robotPos.y = originY;
      this.robotPos.floor = this.originFloor;

      const distToCabin = Math.hypot(
        elevCfg.cabinPos.x - this.robotPos.x,
        elevCfg.cabinPos.z - this.robotPos.z
      );

      if (distToCabin <= 0.55) {
        this.robotPos = {
          ...elevCfg.cabinPos,
          y: originY,
          floor: this.originFloor,
        };
        this.currentSpeedMps = 0;
        // Turn robot to face the South doorway (heading = 0) while inside the cabin
        this.robotHeading = 0;
        activeElev.robotInside = true;
        activeElev.state = 'Doors Closing';
        activeElev.machineState = 'DOORS_CLOSING';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'doors-closing-ground';
        const msg = `Boarded ${activeElev.name} cabin on ${this.getFloorLabel(
          this.originFloor
        )}. Doors Closing [DOORS_CLOSING].`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `${activeElev.name}: Inside Cabin — Doors Closing`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
        return true;
      }
      return false;
    }

    // 5. DOORS_CLOSING on Origin Floor before Vertical Lift
    if (this.elevatorMissionPhase === 'doors-closing-ground') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      activeElev.state = 'Doors Closing';
      activeElev.machineState = 'DOORS_CLOSING';
      activeElev.doorOpenProgress = Math.max(
        0,
        1 - this.elevatorPhaseTimerSec / 0.55
      );

      if (activeElev.doorOpenProgress <= 0) {
        activeElev.doorOpenProgress = 0;
        this.elevatorTransitStartFloor = this.originFloor;
        const movingUp = this.targetFloor >= this.originFloor;
        activeElev.state = movingUp ? 'Moving Up' : 'Moving Down';
        activeElev.machineState = movingUp ? 'MOVING_UP' : 'MOVING_DOWN';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'in-elevator-transit';
        this.robotOpState = 'In Elevator Transit';
        const dirWord = movingUp ? 'Ascending' : 'Descending';
        const msg = `${activeElev.name} Doors Closed — ${dirWord} shaft from ${this.getFloorLabel(
          this.originFloor
        )} to ${this.getFloorLabel(this.targetFloor)} [${
          activeElev.machineState
        }].`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `In Elevator Transit: ${this.getFloorLabel(
          this.originFloor
        )} → ${this.getFloorLabel(this.targetFloor)}`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
      }
      return true;
    }

    // 6. MOVING_UP / MOVING_DOWN / STUCK: Vertical Cabin Movement Inside Enclosed Shaft
    if (this.elevatorMissionPhase === 'in-elevator-transit') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      const floorSpan = Math.max(
        1,
        Math.abs(this.targetFloor - this.elevatorTransitStartFloor)
      );
      const totalClimbTimeSec = Math.max(1.25, floorSpan * 1.1);
      const progress = Math.min(1, this.elevatorPhaseTimerSec / totalClimbTimeSec);
      const currentContFloor =
        this.elevatorTransitStartFloor +
        (this.targetFloor - this.elevatorTransitStartFloor) * progress;
      const movingUp = this.targetFloor >= this.elevatorTransitStartFloor;

      // Case 8: Elevator becomes STUCK between floors during vertical transit!
      if (
        this.elevatorFaultMode === 'stuck-during-journey' &&
        progress >= 0.65
      ) {
        const stuckFloorVal = Number(currentContFloor.toFixed(2));
        activeElev.state = 'Stuck';
        activeElev.machineState = 'STUCK';
        activeElev.currentFloor = stuckFloorVal;
        activeElev.doorOpenProgress = 0; // Doors remain strictly closed when stuck between floors!
        activeElev.assistanceRequested = true;
        this.currentFloor = Math.round(stuckFloorVal);
        this.robotAltitudeY = Number((stuckFloorVal * fh).toFixed(2));
        this.robotPos = {
          ...elevCfg.cabinPos,
          y: this.robotAltitudeY,
          floor: this.currentFloor,
        };
        this.elevatorStateEncountered = 'Stuck';
        this.elevatorMissionPhase = 'failed-in-elevator';
        this.robotOpState = 'Awaiting Assistance';

        const stuckMsg = `CRITICAL: ${activeElev.name} cabin halted mid-shaft at Floor ${stuckFloorVal} (y=${this.robotAltitudeY}m) [STUCK] with doors closed and ${
          this.getCurrentRobot().name
        } aboard!`;
        this.elevatorEventsLog.push(stuckMsg);
        this.callbacks.onLogEvent?.('error', stuckMsg);

        activeElev.state = 'Emergency Assistance';
        const assistMsg = `Emergency Assistance requested in ${elevCfg.buildingName}. Cabin doors locked safe; operator dashboard alerted.`;
        this.elevatorEventsLog.push(assistMsg);
        this.navStatusText = `Emergency Assistance: Cabin Stuck Mid-Shaft (y=${this.robotAltitudeY}m, Doors Closed)`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('error', assistMsg);

        this.runState = 'failed';
        this.emitCompletion({
          status: 'Failed',
          durationSec: Number(this.elapsedTimeSec.toFixed(1)),
          distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
          collisions: this.collisionsCount,
          replanCount: this.replanCount,
          pedestrianDetectionsCount: this.pedestrianDetectionsCount,
          predictedEncountersCount: this.predictedEncountersCount,
          avoidedEncountersCount: this.avoidedEncountersCount,
          unnecessaryStopsCount: this.unnecessaryStopsCount,
          predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
          pedestrianReplanCount: this.pedestrianReplanCount,
          speedReductionEventsCount: this.speedReductionEventsCount,
          reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
          pedestrianWaitingTimeSec: Number(this.pedestrianWaitingTimeSec.toFixed(1)),
          speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
          localBypassCount: this.localBypassCount,
          globalReplanCount: this.globalReplanCount,
          totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
          elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
          elevatorUsed: true,
          elevatorStateEncountered: 'Stuck',
          elevatorFaultMode: this.elevatorFaultMode,
          elevatorReroutedToBackup: this.elevatorReroutedToBackup,
          elevatorEventsLog: [...this.elevatorEventsLog],
          batteryConsumedPct: Number(
            (this.initialBatteryPct - this.batteryPct).toFixed(1)
          ),
          failureType: 'Elevator Mechanical Failure',
          obstacleType: 'Elevator Cab',
          failureReason: stuckMsg,
          rootCause: `${stuckMsg} Robot entered safe Awaiting Assistance state with cabin doors closed and transmitted Emergency Assistance beacon to campus operations.`,
          mitigationSuggested:
            'Dispatch facilities maintenance to reset trapped elevator cabin in Innovation & Student Union and enable pre-boarding lift telemetry checks.',
          failureCoordinates: {
            x: Number(this.robotPos.x.toFixed(1)),
            z: Number(this.robotPos.z.toFixed(1)),
          },
        });
        return true;
      }

      if (progress < 1) {
        activeElev.state = movingUp ? 'Moving Up' : 'Moving Down';
        activeElev.machineState = movingUp ? 'MOVING_UP' : 'MOVING_DOWN';
        activeElev.currentFloor = Number(currentContFloor.toFixed(2));
        this.currentFloor = Math.round(activeElev.currentFloor);
        this.robotAltitudeY = Number(
          (activeElev.currentFloor * fh).toFixed(2)
        );
        // Robot position stays synchronized inside the elevator cabin as it moves vertically
        this.robotPos = {
          ...elevCfg.cabinPos,
          y: this.robotAltitudeY,
          floor: this.currentFloor,
        };
        this.navStatusText = `In Elevator Transit [${activeElev.machineState}]: ${
          activeElev.name
        } (${this.getFloorLabel(activeElev.currentFloor)}, y=${
          this.robotAltitudeY
        }m)`;
        return true;
      }

      // Reached Destination Floor -> DOORS_OPENING_AT_DESTINATION
      activeElev.currentFloor = this.targetFloor;
      this.currentFloor = this.targetFloor;
      this.robotAltitudeY = destY;
      this.robotPos = {
        ...elevCfg.cabinPos,
        y: destY,
        floor: this.targetFloor,
      };
      activeElev.state = 'Doors Opening at Destination';
      activeElev.machineState = 'DOORS_OPENING_AT_DESTINATION';
      this.elevatorPhaseTimerSec = 0;
      this.elevatorMissionPhase = 'doors-opening-upper';
      this.robotOpState = 'Exiting Elevator';
      this.navStatusText = `Arrived at ${this.getFloorLabel(
        this.targetFloor
      )} — Doors Opening [DOORS_OPENING_AT_DESTINATION]`;
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      return true;
    }

    // 7. DOORS_OPENING_AT_DESTINATION on Target Floor (Floor 0, 1, or 2)
    if (this.elevatorMissionPhase === 'doors-opening-upper') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      activeElev.state = 'Doors Opening at Destination';
      activeElev.machineState = 'DOORS_OPENING_AT_DESTINATION';
      activeElev.currentFloor = this.targetFloor;
      activeElev.doorOpenProgress = Math.min(
        1,
        this.elevatorPhaseTimerSec / 0.55
      );

      if (activeElev.doorOpenProgress >= 1) {
        activeElev.doorOpenProgress = 1;
        activeElev.state = 'Exiting';
        activeElev.machineState = 'EXITING';
        activeElev.robotInside = false;
        if (this.elevatorStateEncountered === 'Available') {
          this.elevatorStateEncountered =
            this.targetFloor >= this.originFloor ? 'Moving Up' : 'Moving Down';
        }
        this.elevatorMissionPhase = 'exiting-to-destination';
        this.robotOpState = 'Exiting Elevator';

        const targetLoc = this.getTargetLocation();
        const destRoomCoords = this.getTargetDestinationRoomCoords(elevCfg);
        const destRoomName = this.getTargetDestinationRoomName(elevCfg);

        // Build Exit Route on targetFloor:
        // If targetFloor === 0 and destination is outdoors (e.g. Case 3: 2F -> Ground outdoor dock),
        // exit building lobby to outdoorApproachPos and append outdoor A* route!
        if (this.targetFloor === 0 && !targetLoc.isIndoor) {
          const indoorExitWps = buildIndoorElevatorRouteWaypoints(
            elevCfg,
            'exit-to-destination',
            0
          );
          const outdoorCont = computeAStarPathWithDiagnostics(
            elevCfg.outdoorApproachPos,
            { x: targetLoc.position[0], z: targetLoc.position[2], y: 0, floor: 0 },
            this.currentScenario.activeConstructionZones,
            this.currentPolicy.safetyClearanceM +
              this.perceptionProfile.uncertaintySafetyBufferM,
            []
          );
          const groundOutdoorWps = outdoorCont.path.map((pt: Vector2D) => ({
            ...pt,
            y: 0,
            floor: 0,
          }));
          this.waypoints = [...indoorExitWps, ...groundOutdoorWps.slice(1)];
        } else {
          this.waypoints = buildIndoorElevatorRouteWaypoints(
            elevCfg,
            'exit-to-destination',
            this.targetFloor,
            destRoomCoords
          );
        }

        this.currentWaypointIdx = 1;
        this.pathDiagnostics = {
          path: this.waypoints,
          reachable: true,
          detourActive: this.elevatorReroutedToBackup,
          blockedZonesOnDirectPath: [],
          failureReason: null,
        };

        const exitMsg = `${activeElev.name} arrived at ${this.getFloorLabel(
          this.targetFloor
        )} (y=${destY}m). Exiting doorway [EXITING] toward ${destRoomName}.`;
        this.elevatorEventsLog.push(exitMsg);
        this.navStatusText = `${this.getFloorLabel(
          this.targetFloor
        )} Exit → ${destRoomName}`;
        this.emitPathUpdate();
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('success', exitMsg);
        return false; // Let robot physically drive out the doorway along the target floor!
      }
      return true;
    }

    // 8. EXITING -> Robot Driving Along Destination Floor to Final Room or Outdoor Goal
    if (this.elevatorMissionPhase === 'exiting-to-destination') {
      this.robotAltitudeY = destY;
      this.currentFloor = this.targetFloor;
      this.robotPos.y = destY;
      this.robotPos.floor = this.targetFloor;

      const distFromCabin = Math.hypot(
        this.robotPos.x - elevCfg.cabinPos.x,
        this.robotPos.z - elevCfg.cabinPos.z
      );
      if (distFromCabin > 2.85 && activeElev.state === 'Exiting') {
        activeElev.state = 'Available';
        activeElev.machineState = 'IDLE';
        activeElev.doorOpenProgress = 0;
        if (this.robotOpState === 'Exiting Elevator') {
          this.robotOpState = 'Navigating';
          this.navStatusText = `Navigating ${this.getFloorLabel(
            this.targetFloor
          )} → ${this.getTargetDestinationRoomName(elevCfg)}`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        }
      }
      return false;
    }

    return false;
  }

  /**
   * Advances pedestrian movement, 5-level hierarchical pedestrian avoidance,
   * smooth physical speed regulation, multi-floor elevator state machine,
   * and deadlock recovery by `subDt` seconds.
   */
  public stepSimulationSubStep(subDt: number): void {
    // 1. Always update ground-floor dynamic pedestrian positions along campus walkways
    stepDynamicPedestrians(
      this.pedestrianAgents,
      this.robotPos,
      subDt,
      this.currentScenario.activeConstructionZones
    );

    if (this.runState !== 'running') return;

    this.elapsedTimeSec += subDt;
    if (this.replanCooldownSec > 0) {
      this.replanCooldownSec = Math.max(0, this.replanCooldownSec - subDt);
    }
    if (this.localBypassCooldownSec > 0) {
      this.localBypassCooldownSec = Math.max(0, this.localBypassCooldownSec - subDt);
    }
    if (this.safetyInterventionCooldownSec > 0) {
      this.safetyInterventionCooldownSec = Math.max(
        0,
        this.safetyInterventionCooldownSec - subDt
      );
    }

    this.evaluatePerception(this.elapsedTimeSec);

    // 2. Step Multi-Floor Building & Elevator State Machine if active
    const pausedInElevator = this.stepElevatorStateMachine(subDt);
    if (pausedInElevator || this.runState !== 'running') {
      return;
    }

    const bot = this.getCurrentRobot();
    const effectivePayloadKg =
      this.activePayloadKg ?? bot.defaultPayloadKg ?? Math.round(bot.payloadCapacityKg * 0.4);
    const payloadRatio =
      bot.payloadCapacityKg > 0
        ? Math.min(1.4, effectivePayloadKg / bot.payloadCapacityKg)
        : 0.4;
    const payloadSpeedFactor = Math.max(
      0.72,
      1.0 - Math.max(0, payloadRatio - 0.35) * (bot.payloadSpeedPenaltyFactor ?? 0.12)
    );
    const noiseCautionFactor = Math.max(
      0.72,
      1.0 -
        this.currentScenario.sensorNoiseLevel *
          (bot.hasRadar || bot.hasThermalCamera ? 0.32 : 0.45)
    );
    const nominalCruiseSpeed =
      bot.maxSpeedMps *
      payloadSpeedFactor *
      this.currentPolicy.cruiseSpeedFactor *
      this.currentScenario.surfaceTraction *
      noiseCautionFactor;

    let desiredSpeed = this.isRobotIndoor
      ? Math.min(nominalCruiseSpeed, 1.85) // Safe indoor corridor speed
      : nominalCruiseSpeed;

    const robotFootprintClearanceAdder = Math.max(
      -0.12,
      (bot.collisionRadiusM ?? ROBOT_COLLISION_RADIUS) - ROBOT_COLLISION_RADIUS
    );
    const effectivePolicyClearance =
      this.currentPolicy.safetyClearanceM +
      robotFootprintClearanceAdder +
      this.perceptionProfile.uncertaintySafetyBufferM;

    // 3. Evaluate Predictive Trajectory Conflicts & Active Path Hazards (when on outdoor ground floor)
    const predictive = !this.isRobotIndoor
      ? evaluatePredictiveConflicts(
          this.robotPos,
          nominalCruiseSpeed,
          this.waypoints,
          this.currentWaypointIdx,
          this.pedestrianAgents,
          this.perceptionProfile.visibilityRangeM,
          effectivePolicyClearance,
          this.predictionHorizonSec
        )
      : {
          conflicts: [],
          penaltyZones: [],
          recommendedSpeedScale: 1.0,
          proactiveReplanRecommended: false,
          primaryConflictPed: null,
          closestApproachDistanceM: null,
          earliestTtcSec: null,
          isTransientCrossingConflict: false,
          isSameDirectionConflict: false,
          followingSpeedMps: null,
        };

    this.activePredictedConflicts = predictive.conflicts;
    this.closestApproachDistanceM = predictive.closestApproachDistanceM;
    this.estimatedTtcSec = predictive.earliestTtcSec;
    this.updatePredictionAccuracyTracking();

    // Record newly predicted trajectory conflicts
    for (const conf of predictive.conflicts) {
      const timeBucket = Math.floor(this.elapsedTimeSec / 2.5);
      const cKey = `${conf.pedestrianId}-${timeBucket}`;
      if (!this.recordedConflictKeys.has(cKey)) {
        this.recordedConflictKeys.add(cKey);
        this.predictedEncountersCount += 1;
      }
    }

    let hazard = !this.isRobotIndoor
      ? evaluateActivePathPedestrianHazard(
          this.robotPos,
          this.waypoints,
          this.currentWaypointIdx,
          this.pedestrianAgents,
          this.perceptionProfile.visibilityRangeM,
          effectivePolicyClearance,
          this.perceptionProfile.sensorNoiseStdM,
          this.elapsedTimeSec
        )
      : {
          nearestActualDist: null,
          nearestPerceivedDist: null,
          nearestPed: null,
          blockingPed: null,
          newlyDetectedPedIds: [],
          imminentStopRequired: false,
          pathObstructedAhead: false,
          speedScaleFactor: 1.0,
          sameDirectionAhead: false,
          sameDirectionPedSpeedMps: null,
          transientCrossingAhead: false,
        };

    if (hazard.newlyDetectedPedIds.length > 0) {
      this.pedestrianDetectionsCount += hazard.newlyDetectedPedIds.length;
      const detectedPed = this.pedestrianAgents.find(
        (p) => p.id === hazard.newlyDetectedPedIds[0]
      );
      if (detectedPed && hazard.nearestActualDist !== null) {
        this.callbacks.onLogEvent?.(
          'info',
          `Pedestrian Detected: ${detectedPed.name} (${
            detectedPed.behaviorClass
          }) at ${hazard.nearestActualDist.toFixed(1)}m clearance.`
        );
      }
    }

    this.nearestObstacleDist = hazard.nearestActualDist;
    this.perceivedNearestDist = hazard.nearestPerceivedDist;
    this.nearestObstacleLabel = hazard.nearestPed ? hazard.nearestPed.name : null;

    // ============================================================================
    // PART 1 & SECTION 7: LOCAL AVOIDANCE CONTROLLER
    // Supports:
    //  A) Legacy Eager-Replan Mode (useLegacyAvoidance = true)
    //  B) Candidate Tabular Q-Learning Policy + Hard Safety Layer (when candidatePolicyState is active)
    //  C) 5-Level Hierarchical Avoidance (Baseline Policy)
    // ============================================================================
    const conflictPed =
      hazard.blockingPed ?? predictive.primaryConflictPed ?? hazard.nearestPed;
    const isUsingCandidatePolicy =
      Boolean(this.candidatePolicyState) ||
      Boolean(this.currentPolicy.isCandidatePolicy);

    // Extract Q-Learning Observation for reward & decision tracking
    let nearestStaticObsDist: number | null = null;
    for (const czId of this.currentScenario.activeConstructionZones) {
      const cz = CONSTRUCTION_ZONES.find((z) => z.id === czId);
      if (cz) {
        const d = Math.hypot(
          cz.position[0] - this.robotPos.x,
          cz.position[2] - this.robotPos.z
        );
        if (nearestStaticObsDist === null || d < nearestStaticObsDist) {
          nearestStaticObsDist = d;
        }
      }
    }
    for (const cObs of this.currentScenario.customObstacles ?? []) {
      const d = Math.hypot(cObs.x - this.robotPos.x, cObs.z - this.robotPos.z);
      if (nearestStaticObsDist === null || d < nearestStaticObsDist) {
        nearestStaticObsDist = d;
      }
    }

    const conflictPedSpeed = conflictPed
      ? Math.hypot(conflictPed.velocity.x, conflictPed.velocity.z)
      : 0;
    const relativePedMovement: QLearningObservation['relativePedMovement'] =
      !conflictPed || (hazard.nearestActualDist ?? 99) > 6.5
        ? 'none'
        : hazard.sameDirectionAhead || predictive.isSameDirectionConflict
        ? 'same-direction'
        : conflictPedSpeed < 0.2
        ? 'stationary'
        : 'approaching-crossing';

    const temporaryObstructionPresent = Boolean(
      predictive.isTransientCrossingConflict ||
        hazard.transientCrossingAhead ||
        (conflictPed && conflictPedSpeed >= 0.22)
    );

    const activeElevUnit = this.getActiveElevatorUnit();
    const elevatorAvailable = this.requiresElevator
      ? Boolean(
          activeElevUnit &&
            activeElevUnit.state !== 'Out of Service' &&
            activeElevUnit.state !== 'Stuck'
        )
      : true;

    const currentObs: QLearningObservation = {
      nearestPedDistM:
        hazard.nearestPerceivedDist ?? hazard.nearestActualDist ?? null,
      relativePedMovement,
      ttcSec: predictive.earliestTtcSec,
      nearestObstacleDistM: nearestStaticObsDist,
      currentSpeedRatio:
        nominalCruiseSpeed > 0.1 ? this.currentSpeedMps / nominalCruiseSpeed : 0,
      pathBlocked: hazard.pathObstructedAhead,
      temporaryObstructionPresent,
      elevatorAvailable,
      navigationState: this.robotOpState,
      consecutiveStops: this.consecutiveStopsCount,
      consecutiveReplans: this.consecutiveReplansCount,
    };

    if (this.useLegacyAvoidance) {
      // Baseline Reactive A* Controller (Speed Regulation + Safety Stop + Global A* Replanning)
      if (predictive.conflicts.length > 0 && predictive.primaryConflictPed) {
        desiredSpeed *= predictive.recommendedSpeedScale;
        if (this.replanCooldownSec <= 0) {
          if (temporaryObstructionPresent) this.unnecessaryReplanCount += 1;
          this.attemptDynamicReplanAroundPedestrians(
            predictive.primaryConflictPed.name,
            predictive.penaltyZones,
            true
          );
          this.episodeActionCounts.GLOBAL_REPLAN += 1;
          if (this.decisionHistory.length < 25) {
            this.decisionHistory.push(
              `[t=${this.elapsedTimeSec.toFixed(1)}s] Baseline Proactive Global A* Replan (${predictive.primaryConflictPed.name})`
            );
          }
        }
      }
      if (hazard.pathObstructedAhead && hazard.blockingPed) {
        this.pedestrianYieldTimerSec += subDt;
        if (hazard.imminentStopRequired) {
          if (this.safetyInterventionCooldownSec <= 0) {
            this.safetyInterventionCount += 1;
            this.safetyInterventionCooldownSec = 2.0;
          }
          desiredSpeed = 0;
          this.currentSpeedMps = 0;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.episodeActionCounts.STOP_TEMPORARILY += 1;
          this.episodeReward -= 0.85;
        } else {
          desiredSpeed *= hazard.speedScaleFactor;
          this.episodeActionCounts.REDUCE_SPEED += 1;
        }
        if (this.replanCooldownSec <= 0) {
          if (temporaryObstructionPresent) this.unnecessaryReplanCount += 1;
          const replanOk = this.attemptDynamicReplanAroundPedestrians(
            hazard.blockingPed.name,
            predictive.penaltyZones,
            false
          );
          this.episodeActionCounts.GLOBAL_REPLAN += 1;
          this.episodeReward -= 2.4;
          if (!replanOk) {
            this.deadlockRetryCount += 1;
          }
        }
        // If baseline reactive policy remains stalled at a corridor blockage or multi-obstacle bottleneck beyond maxDeadlockWaitSec, record genuine Pathway Deadlock
        if (this.pedestrianYieldTimerSec >= this.maxDeadlockWaitSec) {
          this.deadlockCount += 1;
          const reason = `Pathway Deadlock: Baseline reactive policy stalled behind ${
            hazard.blockingPed.name
          } for ${this.pedestrianYieldTimerSec.toFixed(
            1
          )}s after ${this.globalReplanCount} global replans (${this.totalWaitingTimeSec.toFixed(
            1
          )}s total wait).`;
          this.runState = 'failed';
          this.currentSpeedMps = 0;
          this.robotOpState = 'Emergency Stop';
          this.navStatusText = reason;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          this.callbacks.onLogEvent?.('error', reason);
          this.emitCompletion({
            status: 'Failed',
            durationSec: Number(this.elapsedTimeSec.toFixed(1)),
            distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
            collisions: this.collisionsCount,
            replanCount: this.replanCount,
            pedestrianDetectionsCount: this.pedestrianDetectionsCount,
            predictedEncountersCount: this.predictedEncountersCount,
            avoidedEncountersCount: this.avoidedEncountersCount,
            unnecessaryStopsCount: this.unnecessaryStopsCount,
            predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
            pedestrianReplanCount: this.pedestrianReplanCount,
            speedReductionEventsCount: this.speedReductionEventsCount,
            reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
            pedestrianWaitingTimeSec: Number(this.pedestrianWaitingTimeSec.toFixed(1)),
            speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
            localBypassCount: this.localBypassCount,
            globalReplanCount: this.globalReplanCount,
            totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
            elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
            batteryConsumedPct: Number(
              (this.initialBatteryPct - this.batteryPct).toFixed(1)
            ),
            failureType: 'Pathway Deadlock',
            obstacleType: 'Dynamic Pedestrian',
            failureReason: reason,
            rootCause: reason,
            mitigationSuggested:
              'Train Candidate Q-Learning Policy to execute continuous-space LOCAL_AVOIDANCE bypasses and proactive speed regulation instead of repeated global A* replanning.',
            failureCoordinates: {
              x: Number(this.robotPos.x.toFixed(1)),
              z: Number(this.robotPos.z.toFixed(1)),
            },
          });
          return;
        }
      } else {
        this.pedestrianYieldTimerSec = Math.max(
          0,
          this.pedestrianYieldTimerSec - subDt * 0.45
        );
      }
    } else if (!this.isRobotIndoor && isUsingCandidatePolicy && this.candidatePolicyState) {
      // ==========================================================================
      // CANDIDATE TABULAR Q-LEARNING POLICY + HARD SAFETY LAYER
      // ==========================================================================
      this.rlDecisionTimerSec += subDt;
      const hasConflictOrHazard =
        predictive.conflicts.length > 0 ||
        hazard.pathObstructedAhead ||
        hazard.speedScaleFactor < 0.96 ||
        (nearestStaticObsDist !== null && nearestStaticObsDist <= 3.6);

      // Trigger RL decision step every 0.40s or immediately when a hazard appears
      if (this.rlDecisionTimerSec >= 0.4 || (hasConflictOrHazard && !this.lastRlAction)) {
        const nextStateKey = encodeObservationToStateKey(currentObs);

        // If we had a previous RL action, compute its step reward and update Q-table if training
        if (this.lastRlStateKey && this.lastRlAction && this.lastRlObs) {
          const progressM = Math.hypot(
            this.robotPos.x - this.lastRlRobotPos.x,
            this.robotPos.z - this.lastRlRobotPos.z
          );
          const safetyOverrideOccurred = Boolean(
            hazard.imminentStopRequired && this.lastRlAction === 'MAINTAIN_SPEED'
          );
          if (safetyOverrideOccurred && this.safetyInterventionCooldownSec <= 0) {
            this.safetyInterventionCount += 1;
            this.safetyInterventionCooldownSec = 2.0;
          }
          const stepReward = computeStepReward(this.lastRlObs, this.lastRlAction, {
            progressMeters: progressM,
            collisionOccurred: false,
            safetyOverrideTriggered: safetyOverrideOccurred,
            unnecessaryReplanTriggered: Boolean(
              this.lastRlAction === 'GLOBAL_REPLAN' &&
                (this.lastRlObs.temporaryObstructionPresent ||
                  (this.lastRlObs.consecutiveReplans ?? 0) >= 1)
            ),
            localBypassSucceeded:
              this.lastRlAction === 'LOCAL_AVOIDANCE' && progressM > 0.15,
            speedRegulatedSmoothly:
              this.lastRlAction === 'REDUCE_SPEED' &&
              this.lastRlObs.temporaryObstructionPresent &&
              progressM > 0.1,
          });
          this.episodeReward += stepReward;

          if (this.isTrainingEpisode) {
            updateQTableStep(
              this.candidatePolicyState,
              this.lastRlStateKey,
              this.lastRlAction,
              stepReward,
              nextStateKey,
              false
            );
            this.qTableUpdatesCount += 1;
          } else {
            this.candidatePolicyState.stateVisitCounts[this.lastRlStateKey] =
              (this.candidatePolicyState.stateVisitCounts[this.lastRlStateKey] ?? 0) + 1;
            this.candidatePolicyState.actionDistribution[this.lastRlAction] =
              (this.candidatePolicyState.actionDistribution[this.lastRlAction] ?? 0) + 1;
          }

          if (progressM > 0.35) {
            this.consecutiveStopsCount = 0;
          }
        }

        const selection = selectQLearningAction(
          this.candidatePolicyState,
          currentObs,
          this.isTrainingEpisode,
          this.episodeRng
        );

        if (
          selection.action === 'STOP_TEMPORARILY' ||
          (hazard.imminentStopRequired && selection.action === 'MAINTAIN_SPEED')
        ) {
          this.consecutiveStopsCount += 1;
        } else if (selection.action === 'LOCAL_AVOIDANCE') {
          this.consecutiveStopsCount = 0;
          this.consecutiveReplansCount = 0;
        }

        if (selection.action === 'GLOBAL_REPLAN') {
          this.consecutiveReplansCount += 1;
        } else if (selection.action !== 'STOP_TEMPORARILY') {
          this.consecutiveReplansCount = 0;
        }

        this.lastRlStateKey = selection.stateKey;
        this.lastRlAction = selection.action;
        this.lastRlObs = currentObs;
        this.lastRlRobotPos = { ...this.robotPos };
        this.rlDecisionTimerSec = 0;
        this.episodeActionCounts[selection.action] += 1;
        this.episodeTrajectoryTrace.push({
          stateKey: selection.stateKey,
          action: selection.action,
        });

        if (hasConflictOrHazard && this.decisionHistory.length < 25) {
          this.decisionHistory.push(
            `[t=${this.elapsedTimeSec.toFixed(1)}s] ${
              QL_ACTION_LABELS[selection.action]
            } (${selection.stateKey.split('|').slice(0, 3).join(', ')})`
          );
        }

        // Execute selected Q-learning action if it is a discrete route action (LOCAL_AVOIDANCE or GLOBAL_REPLAN)
        if (
          selection.action === 'LOCAL_AVOIDANCE' &&
          conflictPed &&
          this.localBypassCooldownSec <= 0
        ) {
          const bypass = computeLocalBypassWaypoints(
            this.robotPos,
            this.waypoints,
            this.currentWaypointIdx,
            conflictPed,
            this.currentScenario.activeConstructionZones,
            this.pedestrianAgents
          );
          if (bypass) {
            this.waypoints = bypass.splicedWaypoints;
            this.currentWaypointIdx = bypass.resumeIdx;
            this.localBypassCount += 1;
            this.avoidedEncountersCount += 1;
            this.localBypassCooldownSec = 1.05;
            this.pedestrianYieldTimerSec = 0;
            this.deadlockWaitTimerSec = 0;
            this.consecutiveStopsCount = 0;
            this.activeAvoidanceLevel = 'Level 4: Local Bypass';
            this.robotOpState = 'Local Bypass';
            this.navStatusText = `Q-Policy Local Bypass: Passing around ${conflictPed.name}`;
            this.emitPathUpdate();
            // Re-evaluate forward path hazard along the newly spliced bypass trajectory
            hazard = evaluateActivePathPedestrianHazard(
              this.robotPos,
              this.waypoints,
              this.currentWaypointIdx,
              this.pedestrianAgents,
              this.perceptionProfile.visibilityRangeM,
              effectivePolicyClearance,
              this.perceptionProfile.sensorNoiseStdM,
              this.elapsedTimeSec
            );
          } else if (hazard.pathObstructedAhead && this.replanCooldownSec <= 0) {
            const detourZones: PredictedGridPenaltyZone[] = [
              ...predictive.penaltyZones,
              {
                pos: {
                  x: conflictPed.currentPos.x,
                  z: conflictPed.currentPos.z,
                },
                radiusM: Math.max(2.1, (conflictPed.radius ?? 0.5) + 1.4),
                costPenalty: 14.0,
                pedestrianName: conflictPed.name,
              },
            ];
            const replanOk = this.attemptDynamicReplanAroundPedestrians(
              conflictPed.name,
              detourZones,
              false
            );
            if (replanOk) {
              this.localBypassCount += 1;
              this.avoidedEncountersCount += 1;
              this.localBypassCooldownSec = 1.05;
              this.pedestrianYieldTimerSec = 0;
              this.deadlockWaitTimerSec = 0;
              this.consecutiveStopsCount = 0;
              hazard = evaluateActivePathPedestrianHazard(
                this.robotPos,
                this.waypoints,
                this.currentWaypointIdx,
                this.pedestrianAgents,
                this.perceptionProfile.visibilityRangeM,
                effectivePolicyClearance,
                this.perceptionProfile.sensorNoiseStdM,
                this.elapsedTimeSec
              );
            }
          }
        } else if (
          selection.action === 'GLOBAL_REPLAN' &&
          conflictPed &&
          this.replanCooldownSec <= 0
        ) {
          if (temporaryObstructionPresent || this.consecutiveReplansCount > 1) {
            this.unnecessaryReplanCount += 1;
          }
          this.attemptDynamicReplanAroundPedestrians(
            conflictPed.name,
            predictive.penaltyZones,
            true
          );
        }
      }

      // Continuous speed control governed by active Q-Learning action + HARD SAFETY LAYER
      const activeAction = this.lastRlAction ?? 'MAINTAIN_SPEED';
      if (activeAction === 'MAINTAIN_SPEED') {
        this.activeAvoidanceLevel = 'Level 1: Maintain Path';
        if (hasConflictOrHazard) {
          desiredSpeed *= Math.max(0.82, predictive.recommendedSpeedScale);
        }
      } else if (activeAction === 'REDUCE_SPEED') {
        this.activeAvoidanceLevel = 'Level 2: Speed Regulation';
        this.reducedSpeedTimeSec += subDt;
        if (!this.inSpeedReductionEpisode && conflictPed) {
          this.inSpeedReductionEpisode = true;
          this.speedReductionEventsCount += 1;
          this.speedBasedAvoidanceCount += 1;
          this.avoidedEncountersCount += 1;
        }
        const scale = Math.min(
          predictive.recommendedSpeedScale,
          hazard.speedScaleFactor
        );
        desiredSpeed *= Math.max(0.38, Math.min(0.78, scale));
        this.robotOpState = 'Speed Regulation';
        this.navStatusText = `Q-Policy Level 2 Speed Regulation (${desiredSpeed.toFixed(
          2
        )} m/s)`;
      } else if (activeAction === 'STOP_TEMPORARILY') {
        this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
        desiredSpeed = 0;
        this.totalWaitingTimeSec += subDt;
        this.pedestrianWaitingTimeSec += subDt;
        if (hazard.pathObstructedAhead) {
          this.pedestrianYieldTimerSec += subDt;
        }
        if ((hazard.nearestActualDist ?? 99) > 2.2) {
          this.unnecessaryStopsCount += 1;
        }
        this.robotOpState = 'Obstacle Yield';
        this.navStatusText = `Q-Policy Temporary Yield`;
      } else if (activeAction === 'LOCAL_AVOIDANCE') {
        desiredSpeed *= 0.8;
      } else if (activeAction === 'GLOBAL_REPLAN') {
        desiredSpeed *= 0.72;
      }

      if (!hasConflictOrHazard) {
        this.inSpeedReductionEpisode = false;
      }

      // ==========================================================================
      // CRITICAL HARD SAFETY LAYER (Cannot be overridden by learned policy!)
      // Strictly prevents physical collisions at close range while requiring the
      // policy to select a valid avoidance action rather than auto-rescuing bad policies.
      // ==========================================================================
      if (hazard.imminentStopRequired && conflictPed) {
        const dist = hazard.nearestActualDist ?? 99;
        if (dist < 1.38) {
          if (!this.inSafetyInterventionEpisode && this.safetyInterventionCooldownSec <= 0) {
            this.inSafetyInterventionEpisode = true;
            this.safetyInterventionCount += 1;
            this.safetyInterventionCooldownSec = 2.0;
          }
          // Hard Safety Override: prevent physical collision regardless of learned policy action
          desiredSpeed = 0;
          this.currentSpeedMps = 0;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.pedestrianYieldTimerSec += subDt;
          this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
          this.robotOpState = 'Obstacle Yield';
          this.navStatusText = `Safety Layer Protected Stop (${dist.toFixed(
            2
          )}m to ${conflictPed.name})`;
        } else {
          this.inSafetyInterventionEpisode = false;
        }
      } else {
        this.inSafetyInterventionEpisode = false;
        if (activeAction !== 'STOP_TEMPORARILY') {
          this.pedestrianYieldTimerSec = Math.max(
            0,
            this.pedestrianYieldTimerSec - subDt * 0.5
          );
        }
      }

      // If the policy stays stalled at a blockage for >= maxDeadlockWaitSec without resolving it via LOCAL_AVOIDANCE,
      // terminate episode as a genuine Pathway Deadlock (Safe Stop — never counted as a successful delivery!)
      if (this.pedestrianYieldTimerSec >= this.maxDeadlockWaitSec && conflictPed) {
        this.deadlockCount += 1;
        const reason = `Pathway Deadlock: Robot remained blocked by ${
          conflictPed.name
        } for ${this.pedestrianYieldTimerSec.toFixed(
          1
        )}s without resolving corridor obstruction (Safety Interventions: ${
          this.safetyInterventionCount
        }).`;
        this.runState = 'failed';
        this.currentSpeedMps = 0;
        this.robotOpState = 'Emergency Stop';
        this.navStatusText = reason;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('error', reason);
        this.emitCompletion({
          status: 'Failed',
          durationSec: Number(this.elapsedTimeSec.toFixed(1)),
          distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
          collisions: this.collisionsCount,
          replanCount: this.replanCount,
          pedestrianDetectionsCount: this.pedestrianDetectionsCount,
          predictedEncountersCount: this.predictedEncountersCount,
          avoidedEncountersCount: this.avoidedEncountersCount,
          unnecessaryStopsCount: this.unnecessaryStopsCount,
          predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
          pedestrianReplanCount: this.pedestrianReplanCount,
          speedReductionEventsCount: this.speedReductionEventsCount,
          reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
          pedestrianWaitingTimeSec: Number(this.pedestrianWaitingTimeSec.toFixed(1)),
          speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
          localBypassCount: this.localBypassCount,
          globalReplanCount: this.globalReplanCount,
          totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
          elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
          batteryConsumedPct: Number(
            (this.initialBatteryPct - this.batteryPct).toFixed(1)
          ),
          failureType: 'Pathway Deadlock',
          obstacleType: 'Dynamic Pedestrian',
          failureReason: reason,
          rootCause: reason,
          mitigationSuggested:
            'Continue Q-Learning training so the policy learns to select LOCAL_AVOIDANCE when path:blocked or stl:stalled.',
          failureCoordinates: {
            x: Number(this.robotPos.x.toFixed(1)),
            z: Number(this.robotPos.z.toFixed(1)),
          },
        });
        return;
      }
    } else if (!this.isRobotIndoor) {
      // ==========================================================================
      // BASELINE RULE-BASED CONTROLLER
      // ==========================================================================
      const hasPredictiveConflict =
        predictive.conflicts.length > 0 && predictive.primaryConflictPed !== null;
      const hasActiveHazard =
        hazard.pathObstructedAhead || hazard.speedScaleFactor < 0.96;

      if (
        hasPredictiveConflict &&
        predictive.proactiveReplanRecommended &&
        this.replanCooldownSec <= 0 &&
        this.currentPolicy.replanThresholdSec <= 1.25 &&
        conflictPed
      ) {
        if (temporaryObstructionPresent) {
          this.unnecessaryReplanCount += 1;
        }
        this.attemptDynamicReplanAroundPedestrians(
          conflictPed.name,
          predictive.penaltyZones,
          true
        );
        this.episodeActionCounts.GLOBAL_REPLAN += 1;
        if (this.decisionHistory.length < 25) {
          this.decisionHistory.push(
            `[t=${this.elapsedTimeSec.toFixed(1)}s] Baseline Proactive Global Replan (${conflictPed.name})`
          );
        }
      }

      // Case A: Conflict cleared -> Return to LEVEL 1: MAINTAIN CURRENT PATH
      if (!hasPredictiveConflict && !hasActiveHazard) {
        this.episodeActionCounts.MAINTAIN_SPEED += 1;
        this.episodeReward += 0.35;
        if (this.inSpeedReductionEpisode) {
          this.inSpeedReductionEpisode = false;
          if (!this.activeConflictHadStopOrReplan) {
            this.speedBasedAvoidanceCount += 1;
            const avoidKey = `${this.activeConflictPedId ?? 'ped'}-${Math.floor(
              this.elapsedTimeSec / 2.5
            )}`;
            if (!this.recordedAvoidedKeys.has(avoidKey)) {
              this.recordedAvoidedKeys.add(avoidKey);
              this.avoidedEncountersCount += 1;
            }
          }
          this.activeConflictHadStopOrReplan = false;
          this.activeConflictPedId = null;
        }

        this.stopStartedWithoutClosePed = false;
        this.pedestrianYieldTimerSec = Math.max(
          0,
          this.pedestrianYieldTimerSec - subDt * 0.8
        );

        if (this.robotOpState === 'WaitingForClearPath') {
          this.deadlockWaitTimerSec = 0;
          this.deadlockRetryCount = 0;
          this.robotOpState = 'Navigating';
          this.navStatusText = `Path cleared — resuming original route (${this.waypoints.length} nodes)`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        } else if (
          this.robotOpState === 'Speed Regulation' ||
          this.robotOpState === 'Obstacle Yield' ||
          this.robotOpState === 'Pedestrian Detected' ||
          (this.robotOpState === 'Local Bypass' &&
            this.localBypassCooldownSec <= 0) ||
          (this.robotOpState === 'Replanning Path' && this.replanCooldownSec <= 0)
        ) {
          this.robotOpState = 'Navigating';
          this.navStatusText = this.pathDiagnostics.detourActive
            ? `Navigating route (${this.waypoints.length} nodes)`
            : `Cruising via ${this.currentPolicy.algorithm}`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        }

        if (
          this.localBypassCooldownSec <= 0 &&
          this.replanCooldownSec <= 0
        ) {
          this.activeAvoidanceLevel = 'Level 1: Maintain Path';
        }
      } else {
        // Track speed reduction episode start
        if (!this.inSpeedReductionEpisode && conflictPed) {
          this.inSpeedReductionEpisode = true;
          this.activeConflictHadStopOrReplan = false;
          this.activeConflictPedId = conflictPed.id;
          this.speedReductionEventsCount += 1;
          if (this.decisionHistory.length < 25) {
            this.decisionHistory.push(
              `[t=${this.elapsedTimeSec.toFixed(1)}s] Baseline Speed Modulation (${conflictPed.name})`
            );
          }
        }

        // Check if LEVEL 3 (Temporary Stop) is required to protect the collision safety boundary
        if (hazard.imminentStopRequired && conflictPed) {
          if (this.safetyInterventionCooldownSec <= 0) {
            this.safetyInterventionCount += 1;
            this.safetyInterventionCooldownSec = 2.0;
          }
          desiredSpeed = 0;
          this.pedestrianYieldTimerSec += subDt;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.activeConflictHadStopOrReplan = true;
          this.episodeActionCounts.STOP_TEMPORARILY += 1;
          this.episodeReward -= 0.45;

          if (
            (hazard.nearestActualDist ?? 99) > 1.8 &&
            !this.stopStartedWithoutClosePed
          ) {
            this.stopStartedWithoutClosePed = true;
            this.unnecessaryStopsCount += 1;
          }

          const pedSpeed = Math.hypot(
            conflictPed.velocity.x,
            conflictPed.velocity.z
          );
          const pedIsMovingTransversely =
            pedSpeed > 0.25 && !hazard.sameDirectionAhead;

          // Wait longer for a moving crossing pedestrian to clear before escalating to Level 4/5
          const localBypassTriggerSec = pedIsMovingTransversely ? 1.85 : 1.05;
          const globalReplanTriggerSec = pedIsMovingTransversely
            ? Math.max(2.8, this.currentPolicy.replanThresholdSec * 2.0)
            : Math.max(1.85, this.currentPolicy.replanThresholdSec * 1.35);

          // Escalation to LEVEL 4: LOCAL AVOIDANCE (LOCAL BYPASS)
          let resolvedByLocalOrGlobal = false;
          if (
            this.pedestrianYieldTimerSec >= localBypassTriggerSec &&
            this.localBypassCooldownSec <= 0
          ) {
            const bypass = computeLocalBypassWaypoints(
              this.robotPos,
              this.waypoints,
              this.currentWaypointIdx,
              conflictPed,
              this.currentScenario.activeConstructionZones,
              this.pedestrianAgents
            );

            if (bypass) {
              this.waypoints = bypass.splicedWaypoints;
              this.currentWaypointIdx = bypass.resumeIdx;
              this.localBypassCount += 1;
              this.avoidedEncountersCount += 1;
              this.episodeActionCounts.LOCAL_AVOIDANCE += 1;
              this.localBypassCooldownSec = 2.4;
              this.pedestrianYieldTimerSec = 0;
              this.activeAvoidanceLevel = 'Level 4: Local Bypass';
              this.robotOpState = 'Local Bypass';
              this.navStatusText = `Level 4 Local Bypass: Passing around ${conflictPed.name}`;
              desiredSpeed = nominalCruiseSpeed * 0.65;
              this.emitPathUpdate();
              this.callbacks.onStatusChanged?.(
                this.robotOpState,
                this.navStatusText
              );
              this.callbacks.onLogEvent?.(
                'info',
                `Level 4 Local Avoidance: Spliced local bypass around ${conflictPed.name} while preserving global route.`
              );
              resolvedByLocalOrGlobal = true;
            }
          }

          // Escalation to LEVEL 5: GLOBAL REPLANNING (only if Level 4 local bypass failed and obstruction persists)
          if (
            !resolvedByLocalOrGlobal &&
            this.pedestrianYieldTimerSec >= globalReplanTriggerSec &&
            this.replanCooldownSec <= 0
          ) {
            this.pedestrianYieldTimerSec = 0;
            if (temporaryObstructionPresent) {
              this.unnecessaryReplanCount += 1;
            }
            const replannedOk = this.attemptDynamicReplanAroundPedestrians(
              conflictPed.name,
              predictive.penaltyZones,
              false
            );
            this.episodeActionCounts.GLOBAL_REPLAN += 1;

            if (replannedOk) {
              this.avoidedEncountersCount += 1;
              desiredSpeed = nominalCruiseSpeed * 0.65;
              resolvedByLocalOrGlobal = true;
            } else {
              this.deadlockRetryCount += 1;
              this.replanCooldownSec = 1.1;
              this.robotOpState = 'WaitingForClearPath';
              this.navStatusText = `Level 3 Stop / WaitingForClearPath: Blocked by ${conflictPed.name} (Retry ${this.deadlockRetryCount}/${this.maxDeadlockRetries})`;
              this.callbacks.onStatusChanged?.(
                this.robotOpState,
                this.navStatusText
              );
            }
          }

          // Stay in LEVEL 3: TEMPORARY STOP while waiting for pedestrian to clear
          if (!resolvedByLocalOrGlobal) {
            this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
            if (this.robotOpState !== 'WaitingForClearPath') {
              this.robotOpState = 'Obstacle Yield';
              this.navStatusText = `Level 3 Temporary Stop: Yielding to ${
                conflictPed.name
              } (${(
                hazard.nearestPerceivedDist ??
                hazard.nearestActualDist ??
                0
              ).toFixed(1)}m)`;
              this.callbacks.onStatusChanged?.(
                this.robotOpState,
                this.navStatusText
              );
            }
          }
        } else {
          // LEVEL 2: INTELLIGENT SPEED REGULATION (Maintain current A* route, modulate speed smoothly)
          this.activeAvoidanceLevel = 'Level 2: Speed Regulation';
          this.reducedSpeedTimeSec += subDt;
          this.episodeActionCounts.REDUCE_SPEED += 1;
          this.episodeReward += 0.25;

          if (
            hazard.sameDirectionAhead ||
            predictive.isSameDirectionConflict
          ) {
            const followSpd =
              hazard.sameDirectionPedSpeedMps ??
              predictive.followingSpeedMps ??
              1.1;
            desiredSpeed = Math.min(
              desiredSpeed,
              Math.max(0.48, followSpd * 0.92)
            );
          } else {
            const scale = Math.min(
              predictive.recommendedSpeedScale,
              hazard.speedScaleFactor
            );
            desiredSpeed *= Math.max(0.28, Math.min(0.86, scale));
          }

          if (
            conflictPed &&
            Math.hypot(conflictPed.velocity.x, conflictPed.velocity.z) < 0.15 &&
            hazard.pathObstructedAhead
          ) {
            this.pedestrianYieldTimerSec += subDt;
            if (
              this.pedestrianYieldTimerSec >= 1.25 &&
              this.localBypassCooldownSec <= 0
            ) {
              const bypass = computeLocalBypassWaypoints(
                this.robotPos,
                this.waypoints,
                this.currentWaypointIdx,
                conflictPed,
                this.currentScenario.activeConstructionZones,
                this.pedestrianAgents
              );
              if (bypass) {
                this.waypoints = bypass.splicedWaypoints;
                this.currentWaypointIdx = bypass.resumeIdx;
                this.localBypassCount += 1;
                this.avoidedEncountersCount += 1;
                this.episodeActionCounts.LOCAL_AVOIDANCE += 1;
                this.localBypassCooldownSec = 2.4;
                this.pedestrianYieldTimerSec = 0;
                this.activeConflictHadStopOrReplan = true;
                this.activeAvoidanceLevel = 'Level 4: Local Bypass';
                this.robotOpState = 'Local Bypass';
                this.navStatusText = `Level 4 Local Bypass: Detouring around stationary ${conflictPed.name}`;
                this.emitPathUpdate();
                this.callbacks.onStatusChanged?.(
                  this.robotOpState,
                  this.navStatusText
                );
              }
            }
          } else {
            this.pedestrianYieldTimerSec = Math.max(
              0,
              this.pedestrianYieldTimerSec - subDt * 0.4
            );
          }

          if (
            this.activeAvoidanceLevel === 'Level 2: Speed Regulation' &&
            this.robotOpState !== 'Local Bypass' &&
            this.robotOpState !== 'Replanning Path'
          ) {
            this.robotOpState = 'Speed Regulation';
            const ttcLabel =
              this.estimatedTtcSec !== null
                ? `TTC ${this.estimatedTtcSec.toFixed(1)}s`
                : `PCA ${(this.closestApproachDistanceM ?? 1.2).toFixed(1)}m`;
            this.navStatusText = `Level 2 Speed Regulation (${desiredSpeed.toFixed(
              2
            )} m/s · ${ttcLabel}) for ${conflictPed?.name ?? 'pedestrian'}`;
            this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          }
        }

        // Deadlock timeout safeguard if trapped in WaitingForClearPath
        if (this.robotOpState === 'WaitingForClearPath' && conflictPed) {
          this.deadlockWaitTimerSec += subDt;
          if (
            this.deadlockRetryCount >= this.maxDeadlockRetries ||
            this.deadlockWaitTimerSec >= this.maxDeadlockWaitSec
          ) {
            this.deadlockCount += 1;
            const reason = `Pathway Deadlock: All safe routes remained blocked by ${
              conflictPed.name
            } after ${this.deadlockRetryCount} replanning retries (${this.totalWaitingTimeSec.toFixed(
              1
            )}s waiting time).`;
            this.runState = 'failed';
            this.currentSpeedMps = 0;
            this.robotOpState = 'Emergency Stop';
            this.navStatusText = reason;
            this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
            this.callbacks.onLogEvent?.('error', reason);
            this.emitCompletion({
              status: 'Failed',
              durationSec: Number(this.elapsedTimeSec.toFixed(1)),
              distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
              collisions: this.collisionsCount,
              replanCount: this.replanCount,
              pedestrianDetectionsCount: this.pedestrianDetectionsCount,
              predictedEncountersCount: this.predictedEncountersCount,
              avoidedEncountersCount: this.avoidedEncountersCount,
              unnecessaryStopsCount: this.unnecessaryStopsCount,
              predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
              pedestrianReplanCount: this.pedestrianReplanCount,
              speedReductionEventsCount: this.speedReductionEventsCount,
              reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
              pedestrianWaitingTimeSec: Number(
                this.pedestrianWaitingTimeSec.toFixed(1)
              ),
              speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
              localBypassCount: this.localBypassCount,
              globalReplanCount: this.globalReplanCount,
              totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
              elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
              batteryConsumedPct: Number(
                (this.initialBatteryPct - this.batteryPct).toFixed(1)
              ),
              failureType: 'Pathway Deadlock',
              obstacleType: 'Dynamic Pedestrian',
              failureReason: reason,
              rootCause: reason,
              mitigationSuggested:
                'Train Candidate Policy on dense pedestrian bottlenecks to trigger earlier local bypasses.',
              failureCoordinates: {
                x: Number(this.robotPos.x.toFixed(1)),
                z: Number(this.robotPos.z.toFixed(1)),
              },
            });
            return;
          }
        }
      }
    }

    // 4. Smooth Physical Acceleration & Deceleration (Rate-Limited + Exponential Smoothing)
    this.targetSpeedMps = desiredSpeed;
    if (desiredSpeed === 0 && hazard.imminentStopRequired) {
      // Smooth emergency braking before entering safety boundary
      const maxBrakeStep = 5.2 * subDt;
      this.currentSpeedMps =
        this.currentSpeedMps <= maxBrakeStep
          ? 0
          : this.currentSpeedMps - maxBrakeStep;
    } else if (desiredSpeed < this.currentSpeedMps) {
      // Smooth deceleration (max 2.4 m/s^2)
      const maxDecelStep = 2.4 * subDt;
      const diff = this.currentSpeedMps - desiredSpeed;
      this.currentSpeedMps -= Math.min(diff, maxDecelStep);
    } else if (desiredSpeed > this.currentSpeedMps) {
      // Smooth acceleration (max 1.85 m/s^2)
      const maxAccelStep = 1.85 * subDt;
      const diff = desiredSpeed - this.currentSpeedMps;
      this.currentSpeedMps += Math.min(diff, maxAccelStep);
    }

    const targetWp = this.waypoints[this.currentWaypointIdx];
    if (!targetWp) return;

    const dx = targetWp.x - this.robotPos.x;
    const dz = targetWp.z - this.robotPos.z;
    const distToWp = Math.hypot(dx, dz);

    if (distToWp >= 0.05) {
      const desiredHeading = Math.atan2(dx, dz);
      let angleDiff = desiredHeading - this.robotHeading;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      this.robotHeading += angleDiff * Math.min(1, subDt * 12.0);
    }

    if (distToWp < 0.35) {
      if (this.currentWaypointIdx < this.waypoints.length - 1) {
        this.currentWaypointIdx += 1;
      } else {
        // If in an intermediate elevator phase, snap to the target waypoint and immediately advance the elevator state machine
        if (
          this.requiresElevator &&
          this.elevatorMissionPhase !== 'exiting-to-destination'
        ) {
          this.robotPos = {
            x: targetWp.x,
            z: targetWp.z,
            y: targetWp.y ?? this.robotAltitudeY,
            floor: targetWp.floor ?? this.currentFloor,
          };
          this.currentSpeedMps = 0;
          this.stepElevatorStateMachine(subDt);
          return;
        }

        // Reached final destination! Verify genuine arrival at destination coordinates (1F/2F indoor room or outdoor dock)
        const activeElevCfg = this.getActiveElevatorConfig();
        const targetLoc = this.getTargetLocation();
        const finalGoalCoords: Vector2D =
          this.requiresElevator && activeElevCfg && targetLoc.isIndoor
            ? this.getTargetDestinationRoomCoords(activeElevCfg)
            : { x: targetLoc.position[0], z: targetLoc.position[2] };
        const finalGoalName =
          this.requiresElevator && activeElevCfg && targetLoc.isIndoor
            ? `${this.getTargetDestinationRoomName(activeElevCfg)} (${
                activeElevCfg.buildingName
              })`
            : targetLoc.name;

        const distToDest = Math.hypot(
          finalGoalCoords.x - this.robotPos.x,
          finalGoalCoords.z - this.robotPos.z
        );
        if (distToDest <= 1.2) {
          // Preserve the robot's final physical position & heading at the destination
          this.robotPos = {
            x: finalGoalCoords.x,
            z: finalGoalCoords.z,
            y: finalGoalCoords.y ?? this.robotAltitudeY,
            floor: finalGoalCoords.floor ?? this.currentFloor,
          };
          this.runState = 'completed';
          this.currentSpeedMps = 0;
          this.distanceRemainingM = 0;
          this.robotOpState = 'Delivering Payload';
          this.navStatusText = `Arrived at ${finalGoalName}`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          this.callbacks.onLogEvent?.(
            'success',
            `Delivery completed at ${finalGoalName} in ${this.elapsedTimeSec.toFixed(
              1
            )}s.`
          );
          this.emitCompletion({
            status: 'Success',
            durationSec: Number(this.elapsedTimeSec.toFixed(1)),
            distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
            collisions: this.collisionsCount,
            replanCount: this.replanCount,
            pedestrianDetectionsCount: this.pedestrianDetectionsCount,
            predictedEncountersCount: this.predictedEncountersCount,
            avoidedEncountersCount: this.avoidedEncountersCount,
            unnecessaryStopsCount: this.unnecessaryStopsCount,
            predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
            pedestrianReplanCount: this.pedestrianReplanCount,
            speedReductionEventsCount: this.speedReductionEventsCount,
            reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
            pedestrianWaitingTimeSec: Number(
              this.pedestrianWaitingTimeSec.toFixed(1)
            ),
            speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
            localBypassCount: this.localBypassCount,
            globalReplanCount: this.globalReplanCount,
            totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
            elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
            elevatorUsed: this.requiresElevator,
            elevatorStateEncountered: this.elevatorStateEncountered,
            elevatorFaultMode: this.elevatorFaultMode,
            elevatorReroutedToBackup: this.elevatorReroutedToBackup,
            elevatorEventsLog: [...this.elevatorEventsLog],
            batteryConsumedPct: Number(
              (this.initialBatteryPct - this.batteryPct).toFixed(1)
            ),
          });
          return;
        }
      }
    } else if (this.currentSpeedMps > 0.001) {
      const stepM = Math.min(distToWp, this.currentSpeedMps * subDt);
      const candidatePos: Vector2D = {
        x: this.robotPos.x + (dx / distToWp) * stepM,
        z: this.robotPos.z + (dz / distToWp) * stepM,
        y: targetWp.y ?? this.robotAltitudeY,
        floor: targetWp.floor ?? this.currentFloor,
      };

      const pedCircles: CollisionCircle[] = this.pedestrianAgents.map((o) => ({
        id: o.id,
        name: o.name,
        type: 'Dynamic Pedestrian',
        x: o.currentPos.x,
        z: o.currentPos.z,
        radius: o.radius,
      }));

      const activeElev = this.getActiveElevatorUnit();
      const activeElevCfg = this.getActiveElevatorConfig();
      const doorOpen = Boolean(
        this.elevatorMissionPhase === 'boarding-cabin' ||
          this.elevatorMissionPhase === 'exiting-to-destination' ||
          (activeElev && (activeElev.doorOpenProgress ?? 0) >= 0.45)
      );

      const bot = this.getCurrentRobot();
      const hit = checkSweptRobotCollision(
        this.robotPos,
        candidatePos,
        bot.collisionRadiusM ?? ROBOT_COLLISION_RADIUS,
        this.currentScenario.activeConstructionZones,
        pedCircles,
        activeElevCfg,
        doorOpen
      );

      if (hit && hit.collided) {
        if (hit.obstacleType === 'Dynamic Pedestrian') {
          if (this.safetyInterventionCooldownSec <= 0) {
            this.safetyInterventionCount += 1;
            this.safetyInterventionCooldownSec = 2.0;
          }
          this.robotPos = hit.safePosition;
          this.currentSpeedMps = 0;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
          this.robotOpState = 'Obstacle Yield';
          this.navStatusText = `Level 3 Temporary Stop: Yielding safely before ${hit.obstacleName}`;
          this.callbacks.onStatusChanged?.(
            this.robotOpState,
            this.navStatusText
          );
          return;
        }

        // Static construction barrier or building impact records a collision failure
        this.robotPos = hit.safePosition;
        this.currentSpeedMps = 0;
        this.collisionsCount += 1;

        const failureType: FailureType = 'Collision with Barrier';
        const reason = `${failureType}: Impacted ${
          hit.obstacleName
        } at (${hit.contactPoint.x.toFixed(1)}, ${hit.contactPoint.z.toFixed(
          1
        )}) under ${this.currentPolicy.name}`;

        this.robotOpState = 'Emergency Stop';
        this.navStatusText = `Collision detected with ${
          hit.obstacleName
        } at (${hit.contactPoint.x.toFixed(1)}, ${hit.contactPoint.z.toFixed(1)})`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.(
          'error',
          `Collision with ${hit.obstacleType} (${
            hit.obstacleName
          }) at (${hit.contactPoint.x.toFixed(1)}, ${hit.contactPoint.z.toFixed(
            1
          )})!`
        );

        this.runState = 'failed';
        this.emitCompletion({
          status: 'Failed',
          durationSec: Number(this.elapsedTimeSec.toFixed(1)),
          distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
          collisions: this.collisionsCount,
          replanCount: this.replanCount,
          pedestrianDetectionsCount: this.pedestrianDetectionsCount,
          predictedEncountersCount: this.predictedEncountersCount,
          avoidedEncountersCount: this.avoidedEncountersCount,
          unnecessaryStopsCount: this.unnecessaryStopsCount,
          predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
          pedestrianReplanCount: this.pedestrianReplanCount,
          speedReductionEventsCount: this.speedReductionEventsCount,
          reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
          pedestrianWaitingTimeSec: Number(
            this.pedestrianWaitingTimeSec.toFixed(1)
          ),
          speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
          localBypassCount: this.localBypassCount,
          globalReplanCount: this.globalReplanCount,
          totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
          elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
          batteryConsumedPct: Number(
            (this.initialBatteryPct - this.batteryPct).toFixed(1)
          ),
          failureType,
          obstacleType: hit.obstacleType,
          failureReason: reason,
          rootCause: reason,
          mitigationSuggested:
            'Activate Hybrid A* Safety-First v2.1 or Resilient Risk-Aware Policy v3.0 to increase safety clearance and replanning horizon.',
          failureCoordinates: {
            x: Number(hit.contactPoint.x.toFixed(1)),
            z: Number(hit.contactPoint.z.toFixed(1)),
          },
        });
        return;
      }

      this.robotPos = candidatePos;
      this.distanceTraveledM += stepM;

      const remSlice = [
        {
          x: this.robotPos.x,
          z: this.robotPos.z,
          y: this.robotAltitudeY,
          floor: this.currentFloor,
        },
        ...this.waypoints.slice(this.currentWaypointIdx),
      ];
      this.distanceRemainingM = calculatePathDistance(remSlice);

      this.batteryPct = Math.max(
        0,
        this.batteryPct -
          stepM * 0.065 * this.currentScenario.batteryDrainMultiplier
      );

      // Record downsampled trajectory point every 0.5s for Before vs After Demonstration
      if (
        this.lastTrajectorySampleTimeSec < 0 ||
        this.elapsedTimeSec - this.lastTrajectorySampleTimeSec >= 0.5
      ) {
        this.lastTrajectorySampleTimeSec = this.elapsedTimeSec;
        this.trajectorySamples.push({
          t: Number(this.elapsedTimeSec.toFixed(1)),
          x: Number(this.robotPos.x.toFixed(2)),
          z: Number(this.robotPos.z.toFixed(2)),
          y: Number(this.robotAltitudeY.toFixed(2)),
          floor: this.currentFloor,
          speedMps: Number(this.currentSpeedMps.toFixed(2)),
          robotStatus: this.robotOpState,
          actionTaken: this.lastRlAction ?? this.activeAvoidanceLevel,
          replanCount: this.globalReplanCount,
          waitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
          safetyInterventions: this.safetyInterventionCount,
        });
      }

      // Check for Battery Depletion Failure
      if (this.batteryPct <= 0.5) {
        const reason = `Battery Depletion: Charge exhausted (${this.batteryPct.toFixed(
          1
        )}% remaining from ${this.initialBatteryPct.toFixed(
          1
        )}% initial) after ${this.distanceTraveledM.toFixed(1)}m.`;
        this.runState = 'failed';
        this.currentSpeedMps = 0;
        this.robotOpState = 'Emergency Stop';
        this.navStatusText = reason;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('error', reason);
        this.emitCompletion({
          status: 'Failed',
          durationSec: Number(this.elapsedTimeSec.toFixed(1)),
          distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
          collisions: this.collisionsCount,
          replanCount: this.replanCount,
          pedestrianDetectionsCount: this.pedestrianDetectionsCount,
          predictedEncountersCount: this.predictedEncountersCount,
          avoidedEncountersCount: this.avoidedEncountersCount,
          unnecessaryStopsCount: this.unnecessaryStopsCount,
          predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
          pedestrianReplanCount: this.pedestrianReplanCount,
          speedReductionEventsCount: this.speedReductionEventsCount,
          reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
          pedestrianWaitingTimeSec: Number(
            this.pedestrianWaitingTimeSec.toFixed(1)
          ),
          speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
          localBypassCount: this.localBypassCount,
          globalReplanCount: this.globalReplanCount,
          totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
          elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
          batteryConsumedPct: Number(
            (this.initialBatteryPct - this.batteryPct).toFixed(1)
          ),
          failureType: 'Battery Depletion',
          obstacleType: 'Battery Reserve',
          failureReason: reason,
          rootCause: reason,
          mitigationSuggested:
            'Minimize detour distance and unnecessary replanning or dispatch with >= 45% initial charge.',
          failureCoordinates: {
            x: Number(this.robotPos.x.toFixed(1)),
            z: Number(this.robotPos.z.toFixed(1)),
          },
        });
        return;
      }
    }

    // Check for Excessive Delivery Time / Mission Timeout
    if (this.elapsedTimeSec >= 115.0) {
      const reason = `Excessive delivery time: Mission exceeded 115.0s operational time limit (Wait time: ${this.totalWaitingTimeSec.toFixed(
        1
      )}s, Replans: ${this.globalReplanCount}).`;
      this.runState = 'failed';
      this.currentSpeedMps = 0;
      this.robotOpState = 'Emergency Stop';
      this.navStatusText = reason;
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      this.callbacks.onLogEvent?.('error', reason);
      this.emitCompletion({
        status: 'Failed',
        durationSec: Number(this.elapsedTimeSec.toFixed(1)),
        distanceMeters: Number(this.distanceTraveledM.toFixed(1)),
        collisions: this.collisionsCount,
        replanCount: this.replanCount,
        pedestrianDetectionsCount: this.pedestrianDetectionsCount,
        predictedEncountersCount: this.predictedEncountersCount,
        avoidedEncountersCount: this.avoidedEncountersCount,
        unnecessaryStopsCount: this.unnecessaryStopsCount,
        predictionAccuracyPct: Number(this.predictionAccuracyPct.toFixed(1)),
        pedestrianReplanCount: this.pedestrianReplanCount,
        speedReductionEventsCount: this.speedReductionEventsCount,
        reducedSpeedTimeSec: Number(this.reducedSpeedTimeSec.toFixed(1)),
        pedestrianWaitingTimeSec: Number(
          this.pedestrianWaitingTimeSec.toFixed(1)
        ),
        speedBasedAvoidanceCount: this.speedBasedAvoidanceCount,
        localBypassCount: this.localBypassCount,
        globalReplanCount: this.globalReplanCount,
        totalWaitingTimeSec: Number(this.totalWaitingTimeSec.toFixed(1)),
        elevatorWaitTimeSec: Number(this.elevatorWaitTimeSec.toFixed(1)),
        batteryConsumedPct: Number(
          (this.initialBatteryPct - this.batteryPct).toFixed(1)
        ),
        failureType: 'Mission Timeout',
        obstacleType: 'Corridor Delay',
        failureReason: reason,
        rootCause: reason,
        mitigationSuggested:
          'Train Candidate Q-Learning Policy to regulate speed smoothly and execute local bypasses rather than prolonged stops.',
        failureCoordinates: {
          x: Number(this.robotPos.x.toFixed(1)),
          z: Number(this.robotPos.z.toFixed(1)),
        },
      });
    }
  }

  private emitCompletion(
    partial: Omit<
      SimulationCompletionData,
      | 'runSessionId'
      | 'scenarioId'
      | 'scenarioName'
      | 'scenarioSeed'
      | 'robotId'
      | 'robotName'
      | 'policyId'
      | 'policyName'
      | 'policyVersion'
      | 'isCandidatePolicy'
      | 'originName'
      | 'destinationName'
      | 'originFloor'
      | 'destinationFloor'
      | 'safetyInterventionCount'
      | 'unnecessaryReplanCount'
      | 'deadlockCount'
      | 'episodeReward'
      | 'decisionHistory'
      | 'robotStateBeforeCompletion'
      | 'environmentalConditionsSummary'
      | 'episodeActionCounts'
    >
  ): void {
    if (this.completionEmittedForSession) return;
    this.completionEmittedForSession = true;

    const bot = this.getCurrentRobot();
    const origin = this.getOriginLocation();
    const target = this.getTargetLocation();
    const activeElevCfg = this.getActiveElevatorConfig();
    const distConfig = derivePedestrianDistribution(
      this.currentScenario.dynamicObstacleCount,
      this.pedestrianDistributionOverride ??
        this.currentScenario.pedestrianDistribution
    );

    const terminalReward = computeTerminalEpisodeReward(partial.status, {
      collisions: partial.collisions,
      durationSec: partial.durationSec,
      unnecessaryReplans: this.unnecessaryReplanCount,
      deadlockOccurred:
        this.deadlockCount > 0 || partial.failureType === 'Pathway Deadlock',
      waitingTimeSec: partial.totalWaitingTimeSec,
      safetyInterventions: this.safetyInterventionCount,
    });
    this.episodeReward = Number((this.episodeReward + terminalReward).toFixed(1));

    // Propagate terminal reward to visited state-action pairs during training episode
    if (this.isTrainingEpisode && this.candidatePolicyState) {
      if (this.lastRlStateKey && this.lastRlAction) {
        updateQTableStep(
          this.candidatePolicyState,
          this.lastRlStateKey,
          this.lastRlAction,
          terminalReward * 0.35,
          null,
          true
        );
        this.qTableUpdatesCount += 1;
      }
      // Eligibility trace credit assignment over the episode's key decision steps
      const traceLen = this.episodeTrajectoryTrace.length;
      const perStepBonus =
        partial.status === 'Success'
          ? 2.8
          : partial.collisions > 0
          ? -5.0
          : -3.5;
      for (let i = Math.max(0, traceLen - 12); i < traceLen; i++) {
        const item = this.episodeTrajectoryTrace[i];
        // Reinforce good local decisions (REDUCE_SPEED / LOCAL_AVOIDANCE) on successful episodes
        const actionBonus =
          partial.status === 'Success' &&
          (item.action === 'REDUCE_SPEED' || item.action === 'LOCAL_AVOIDANCE')
            ? perStepBonus * 1.5
            : item.action === 'GLOBAL_REPLAN'
            ? -3.0
            : item.action === 'STOP_TEMPORARILY' && partial.status === 'Failed'
            ? -4.0
            : perStepBonus * 0.6;
        updateQTableStep(
          this.candidatePolicyState,
          item.stateKey,
          item.action,
          actionBonus,
          null,
          true
        );
        this.qTableUpdatesCount += 1;
      }
    }

    const robotStateBeforeCompletion = `Pos (${this.robotPos.x.toFixed(
      1
    )}m, ${this.robotPos.z.toFixed(1)}m, y=${this.robotAltitudeY.toFixed(
      1
    )}m) · Floor ${this.currentFloor} (${this.getFloorLabel(
      this.currentFloor
    )}) · Speed ${this.currentSpeedMps.toFixed(
      2
    )} m/s · Battery ${this.batteryPct.toFixed(1)}% · Avoidance: ${
      this.activeAvoidanceLevel
    }`;

    const environmentalConditionsSummary = `Seed: ${
      this.currentScenario.randomSeed ?? distConfig.randomSeed ?? 101
    } · Floors: ${this.getFloorLabel(this.originFloor)} → ${this.getFloorLabel(
      this.targetFloor
    )} · Pedestrians: ${
      this.currentScenario.dynamicObstacleCount
    } (${distConfig.commuterCount}C/${distConfig.randomCount}R/${
      distConfig.crossingCount
    }X/${distConfig.groupCount}G) · Zones: ${
      this.currentScenario.activeConstructionZones.length
    } · Traction: ${(this.currentScenario.surfaceTraction * 100).toFixed(
      0
    )}% · Sensor Noise: ±${(
      this.currentScenario.sensorNoiseLevel * 100
    ).toFixed(0)}%`;

    this.callbacks.onComplete?.({
      runSessionId: this.activeRunSessionId || `SESSION-${Date.now()}`,
      environmentId:
        this.currentEnvironment?.id ??
        this.currentScenario.environmentId ??
        'env-campus-main',
      environmentName:
        this.currentEnvironment?.name ??
        this.currentScenario.environmentName ??
        'University Innovation Campus (Multi-Floor)',
      environmentVersion:
        this.currentEnvironment?.version ??
        this.currentScenario.environmentVersion ??
        '2.4.0',
      scenarioId: this.currentScenario.id,
      scenarioName: this.currentScenario.name,
      scenarioSeed:
        this.currentScenario.randomSeed ?? distConfig.randomSeed ?? 101,
      robotId: bot.id,
      robotName: bot.name,
      robotHardwareSummary: formatRobotHardwareSummary(bot),
      robotConfigSnapshot: { ...bot },
      payloadKg:
        this.activePayloadKg ??
        bot.defaultPayloadKg ??
        Math.round(bot.payloadCapacityKg * 0.4),
      policyId: this.currentPolicy.id,
      policyName: this.candidatePolicyState
        ? `${this.candidatePolicyState.name} (${this.candidatePolicyState.version})`
        : this.currentPolicy.name,
      policyVersion: this.candidatePolicyState
        ? this.candidatePolicyState.version
        : this.currentPolicy.version,
      isCandidatePolicy: Boolean(
        this.candidatePolicyState || this.currentPolicy.isCandidatePolicy
      ),
      originName: origin.name,
      destinationName:
        this.requiresElevator && activeElevCfg && target.isIndoor
          ? `${this.getTargetDestinationRoomName(activeElevCfg)} (${
              activeElevCfg.buildingName
            })`
          : target.name,
      originFloor: this.originFloor,
      destinationFloor: this.targetFloor,
      originCoordinates: { ...this.initialStartCoords },
      destinationCoordinates: {
        x: Number(target.position[0].toFixed(1)),
        z: Number(target.position[2].toFixed(1)),
        y: Number(((this.targetFloor ?? 0) * 3.6).toFixed(2)),
        floor: this.targetFloor,
      },
      safetyInterventionCount: this.safetyInterventionCount,
      unnecessaryReplanCount: this.unnecessaryReplanCount,
      deadlockCount:
        this.deadlockCount ||
        (partial.failureType === 'Pathway Deadlock' ? 1 : 0),
      episodeReward: this.episodeReward,
      qTableUpdatesCount: this.qTableUpdatesCount,
      trajectorySamples: [
        ...this.trajectorySamples,
        {
          t: Number(partial.durationSec.toFixed(1)),
          x: Number(this.robotPos.x.toFixed(2)),
          z: Number(this.robotPos.z.toFixed(2)),
          y: Number(this.robotAltitudeY.toFixed(2)),
          floor: this.currentFloor,
          speedMps: 0,
          robotStatus: partial.status === 'Success' ? 'Delivered' : 'Halted',
          actionTaken: partial.status,
          replanCount: this.globalReplanCount,
          waitingTimeSec: Number(partial.totalWaitingTimeSec.toFixed(1)),
          safetyInterventions: this.safetyInterventionCount,
        },
      ],
      decisionHistory:
        this.decisionHistory.length > 0
          ? [...this.decisionHistory]
          : [
              `[t=0.0s] Dispatched via ${this.currentPolicy.algorithm}`,
              `[t=${partial.durationSec.toFixed(1)}s] Mission ${partial.status} (${this.speedBasedAvoidanceCount} speed modulations, ${this.localBypassCount} local bypasses, ${this.globalReplanCount} global replans, ${this.safetyInterventionCount} safety interventions)`,
            ],
      robotStateBeforeCompletion,
      environmentalConditionsSummary,
      episodeActionCounts: { ...this.episodeActionCounts },
      pedestrianDistribution: distConfig,
      predictionHorizonSec: this.predictionHorizonSec,
      elevatorAssistanceRequested: Boolean(
        this.robotOpState === 'Awaiting Assistance' ||
          this.elevatorStateEncountered === 'Stuck' ||
          this.elevatorStateEncountered === 'Emergency Assistance'
      ),
      ...partial,
    });
  }
}
