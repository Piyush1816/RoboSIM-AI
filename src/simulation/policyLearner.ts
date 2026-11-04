import {
  CandidatePolicyState,
  QLearningAction,
  QLearningHyperparameters,
  QLearningObservation,
} from '../types/simulation';
import { createSeededRng } from './scenarioFactory';

export const ALL_QL_ACTIONS: QLearningAction[] = [
  'MAINTAIN_SPEED',
  'REDUCE_SPEED',
  'STOP_TEMPORARILY',
  'LOCAL_AVOIDANCE',
  'GLOBAL_REPLAN',
];

export const QL_ACTION_LABELS: Record<QLearningAction, string> = {
  MAINTAIN_SPEED: 'Maintain Current Speed',
  REDUCE_SPEED: 'Reduce Speed Smoothly',
  STOP_TEMPORARILY: 'Stop Temporarily (Yield)',
  LOCAL_AVOIDANCE: 'Perform Local Avoidance Bypass',
  GLOBAL_REPLAN: 'Request Global A* Replan',
};

export function createDefaultHyperparameters(): QLearningHyperparameters {
  return {
    learningRate: 0.3,
    discountFactor: 0.92,
    explorationRate: 0.36,
    initialExplorationRate: 0.36,
    minExplorationRate: 0.04,
    explorationDecay: 0.89,
  };
}

export function createInitialCandidatePolicyState(): CandidatePolicyState {
  return {
    id: 'pol-candidate-rl',
    name: 'Candidate Q-Learning Policy',
    version: '1.0.0-untrained',
    basePolicyId: 'pol-hybrid-safe',
    isTrained: false,
    totalEpisodesTrained: 0,
    totalQTableUpdates: 0,
    lastTrainedAt: null,
    hyperparameters: createDefaultHyperparameters(),
    qTable: {},
    stateVisitCounts: {},
    actionDistribution: {
      MAINTAIN_SPEED: 0,
      REDUCE_SPEED: 0,
      STOP_TEMPORARILY: 0,
      LOCAL_AVOIDANCE: 0,
      GLOBAL_REPLAN: 0,
    },
    trainingHistory: [],
    trainingScenarioIds: [
      'scen-train-congestion-wave',
      'scen-train-temp-corridor',
      'scen-train-consecutive-obstacles',
      'scen-train-replan-trap',
      'scen-train-elevator-reroute',
      'scen-train-compound-stress',
      'scen-construction-detour',
      'scen-low-visibility',
    ],
    heldOutScenarioIds: [
      'scen-congestion-peak',
      'scen-multi-stress',
      'scen-elevator-recovery',
      'scen-test-corridor-gauntlet',
      'scen-test-replan-labyrinth',
    ],
  };
}

/**
 * Discretizes continuous robot observations into an interpretable tabular state key.
 * Captures all required observation features:
 * 1. Distance to nearest pedestrian
 * 2. Relative pedestrian movement
 * 3. Time to potential collision (TTC)
 * 4. Distance to nearest obstacle
 * 5. Whether current path is blocked
 * 6. Whether a temporary obstruction is present
 * 7. Stall / repeated stop or replan state
 * 8. Elevator availability
 */
export function encodeObservationToStateKey(obs: QLearningObservation): string {
  const pedDistBin =
    obs.nearestPedDistM === null || obs.nearestPedDistM > 5.2
      ? 'far'
      : obs.nearestPedDistM > 2.4
      ? 'med'
      : obs.nearestPedDistM > 1.35
      ? 'close'
      : 'crit';

  const relMotion = obs.relativePedMovement;

  const ttcBin =
    obs.ttcSec === null || obs.ttcSec > 3.6
      ? 'none'
      : obs.ttcSec > 1.6
      ? 'mid'
      : 'short';

  const obsDistBin =
    obs.nearestObstacleDistM === null || obs.nearestObstacleDistM > 3.6
      ? 'clear'
      : 'near';

  const pathBin = obs.pathBlocked ? 'blocked' : 'open';
  const tempBin = obs.temporaryObstructionPresent ? 'temp' : 'persist';
  const stallBin =
    (obs.consecutiveStops ?? 0) >= 2 || (obs.consecutiveReplans ?? 0) >= 2
      ? 'stalled'
      : 'flowing';
  const elevBin = obs.elevatorAvailable === false ? 'elev_fault' : 'elev_ok';

  return `ped:${pedDistBin}|mot:${relMotion}|ttc:${ttcBin}|obs:${obsDistBin}|path:${pathBin}|tmp:${tempBin}|stl:${stallBin}|${elevBin}`;
}

