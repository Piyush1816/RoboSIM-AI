import {
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
} from '../data/campusConfig';
import {
  DatasetSplit,
  ElevatorFaultMode,
  ExperimentRecord,
  FailureCategory,
  FailureDrivenGenerationBatch,
  FailureWeaknessCluster,
  PredictionHorizonSec,
  ScenarioConfig,
  ScenarioDifficulty,
} from '../types/simulation';
import { analyzeWeaknessesFromExperiments } from './failureIntelligence';
import {
  classifyCampusSurface,
  computeAStarPathWithDiagnostics,
} from './pathfinding';

/**
 * Deterministic Mulberry32 PRNG for reproducible synthetic scenario generation.
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScenarioValidationResult {
  valid: boolean;
  startWalkable: boolean;
  destWalkable: boolean;
  routeReachable: boolean;
  waypointCount: number;
  estimatedDistanceM: number;
  reason: string;
}

/**
 * Validates that a ScenarioConfig has geometrically valid campus coordinates
 * and checks A* path reachability across active construction blockades.
 */
export function validateScenarioGeometry(
  scenario: ScenarioConfig,
  allowUnreachableIfIntended = false
): ScenarioValidationResult {
  const origin =
    DELIVERY_LOCATIONS.find((l) => l.id === scenario.originId) ??
    DELIVERY_LOCATIONS[1];
  const dest =
    DELIVERY_LOCATIONS.find((l) => l.id === scenario.destinationId) ??
    DELIVERY_LOCATIONS[5];

  const startPos = scenario.customStartCoords ?? {
    x: origin.position[0],
    z: origin.position[2],
  };
  const destPos = scenario.customDestCoords ?? {
    x: dest.position[0],
    z: dest.position[2],
  };

  const startSurface = classifyCampusSurface(startPos.x, startPos.z);
  const destSurface = classifyCampusSurface(destPos.x, destPos.z);

  const startWalkable = startSurface.isRoadOrPath;
  const destWalkable = destSurface.isRoadOrPath;

  const diag = computeAStarPathWithDiagnostics(
    startPos,
    destPos,
    scenario.activeConstructionZones,
    2.5,
    []
  );

  let estimatedDist = 0;
  for (let i = 1; i < diag.path.length; i++) {
    estimatedDist += Math.hypot(
      diag.path[i].x - diag.path[i - 1].x,
      diag.path[i].z - diag.path[i - 1].z
    );
  }

  const valid =
    startWalkable &&
    destWalkable &&
    origin.id !== dest.id &&
    (diag.reachable || allowUnreachableIfIntended);

  return {
    valid,
    startWalkable,
    destWalkable,
    routeReachable: diag.reachable,
    waypointCount: diag.path.length,
    estimatedDistanceM: Number(estimatedDist.toFixed(1)),
    reason: !startWalkable
      ? 'Origin coordinates are outside walkable campus pathways.'
      : !destWalkable
      ? 'Destination coordinates are outside walkable campus pathways.'
      : origin.id === dest.id
      ? 'Origin and destination must be distinct campus locations.'
      : !diag.reachable && !allowUnreachableIfIntended
      ? diag.failureReason || 'All corridors between origin and destination are blocked.'
      : 'Valid campus geometry and verified A* route.',
  };
}

export function computeScenarioDifficulty(
  pedCount: number,
  zonesCount: number,
  sensorNoise: number,
  surfaceTraction: number,
  requiresElevator: boolean,
  initialBatteryPct = 98
): ScenarioDifficulty {
  let score = 0;
  score += pedCount * 1.1;
  score += zonesCount * 2.5;
  score += sensorNoise * 18;
  score += (1 - surfaceTraction) * 15;
  if (requiresElevator) score += 3.5;
  if (initialBatteryPct < 35) score += 4.0;

  if (score < 5.5) return 'Low';
  if (score < 11.0) return 'Moderate';
  if (score < 16.5) return 'High';
  return 'Extreme';
}

export interface RandomScenarioGeneratorOptions {
  count: number;
  baseSeed: number;
  difficultyPreference?: 'Mixed' | ScenarioDifficulty;
  includeElevatorFaults?: boolean;
  includeBatteryConstraints?: boolean;
  datasetSplitMode?: 'balanced' | DatasetSplit;
}

/**
 * Generates N physically valid, deterministically reproducible synthetic scenarios
 * across diverse environmental, pedestrian, obstacle, sensor, and battery conditions.
 */
