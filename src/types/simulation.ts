export type NavPageId =
  | 'overview'
  | 'simulation-lab'
  | 'scenario-generator'
  | 'failure-analysis'
  | 'robot-policies'
  | 'policy-benchmarking'
  | 'performance-analytics'
  | 'experiment-history';

export type SimulationRunState = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export type AvoidanceHierarchyLevel =
  | 'Level 1: Maintain Path'
  | 'Level 2: Speed Regulation'
  | 'Level 3: Temporary Stop'
  | 'Level 4: Local Bypass'
  | 'Level 5: Global Replanning';

export type RobotOperationalState =
  | 'Standby'
  | 'Navigating'
  | 'Speed Regulation'
  | 'Pedestrian Detected'
  | 'Local Bypass'
  | 'Replanning Path'
  | 'Obstacle Yield'
  | 'WaitingForClearPath'
  | 'Entering Building'
  | 'Waiting for Elevator'
  | 'Boarding Elevator'
  | 'In Elevator Transit'
  | 'Exiting Elevator'
  | 'Awaiting Assistance'
  | 'Delivering Payload'
  | 'Returning to Dock'
  | 'Charging'
  | 'Emergency Stop';

export type PedestrianBehaviorClass =
  | 'commuter'
  | 'random'
  | 'crossing'
  | 'group';

export interface PedestrianDistributionConfig {
  commuterCount: number;
  randomCount: number;
  crossingCount: number;
  groupCount: number;
  randomSeed?: number;
}

export type PredictionHorizonSec = 1 | 2 | 4;

export interface PredictedConflictPoint {
  pedestrianId: string;
  pedestrianName: string;
  behaviorClass: PedestrianBehaviorClass;
  conflictPos: Vector2D;
  ttcSec: number;
  pcaDistanceM?: number;
  uncertaintyRadiusM: number;
  confidence: number;
}

export type ElevatorState =
  | 'Available'
  | 'Approaching'
  | 'Doors Opening'
  | 'Boarding'
  | 'Doors Closing'
  | 'Moving'
  | 'Exiting'
  | 'Delayed'
  | 'Stuck'
  | 'Out of Service'
  | 'Emergency Assistance';

export type ElevatorFaultMode =
  | 'none'
  | 'unavailable-before-arrival'
  | 'stuck-during-journey'
  | 'delayed-reassess'
  | 'no-alternative-available';

export interface CampusElevatorConfig {
  id: string;
  name: string;
  buildingId: string;
  buildingName: string;
  /** Legacy / outdoor reference point (kept for backward compatibility) */
  position: Vector2D;
  /** Outdoor campus road node where robot transitions to building entrance */
  outdoorApproachPos: Vector2D;
  /** Ground-floor building front entrance facing the campus pathway */
  entrancePos: Vector2D;
  /** Internal ground-floor corridor waypoints from building entrance to elevator lobby */
  groundCorridorWaypoints: Vector2D[];
  /** Ground-floor elevator lobby waiting point directly in front of the single doorway */
  lobbyPos: Vector2D;
  /** Single elevator doorway coordinates (only entry/exit portal into shaft) */
  doorwayPos: Vector2D;
  /** Enclosed elevator cabin center coordinates inside the shaft */
  cabinPos: Vector2D;
  /** Direction the single elevator doorway faces toward the indoor lobby */
  doorwayFacing: 'south' | 'north' | 'east' | 'west';
  /** Destination floor internal corridor waypoints from upper lobby to delivery room */
  upperCorridorWaypoints: Vector2D[];
  /** Final indoor destination room / delivery point on the upper floor */
  destinationRoomPos: Vector2D;
  destinationRoomName: string;
  isPrimary: boolean;
  /** Floors served: 0 = Ground Floor, 1 = First Floor, 2 = Second Floor */
  floorsServed: number[];
  destinationFloor: number;
  floorHeightM: number;
}

export interface ElevatorUnitStatus {
  id: string;
  name: string;
  buildingId?: string;
  buildingName: string;
  position: Vector2D;
  outdoorApproachPos?: Vector2D;
  entrancePos?: Vector2D;
  lobbyPos?: Vector2D;
  doorwayPos?: Vector2D;
  cabinPos?: Vector2D;
  destinationRoomPos?: Vector2D;
  destinationRoomName?: string;
  doorwayFacing?: 'south' | 'north' | 'east' | 'west';
  doorOpenProgress?: number; // 0 = closed, 1 = open
  state: ElevatorState;
  currentFloor: number; // 0 = Ground, 1 = First, 2 = Second
  targetFloor: number;
  floorHeightM?: number;
  isPrimary: boolean;
  isBackup?: boolean;
  robotInside: boolean;
  waitElapsedSec: number;
  assistanceRequested: boolean;
}