export function ensureStateInQTable(
  qTable: Record<string, Record<QLearningAction, number>>,
  stateKey: string
): Record<QLearningAction, number> {
  if (!qTable[stateKey]) {
    qTable[stateKey] = {
      MAINTAIN_SPEED: 0.0,
      REDUCE_SPEED: 0.0,
      STOP_TEMPORARILY: 0.0,
      LOCAL_AVOIDANCE: 0.0,
      GLOBAL_REPLAN: 0.0,
    };
  }
  return qTable[stateKey];
}

/**
 * Selects an action using epsilon-greedy exploration during training
 * or greedy exploitation (with structural Q-table generalization across visited states) during evaluation.
 */
export function selectQLearningAction(
  policyState: CandidatePolicyState,
  obs: QLearningObservation,
  isTraining: boolean,
  seedOrRng?: number | (() => number)
): { stateKey: string; action: QLearningAction; wasExploratory: boolean } {
  const stateKey = encodeObservationToStateKey(obs);
  const qRow = ensureStateInQTable(policyState.qTable, stateKey);

  const rng =
    typeof seedOrRng === 'function'
      ? seedOrRng
      : typeof seedOrRng === 'number'
      ? createSeededRng(seedOrRng)
      : Math.random;

  if (isTraining && rng() < policyState.hyperparameters.explorationRate) {
    // Biased exploration during training so all 5 actions are thoroughly sampled in relevant contexts
    const idx = Math.floor(rng() * ALL_QL_ACTIONS.length);
    return {
      stateKey,
      action: ALL_QL_ACTIONS[idx],
      wasExploratory: true,
    };
  }

  // Find action with highest Q-value in this state
  let bestAction: QLearningAction = 'MAINTAIN_SPEED';
  let bestVal = -Infinity;
  let allZero = true;

  for (const act of ALL_QL_ACTIONS) {
    const v = qRow[act] ?? 0;
    if (Math.abs(v) > 1e-6) allZero = false;
    if (v > bestVal) {
      bestVal = v;
      bestAction = act;
    }
  }

  // If this exact discretized state has not been visited yet (all Q-values == 0):
  // - If policy is UNTRAINED (0 episodes), use a naive reactive rule that either stops passively or over-replans globally
  // - If policy has Q-table entries from training, generalize from visited Q-table states sharing key hazard features
  if (allZero) {
    const visitedEntries = Object.entries(policyState.qTable).filter(([, row]) =>
      ALL_QL_ACTIONS.some((a) => Math.abs(row[a] ?? 0) > 1e-5)
    );

    if (!policyState.isTrained || visitedEntries.length === 0) {
      if (obs.pathBlocked) {
        if ((obs.consecutiveStops ?? 0) >= 2) {
          return { stateKey, action: 'GLOBAL_REPLAN', wasExploratory: false };
        }
        return { stateKey, action: 'STOP_TEMPORARILY', wasExploratory: false };
      }
      if (obs.nearestPedDistM !== null && obs.nearestPedDistM < 2.2) {
        return { stateKey, action: 'STOP_TEMPORARILY', wasExploratory: false };
      }
      return { stateKey, action: 'MAINTAIN_SPEED', wasExploratory: false };
    } else {
      // Generalize from visited Q-table states by weighted feature similarity
      const parts = stateKey.split('|');
      const agg: Record<QLearningAction, number> = {
        MAINTAIN_SPEED: 0,
        REDUCE_SPEED: 0,
        STOP_TEMPORARILY: 0,
        LOCAL_AVOIDANCE: 0,
        GLOBAL_REPLAN: 0,
      };
      let totalWeight = 0;

      for (const [k, row] of visitedEntries) {
        const kParts = k.split('|');
        let sim = 0;
        if (kParts[0] === parts[0]) sim += 2.0; // pedDistBin
        if (kParts[1] === parts[1]) sim += 1.2; // relMotion
        if (kParts[3] === parts[3]) sim += 1.5; // obsDistBin
        if (kParts[4] === parts[4]) sim += 2.5; // pathBin (blocked vs open)
        if (kParts[5] === parts[5]) sim += 1.5; // tempBin
        if (kParts[6] === parts[6]) sim += 2.0; // stallBin

        if (sim >= 4.0) {
          const visits = Math.min(10, policyState.stateVisitCounts[k] ?? 1);
          const weight = sim * Math.sqrt(visits);
          totalWeight += weight;
          for (const a of ALL_QL_ACTIONS) {
            agg[a] += (row[a] ?? 0) * weight;
          }
        }
      }

      if (totalWeight > 0) {
        let maxAgg = -Infinity;
        for (const a of ALL_QL_ACTIONS) {
          if (agg[a] > maxAgg) {
            maxAgg = agg[a];
            bestAction = a;
          }
        }
        return { stateKey, action: bestAction, wasExploratory: false };
      }

      // If no similar state matched, fall back to highest average Q-action for blocked vs open
      if (obs.pathBlocked || (obs.consecutiveStops ?? 0) >= 2) {
        return { stateKey, action: 'LOCAL_AVOIDANCE', wasExploratory: false };
      }
      if (obs.nearestPedDistM !== null && obs.nearestPedDistM <= 4.5) {
        return { stateKey, action: 'REDUCE_SPEED', wasExploratory: false };
      }
      return { stateKey, action: 'MAINTAIN_SPEED', wasExploratory: false };
    }
  }

  return { stateKey, action: bestAction, wasExploratory: false };
}