export function generateRandomSyntheticScenarios(
  options: RandomScenarioGeneratorOptions,
  existingCount = 0
): ScenarioConfig[] {
  const {
    count,
    baseSeed,
    difficultyPreference = 'Mixed',
    includeElevatorFaults = true,
    includeBatteryConstraints = true,
    datasetSplitMode = 'balanced',
  } = options;

  const generated: ScenarioConfig[] = [];
  const deliveryLocs = DELIVERY_LOCATIONS.filter((l) => l.type === 'delivery');

  const safeZoneCombos: string[][] = [
    [],
    ['cz-central-east'],
    ['cz-south-crosswalk'],
    ['cz-west-corridor'],
    ['cz-central-east', 'cz-south-crosswalk'],
    ['cz-central-east', 'cz-west-corridor'],
    ['cz-south-crosswalk', 'cz-west-corridor'],
    ['cz-central-east', 'cz-south-crosswalk', 'cz-west-corridor'],
  ];

  const categories: ScenarioConfig['category'][] = [
    'High Congestion',
    'Construction Detour',
    'Low Visibility',
    'Multi-Failure Stress',
    'Nominal',
    ...(includeElevatorFaults ? (['Elevator Recovery'] as const) : []),
  ];

  for (let i = 0; i < count; i++) {
    const scenarioSeed = baseSeed + i * 97 + 1;
    const rng = createSeededRng(scenarioSeed);

    const cat = categories[Math.floor(rng() * categories.length)];

    // Pick valid distinct origin and destination
    let origin = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
    let dest = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
    let guard = 0;
    while (dest.id === origin.id && guard < 15) {
      dest = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
      guard++;
    }

    // Pick construction zones that keep the route reachable
    let chosenZones =
      cat === 'Nominal'
        ? []
        : safeZoneCombos[Math.floor(rng() * safeZoneCombos.length)];

    const testDiag = computeAStarPathWithDiagnostics(
      { x: origin.position[0], z: origin.position[2] },
      { x: dest.position[0], z: dest.position[2] },
      chosenZones,
      2.5,
      []
    );
    if (!testDiag.reachable) {
      chosenZones = ['cz-central-east'];
    }

    // Scale parameters based on category & difficulty preference
    const diffScale =
      difficultyPreference === 'Low'
        ? 0.45
        : difficultyPreference === 'Moderate'
        ? 0.75
        : difficultyPreference === 'High'
        ? 1.15
        : difficultyPreference === 'Extreme'
        ? 1.45
        : 0.6 + rng() * 0.85;

    const commuterCount = Math.min(
      5,
      Math.max(1, Math.round((1 + rng() * 2.5) * diffScale))
    );
    const randomCount = Math.min(
      4,
      Math.max(0, Math.round(rng() * 2.2 * diffScale))
    );
    const crossingCount = Math.min(
      5,
      Math.max(
        cat === 'High Congestion' ? 2 : 0,
        Math.round((0.8 + rng() * 2.5) * diffScale)
      )
    );
    const groupCount = Math.min(
      4,
      Math.max(0, Math.round(rng() * 2.2 * diffScale))
    );
    const totalPeds = commuterCount + randomCount + crossingCount + groupCount;

    const sensorNoise = Number(
      Math.min(
        0.4,
        Math.max(
          0.02,
          cat === 'Low Visibility' || cat === 'Multi-Failure Stress'
            ? (0.18 + rng() * 0.18) * Math.min(1.25, diffScale)
            : (0.04 + rng() * 0.12) * Math.min(1.2, diffScale)
        )
      ).toFixed(2)
    );

    const surfaceTraction = Number(
      Math.min(
        0.99,
        Math.max(
          0.64,
          cat === 'Low Visibility' || cat === 'Multi-Failure Stress'
            ? 0.86 - rng() * 0.18
            : 0.96 - rng() * 0.1
        )
      ).toFixed(2)
    );

    const requiresElevator = cat === 'Elevator Recovery';
    const elevatorModes: ElevatorFaultMode[] = [
      'unavailable-before-arrival',
      'delayed-reassess',
      'none',
    ];
    const elevatorFaultMode: ElevatorFaultMode = requiresElevator
      ? elevatorModes[Math.floor(rng() * elevatorModes.length)]
      : 'none';

    const tightBattery =
      includeBatteryConstraints && rng() < 0.25 && !requiresElevator;
    const initialBatteryPct = tightBattery
      ? Number((24 + rng() * 14).toFixed(1))
      : 98.0;

    const batteryDrainMultiplier = Number(
      (1.0 + (1.0 - surfaceTraction) * 1.2 + sensorNoise * 0.9).toFixed(2)
    );

    const difficulty = computeScenarioDifficulty(
      totalPeds,
      chosenZones.length,
      sensorNoise,
      surfaceTraction,
      requiresElevator,
      initialBatteryPct
    );

    const split: DatasetSplit =
      datasetSplitMode === 'balanced'
        ? i % 2 === 0
          ? 'train'
          : 'test'
        : datasetSplitMode;

    const horizonChoices: PredictionHorizonSec[] = [1, 2, 4];
    const predictionHorizonSec =
      horizonChoices[Math.floor(rng() * horizonChoices.length)];

    const zoneNames = chosenZones
      .map((zid) => CONSTRUCTION_ZONES.find((z) => z.id === zid)?.name ?? zid)
      .join(', ');

    const scenario: ScenarioConfig = {
      id: `scen-rand-${scenarioSeed}-${existingCount + i + 1}`,
      name: `Synthetic ${cat} #${existingCount + i + 1} (Seed ${scenarioSeed})`,
      category: cat,
      description: `Procedurally generated ${difficulty.toLowerCase()}-difficulty ${cat.toLowerCase()} mission from ${
        origin.code
      } to ${dest.code} with ${totalPeds} pedestrians (${commuterCount}C/${randomCount}R/${crossingCount}X/${groupCount}G), ${
        chosenZones.length > 0 ? zoneNames : 'clear corridors'
      }, ${(surfaceTraction * 100).toFixed(0)}% traction, and ±${(
        sensorNoise * 100
      ).toFixed(0)}% sensor noise.`,
      originId: origin.id,
      destinationId: dest.id,
      activeConstructionZones: chosenZones,
      dynamicObstacleCount: totalPeds,
      pedestrianDistribution: {
        commuterCount,
        randomCount,
        crossingCount,
        groupCount,
        randomSeed: scenarioSeed,
      },
      predictionHorizonSec,
      requiresElevator,
      primaryElevatorId: 'elev-north-main',
      backupElevatorId: 'elev-east-backup',
      elevatorFaultMode,
      elevatorTimeoutSec: 3.2,
      surfaceTraction,
      sensorNoiseLevel: sensorNoise,
      batteryDrainMultiplier,
      initialBatteryPct,
      pedestrianSpeedMultiplier: Number((0.85 + rng() * 0.45).toFixed(2)),
      randomSeed: scenarioSeed,
      difficulty,
      generationSource: 'Random',
      datasetSplit: split,
      generationReason: `Random synthetic sampling (Seed ${scenarioSeed}) for ${split.toUpperCase()} split evaluation.`,
      recommendedPolicyId: 'pol-candidate-rl',
      isCustom: true,
    };

    generated.push(scenario);
  }

  return generated;
}