export type CameraPresetId =
  | 'isometric'
  | 'follow'
  | 'top-down'
  | 'charging-station'
  | 'construction-zone'
  | 'elevator-interior';

export interface Vector2D {
  x: number;
  z: number;
  /** Optional vertical height in meters for multi-floor indoor navigation */
  y?: number;
  /** Optional floor index (0 = Ground, 1 = First, 2 = Second) */
  floor?: number;
}

export interface CampusBuilding {
  id: string;
  name: string;
  category: 'academic' | 'hostel' | 'facility';
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  accentColor: string;
  description: string;
}

export interface DeliveryLocation {
  id: string;
  name: string;
  code: string;
  buildingId: string;
  position: [number, number, number];
  type: 'delivery' | 'charging';
  priority: 'Standard' | 'Priority' | 'Lab Sample';
}

export interface ConstructionZoneConfig {
  id: string;
  name: string;
  position: [number, number, number];
  size: [number, number];
  activeInScenarios: string[];
  severity: 'Partial Lane Closure' | 'Full Pathway Blockade' | 'Sensor Hazard Zone';
}

export interface RobotUnitConfig {
  id: string;
  name: string;
  model: string;
  chassisColor: string;
  accentColor: string;
  maxSpeedMps: number;
  batteryCapacityWh: number;
  sensorSuite: string;
  assignedPolicyId: string;
  payloadCapacityKg: number;
}

export type ScenarioGenerationSource =
  | 'Preset'
  | 'Random'
  | 'Custom'
  | 'Failure-Driven';

export type ScenarioDifficulty = 'Low' | 'Moderate' | 'High' | 'Extreme';

export type DatasetSplit = 'train' | 'test';

export type FailureCategory =
  | 'Pedestrian interaction failure'
  | 'Unsafe obstacle avoidance'
  | 'Excessive global replanning'
  | 'Navigation deadlock'
  | 'Unreachable destination'
  | 'Low-visibility perception limitation'
  | 'Sensor-noise sensitivity'
  | 'Battery depletion'
  | 'Elevator-related failure'
  | 'Excessive delivery time'
  | 'Other or unclassified failure';

export interface CustomStaticObstacle {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  category:
    | 'Nominal'
    | 'Construction Detour'
    | 'High Congestion'
    | 'Low Visibility'
    | 'Multi-Failure Stress'
    | 'Elevator Recovery';
  description: string;
  originId: string;
  destinationId: string;
  activeConstructionZones: string[];
  dynamicObstacleCount: number;
  pedestrianDistribution?: PedestrianDistributionConfig;
  predictionHorizonSec?: PredictionHorizonSec;
  requiresElevator?: boolean;
  primaryElevatorId?: string;
  backupElevatorId?: string;
  elevatorFaultMode?: ElevatorFaultMode;
  elevatorTimeoutSec?: number;
  surfaceTraction: number; // 0.5 to 1.0
  sensorNoiseLevel: number; // 0.0 to 0.5
  batteryDrainMultiplier: number;
  initialBatteryPct?: number; // 15 to 100
  pedestrianSpeedMultiplier?: number; // 0.7 to 1.6
  crossingDenseMode?: boolean;
  customStartCoords?: Vector2D;
  customDestCoords?: Vector2D;
  customObstacles?: CustomStaticObstacle[];
  randomSeed?: number;
  difficulty?: ScenarioDifficulty;
  generationSource?: ScenarioGenerationSource;
  datasetSplit?: DatasetSplit;
  targetedFailureCategory?: FailureCategory;
  generationReason?: string;
  sourceWeaknessEvidence?: string;
  recommendedPolicyId: string;
  isCustom?: boolean;
}

