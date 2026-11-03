import {
  CAMPUS_ELEVATORS,
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
  ROBOT_UNITS,
} from '../data/campusConfig';
import {
  AvoidanceHierarchyLevel,
  CampusElevatorConfig,
  CandidatePolicyState,
  ElevatorFaultMode,
  ElevatorState,
  ElevatorUnitStatus,
  FailureType,
  LiveTelemetry,
  NavigationPolicyConfig,
  PedestrianDistributionConfig,
  PredictedConflictPoint,
  PredictionHorizonSec,
  QLearningAction,
  QLearningObservation,
  RobotOperationalState,
  ScenarioConfig,
  SimulationLogEntry,
  SimulationRunState,
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
  scenarioId: string;
  scenarioName: string;
  scenarioSeed?: number;
  robotId: string;
  robotName: string;
  policyId: string;
  policyName: string;
  policyVersion?: string;
  isCandidatePolicy?: boolean;
  originName: string;
  destinationName: string;
  status: 'Success' | 'Failed';
  durationSec: number;
  distanceMeters: number;
  collisions: number;
  replanCount: number;
  unnecessaryReplanCount: number;
  deadlockCount: number;
  episodeReward: number;
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

  public currentScenario: ScenarioConfig;
  public currentPolicy: NavigationPolicyConfig;
  public currentRobotId: string;
  public destinationOverrideId: string | null = null;

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
    callbacks: NavigationControllerCallbacks = {}
  ) {
    this.currentScenario = scenario;
    this.currentPolicy = policy;
    this.currentRobotId = robotId;
    this.callbacks = callbacks;
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
    requiresElevator = true
  ): void {
    this.elevatorFaultModeOverride = faultMode;
    this.currentScenario = {
      ...this.currentScenario,
      requiresElevator,
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

  public getCurrentRobot() {
    return ROBOT_UNITS.find((r) => r.id === this.currentRobotId) ?? ROBOT_UNITS[0];
  }

  public getOriginLocation() {
    return (
      DELIVERY_LOCATIONS.find((l) => l.id === this.currentScenario.originId) ??
      DELIVERY_LOCATIONS[1]
    );
  }

  public getTargetLocation() {
    const destId = this.destinationOverrideId || this.currentScenario.destinationId;
    return (
      DELIVERY_LOCATIONS.find((l) => l.id === destId) ?? DELIVERY_LOCATIONS[5]
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
    return (
      CAMPUS_ELEVATORS.find((e) => e.id === this.activeElevatorId) ?? null
    );
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

  public setConfiguration(
    scenario: ScenarioConfig,
    policy: NavigationPolicyConfig,
    robotId: string,
    destinationOverrideId: string | null = null
  ): void {
    this.currentScenario = scenario;
    this.currentPolicy = policy;
    this.currentRobotId = robotId;
    this.destinationOverrideId = destinationOverrideId;
    this.pedestrianDistributionOverride = null;
    this.elevatorFaultModeOverride = null;
    this.reset(false);
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
   * Ground Floor Indoor Lobby (`Outdoor A* -> Building Entrance -> Ground Internal Corridor -> Elevator Lobby`),
   * plus visual preview waypoints up the shaft and along the Second Floor Corridor to the Destination Room.
   */
  private computeMultiFloorApproachRoute(
    startPos: Vector2D,
    elevCfg: CampusElevatorConfig,
    dynamicPedPositions: Vector2D[] = [],
    predictedPenaltyZones: PredictedGridPenaltyZone[] = []
  ): PathfindingDiagnosticsResult {
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
      'enter-to-lobby'
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

    const destinationLabel =
      this.requiresElevator && activeElevCfg
        ? `${activeElevCfg.destinationRoomName} (${activeElevCfg.buildingName})`
        : `${target.name} (${target.code})`;

    return {
      simulationState: this.runState,
      robotId: bot.id,
      robotName: bot.name,
      robotStatus: this.robotOpState,
      activeAvoidanceLevel: this.activeAvoidanceLevel,
      originName: origin.name,
      currentDestination: destinationLabel,
      batteryLevelPct: Number(this.batteryPct.toFixed(1)),
      currentSpeedMps: Number(this.currentSpeedMps.toFixed(2)),
      targetSpeedMps: Number(this.targetSpeedMps.toFixed(2)),
      navigationStatus: this.navStatusText,
      distanceRemainingM: Number(this.distanceRemainingM.toFixed(1)),
      distanceTraveledM: Number(this.distanceTraveledM.toFixed(1)),
      elapsedTimeSec: Number(this.elapsedTimeSec.toFixed(1)),
      collisionsCount: this.collisionsCount,
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
    this.runState = 'idle';
    this.activeRunSessionId = '';
    this.completionEmittedForSession = false;
    this.currentSpeedMps = 0;
    this.targetSpeedMps = 0;
    this.elapsedTimeSec = 0;
    this.distanceTraveledM = 0;
    this.collisionsCount = 0;
    this.replanCount = 0;
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

    // Initialize Part 2 Multi-Floor Indoor Elevator configuration
    this.requiresElevator = Boolean(this.currentScenario.requiresElevator);
    this.elevatorFaultMode =
      this.elevatorFaultModeOverride ??
      this.currentScenario.elevatorFaultMode ??
      'none';
    this.elevatorTimeoutSec = this.currentScenario.elevatorTimeoutSec ?? 3.2;
    this.elevatorPhaseTimerSec = 0;
    this.elevatorWaitTimeSec = 0;
    this.elevatorReroutedToBackup = false;
    this.elevatorStateEncountered = 'Available';
    this.elevatorEventsLog = [];
    this.robotAltitudeY = 0;
    this.currentFloor = 0;
    this.isRobotIndoor = false;

    this.elevatorUnits = CAMPUS_ELEVATORS.map((cfg) => {
      let initialState: ElevatorState = 'Available';
      if (this.requiresElevator) {
        if (
          cfg.isPrimary &&
          (this.elevatorFaultMode === 'unavailable-before-arrival' ||
            this.elevatorFaultMode === 'no-alternative-available')
        ) {
          initialState = 'Out of Service';
        } else if (
          !cfg.isPrimary &&
          this.elevatorFaultMode === 'no-alternative-available'
        ) {
          initialState = 'Out of Service';
        } else if (
          cfg.isPrimary &&
          this.elevatorFaultMode === 'delayed-reassess'
        ) {
          initialState = 'Delayed';
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
        currentFloor: 0, // Starts at Ground Floor (0)
        targetFloor: cfg.destinationFloor,
        floorHeightM: cfg.floorHeightM,
        isPrimary: cfg.isPrimary,
        robotInside: false,
        waitElapsedSec: 0,
        assistanceRequested: false,
      };
    });

    this.perceptionProfile = computePerceptionProfile(
      this.currentScenario.sensorNoiseLevel
    );

    const originLoc = this.getOriginLocation();
    const targetLoc = this.getTargetLocation();

    this.robotPos = {
      x: originLoc.position[0],
      z: originLoc.position[2],
      y: 0,
      floor: 0,
    };

    this.cachedStaticGrid = buildNavigationGrid(
      this.currentScenario.activeConstructionZones,
      this.currentPolicy.constructionAvoidanceWeight,
      []
    );

    if (this.requiresElevator && this.elevatorUnits.length > 0) {
      const primaryCfg =
        CAMPUS_ELEVATORS.find((e) => e.isPrimary) ?? CAMPUS_ELEVATORS[0];
      this.activeElevatorId = primaryCfg.id;
      this.elevatorMissionPhase = 'approaching-building-entrance';
      this.pathDiagnostics = this.computeMultiFloorApproachRoute(
        this.robotPos,
        primaryCfg,
        []
      );
    } else {
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

    if (this.waypoints.length > 1) {
      const dx = this.waypoints[1].x - this.robotPos.x;
      const dz = this.waypoints[1].z - this.robotPos.z;
      this.robotHeading = Math.atan2(dx, dz);
    }

    this.distanceRemainingM = calculatePathDistance(this.waypoints);
    this.robotOpState = 'Standby';

    if (!this.pathDiagnostics.reachable) {
      this.navStatusText =
        this.pathDiagnostics.failureReason ||
        'Route Blocked: No valid path to destination';
    } else if (this.requiresElevator) {
      const primaryElev = this.getActiveElevatorUnit();
      this.navStatusText = `Ready at ${originLoc.code} → ${
        primaryElev?.buildingName ?? 'Academic Building'
      } Entrance & Lobby (${this.waypoints.length} nodes)`;
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
          ? `Simulation reset to ${originLoc.name}. Computed ${this.waypoints.length} navigation nodes (Prediction horizon: ${this.predictionHorizonSec}s).`
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
      this.navStatusText = `Approaching ${
        elev?.buildingName ?? 'Building'
      } Entrance → ${elev?.name ?? 'Elevator Lobby'}`;
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
      `Dispatched ${this.getCurrentRobot().name} toward ${
        this.requiresElevator
          ? this.getActiveElevatorConfig()?.destinationRoomName ??
            this.getTargetLocation().name
          : this.getTargetLocation().name
      } (Prediction Horizon: ${this.predictionHorizonSec}s, Visibility: ${
        this.perceptionProfile.visibilityRangeM
      }m).`
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
    return { x: targetLoc.position[0], z: targetLoc.position[2], y: 0, floor: 0 };
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
   * before boarding (Test 6) or Delayed beyond timeout (Test 8).
   */
  private attemptRerouteToBackupElevator(reasonLabel: string): boolean {
    const backupElev = this.elevatorUnits.find(
      (e) => !e.isPrimary && e.state !== 'Out of Service' && e.state !== 'Stuck'
    );
    const backupCfg = CAMPUS_ELEVATORS.find((e) => e.id === backupElev?.id);

    if (!backupElev || !backupCfg) {
      // Test 9: No alternative elevator available!
      const failMsg = `Elevator Unavailable: ${reasonLabel}, and backup lift is Out of Service. Ground delivery robot cannot use stairs to reach ${
        this.getActiveElevatorConfig()?.destinationRoomName ?? 'Second Floor'
      }.`;
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
   * PART 2: MULTI-FLOOR INDOOR BUILDING & ELEVATOR STATE MACHINE
   * Route sequence:
   * Outdoor campus pathway -> Building entrance -> Internal corridor -> Elevator lobby ->
   * Single elevator doorway -> Elevator cabin -> Destination floor ->
   * Elevator doorway -> Internal corridor -> Destination room.
   *
   * Returns `true` when the robot is stationary inside the lobby or cabin waiting for doors/lift motion,
   * or `false` when the robot should physically drive along `this.waypoints`.
   */
  private stepElevatorStateMachine(subDt: number): boolean {
    if (!this.requiresElevator || this.elevatorMissionPhase === 'not-required') {
      this.isRobotIndoor = false;
      this.robotAltitudeY = 0;
      this.currentFloor = 0;
      return false;
    }

    const activeElev = this.getActiveElevatorUnit();
    const elevCfg = this.getActiveElevatorConfig();
    if (!activeElev || !elevCfg) return false;

    // Check if robot is currently inside the building footprint
    const inGroundCorridor =
      Math.abs(this.robotPos.x - elevCfg.cabinPos.x) <= 2.2 &&
      this.robotPos.z <= elevCfg.entrancePos.z + 0.3 &&
      this.robotPos.z >= elevCfg.cabinPos.z - 1.5;
    this.isRobotIndoor =
      inGroundCorridor ||
      this.currentFloor > 0 ||
      this.elevatorMissionPhase === 'boarding-cabin' ||
      this.elevatorMissionPhase === 'doors-closing-ground' ||
      this.elevatorMissionPhase === 'in-elevator-transit' ||
      this.elevatorMissionPhase === 'doors-opening-upper' ||
      this.elevatorMissionPhase === 'exiting-to-destination';

    // 1. Approaching Building Entrance -> Internal Corridor -> Ground Floor Elevator Lobby
    if (this.elevatorMissionPhase === 'approaching-building-entrance') {
      const distToEntrance = Math.hypot(
        elevCfg.entrancePos.x - this.robotPos.x,
        elevCfg.entrancePos.z - this.robotPos.z
      );
      const distToLobby = Math.hypot(
        elevCfg.lobbyPos.x - this.robotPos.x,
        elevCfg.lobbyPos.z - this.robotPos.z
      );

      // Update status when entering building front entrance
      if (inGroundCorridor && this.robotOpState === 'Navigating') {
        this.robotOpState = 'Entering Building';
        this.navStatusText = `Inside ${elevCfg.buildingName}: Ground Corridor → ${activeElev.name} Lobby`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      }

      // Check if primary elevator is Out of Service as robot approaches building entrance or lobby (Test 6 & Test 9)
      if (
        activeElev.state === 'Out of Service' &&
        (distToEntrance <= 4.5 || distToLobby <= 6.5)
      ) {
        this.elevatorStateEncountered = 'Out of Service';
        this.attemptRerouteToBackupElevator(
          `${activeElev.name} in ${elevCfg.buildingName} is Out of Service before boarding`
        );
        return this.runState !== 'running';
      }

      if (distToLobby <= 4.5 && activeElev.state === 'Available') {
        activeElev.state = 'Approaching';
      }

      // Check arrival at Ground Floor Elevator Lobby directly in front of the single doorway
      if (distToLobby <= 0.38) {
        this.robotPos = { ...elevCfg.lobbyPos, y: 0, floor: 0 };
        this.currentSpeedMps = 0;
        this.elevatorPhaseTimerSec = 0;

        if (activeElev.state === 'Delayed') {
          this.elevatorStateEncountered = 'Delayed';
          this.elevatorMissionPhase = 'waiting-in-lobby';
          this.robotOpState = 'Waiting for Elevator';
          const msg = `Arrived at ${elevCfg.buildingName} Ground Lobby: ${activeElev.name} is Delayed. Waiting up to ${this.elevatorTimeoutSec.toFixed(
            1
          )}s before reassessing.`;
          this.elevatorEventsLog.push(msg);
          this.navStatusText = `Lobby Wait: ${activeElev.name} Delayed`;
          this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
          this.callbacks.onLogEvent?.('warn', msg);
          return true;
        }

        // Start opening the single elevator doorway facing the lobby
        activeElev.state = 'Doors Opening';
        activeElev.doorOpenProgress = 0.05;
        this.elevatorMissionPhase = 'doors-opening-ground';
        this.robotOpState = 'Waiting for Elevator';
        const msg = `Arrived at ${elevCfg.buildingName} Ground Lobby: ${activeElev.name} single doorway opening.`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `${activeElev.name}: Doors Opening at Ground Lobby`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
        return true;
      }

      return false;
    }

    // 2. Waiting in Indoor Lobby for Delayed Elevator (Test 8)
    if (this.elevatorMissionPhase === 'waiting-in-lobby') {
      this.currentSpeedMps = 0;
      this.totalWaitingTimeSec += subDt;
      this.elevatorWaitTimeSec += subDt;
      activeElev.waitElapsedSec += subDt;

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

    // 3. Doors Opening at Ground Floor Lobby
    if (this.elevatorMissionPhase === 'doors-opening-ground') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      this.elevatorWaitTimeSec += subDt * 0.5;
      activeElev.state = 'Doors Opening';
      activeElev.doorOpenProgress = Math.min(
        1,
        this.elevatorPhaseTimerSec / 0.65
      );
      this.navStatusText = `${activeElev.name}: Single Doorway Opening (${Math.round(
        activeElev.doorOpenProgress * 100
      )}%)`;

      if (activeElev.doorOpenProgress >= 1) {
        // Doorway is fully open and cabin is at Ground Floor (0)!
        // Unlock the single doorway edge: Lobby -> Single Doorway -> Cabin
        activeElev.state = 'Boarding';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'boarding-cabin';
        this.robotOpState = 'Boarding Elevator';
        this.waypoints = buildIndoorElevatorRouteWaypoints(
          elevCfg,
          'board-cabin'
        );
        this.currentWaypointIdx = 1;
        this.navStatusText = `Boarding ${activeElev.name} Cabin via Single South Doorway`;
        this.emitPathUpdate();
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        return false; // Let robot physically drive through the single doorway into cabinPos!
      }
      return true;
    }

    // 4. Robot Physically Driving Through Single Doorway Into Elevator Cabin
    if (this.elevatorMissionPhase === 'boarding-cabin') {
      activeElev.state = 'Boarding';
      activeElev.doorOpenProgress = 1;
      const distToCabin = Math.hypot(
        elevCfg.cabinPos.x - this.robotPos.x,
        elevCfg.cabinPos.z - this.robotPos.z
      );

      if (distToCabin <= 0.26) {
        this.robotPos = { ...elevCfg.cabinPos, y: 0, floor: 0 };
        this.currentSpeedMps = 0;
        // Turn robot to face the South doorway (heading = 0) while inside the cabin
        this.robotHeading = 0;
        activeElev.robotInside = true;
        activeElev.state = 'Doors Closing';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'doors-closing-ground';
        const msg = `Boarded ${activeElev.name} cabin via single doorway. Doors Closing.`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `${activeElev.name}: Inside Cabin — Doors Closing`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
        return true;
      }
      return false;
    }

    // 5. Doors Closing on Ground Floor before Vertical Lift
    if (this.elevatorMissionPhase === 'doors-closing-ground') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      activeElev.state = 'Doors Closing';
      activeElev.doorOpenProgress = Math.max(
        0,
        1 - this.elevatorPhaseTimerSec / 0.55
      );

      if (activeElev.doorOpenProgress <= 0) {
        activeElev.doorOpenProgress = 0;
        activeElev.state = 'Moving';
        this.elevatorPhaseTimerSec = 0;
        this.elevatorMissionPhase = 'in-elevator-transit';
        this.robotOpState = 'In Elevator Transit';
        const msg = `${activeElev.name} Doors Closed — Ascending shaft from Ground Floor (G) through 1F to Second Floor (2F).`;
        this.elevatorEventsLog.push(msg);
        this.navStatusText = `In Elevator Transit: Ground (G) → Second Floor (2F)`;
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('info', msg);
      }
      return true;
    }

    // 6. Vertical Cabin Movement Inside Enclosed Shaft (Ground Floor 0 -> First Floor 1 -> Second Floor 2)
    if (this.elevatorMissionPhase === 'in-elevator-transit') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      const totalClimbTimeSec = 2.0;
      const progress = Math.min(1, this.elevatorPhaseTimerSec / totalClimbTimeSec);
      const currentContFloor = progress * elevCfg.destinationFloor;

      // Test 7: Elevator becomes Stuck between First Floor (1.0) and Second Floor (2.0)!
      if (
        this.elevatorFaultMode === 'stuck-during-journey' &&
        currentContFloor >= 1.35
      ) {
        activeElev.state = 'Stuck';
        activeElev.currentFloor = 1.35;
        activeElev.doorOpenProgress = 0; // Doors remain strictly closed when stuck between floors!
        activeElev.assistanceRequested = true;
        this.currentFloor = 1;
        this.robotAltitudeY = Number(
          (activeElev.currentFloor * elevCfg.floorHeightM).toFixed(2)
        );
        this.robotPos = {
          ...elevCfg.cabinPos,
          y: this.robotAltitudeY,
          floor: 1,
        };
        this.elevatorStateEncountered = 'Stuck';
        this.elevatorMissionPhase = 'failed-in-elevator';
        this.robotOpState = 'Awaiting Assistance';

        const stuckMsg = `CRITICAL: ${activeElev.name} cabin halted mid-shaft between 1st Floor and 2nd Floor (y=${this.robotAltitudeY}m) with doors closed and ${
          this.getCurrentRobot().name
        } aboard!`;
        this.elevatorEventsLog.push(stuckMsg);
        this.callbacks.onLogEvent?.('error', stuckMsg);

        activeElev.state = 'Emergency Assistance';
        const assistMsg = `Emergency Assistance requested in ${elevCfg.buildingName}. Cabin doors locked safe; operator dashboard alerted.`;
        this.elevatorEventsLog.push(assistMsg);
        this.navStatusText = `Emergency Assistance: Cabin Stuck Between 1F & 2F (Doors Closed)`;
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
        activeElev.state = 'Moving';
        activeElev.currentFloor = Number(currentContFloor.toFixed(2));
        this.currentFloor = Math.round(activeElev.currentFloor);
        this.robotAltitudeY = Number(
          (activeElev.currentFloor * elevCfg.floorHeightM).toFixed(2)
        );
        this.robotPos = {
          ...elevCfg.cabinPos,
          y: this.robotAltitudeY,
          floor: this.currentFloor,
        };
        this.navStatusText = `In Elevator Transit: ${
          activeElev.name
        } (${this.getFloorLabel(activeElev.currentFloor)}, y=${
          this.robotAltitudeY
        }m)`;
        return true;
      }

      // Reached Destination Floor (Second Floor, Floor 2, y = 7.2m) -> Open Single Doorway
      activeElev.currentFloor = elevCfg.destinationFloor;
      this.currentFloor = elevCfg.destinationFloor;
      this.robotAltitudeY = Number(
        (elevCfg.destinationFloor * elevCfg.floorHeightM).toFixed(2)
      );
      this.robotPos = {
        ...elevCfg.cabinPos,
        y: this.robotAltitudeY,
        floor: this.currentFloor,
      };
      activeElev.state = 'Doors Opening';
      this.elevatorPhaseTimerSec = 0;
      this.elevatorMissionPhase = 'doors-opening-upper';
      this.robotOpState = 'Exiting Elevator';
      this.navStatusText = `Arrived at ${this.getFloorLabel(
        this.currentFloor
      )} — Doors Opening`;
      this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
      return true;
    }

    // 7. Doors Opening on Destination Floor (Second Floor, y = 7.2m)
    if (this.elevatorMissionPhase === 'doors-opening-upper') {
      this.currentSpeedMps = 0;
      this.elevatorPhaseTimerSec += subDt;
      activeElev.state = 'Doors Opening';
      activeElev.doorOpenProgress = Math.min(
        1,
        this.elevatorPhaseTimerSec / 0.55
      );

      if (activeElev.doorOpenProgress >= 1) {
        activeElev.doorOpenProgress = 1;
        activeElev.state = 'Exiting';
        activeElev.robotInside = false;
        if (this.elevatorStateEncountered === 'Available') {
          this.elevatorStateEncountered = 'Moving';
        }
        this.elevatorMissionPhase = 'exiting-to-destination';
        this.robotOpState = 'Exiting Elevator';

        // Build Upper Floor Indoor Route: Cabin -> Single South Doorway -> Upper Lobby -> Upper Corridor -> Destination Room
        this.waypoints = buildIndoorElevatorRouteWaypoints(
          elevCfg,
          'exit-to-destination'
        );
        this.currentWaypointIdx = 1;
        this.pathDiagnostics = {
          path: this.waypoints,
          reachable: true,
          detourActive: this.elevatorReroutedToBackup,
          blockedZonesOnDirectPath: [],
          failureReason: null,
        };

        const exitMsg = `${activeElev.name} arrived at ${this.getFloorLabel(
          this.currentFloor
        )} (y=${this.robotAltitudeY}m). Exiting single doorway to ${
          elevCfg.destinationRoomName
        }.`;
        this.elevatorEventsLog.push(exitMsg);
        this.navStatusText = `2F Indoor Corridor → ${elevCfg.destinationRoomName}`;
        this.emitPathUpdate();
        this.callbacks.onStatusChanged?.(this.robotOpState, this.navStatusText);
        this.callbacks.onLogEvent?.('success', exitMsg);
        return false; // Let robot physically drive out the single doorway along the 2F corridor!
      }
      return true;
    }

    // 8. Robot Driving Along Second Floor Internal Corridor to Destination Room
    if (this.elevatorMissionPhase === 'exiting-to-destination') {
      const destY = elevCfg.destinationFloor * elevCfg.floorHeightM;
      this.robotAltitudeY = destY;
      this.currentFloor = elevCfg.destinationFloor;
      this.robotPos.y = destY;
      this.robotPos.floor = elevCfg.destinationFloor;

      const distFromCabin = Math.hypot(
        this.robotPos.x - elevCfg.cabinPos.x,
        this.robotPos.z - elevCfg.cabinPos.z
      );
      if (distFromCabin > 2.45 && activeElev.state === 'Exiting') {
        activeElev.state = 'Available';
        activeElev.doorOpenProgress = 0;
        if (this.robotOpState === 'Exiting Elevator') {
          this.robotOpState = 'Navigating';
          this.navStatusText = `Navigating 2F Corridor → ${elevCfg.destinationRoomName}`;
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

    this.evaluatePerception(this.elapsedTimeSec);

    // 2. Step Multi-Floor Building & Elevator State Machine if active
    const pausedInElevator = this.stepElevatorStateMachine(subDt);
    if (pausedInElevator || this.runState !== 'running') {
      return;
    }

    const bot = this.getCurrentRobot();
    const noiseCautionFactor = Math.max(
      0.72,
      1.0 - this.currentScenario.sensorNoiseLevel * 0.45
    );
    const nominalCruiseSpeed =
      bot.maxSpeedMps *
      this.currentPolicy.cruiseSpeedFactor *
      this.currentScenario.surfaceTraction *
      noiseCautionFactor;

    let desiredSpeed = this.isRobotIndoor
      ? Math.min(nominalCruiseSpeed, 1.85) // Safe indoor corridor speed
      : nominalCruiseSpeed;

    const effectivePolicyClearance =
      this.currentPolicy.safetyClearanceM +
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

    const hazard = !this.isRobotIndoor
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
    };

    if (this.useLegacyAvoidance) {
      // Legacy eager-replan behavior
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
        }
      }
      if (hazard.pathObstructedAhead && hazard.blockingPed) {
        this.pedestrianYieldTimerSec += subDt;
        if (hazard.imminentStopRequired) {
          desiredSpeed = 0;
          this.currentSpeedMps = 0;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.episodeActionCounts.STOP_TEMPORARILY += 1;
        } else {
          desiredSpeed *= hazard.speedScaleFactor;
          this.episodeActionCounts.REDUCE_SPEED += 1;
        }
        if (this.replanCooldownSec <= 0) {
          if (temporaryObstructionPresent) this.unnecessaryReplanCount += 1;
          this.attemptDynamicReplanAroundPedestrians(
            hazard.blockingPed.name,
            predictive.penaltyZones,
            false
          );
          this.episodeActionCounts.GLOBAL_REPLAN += 1;
        }
      }
    } else if (!this.isRobotIndoor && isUsingCandidatePolicy && this.candidatePolicyState) {
      // ==========================================================================
      // CANDIDATE TABULAR Q-LEARNING POLICY + HARD SAFETY LAYER
      // ==========================================================================
      this.rlDecisionTimerSec += subDt;
      const hasConflictOrHazard =
        predictive.conflicts.length > 0 ||
        hazard.pathObstructedAhead ||
        hazard.speedScaleFactor < 0.96;

      // Trigger RL decision step every 0.40s or immediately when a hazard appears
      if (this.rlDecisionTimerSec >= 0.4 || (hasConflictOrHazard && !this.lastRlAction)) {
        const nextStateKey = encodeObservationToStateKey(currentObs);

        // If we had a previous RL action, compute its step reward and update Q-table if training
        if (this.lastRlStateKey && this.lastRlAction && this.lastRlObs) {
          const progressM = Math.hypot(
            this.robotPos.x - this.lastRlRobotPos.x,
            this.robotPos.z - this.lastRlRobotPos.z
          );
          const stepReward = computeStepReward(this.lastRlObs, this.lastRlAction, {
            progressMeters: progressM,
            collisionOccurred: false,
            safetyOverrideTriggered: Boolean(
              hazard.imminentStopRequired && this.lastRlAction === 'MAINTAIN_SPEED'
            ),
            unnecessaryReplanTriggered: Boolean(
              this.lastRlAction === 'GLOBAL_REPLAN' &&
                this.lastRlObs.temporaryObstructionPresent
            ),
            localBypassSucceeded: this.lastRlAction === 'LOCAL_AVOIDANCE',
            speedRegulatedSmoothly:
              this.lastRlAction === 'REDUCE_SPEED' &&
              this.lastRlObs.temporaryObstructionPresent,
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
          } else {
            this.candidatePolicyState.stateVisitCounts[this.lastRlStateKey] =
              (this.candidatePolicyState.stateVisitCounts[this.lastRlStateKey] ?? 0) + 1;
            this.candidatePolicyState.actionDistribution[this.lastRlAction] =
              (this.candidatePolicyState.actionDistribution[this.lastRlAction] ?? 0) + 1;
          }
        }

        const selection = selectQLearningAction(
          this.candidatePolicyState,
          currentObs,
          this.isTrainingEpisode,
          this.episodeRng
        );

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
            this.localBypassCooldownSec = 2.2;
            this.activeAvoidanceLevel = 'Level 4: Local Bypass';
            this.robotOpState = 'Local Bypass';
            this.navStatusText = `Q-Policy Local Bypass: Passing around ${conflictPed.name}`;
            this.emitPathUpdate();
          }
        } else if (
          selection.action === 'GLOBAL_REPLAN' &&
          conflictPed &&
          this.replanCooldownSec <= 0
        ) {
          if (temporaryObstructionPresent) {
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
          // Mild predictive caution even in maintain speed
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
        desiredSpeed *= Math.max(0.35, Math.min(0.78, scale));
        this.robotOpState = 'Speed Regulation';
        this.navStatusText = `Q-Policy Level 2 Speed Regulation (${desiredSpeed.toFixed(
          2
        )} m/s)`;
      } else if (activeAction === 'STOP_TEMPORARILY') {
        this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
        desiredSpeed = 0;
        this.totalWaitingTimeSec += subDt;
        this.pedestrianWaitingTimeSec += subDt;
        if ((hazard.nearestActualDist ?? 99) > 2.2) {
          this.unnecessaryStopsCount += 1;
        }
        this.robotOpState = 'Obstacle Yield';
        this.navStatusText = `Q-Policy Temporary Yield`;
      } else if (activeAction === 'LOCAL_AVOIDANCE') {
        desiredSpeed *= 0.76;
      } else if (activeAction === 'GLOBAL_REPLAN') {
        desiredSpeed *= 0.72;
      }

      if (!hasConflictOrHazard) {
        this.inSpeedReductionEpisode = false;
      }

      // ==========================================================================
      // CRITICAL HARD SAFETY LAYER (Cannot be overridden by learned policy!)
      // Enforces minimum safety distance, emergency stopping, and deadlock recovery
      // ==========================================================================
      if (hazard.imminentStopRequired && conflictPed) {
        const dist = hazard.nearestActualDist ?? 99;
        if (dist < 1.38) {
          // Hard Safety Override: prevent physical collision regardless of learned policy action
          desiredSpeed = 0;
          this.totalWaitingTimeSec += subDt;
          this.pedestrianWaitingTimeSec += subDt;
          this.pedestrianYieldTimerSec += subDt;
          this.activeAvoidanceLevel = 'Level 3: Temporary Stop';
          this.robotOpState = 'Obstacle Yield';
          this.navStatusText = `Safety Layer Protected Stop (${dist.toFixed(
            2
          )}m to ${conflictPed.name})`;

          // If stuck at close range for > 1.0s, safety layer triggers local bypass or replan so robot never deadlocks
          if (this.pedestrianYieldTimerSec >= 1.0 && this.localBypassCooldownSec <= 0) {
            const safetyBypass = computeLocalBypassWaypoints(
              this.robotPos,
              this.waypoints,
              this.currentWaypointIdx,
              conflictPed,
              this.currentScenario.activeConstructionZones,
              this.pedestrianAgents
            );
            if (safetyBypass) {
              this.waypoints = safetyBypass.splicedWaypoints;
              this.currentWaypointIdx = safetyBypass.resumeIdx;
              this.localBypassCount += 1;
              this.avoidedEncountersCount += 1;
              this.localBypassCooldownSec = 2.0;
              this.pedestrianYieldTimerSec = 0;
              desiredSpeed = nominalCruiseSpeed * 0.65;
              this.emitPathUpdate();
            } else if (
              this.pedestrianYieldTimerSec >= 2.2 &&
              this.replanCooldownSec <= 0
            ) {
              this.pedestrianYieldTimerSec = 0;
              this.attemptDynamicReplanAroundPedestrians(
                conflictPed.name,
                predictive.penaltyZones,
                false
              );
            }
          }
        }
      } else {
        this.pedestrianYieldTimerSec = Math.max(
          0,
          this.pedestrianYieldTimerSec - subDt * 0.5
        );
      }
    } else if (!this.isRobotIndoor) {
      // ==========================================================================
      // BASELINE RULE-BASED CONTROLLER
      // ==========================================================================
      const hasPredictiveConflict =
        predictive.conflicts.length > 0 && predictive.primaryConflictPed !== null;
      const hasActiveHazard =
        hazard.pathObstructedAhead || hazard.speedScaleFactor < 0.96;

      // Baseline rule-based policies with low safety clearance (e.g., Greedy A*) or proactive replan thresholds
      // trigger global replanning earlier when conflicts arise, whereas the Candidate Q-Learning policy
      // learns to regulate speed and use local bypasses.
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

    if (distToWp < 0.28) {
      if (this.currentWaypointIdx < this.waypoints.length - 1) {
        this.currentWaypointIdx += 1;
      } else {
        // If in an intermediate elevator phase, let stepElevatorStateMachine handle transition on next sub-step
        if (
          this.requiresElevator &&
          this.elevatorMissionPhase !== 'exiting-to-destination'
        ) {
          return;
        }

        // Reached final destination! Verify genuine arrival at destination coordinates (2F indoor room or outdoor dock)
        const activeElevCfg = this.getActiveElevatorConfig();
        const targetLoc = this.getTargetLocation();
        const finalGoalCoords: Vector2D =
          this.requiresElevator && activeElevCfg
            ? activeElevCfg.destinationRoomPos
            : { x: targetLoc.position[0], z: targetLoc.position[2] };
        const finalGoalName =
          this.requiresElevator && activeElevCfg
            ? `${activeElevCfg.destinationRoomName} (${activeElevCfg.buildingName})`
            : targetLoc.name;

        const distToDest = Math.hypot(
          finalGoalCoords.x - this.robotPos.x,
          finalGoalCoords.z - this.robotPos.z
        );
        if (distToDest <= 1.2) {
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
        activeElev && (activeElev.doorOpenProgress ?? 0) >= 0.85
      );

      const hit = checkSweptRobotCollision(
        this.robotPos,
        candidatePos,
        ROBOT_COLLISION_RADIUS,
        this.currentScenario.activeConstructionZones,
        pedCircles,
        activeElevCfg,
        doorOpen
      );

      if (hit && hit.collided) {
        if (hit.obstacleType === 'Dynamic Pedestrian') {
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
      }
      // Eligibility trace credit assignment over the episode's key decision steps
      const traceLen = this.episodeTrajectoryTrace.length;
      const perStepBonus =
        partial.status === 'Success'
          ? 2.4
          : partial.collisions > 0
          ? -4.5
          : -2.0;
      for (let i = Math.max(0, traceLen - 12); i < traceLen; i++) {
        const item = this.episodeTrajectoryTrace[i];
        // Reinforce good local decisions (REDUCE_SPEED / LOCAL_AVOIDANCE) on successful episodes
        const actionBonus =
          partial.status === 'Success' &&
          (item.action === 'REDUCE_SPEED' || item.action === 'LOCAL_AVOIDANCE')
            ? perStepBonus * 1.4
            : item.action === 'GLOBAL_REPLAN'
            ? -2.5
            : perStepBonus * 0.6;
        updateQTableStep(
          this.candidatePolicyState,
          item.stateKey,
          item.action,
          actionBonus,
          null,
          true
        );
      }
    }

    const robotStateBeforeCompletion = `Pos (${this.robotPos.x.toFixed(
      1
    )}m, ${this.robotPos.z.toFixed(1)}m) · Floor ${
      this.currentFloor
    } · Speed ${this.currentSpeedMps.toFixed(
      2
    )} m/s · Battery ${this.batteryPct.toFixed(1)}% · Avoidance: ${
      this.activeAvoidanceLevel
    }`;

    const environmentalConditionsSummary = `Seed: ${
      this.currentScenario.randomSeed ?? distConfig.randomSeed ?? 101
    } · Pedestrians: ${
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
      scenarioId: this.currentScenario.id,
      scenarioName: this.currentScenario.name,
      scenarioSeed:
        this.currentScenario.randomSeed ?? distConfig.randomSeed ?? 101,
      robotId: bot.id,
      robotName: bot.name,
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
        this.requiresElevator && activeElevCfg
          ? `${activeElevCfg.destinationRoomName} (${activeElevCfg.buildingName})`
          : target.name,
      unnecessaryReplanCount: this.unnecessaryReplanCount,
      deadlockCount:
        this.deadlockCount ||
        (partial.failureType === 'Pathway Deadlock' ? 1 : 0),
      episodeReward: this.episodeReward,
      decisionHistory:
        this.decisionHistory.length > 0
          ? [...this.decisionHistory]
          : [
              `[t=0.0s] Dispatched via ${this.currentPolicy.algorithm}`,
              `[t=${partial.durationSec.toFixed(1)}s] Mission ${partial.status} (${this.speedBasedAvoidanceCount} speed modulations, ${this.localBypassCount} local bypasses, ${this.globalReplanCount} global replans)`,
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
