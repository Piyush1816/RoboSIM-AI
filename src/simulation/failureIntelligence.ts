import { DEFAULT_SCENARIOS } from '../data/campusConfig';
import {
  ExperimentRecord,
  FailureCategory,
  FailureDiagnosisRecord,
  FailureOutcomeDistinction,
  FailureType,
  FailureWeaknessCluster,
  ScenarioConfig,
} from '../types/simulation';

/**
 * Classifies an experiment record into one of the 11 required Failure Intelligence categories
 * and produces a complete 10-field FailureDiagnosisRecord.
 *
 * Strictly distinguishes between:
 * - Actual Collision (collisions > 0)
 * - Safe Stop (Blocked/Fault) (collisions === 0, robot halted safely before barrier/pedestrian/elevator fault)
 * - Mission Timeout (excessive delivery time limit reached)
 * - Failed Delivery (battery depletion or mission abort)
 */
export const FAILURE_CATEGORIES: FailureCategory[] = [
  'Pedestrian interaction failure',
  'Unsafe obstacle avoidance',
  'Excessive global replanning',
  'Navigation deadlock',
  'Unreachable destination',
  'Low-visibility perception limitation',
  'Sensor-noise sensitivity',
  'Battery depletion',
  'Elevator-related failure',
  'Excessive delivery time',
  'Other or unclassified failure',
];