export interface NavigationPolicyConfig {
  id: string;
  name: string;
  version: string;
  algorithm:
    | 'A* Grid Optimal'
    | 'Hybrid A* + Safety Margin'
    | 'Dynamic Risk-Aware Planner'
    | 'Tabular Q-Learning + Safety Layer';
  description: string;
  safetyClearanceM: number;
  cruiseSpeedFactor: number;
  replanThresholdSec: number;
  constructionAvoidanceWeight: number;
  batteryReserveThresholdPct: number;
  isCandidatePolicy?: boolean;
  isReadOnlyBaseline?: boolean;
}

export type FailureType =
  | 'Collision with Barrier'
  | 'Pedestrian Safety Violation'
  | 'Pathway Deadlock'
  | 'No Valid Route Available'
  | 'Elevator Mechanical Failure'
  | 'Elevator Unavailable'
  | 'Battery Depletion'
  | 'Mission Timeout'
  | 'Localization Drift';

export type FailureOutcomeDistinction =
  | 'Actual Collision'
  | 'Failed Delivery'
  | 'Mission Timeout'
  | 'Safe Stop (Blocked/Fault)';

/**
 * Automated Failure Diagnosis Record (Section 5: Failure Intelligence)
 * Includes all 10 required diagnostic fields.
 */
export interface FailureDiagnosisRecord {
  id: string;
  /** 1. Experiment ID */
  experimentId: string;
  /** 2. Scenario ID */
  scenarioId: string;
  scenarioName: string;
  /** 3. Policy version */
  policyVersion: string;
  policyId: string;
  policyName: string;
  robotName: string;
  /** 4. Failure category */
  failureCategory: FailureCategory;
  failureType: FailureType;
  outcomeDistinction: FailureOutcomeDistinction;
  /** 5. Relevant environmental conditions */
  environmentalConditions: string;
  /** 6. Robot state before failure */
  robotStateBeforeFailure: string;
  /** 7. Actions taken by the robot */
  actionsTaken: string;
  /** 8. Probable root cause */
  probableRootCause: string;
  /** 9. Evidence supporting the diagnosis */
  supportingEvidence: string;
  /** 10. Suggested improvement */
  suggestedImprovement: string;
  coordinates: { x: number; z: number };
  severity: 'Warning' | 'Critical';
  timestamp: string;
  isDemoData?: boolean;
}

export interface FailureEventRecord {
  id: string;
  experimentId: string;
  scenarioId?: string;
  timestamp: string;
  scenarioName: string;
  robotName: string;
  policyName: string;
  policyVersion?: string;
  failureType: FailureType;
  failureCategory?: FailureCategory;
  outcomeDistinction?: FailureOutcomeDistinction;
  obstacleType?: string;
  coordinates: { x: number; z: number };
  severity: 'Warning' | 'Critical';
  rootCause: string;
  mitigationSuggested: string;
  environmentalConditions?: string;
  robotStateBeforeFailure?: string;
  actionsTaken?: string;
  supportingEvidence?: string;
  isDemoData?: boolean;
}

export interface FailureWeaknessCluster {
  category: FailureCategory;
  failureCount: number;
  shareOfFailuresPct: number;
  affectedScenarioIds: string[];
  avgWaitingTimeSec: number;
  avgReplans: number;
  avgCollisions: number;
  evidenceSummary: string;
  recommendedMutationStrategy: string;
}

export interface FailureDrivenGenerationBatch {
  id: string;
  timestamp: string;
  weaknessesDiscovered: FailureWeaknessCluster[];
  generatedScenarios: ScenarioConfig[];
}

// ============================================================================
// SECTION 7 & 8: TABULAR Q-LEARNING CANDIDATE POLICY & TRAINING LOOP TYPES
// ============================================================================

export type QLearningAction =
  | 'MAINTAIN_SPEED'
  | 'REDUCE_SPEED'
  | 'STOP_TEMPORARILY'
  | 'LOCAL_AVOIDANCE'
  | 'GLOBAL_REPLAN';

export interface QLearningObservation {
  nearestPedDistM: number | null;
  relativePedMovement: 'none' | 'approaching-crossing' | 'same-direction' | 'stationary';
  ttcSec: number | null;
  nearestObstacleDistM: number | null;
  currentSpeedRatio: number; // currentSpeed / nominalCruiseSpeed
  pathBlocked: boolean;
  temporaryObstructionPresent: boolean;
}

