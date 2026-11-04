export type NavPageId =
  | 'overview'
  | 'simulation-lab'
  | 'environment-studio'
  | 'robot-config'
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

export type ElevatorMachineState =
  | 'IDLE'
  | 'DOORS_OPENING'
  | 'BOARDING'
  | 'DOORS_CLOSING'
  | 'MOVING_UP'
  | 'MOVING_DOWN'
  | 'DOORS_OPENING_AT_DESTINATION'
  | 'EXITING'
  | 'OUT_OF_SERVICE'
  | 'STUCK';

export type ElevatorState =
  | 'Available'
  | 'Approaching'
  | 'Doors Opening'
  | 'Boarding'
  | 'Doors Closing'
  | 'Moving'
  | 'Moving Up'
  | 'Moving Down'
  | 'Doors Opening at Destination'
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
  /** First-floor internal corridor waypoints from 1F lobby to 1F delivery room */
  firstFloorCorridorWaypoints?: Vector2D[];
  /** First-floor indoor destination room / delivery point */
  firstFloorRoomPos?: Vector2D;
  firstFloorRoomName?: string;
  /** Second-floor internal corridor waypoints from 2F lobby to 2F delivery room */
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
  machineState?: ElevatorMachineState;
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
  /** Floor index: 0 = Ground Floor, 1 = First Floor (3.6m), 2 = Second Floor (7.2m) */
  floor?: number;
  /** Whether the location is inside a multi-floor building */
  isIndoor?: boolean;
  /** Associated elevator ID if located inside an elevator-equipped building */
  elevatorId?: string;
}

export interface ConstructionZoneConfig {
  id: string;
  name: string;
  position: [number, number, number];
  size: [number, number];
  activeInScenarios: string[];
  severity: 'Partial Lane Closure' | 'Full Pathway Blockade' | 'Sensor Hazard Zone';
}

export type EnvironmentTemplateType =
  | 'Campus'
  | 'Warehouse'
  | 'Hospital'
  | 'Factory'
  | 'Office'
  | 'Shopping Mall'
  | 'Laboratory'
  | 'Custom Environment';

export type EnvironmentElementType =
  | 'wall'
  | 'corridor'
  | 'room'
  | 'door'
  | 'obstacle'
  | 'restricted_area'
  | 'charging_station'
  | 'start_point'
  | 'delivery_destination'
  | 'elevator_shaft';

export interface MapElement2D {
  id: string;
  type: EnvironmentElementType;
  name: string;
  floor: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height?: number;
  rotationDeg?: number;
  color?: string;
  code?: string;
  priority?: 'Standard' | 'Priority' | 'Lab Sample';
  floorsServed?: number[];
}

export interface ImportedMapMetadata {
  sourceType: 'floorplan-image' | 'ros-occupancy' | 'geojson' | 'gltf-3d';
  fileName: string;
  importedAt: string;
  metersPerPixel?: number;
  originWorld?: [number, number];
  imageDataUrl?: string;
  modelDataUrl?: string;
  rosResolution?: number;
  occupiedThreshold?: number;
  freeThreshold?: number;
}

export interface EnvironmentValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category:
    | 'Scale & Dimensions'
    | 'Walls & Obstacles'
    | 'Walkable Regions'
    | 'Start & Destination'
    | 'Navigation Connectivity'
    | 'Multi-Floor & Elevator';
  message: string;
  suggestion?: string;
}

export interface EnvironmentValidationReport {
  isValid: boolean;
  canSimulate: boolean;
  timestamp: string;
  checkedFloorCount: number;
  walkableCoveragePct: number;
  reachableDestinationsCount: number;
  totalDestinationsCount: number;
  issues: EnvironmentValidationIssue[];
}

export interface EnvironmentDefinition {
  id: string;
  name: string;
  version: string;
  templateType: EnvironmentTemplateType;
  description: string;
  widthM: number;
  depthM: number;
  gridResolutionM: number;
  floors: { floor: number; label: string; heightM: number }[];
  elements: MapElement2D[];
  buildings: CampusBuilding[];
  locations: DeliveryLocation[];
  elevators: CampusElevatorConfig[];
  constructionZones: ConstructionZoneConfig[];
  importedMap?: ImportedMapMetadata;
  isBuiltIn?: boolean;
  updatedAt: string;
}

export type RobotCategory =
  | 'courier'
  | 'heavy-logistics'
  | 'express-medical'
  | 'custom';

export type WheelConfigurationType =
  | 'Quad-Wheel Skid/Ackermann'
  | '6-Wheel Heavy Differential'
  | 'Compact 4-Wheel Omni/Express';

export interface RobotUnitConfig {
  id: string;
  name: string;
  model: string;
  description?: string;
  intendedApplication?: string;
  category?: RobotCategory;
  chassisColor: string;
  accentColor: string;
  /** Physical Dimensions */
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  weightKg?: number;
  collisionRadiusM?: number;
  /** Mobility & Kinematics */
  maxSpeedMps: number;
  accelerationMps2?: number;
  decelerationMps2?: number;
  emergencyBrakingMps2?: number;
  turningRadiusM?: number;
  wheelConfiguration?: WheelConfigurationType;
  movementType?: string;
  maxSlopeDeg?: number;
  /** Payload */
  payloadCapacityKg: number;
  defaultPayloadKg?: number;
  payloadSpeedPenaltyFactor?: number;
  /** Battery & Power */
  batteryCapacityWh: number;
  basePowerDrawW?: number;
  lowBatteryThresholdPct?: number;
  /** Sensors & Perception */
  sensorSuite: string;
  lidarType?: string;
  lidarRangeM?: number;
  lidarFovDeg?: number;
  cameraType?: string;
  cameraRangeM?: number;
  ultrasonicRangeM?: number;
  hasRadar?: boolean;
  hasThermalCamera?: boolean;
  hasImuFusion?: boolean;
  sensorUpdateHz?: number;
  baseSensorNoiseStdM?: number;
  assignedPolicyId: string;
  isCustom?: boolean;
}