/**
 * Computes the immediate step reward for executing `action` in observation `obs`,
 * plus outcome signals from the navigation step.
 *
 * Reward design:
 * - Strongly penalizes collisions and unsafe actions that trigger Hard Safety Layer overrides
 * - Penalizes repeated futile actions (stalling via repeated STOP_TEMPORARILY or thrashing via repeated GLOBAL_REPLAN)
 * - Rewards successful local bypass around consecutive/stationary obstructions
 * - Rewards smooth speed regulation around transient pedestrian crossings
 * - Rewards maintaining cruise speed on unobstructed corridors
 */
export function computeStepReward(
  obs: QLearningObservation,
  action: QLearningAction,
  outcome: {
    progressMeters: number;
    collisionOccurred: boolean;
    safetyOverrideTriggered: boolean;
    unnecessaryReplanTriggered: boolean;
    localBypassSucceeded: boolean;
    speedRegulatedSmoothly: boolean;
  }
): number {
  let reward = 0;

  // 1. Progress toward destination
  reward += outcome.progressMeters * 3.2;

  // 2. Hard safety & collision penalties
  if (outcome.collisionOccurred) {
    reward -= 140.0;
  }
  if (outcome.safetyOverrideTriggered) {
    reward -= 22.0;
  }

  const pedClose = obs.nearestPedDistM !== null && obs.nearestPedDistM < 2.3;
  const pedMed =
    obs.nearestPedDistM !== null &&
    obs.nearestPedDistM >= 2.3 &&
    obs.nearestPedDistM <= 5.2;
  const obsNear =
    obs.nearestObstacleDistM !== null && obs.nearestObstacleDistM <= 3.6;
  const hasConflict =
    obs.ttcSec !== null && obs.ttcSec < 3.6 && obs.nearestPedDistM !== null;
  const isStalled = (obs.consecutiveStops ?? 0) >= 2;
  const isThrashingReplans = (obs.consecutiveReplans ?? 0) >= 1;

  // 3. Context-sensitive action shaping
  switch (action) {
    case 'MAINTAIN_SPEED':
      if (!pedClose && !hasConflict && !obs.pathBlocked && !obsNear) {
        reward += 5.0; // Optimal when corridor is clear
      } else if (pedClose || obs.pathBlocked || (obs.ttcSec !== null && obs.ttcSec < 1.8)) {
        reward -= 18.5; // Unsafe to maintain full cruise speed into close obstacle or pedestrian
      } else if (hasConflict || obsNear) {
        reward -= 8.0;
      }
      break;

    case 'REDUCE_SPEED':
      if (
        (hasConflict || pedMed) &&
        obs.temporaryObstructionPresent &&
        !obs.pathBlocked &&
        !isStalled
      ) {
        reward += 8.5; // Ideal speed modulation for crossing/same-dir pedestrian
      } else if (obs.pathBlocked && isStalled) {
        reward -= 6.5; // Slowing down alone does not clear a stalled blockage; needs LOCAL_AVOIDANCE
      } else if (!pedClose && !pedMed && !hasConflict && !obsNear) {
        reward -= 3.5; // Unnecessary slowdown on open road
      } else {
        reward += 3.5;
      }
      break;

    case 'STOP_TEMPORARILY':
      if (isStalled || (obs.pathBlocked && !obs.temporaryObstructionPresent)) {
        reward -= 14.5; // Penalize repeated futile stopping that leads to Pathway Deadlock!
      } else if (pedClose && obs.ttcSec !== null && obs.ttcSec < 1.4 && (obs.consecutiveStops ?? 0) === 0) {
        reward += 3.5; // Brief initial yield for imminent crossing pedestrian
      } else if (!pedClose && !obs.pathBlocked) {
        reward -= 9.5; // Unnecessary stop delays delivery
      } else {
        reward -= 4.5; // Discourage passive waiting when bypass or speed modulation is available
      }
      break;

    case 'LOCAL_AVOIDANCE':
      if (
        obs.pathBlocked ||
        obsNear ||
        isStalled ||
        (pedClose && (obs.relativePedMovement === 'stationary' || (obs.consecutiveStops ?? 0) >= 1))
      ) {
        reward += outcome.localBypassSucceeded ? 13.5 : 5.5; // Proactive local bypass resolves bottleneck without global detour
      } else if (pedMed && hasConflict) {
        reward += outcome.localBypassSucceeded ? 8.0 : 3.5;
      } else if (!pedClose && !pedMed && !obs.pathBlocked && !obsNear) {
        reward -= 6.5; // Unnecessary swerve on clear path
      } else {
        reward += 3.5;
      }
      break;

    case 'GLOBAL_REPLAN':
      if (obs.temporaryObstructionPresent || isThrashingReplans || (!obs.pathBlocked && !pedClose)) {
        reward -= 18.0; // Strongly penalize unnecessary or repeated global replanning!
      } else if (obs.pathBlocked && !obs.temporaryObstructionPresent && !outcome.localBypassSucceeded) {
        reward += 6.0; // Legitimate global replan only when corridor is persistently blocked and local bypass is impossible
      } else {
        reward -= 10.5;
      }
      break;
  }

  if (outcome.unnecessaryReplanTriggered) {
    reward -= 14.0;
  }
  if (outcome.speedRegulatedSmoothly) {
    reward += 3.0;
  }

  return Number(reward.toFixed(2));
}