export interface QLearningHyperparameters {
  learningRate: number; // alpha (e.g. 0.22)
  discountFactor: number; // gamma (e.g. 0.92)
  explorationRate: number; // current epsilon (e.g. 0.35 -> decays to 0.05)
  initialExplorationRate: number;
  minExplorationRate: number;
  explorationDecay: number; // per-episode multiplier (e.g. 0.92)
}

export interface TrainingEpisodeRecord {
  id: string;
  episodeNumber: number;
  timestamp: string;
  scenarioId: string;
  scenarioName: string;
  scenarioSeed: number;
  policyVersion: string;
  status: 'Success' | 'Failed';
  totalReward: number;
  stepsCount: number;
  durationSec: number;
  distanceMeters: number;
  collisions: number;
  globalReplanCount: number;
  unnecessaryReplanCount: number;
  waitingTimeSec: number;
  deadlockCount: number;
  batteryConsumedPct: number;
  epsilonUsed: number;
  actionCounts: Record<QLearningAction, number>;
  failureCategory?: FailureCategory;
}

export interface CandidatePolicyState {
  id: string;
  name: string;
  version: string;
  basePolicyId: string;
  isTrained: boolean;
  totalEpisodesTrained: number;
  lastTrainedAt: string | null;
  hyperparameters: QLearningHyperparameters;
  qTable: Record<string, Record<QLearningAction, number>>;
  stateVisitCounts: Record<string, number>;
  actionDistribution: Record<QLearningAction, number>;
  trainingHistory: TrainingEpisodeRecord[];
  trainingScenarioIds: string[];
  heldOutScenarioIds: string[];
}

// ============================================================================
// SECTION 9: POLICY BENCHMARKING TYPES
// ============================================================================

export interface BenchmarkScenarioComparison {
  scenarioId: string;
  scenarioName: string;
  scenarioCategory: ScenarioConfig['category'];
  scenarioSeed: number;
  difficulty: ScenarioDifficulty;
  generationSource: ScenarioGenerationSource;
  baseline: {
    status: 'Success' | 'Failed';
    durationSec: number;
    distanceMeters: number;
    collisions: number;
    globalReplanCount: number;
    unnecessaryReplanCount: number;
    waitingTimeSec: number;
    deadlockCount: number;
    batteryConsumedPct: number;
    episodeReward: number;
    failureCategory?: FailureCategory;
    failureReason?: string;
  };
  candidate: {
    status: 'Success' | 'Failed';
    durationSec: number;
    distanceMeters: number;
    collisions: number;
    globalReplanCount: number;
    unnecessaryReplanCount: number;
    waitingTimeSec: number;
    deadlockCount: number;
    batteryConsumedPct: number;
    episodeReward: number;
    failureCategory?: FailureCategory;
    failureReason?: string;
  };
}

export interface BenchmarkAggregateMetrics {
  policyId: string;
  policyName: string;
  policyVersion: string;
  episodesCount: number;
  successRatePct: number;
  collisionRatePct: number;
  totalCollisions: number;
  avgCompletionTimeSec: number;
  avgDistanceMeters: number;
  totalDeadlocks: number;
  avgWaitingTimeSec: number;
  avgGlobalReplans: number;
  avgUnnecessaryReplans: number;
  avgBatteryConsumedPct: number;
  avgReward: number;
}

export interface BenchmarkSuiteResult {
  id: string;
  timestamp: string;
  candidatePolicyVersion: string;
  heldOutScenariosCount: number;
  episodesPerScenario: number;
  baselineMetrics: BenchmarkAggregateMetrics;
  candidateMetrics: BenchmarkAggregateMetrics;
  scenarioComparisons: BenchmarkScenarioComparison[];
  failureCategoriesImproved: string[];
  failureCategoriesRegressed: string[];
  remainingWeaknesses: string[];
  overallSummary: string;
}

export type ExperimentRunType = 'Interactive' | 'Batch' | 'Training' | 'Benchmark';