export type RobotHardwareConfig = RobotUnitConfig;

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
  originFloor?: number;
  destinationFloor?: number;
  elevatorTestCase?: string;
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
  sourceExperimentIds?: string[];
  recommendedPolicyId: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  robotId?: string;
  payloadKg?: number;
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
  robotId?: string;
  robotName: string;
  robotHardwareSummary?: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  scenarioSeed?: number;
  batteryLevelAtFailurePct?: number;
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
  elevatorAvailable?: boolean;
  navigationState?: string;
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
  safetyInterventionCount?: number;
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
  trainedRobotId?: string;
  trainedRobotName?: string;
  trainedEnvironmentId?: string;
  trainedEnvironmentName?: string;
  isTrained: boolean;
  totalEpisodesTrained: number;
  lastTrainedAt: string | null;
  hyperparameters: QLearningHyperparameters;
  qTable: Record<string, Record<QLearningAction, number>>;
  perRobotQTables?: Record<string, Record<string, Record<QLearningAction, number>>>;
  stateVisitCounts: Record<string, number>;
  actionDistribution: Record<QLearningAction, number>;
  trainingHistory: TrainingEpisodeRecord[];
  trainingScenarioIds: string[];
  heldOutScenarioIds: string[];
}

// ============================================================================
// SECTION 9: POLICY & CROSS-ROBOT HARDWARE BENCHMARKING TYPES
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
    safetyInterventions?: number;
    elevatorFailed?: boolean;
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
    safetyInterventions?: number;
    elevatorFailed?: boolean;
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
  totalSafetyInterventions?: number;
  elevatorFailuresCount?: number;
  avgWaitingTimeSec: number;
  avgGlobalReplans: number;
  avgUnnecessaryReplans: number;
  avgBatteryConsumedPct: number;
  avgReward: number;
}

export interface BenchmarkSuiteResult {
  id: string;
  timestamp: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  robotId?: string;
  robotName?: string;
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

export interface CrossRobotComparisonEntry {
  robotId: string;
  robotName: string;
  robotModel: string;
  maxSpeedMps: number;
  payloadCapacityKg: number;
  batteryCapacityWh: number;
  lidarRangeM: number;
  collisionRadiusM: number;
  sensorSuite: string;
  payloadCompatible: boolean;
  episodesCount: number;
  successRatePct: number;
  collisionRatePct: number;
  totalCollisions: number;
  avgCompletionTimeSec: number;
  avgDistanceMeters: number;
  navigationFailuresCount: number;
  avgGlobalReplans: number;
  totalSafetyInterventions: number;
  avgBatteryConsumedPct: number;
  avgBatteryConsumedWh: number;
  primaryFailureReasons: string[];
}

export interface CrossRobotBenchmarkResult {
  id: string;
  timestamp: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  scenarioIds: string[];
  scenarioNames: string[];
  policyId: string;
  policyName: string;
  requestedPayloadKg: number;
  episodesPerScenario: number;
  seedBase: number;
  entries: CrossRobotComparisonEntry[];
  recommendedRobotId: string;
  recommendedRobotName: string;
  recommendationRationale: string;
}

export type ExperimentRunType = 'Interactive' | 'Batch' | 'Training' | 'Evaluation' | 'Benchmark';

export interface ExperimentRecord {
  id: string;
  timestamp: string;
  environmentId?: string;
  environmentName?: string;
  environmentVersion?: string;
  scenarioId: string;
  scenarioName: string;
  scenarioSeed?: number;
  scenarioGenerationSource?: ScenarioGenerationSource;
  scenarioDifficulty?: ScenarioDifficulty;
  robotId: string;
  robotName: string;
  robotHardwareSummary?: string;
  robotConfigSnapshot?: RobotUnitConfig;
  payloadKg?: number;
  policyId: string;
  policyName: string;
  policyVersion?: string;
  isCandidatePolicy?: boolean;
  runType?: ExperimentRunType;
  originName: string;
  destinationName: string;
  originFloor?: number;
  destinationFloor?: number;
  status: 'Success' | 'Failed';
  durationSec: number;
  distanceMeters: number;
  collisions: number;
  replanCount: number;
  unnecessaryReplanCount?: number;
  deadlockCount?: number;
  safetyInterventionCount?: number;
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
  environmentId?: string;
  environmentName?: string;
  robotId: string;
  robotName: string;
  robotStatus: RobotOperationalState;
  activeAvoidanceLevel?: AvoidanceHierarchyLevel;
  originName: string;
  currentDestination: string;
  originFloor?: number;
  destinationFloor?: number;
  batteryLevelPct: number;
  currentSpeedMps: number;
  targetSpeedMps?: number;
  navigationStatus: string;
  distanceRemainingM: number;
  distanceTraveledM: number;
  elapsedTimeSec: number;
  collisionsCount: number;
  replanCount: number;
  safetyInterventionCount?: number;
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
  activeElevatorMachineState?: ElevatorMachineState | null;
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