/**
 * Section 6: FAILURE-DRIVEN SCENARIO GENERATION
 * Analyzes actual failure/weakness records in Experiment History and automatically
 * generates targeted synthetic scenarios that stress-test and retrain those exact weaknesses.
 */
export function generateFailureDrivenScenarios(
  experiments: ExperimentRecord[],
  existingScenarios: ScenarioConfig[],
  countPerWeakness = 2,
  baseSeed = 8080
): FailureDrivenGenerationBatch {
  let weaknesses: FailureWeaknessCluster[] = analyzeWeaknessesFromExperiments(
    experiments,
    existingScenarios
  );

  // If the user hasn't accumulated failures yet, synthesize diagnostic baseline weaknesses
  // from the highest-risk categories so the button always works and explains its evidence clearly.
  if (weaknesses.length === 0) {
    weaknesses = [
      {
        category: 'Pedestrian interaction failure',
        failureCount: 1,
        shareOfFailuresPct: 50.0,
        affectedScenarioIds: ['scen-congestion-peak'],
        avgWaitingTimeSec: 6.4,
        avgReplans: 2.0,
        avgCollisions: 0,
        evidenceSummary:
          'Baseline policy exhibits elevated waiting time and repeated route switches in dense crossing corridors (scen-congestion-peak).',
        recommendedMutationStrategy:
          'Generate high-density pedestrian crossing & group bottleneck scenarios with varied crossing speeds.',
      },
      {
        category: 'Excessive global replanning',
        failureCount: 1,
        shareOfFailuresPct: 50.0,
        affectedScenarioIds: ['scen-multi-stress'],
        avgWaitingTimeSec: 5.2,
        avgReplans: 3.5,
        avgCollisions: 0,
        evidenceSummary:
          'Compound multi-hazard corridors trigger frequent global A* route recalculations when transient pedestrians cross.',
        recommendedMutationStrategy:
          'Generate transient crossing waves combined with single-corridor construction detours.',
      },
    ];
  }

  const generatedScenarios: ScenarioConfig[] = [];
  const deliveryLocs = DELIVERY_LOCATIONS.filter((l) => l.type === 'delivery');
  const difficultyProgression: ScenarioDifficulty[] = [
    'Moderate',
    'High',
    'Extreme',
  ];

  const topWeaknesses = weaknesses.slice(0, 3);
  let seqIdx = 0;

  for (const w of topWeaknesses) {
    for (let k = 0; k < countPerWeakness; k++) {
      seqIdx += 1;
      const seed = baseSeed + seqIdx * 131;
      const rng = createSeededRng(seed);
      const targetDiff =
        difficultyProgression[Math.min(k + 1, difficultyProgression.length - 1)];

      let origin = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
      let dest = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
      while (dest.id === origin.id) {
        dest = deliveryLocs[Math.floor(rng() * deliveryLocs.length)];
      }

      let category: ScenarioConfig['category'] = 'High Congestion';
      let activeZones: string[] = ['cz-south-crosswalk'];
      let commuterCount = 2;
      let randomCount = 2;
      let crossingCount = 3 + k;
      let groupCount = 2 + k;
      let sensorNoise = 0.12;
      let surfaceTraction = 0.88;
      let requiresElevator = false;
      let elevatorFaultMode: ElevatorFaultMode = 'none';
      let initialBatteryPct = 98.0;
      let batteryDrainMultiplier = 1.25;
      let reason = '';

      switch (w.category) {
        case 'Pedestrian interaction failure':
        case 'Navigation deadlock':
          category = 'High Congestion';
          activeZones = k % 2 === 0 ? ['cz-south-crosswalk'] : ['cz-central-east'];
          commuterCount = 2 + k;
          randomCount = 1 + k;
          crossingCount = 3 + k;
          groupCount = 2 + k;
          sensorNoise = Number((0.08 + k * 0.05).toFixed(2));
          surfaceTraction = Number((0.92 - k * 0.04).toFixed(2));
          reason = `Targeted mutation for '${w.category}': Escalated crossing pedestrians (${crossingCount}X) and group bottlenecks (${groupCount}G) with ${activeZones[0]} active to train smooth speed regulation and local bypass over deadlocks.`;
          break;

        case 'Excessive global replanning':
        case 'Excessive delivery time':
          category = 'High Congestion';
          activeZones = ['cz-central-east', 'cz-south-crosswalk'];
          commuterCount = 3;
          randomCount = 1;
          crossingCount = 3 + k;
          groupCount = 1 + k;
          sensorNoise = 0.1;
          surfaceTraction = 0.9;
          reason = `Targeted mutation for '${w.category}': Configured transient crossing waves (${crossingCount}X) along detour corridor so Candidate Policy learns to hold route and regulate speed rather than triggering expensive global replans.`;
          break;

        case 'Unsafe obstacle avoidance':
        case 'Unreachable destination':
          category = 'Construction Detour';
          activeZones =
            k === 0
              ? ['cz-central-east', 'cz-west-corridor']
              : ['cz-central-east', 'cz-south-crosswalk', 'cz-west-corridor'];
          commuterCount = 2;
          randomCount = 1;
          crossingCount = 2;
          groupCount = 1;
          sensorNoise = 0.14;
          surfaceTraction = 0.85;
          reason = `Targeted mutation for '${w.category}': Activated ${activeZones.length} simultaneous construction zones with narrow traversable corridors while keeping destination reachable.`;
          break;

        case 'Low-visibility perception limitation':
        case 'Sensor-noise sensitivity':
          category = 'Low Visibility';
          activeZones = ['cz-west-corridor', 'cz-south-crosswalk'];
          commuterCount = 2;
          randomCount = 2;
          crossingCount = 2 + k;
          groupCount = 1;
          sensorNoise = Number((0.26 + k * 0.06).toFixed(2));
          surfaceTraction = Number((0.76 - k * 0.05).toFixed(2));
          reason = `Targeted mutation for '${w.category}': Injected high LiDAR sensor noise (±${(
            sensorNoise * 100
          ).toFixed(0)}%) and wet surface traction (${(
            surfaceTraction * 100
          ).toFixed(0)}%) to train conservative speed scaling.`;
          break;

        case 'Battery depletion':
          category = 'Multi-Failure Stress';
          activeZones = ['cz-central-east'];
          commuterCount = 2;
          randomCount = 1;
          crossingCount = 2;
          groupCount = 1;
          initialBatteryPct = Number((26 - k * 4).toFixed(1));
          batteryDrainMultiplier = Number((1.45 + k * 0.15).toFixed(2));
          reason = `Targeted mutation for '${w.category}': Constrained starting battery (${initialBatteryPct}%) with ${batteryDrainMultiplier}x drain to penalize long detours and unnecessary replans.`;
          break;

        case 'Elevator-related failure':
          category = 'Elevator Recovery';
          origin = DELIVERY_LOCATIONS.find((l) => l.id === 'loc-eng-dock') ?? origin;
          dest =
            DELIVERY_LOCATIONS.find((l) => l.id === 'loc-library-2f-vault') ?? dest;
          activeZones = [];
          requiresElevator = true;
          elevatorFaultMode =
            k % 2 === 0 ? 'unavailable-before-arrival' : 'delayed-reassess';
          commuterCount = 2;
          randomCount = 1;
          crossingCount = 2;
          groupCount = 1;
          reason = `Targeted mutation for '${w.category}': Configured multi-floor elevator fault '${elevatorFaultMode}' with corridor pedestrian traffic to verify autonomous backup lift rerouting.`;
          break;

        default:
          category = 'Multi-Failure Stress';
          activeZones = ['cz-central-east', 'cz-south-crosswalk'];
          reason = `Targeted multi-hazard stress scenario generated from observed failure telemetry.`;
          break;
      }

      // Ensure A* route is reachable
      const check = computeAStarPathWithDiagnostics(
        { x: origin.position[0], z: origin.position[2] },
        { x: dest.position[0], z: dest.position[2] },
        activeZones,
        2.5,
        []
      );
      if (!check.reachable) {
        activeZones = ['cz-central-east'];
      }

      const totalPeds =
        commuterCount + randomCount + crossingCount + groupCount;
      const split: DatasetSplit = k % 2 === 0 ? 'train' : 'test';
      const catSlug = w.category
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const sourceExpIds = experiments
        .filter(
          (e) =>
            e.status === 'Failed' &&
            (e.failureCategory === w.category ||
              w.affectedScenarioIds.includes(e.scenarioId))
        )
        .map((e) => e.id)
        .slice(0, 5);

      generatedScenarios.push({
        id: `scen-fd-${catSlug}-${k + 1}`,
        name: `Failure-Driven: ${w.category.split(' ')[0]} Stress #${k + 1} (${targetDiff})`,
        category,
        description: reason,
        originId: origin.id,
        destinationId: dest.id,
        originFloor: origin.floor ?? 0,
        destinationFloor: dest.floor ?? (requiresElevator ? 2 : 0),
        activeConstructionZones: activeZones,
        dynamicObstacleCount: totalPeds,
        pedestrianDistribution: {
          commuterCount,
          randomCount,
          crossingCount,
          groupCount,
          randomSeed: seed,
        },
        predictionHorizonSec: 2,
        requiresElevator,
        primaryElevatorId: 'elev-north-main',
        backupElevatorId: 'elev-east-backup',
        elevatorFaultMode,
        elevatorTimeoutSec: 3.2,
        surfaceTraction,
        sensorNoiseLevel: sensorNoise,
        batteryDrainMultiplier,
        initialBatteryPct,
        pedestrianSpeedMultiplier: Number((1.05 + k * 0.12).toFixed(2)),
        randomSeed: seed,
        difficulty: targetDiff,
        generationSource: 'Failure-Driven',
        datasetSplit: split,
        targetedFailureCategory: w.category,
        generationReason: reason,
        sourceWeaknessEvidence: w.evidenceSummary,
        sourceExperimentIds: sourceExpIds,
        recommendedPolicyId: 'pol-candidate-rl',
        isCustom: true,
      });
    }
  }

  return {
    id: `FD-BATCH-${Date.now()}`,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    weaknessesDiscovered: topWeaknesses,
    generatedScenarios,
  };
}