export interface ExperimentRecord {
  id: string;
  timestamp: string;
  scenarioId: string;
  scenarioName: string;
  scenarioSeed?: number;
  scenarioGenerationSource?: ScenarioGenerationSource;
  scenarioDifficulty?: ScenarioDifficulty;
  robotId: string;
  robotName: string;
  policyId: string;
  policyName: string;
  policyVersion?: string;
  isCandidatePolicy?: boolean;
  runType?: ExperimentRunType;
  originName: string;
  destinationName: string;
  status: 'Success' | 'Failed';
  durationSec: number;
  distanceMeters: number;
  collisions: number;
  replanCount: number;
  unnecessaryReplanCount?: number;
  deadlockCount?: number;
  episodeReward?: number;
  decisionHistory?: string[];
  robotStateBeforeCompletion?: string;
  environmentalConditionsSummary?: string;
  pedestrianDetectionsCount?: number;
  predictedEncountersCount?: number;
  avoidedEncountersCount?: number;
  unnecessaryStopsCount?: number;
  predictionAccuracyPct?: number;
  pedestrianReplanCount?: number;
  speedReductionEventsCount?: number;
  reducedSpeedTimeSec?: number;
  pedestrianWaitingTimeSec?: number;
  speedBasedAvoidanceCount?: number;
  localBypassCount?: number;
  globalReplanCount?: number;
  pedestrianDistribution?: PedestrianDistributionConfig;
  predictionHorizonSec?: PredictionHorizonSec;
  totalWaitingTimeSec?: number;
  elevatorWaitTimeSec?: number;
  elevatorUsed?: boolean;
  elevatorStateEncountered?: ElevatorState;
  elevatorFaultMode?: ElevatorFaultMode;
  elevatorReroutedToBackup?: boolean;
  elevatorAssistanceRequested?: boolean;
  elevatorEventsLog?: string[];
  batteryConsumedPct: number;
  failureReason?: string;
  failureType?: FailureType;
  failureCategory?: FailureCategory;
  failureDiagnosis?: FailureDiagnosisRecord;
  obstacleType?: string;
  failureCoordinates?: { x: number; z: number };
  rootCause?: string;
  mitigationSuggested?: string;
  isDemoData?: boolean;
}

export interface LiveTelemetry {
  simulationState: SimulationRunState;
  robotId: string;
  robotName: string;
  robotStatus: RobotOperationalState;
  activeAvoidanceLevel?: AvoidanceHierarchyLevel;
  originName: string;
  currentDestination: string;
  batteryLevelPct: number;
  currentSpeedMps: number;
  targetSpeedMps?: number;
  navigationStatus: string;
  distanceRemainingM: number;
  distanceTraveledM: number;
  elapsedTimeSec: number;
  collisionsCount: number;
  replanCount: number;
  pedestrianDetectionsCount?: number;
  predictedEncountersCount?: number;
  avoidedEncountersCount?: number;
  unnecessaryStopsCount?: number;
  predictionAccuracyPct?: number;
  pedestrianReplanCount?: number;
  speedReductionEventsCount?: number;
  reducedSpeedTimeSec?: number;
  pedestrianWaitingTimeSec?: number;
  speedBasedAvoidanceCount?: number;
  localBypassCount?: number;
  globalReplanCount?: number;
  closestApproachDistanceM?: number | null;
  estimatedTtcSec?: number | null;
  predictionHorizonSec?: PredictionHorizonSec;
  activePredictedConflicts?: PredictedConflictPoint[];
  predictedConflictPoints?: PredictedConflictPoint[];
  totalWaitingTimeSec?: number;
  elevatorWaitTimeSec?: number;
  requiresElevator?: boolean;
  activeElevatorId?: string | null;
  activeElevatorState?: ElevatorState | null;
  elevatorState?: ElevatorState;
  currentFloor?: number;
  currentFloorLabel?: string;
  robotAltitudeY?: number;
  isRobotIndoor?: boolean;
  elevatorAssistanceRequested?: boolean;
  elevatorFaultMode?: ElevatorFaultMode;
  elevatorUnits?: ElevatorUnitStatus[];
  position: { x: number; z: number; y?: number; headingRad: number };
  activeWaypointIndex: number;
  totalWaypoints: number;
  selectedBuildingName: string | null;
  currentGridCell?: {
    gx: number;
    gz: number;
    walkable: boolean;
    blockReason: string;
  };
  pathBlockedReason?: string | null;
  detourActive?: boolean;
  nearestObstacleDistanceM?: number | null;
  perceivedNearestDistanceM?: number | null;
  nearestObstacleType?: string | null;
  visibilityRangeM?: number;
  sensorNoiseStdM?: number;
  perceivedObstaclesCount?: number;
  totalEnvironmentalObstaclesCount?: number;
}

export interface SimulationLogEntry {
  id: string;
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}