export function diagnoseExperimentFailure(
  exp: ExperimentRecord,
  scenario?: ScenarioConfig
): FailureDiagnosisRecord {
  const matchedScenario =
    scenario ??
    DEFAULT_SCENARIOS.find((s) => s.id === exp.scenarioId);

  const collisions = exp.collisions ?? 0;
  const replans = exp.globalReplanCount ?? exp.replanCount ?? 0;
  const unnecessaryReplans = exp.unnecessaryReplanCount ?? 0;
  const waitSec = exp.totalWaitingTimeSec ?? 0;
  const pedWaitSec = exp.pedestrianWaitingTimeSec ?? 0;
  const batteryUsed = exp.batteryConsumedPct ?? 0;
  const initialBattery = matchedScenario?.initialBatteryPct ?? 98.0;
  const remainingBattery = Math.max(0, initialBattery - batteryUsed);
  const sensorNoise = matchedScenario?.sensorNoiseLevel ?? 0.08;
  const traction = matchedScenario?.surfaceTraction ?? 0.92;
  const pedCount = matchedScenario?.dynamicObstacleCount ?? 4;
  const activeZones = matchedScenario?.activeConstructionZones ?? [];

  const reasonLower = (exp.failureReason ?? exp.rootCause ?? '').toLowerCase();
  const fType: FailureType = exp.failureType ?? 'Collision with Barrier';

  // 1. Determine Outcome Distinction (Never label a safe stop as a collision!)
  let outcomeDistinction: FailureOutcomeDistinction = 'Failed Delivery';
  if (collisions > 0) {
    outcomeDistinction = 'Actual Collision';
  } else if (
    fType === 'Mission Timeout' ||
    reasonLower.includes('timeout') ||
    reasonLower.includes('excessive delivery time')
  ) {
    outcomeDistinction = 'Mission Timeout';
  } else if (
    fType === 'No Valid Route Available' ||
    fType === 'Pathway Deadlock' ||
    fType === 'Elevator Mechanical Failure' ||
    fType === 'Elevator Unavailable' ||
    reasonLower.includes('halted safely') ||
    reasonLower.includes('safe stop') ||
    reasonLower.includes('blocked')
  ) {
    outcomeDistinction = 'Safe Stop (Blocked/Fault)';
  }

  // 2. Classify into the 11 Failure Categories based on concrete telemetry evidence
  let failureCategory: FailureCategory = 'Other or unclassified failure';

  if (
    fType === 'Battery Depletion' ||
    reasonLower.includes('battery') ||
    remainingBattery <= 1.0
  ) {
    failureCategory = 'Battery depletion';
  } else if (
    fType === 'Elevator Mechanical Failure' ||
    fType === 'Elevator Unavailable' ||
    reasonLower.includes('elevator') ||
    reasonLower.includes('lift')
  ) {
    failureCategory = 'Elevator-related failure';
  } else if (
    fType === 'No Valid Route Available' ||
    reasonLower.includes('no valid route') ||
    reasonLower.includes('all corridors') ||
    (exp.distanceMeters < 1.0 && collisions === 0 && replans >= 1)
  ) {
    failureCategory = 'Unreachable destination';
  } else if (
    fType === 'Pathway Deadlock' ||
    reasonLower.includes('deadlock') ||
    (exp.deadlockCount ?? 0) > 0
  ) {
    failureCategory = 'Navigation deadlock';
  } else if (
    fType === 'Mission Timeout' ||
    reasonLower.includes('excessive delivery time') ||
    reasonLower.includes('timeout') ||
    (exp.durationSec >= 95 && collisions === 0)
  ) {
    failureCategory = 'Excessive delivery time';
  } else if (
    fType === 'Pedestrian Safety Violation' ||
    reasonLower.includes('pedestrian') ||
    (pedWaitSec >= 8.0 && collisions === 0)
  ) {
    failureCategory = 'Pedestrian interaction failure';
  } else if (
    collisions > 0 &&
    sensorNoise >= 0.24 &&
    matchedScenario?.category === 'Low Visibility'
  ) {
    failureCategory = 'Low-visibility perception limitation';
  } else if (collisions > 0 && sensorNoise >= 0.22) {
    failureCategory = 'Sensor-noise sensitivity';
  } else if (replans >= 5 || unnecessaryReplans >= 3) {
    failureCategory = 'Excessive global replanning';
  } else if (
    collisions > 0 ||
    fType === 'Collision with Barrier' ||
    reasonLower.includes('impacted') ||
    reasonLower.includes('collision')
  ) {
    failureCategory = 'Unsafe obstacle avoidance';
  }

  // 3. Build Environmental Conditions summary
  const environmentalConditions =
    exp.environmentalConditionsSummary ||
    [
      `Pedestrians: ${pedCount} agents`,
      `Work Zones: ${activeZones.length > 0 ? activeZones.join(', ') : 'None'}`,
      `Traction: ${(traction * 100).toFixed(0)}%`,
      `Sensor Noise: ±${(sensorNoise * 100).toFixed(0)}%`,
      `Visibility: ${Math.max(5.5, 22 - sensorNoise * 38).toFixed(1)}m`,
      matchedScenario?.requiresElevator
        ? `Elevator Mode: ${matchedScenario.elevatorFaultMode ?? 'active'}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  // 4. Build Robot State Before Failure
  const coords = exp.failureCoordinates ?? { x: 8.0, z: 0.0 };
  const robotStateBeforeFailure =
    exp.robotStateBeforeCompletion ||
    `Pos (${coords.x.toFixed(1)}m, ${coords.z.toFixed(1)}m) · Traveled ${exp.distanceMeters.toFixed(
      1
    )}m in ${exp.durationSec.toFixed(1)}s · Battery Rem: ${remainingBattery.toFixed(
      1
    )}% · Wait Time: ${waitSec.toFixed(1)}s · Outcome Type: ${outcomeDistinction}`;

  // 5. Build Actions Taken by Robot
  const decisionList = exp.decisionHistory && exp.decisionHistory.length > 0
    ? exp.decisionHistory.slice(-5).join(' → ')
    : [
        exp.speedReductionEventsCount
          ? `${exp.speedReductionEventsCount} Level-2 speed modulations (${(
              exp.reducedSpeedTimeSec ?? 0
            ).toFixed(1)}s)`
          : null,
        exp.localBypassCount ? `${exp.localBypassCount} Level-4 local bypasses` : null,
        replans > 0 ? `${replans} Level-5 global A* replans` : '0 global replans',
        exp.elevatorReroutedToBackup ? 'Rerouted to backup elevator' : null,
        outcomeDistinction === 'Safe Stop (Blocked/Fault)'
          ? 'Executed safe emergency halt (0 collisions)'
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

  // 6. Build Probable Root Cause & Evidence & Suggested Improvement
  let probableRootCause = exp.rootCause || exp.failureReason || 'Insufficient evidence from telemetry logs.';
  let supportingEvidence = `Collisions=${collisions}, GlobalReplans=${replans}, WaitTime=${waitSec.toFixed(
    1
  )}s, Distance=${exp.distanceMeters.toFixed(1)}m, BatteryUsed=${batteryUsed.toFixed(1)}%.`;
  let suggestedImprovement =
    exp.mitigationSuggested ||
    'Retrain Candidate Q-Learning Policy on failure-driven scenarios with higher penalty on unsafe proximity and unnecessary replans.';

  switch (failureCategory) {
    case 'Pedestrian interaction failure':
      probableRootCause =
        collisions > 0
          ? `Robot entered pedestrian safety buffer during dense crossing traffic (${pedCount} agents) without sufficient early deceleration.`
          : `Robot experienced prolonged pedestrian yielding (${pedWaitSec.toFixed(
              1
            )}s wait) and failed to execute a timely local bypass around moving crowd agents.`;
      supportingEvidence = `PedestrianDetections=${
        exp.pedestrianDetectionsCount ?? 0
      }, PedWaitTime=${pedWaitSec.toFixed(1)}s, LocalBypasses=${
        exp.localBypassCount ?? 0
      }, GlobalReplans=${replans}, Collisions=${collisions}.`;
      suggestedImprovement =
        'Train Candidate Policy on dense pedestrian crossing scenarios to prefer early REDUCE_SPEED and LOCAL_AVOIDANCE over prolonged waiting or late stops.';
      break;

    case 'Unsafe obstacle avoidance':
      probableRootCause =
        collisions > 0
          ? `Policy maintained insufficient safety clearance (${exp.policyName}) or low construction avoidance weight near ${
              exp.obstacleType ?? 'Construction Barrier'
            } at (${coords.x.toFixed(1)}, ${coords.z.toFixed(1)}).`
          : `Robot approached static obstacle boundary too closely before braking.`;
      supportingEvidence = `Collisions=${collisions}, ObstacleType=${
        exp.obstacleType ?? 'Barrier'
      }, ContactCoords=(${coords.x.toFixed(1)}, ${coords.z.toFixed(
        1
      )}), ActiveZones=[${activeZones.join(', ') || 'none'}].`;
      suggestedImprovement =
        'Increase construction avoidance weight ≥ 2.5x and train Candidate Policy to trigger REDUCE_SPEED / LOCAL_AVOIDANCE when obstacle distance < 3.5m.';
      break;

    case 'Excessive global replanning':
      probableRootCause = `Policy triggered ${replans} full-grid A* route recalculations (${unnecessaryReplans} unnecessary) for transient pedestrian conflicts instead of regulating speed locally.`;
      supportingEvidence = `GlobalReplans=${replans}, UnnecessaryReplans=${unnecessaryReplans}, SpeedReductions=${
        exp.speedReductionEventsCount ?? 0
      }, Duration=${exp.durationSec.toFixed(1)}s.`;
      suggestedImprovement =
        'Penalize GLOBAL_REPLAN in Q-learning reward when obstruction is temporary (< 2.0s) and reinforce REDUCE_SPEED (Level 2).';
      break;

    case 'Navigation deadlock':
      probableRootCause = `Safe Stop (No Collision): All local bypasses and ${replans} replanning retries remained obstructed by dynamic agents for ${waitSec.toFixed(
        1
      )}s at (${coords.x.toFixed(1)}, ${coords.z.toFixed(1)}).`;
      supportingEvidence = `Collisions=0 (Safe Stop), TotalWaitTime=${waitSec.toFixed(
        1
      )}s, GlobalReplans=${replans}, LocalBypasses=${exp.localBypassCount ?? 0}.`;
      suggestedImprovement =
        'Train Candidate Policy to trigger proactive LOCAL_AVOIDANCE before entering narrow bottleneck corridors with oncoming pedestrian groups.';
      break;

    case 'Unreachable destination':
      probableRootCause = `Safe Stop (No Collision): A* pathfinder verified that all campus corridors between ${exp.originName} and ${exp.destinationName} are physically sealed by full construction blockades.`;
      supportingEvidence = `Collisions=0 (Safe Stop), DistanceTraveled=${exp.distanceMeters.toFixed(
        1
      )}m, ActiveConstructionZones=[${activeZones.join(', ')}].`;
      suggestedImprovement =
        'Maintain safe-stop behavior when destination is topologically disconnected; re-open at least one corridor in Synthetic Scenario Factory.';
      break;

    case 'Low-visibility perception limitation':
      probableRootCause = `Reduced fog visibility (${Math.max(
        5.5,
        22 - sensorNoise * 38
      ).toFixed(1)}m) delayed hazard detection, leaving insufficient braking distance on ${(
        traction * 100
      ).toFixed(0)}% traction surface.`;
      supportingEvidence = `SensorNoise=${(sensorNoise * 100).toFixed(
        0
      )}%, SurfaceTraction=${(traction * 100).toFixed(
        0
      )}%, Collisions=${collisions}, Duration=${exp.durationSec.toFixed(1)}s.`;
      suggestedImprovement =
        'Train Candidate Policy to select conservative REDUCE_SPEED when sensor noise > 20% or visibility < 12m.';
      break;

    case 'Sensor-noise sensitivity':
      probableRootCause = `Elevated LiDAR multipath noise (±${(
        sensorNoise * 100
      ).toFixed(0)}%) caused noisy distance estimates and late avoidance near (${coords.x.toFixed(
        1
      )}, ${coords.z.toFixed(1)}).`;
      supportingEvidence = `SensorNoise=${(sensorNoise * 100).toFixed(
        0
      )}%, PredictionAccuracy=${(exp.predictionAccuracyPct ?? 88).toFixed(
        1
      )}%, Collisions=${collisions}.`;
      suggestedImprovement =
        'Expand uncertainty safety buffer and train Candidate Policy on high-noise synthetic scenarios.';
      break;

    case 'Battery depletion':
      probableRootCause = `Mission energy consumption (${batteryUsed.toFixed(
        1
      )}%) exhausted available battery charge (Initial: ${initialBattery.toFixed(
        1
      )}%, Drain Multiplier: ${
        matchedScenario?.batteryDrainMultiplier ?? 1.0
      }x) before reaching ${exp.destinationName}.`;
      supportingEvidence = `InitialBattery=${initialBattery.toFixed(
        1
      )}%, BatteryConsumed=${batteryUsed.toFixed(
        1
      )}%, Remaining=${remainingBattery.toFixed(
        1
      )}%, DistanceTraveled=${exp.distanceMeters.toFixed(1)}m.`;
      suggestedImprovement =
        'Minimize detour distance and unnecessary global replans under tight battery constraints, or dispatch from a closer charging dock.';
      break;

    case 'Elevator-related failure':
      probableRootCause = `Safe Stop (No Collision): Vertical transit failed due to elevator fault mode '${
        exp.elevatorFaultMode ?? 'stuck/unavailable'
      }' (Encountered state: ${exp.elevatorStateEncountered ?? 'Out of Service'}).`;
      supportingEvidence = `Collisions=0 (Safe Stop), ElevatorState=${
        exp.elevatorStateEncountered ?? 'Out of Service'
      }, ElevatorWait=${(exp.elevatorWaitTimeSec ?? 0).toFixed(
        1
      )}s, ReroutedToBackup=${Boolean(exp.elevatorReroutedToBackup)}.`;
      suggestedImprovement =
        'Enable proactive backup lift rerouting (Central Library Lift B) when primary lift wait exceeds 3.0s.';
      break;

    case 'Excessive delivery time':
      probableRootCause = `Delivery duration (${exp.durationSec.toFixed(
        1
      )}s) exceeded mission SLA due to cumulative waiting (${waitSec.toFixed(
        1
      )}s) and ${replans} route recalculations.`;
      supportingEvidence = `Duration=${exp.durationSec.toFixed(
        1
      )}s, TotalWaitTime=${waitSec.toFixed(1)}s, GlobalReplans=${replans}, Distance=${exp.distanceMeters.toFixed(
        1
      )}m.`;
      suggestedImprovement =
        'Train Candidate Policy to favor smooth speed regulation (Level 2) and local bypass (Level 4) over prolonged stops and long global detours.';
      break;

    default:
      break;
  }

  return {
    id: `DIAG-${exp.id.replace(/^(DEMO-)?EXP-/, '')}`,
    experimentId: exp.id,
    scenarioId: exp.scenarioId,
    scenarioName: exp.scenarioName,
    policyVersion: exp.policyVersion ?? '2.1.0',
    policyId: exp.policyId,
    policyName: exp.policyName,
    robotId: exp.robotId,
    robotName: exp.robotName,
    robotHardwareSummary: exp.robotHardwareSummary,
    failureCategory,
    failureType: fType,
    outcomeDistinction,
    environmentalConditions,
    robotStateBeforeFailure,
    actionsTaken: decisionList,
    probableRootCause,
    supportingEvidence,
    suggestedImprovement,
    coordinates: coords,
    severity: collisions > 0 ? 'Critical' : 'Warning',
    timestamp: exp.timestamp,
    isDemoData: exp.isDemoData,
  };
}