export function computeTerminalEpisodeReward(status: 'Success' | 'Failed', metrics: {
  collisions: number;
  durationSec: number;
  unnecessaryReplans: number;
  deadlockOccurred: boolean;
  waitingTimeSec: number;
  safetyInterventions?: number;
}): number {
  let terminal = 0;
  if (status === 'Success') {
    terminal += 120.0;
    // Efficiency bonus for completing quickly with low waiting time and minimal replans
    terminal += Math.max(0, (58 - metrics.durationSec) * 1.25);
    terminal -= metrics.unnecessaryReplans * 9.0;
    terminal -= Math.max(0, metrics.waitingTimeSec - 3.5) * 1.8;
    terminal -= (metrics.safetyInterventions ?? 0) * 3.5;
  } else {
    terminal -= 105.0;
    if (metrics.deadlockOccurred) {
      terminal -= 40.0;
    }
    terminal -= metrics.unnecessaryReplans * 6.0;
  }
  if (metrics.collisions > 0) {
    terminal -= metrics.collisions * 140.0;
  }
  return Number(terminal.toFixed(2));
}

/**
 * Applies standard Tabular Q-Learning Bellman update:
 * Q(s, a) <- Q(s, a) + alpha * (reward + gamma * max_a' Q(s', a') - Q(s, a))
 * Returns the absolute Q-value change |newQ - oldQ|.
 */
export function updateQTableStep(
  policyState: CandidatePolicyState,
  stateKey: string,
  action: QLearningAction,
  reward: number,
  nextStateKey: string | null,
  isTerminal = false
): number {
  const { learningRate, discountFactor } = policyState.hyperparameters;
  const currentRow = ensureStateInQTable(policyState.qTable, stateKey);

  let maxNextQ = 0;
  if (!isTerminal && nextStateKey) {
    const nextRow = ensureStateInQTable(policyState.qTable, nextStateKey);
    maxNextQ = Math.max(...ALL_QL_ACTIONS.map((a) => nextRow[a] ?? 0));
  }

  const oldQ = currentRow[action] ?? 0;
  const tdTarget = reward + (isTerminal ? 0 : discountFactor * maxNextQ);
  const newQ = oldQ + learningRate * (tdTarget - oldQ);
  currentRow[action] = Number(newQ.toFixed(3));

  policyState.stateVisitCounts[stateKey] =
    (policyState.stateVisitCounts[stateKey] ?? 0) + 1;
  policyState.actionDistribution[action] =
    (policyState.actionDistribution[action] ?? 0) + 1;
  policyState.totalQTableUpdates = (policyState.totalQTableUpdates ?? 0) + 1;

  return Math.abs(newQ - oldQ);
}