/**
 * Analyzes all recorded experiments (both outright failures and suboptimal runs
 * with excessive replanning or high waiting time) to discover the robot policy's
 * top weakness clusters with verifiable quantitative evidence.
 */
export function analyzeWeaknessesFromExperiments(
  experiments: ExperimentRecord[],
  scenarios: ScenarioConfig[]
): FailureWeaknessCluster[] {
  const scenMap = new Map<string, ScenarioConfig>();
  for (const s of [...DEFAULT_SCENARIOS, ...scenarios]) {
    scenMap.set(s.id, s);
  }

  // Include failed runs AND suboptimal runs (e.g. replanCount >= 3 or totalWaitingTimeSec >= 5.5s)
  const relevantRuns = experiments.filter(
    (e) =>
      e.status === 'Failed' ||
      (e.globalReplanCount ?? e.replanCount ?? 0) >= 3 ||
      (e.totalWaitingTimeSec ?? 0) >= 5.5 ||
      e.collisions > 0
  );

  if (relevantRuns.length === 0) {
    return [];
  }

  const byCategory = new Map<
    FailureCategory,
    {
      runs: ExperimentRecord[];
      scenarioIds: Set<string>;
      totalWait: number;
      totalReplans: number;
      totalCollisions: number;
    }
  >();

  for (const exp of relevantRuns) {
    const sc = scenMap.get(exp.scenarioId);
    let cat: FailureCategory;
    if (exp.status === 'Failed') {
      cat =
        exp.failureCategory ??
        diagnoseExperimentFailure(exp, sc).failureCategory;
    } else if ((exp.globalReplanCount ?? exp.replanCount ?? 0) >= 3) {
      cat = 'Excessive global replanning';
    } else if ((exp.pedestrianWaitingTimeSec ?? exp.totalWaitingTimeSec ?? 0) >= 5.5) {
      cat = 'Pedestrian interaction failure';
    } else {
      cat = 'Excessive delivery time';
    }

    const curr = byCategory.get(cat) ?? {
      runs: [],
      scenarioIds: new Set<string>(),
      totalWait: 0,
      totalReplans: 0,
      totalCollisions: 0,
    };
    curr.runs.push(exp);
    curr.scenarioIds.add(exp.scenarioId);
    curr.totalWait += exp.totalWaitingTimeSec ?? 0;
    curr.totalReplans += exp.globalReplanCount ?? exp.replanCount ?? 0;
    curr.totalCollisions += exp.collisions ?? 0;
    byCategory.set(cat, curr);
  }

  const totalCount = relevantRuns.length;
  const clusters: FailureWeaknessCluster[] = [];

  const strategyMap: Record<FailureCategory, string> = {
    'Pedestrian interaction failure':
      'Generate high-density pedestrian crossing & group bottleneck scenarios with varied crossing angles and speeds.',
    'Unsafe obstacle avoidance':
      'Generate multi-zone construction detour scenarios with tight corridor margins and partial lane closures.',
    'Excessive global replanning':
      'Generate transient pedestrian crossing waves where local speed regulation outperforms full A* route switching.',
    'Navigation deadlock':
      'Generate bi-directional commuter & group crowd surges in narrow campus walkways to train timely local bypasses.',
    'Unreachable destination':
      'Generate alternative-corridor construction configurations where exactly one detour remains open to verify reachability.',
    'Low-visibility perception limitation':
      'Generate dense dusk fog scenarios (visibility 8–12m) combined with wet surface traction (0.68–0.78).',
    'Sensor-noise sensitivity':
      'Generate elevated LiDAR multipath reflection scenarios (sensor noise 0.25–0.40) with moving pedestrians.',
    'Battery depletion':
      'Generate constrained initial battery scenarios (22–35% charge) with elevated drain multipliers (1.35–1.6x).',
    'Elevator-related failure':
      'Generate multi-floor delivery missions with primary lift unavailable or delayed to train rapid backup lift recovery.',
    'Excessive delivery time':
      'Generate compound congestion + partial blockade scenarios requiring smooth speed regulation without prolonged stops.',
    'Other or unclassified failure':
      'Generate multi-hazard stress scenarios combining pedestrian traffic and construction detours.',
  };

  for (const [category, stats] of byCategory.entries()) {
    const count = stats.runs.length;
    const avgWait = stats.totalWait / count;
    const avgReplans = stats.totalReplans / count;
    const avgCollisions = stats.totalCollisions / count;
    const expIds = stats.runs
      .slice(0, 4)
      .map((r) => r.id)
      .join(', ');

    clusters.push({
      category,
      failureCount: count,
      shareOfFailuresPct: Number(((count / totalCount) * 100).toFixed(1)),
      affectedScenarioIds: Array.from(stats.scenarioIds),
      avgWaitingTimeSec: Number(avgWait.toFixed(1)),
      avgReplans: Number(avgReplans.toFixed(1)),
      avgCollisions: Number(avgCollisions.toFixed(2)),
      evidenceSummary: `Observed in ${count} run(s) [${expIds}]: Avg Wait ${avgWait.toFixed(
        1
      )}s, Avg Replans ${avgReplans.toFixed(1)}, Total Collisions ${
        stats.totalCollisions
      }.`,
      recommendedMutationStrategy: strategyMap[category],
    });
  }

  return clusters.sort((a, b) => b.failureCount - a.failureCount);
}
