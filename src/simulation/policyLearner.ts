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
    learningRate: 0.28,
    discountFactor: 0.92,
    explorationRate: 0.35,
    initialExplorationRate: 0.35,
    minExplorationRate: 0.04,
    explorationDecay: 0.9,
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
      'scen-nominal-campus',
      'scen-construction-detour',
      'scen-low-visibility',
    ],
    heldOutScenarioIds: [
      'scen-congestion-peak',
      'scen-multi-stress',
      'scen-elevator-recovery',
    ],
  };
}

/**
 * Discretizes continuous robot observations into an interpretable tabular state key.
 * Captures all 7 required observation features from Section 7:
 * 1. Distance to nearest pedestrian
 * 2. Relative pedestrian movement
 * 3. Time to potential collision (TTC)
 * 4. Distance to nearest obstacle
 * 5. Current robot speed ratio
 * 6. Whether current path is blocked
 * 7. Whether a temporary obstruction is present
 */
export function encodeObservationToStateKey(obs: QLearningObservation): string {
  const pedDistBin =
    obs.nearestPedDistM === null || obs.nearestPedDistM > 5.8
      ? 'far'
      : obs.nearestPedDistM > 2.8
      ? 'med'
      : obs.nearestPedDistM > 1.45
      ? 'close'
      : 'crit';

  const relMotion = obs.relativePedMovement;

  const ttcBin =
    obs.ttcSec === null || obs.ttcSec > 4.2
      ? 'none'
      : obs.ttcSec > 2.0
      ? 'mid'
      : 'short';

  const obsDistBin =
    obs.nearestObstacleDistM === null || obs.nearestObstacleDistM > 3.8
      ? 'clear'
      : 'near';

  const speedBin =
    obs.currentSpeedRatio < 0.15
      ? 'stopped'
      : obs.currentSpeedRatio < 0.78
      ? 'reduced'
      : 'cruise';

  const pathBin = obs.pathBlocked ? 'blocked' : 'open';
  const tempBin = obs.temporaryObstructionPresent ? 'temp' : 'persist';

  return `ped:${pedDistBin}|mot:${relMotion}|ttc:${ttcBin}|obs:${obsDistBin}|spd:${speedBin}|path:${pathBin}|tmp:${tempBin}`;
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
 * or greedy exploitation (with domain-informed tie-breaking) during evaluation.
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
    const idx = Math.floor(rng() * ALL_QL_ACTIONS.length);
    return {
      stateKey,
      action: ALL_QL_ACTIONS[idx],
      wasExploratory: true,
    };
  }

  // Find action with highest Q-value
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
  // - If policy is UNTRAINED, use a naive reactive baseline that tends to over-replan or stop late
  // - If policy is TRAINED, generalize from nearest similar states in the Q-table or safe learned prior
  if (allZero) {
    if (!policyState.isTrained) {
      if (obs.pathBlocked) return { stateKey, action: 'GLOBAL_REPLAN', wasExploratory: false };
      if (obs.nearestPedDistM !== null && obs.nearestPedDistM < 1.8) {
        return { stateKey, action: 'STOP_TEMPORARILY', wasExploratory: false };
      }
      return { stateKey, action: 'MAINTAIN_SPEED', wasExploratory: false };
    } else {
      // Generalize from visited states sharing the same pedDistBin + pathBlocked + tempBin
      const prefix = stateKey.split('|').slice(0, 3).join('|');
      const agg: Record<QLearningAction, number> = {
        MAINTAIN_SPEED: 0,
        REDUCE_SPEED: 0,
        STOP_TEMPORARILY: 0,
        LOCAL_AVOIDANCE: 0,
        GLOBAL_REPLAN: 0,
      };
      let matches = 0;
      for (const [k, row] of Object.entries(policyState.qTable)) {
        if (k.startsWith(prefix)) {
          matches += 1;
          for (const a of ALL_QL_ACTIONS) {
            agg[a] += row[a] ?? 0;
          }
        }
      }
      if (matches > 0) {
        let maxAgg = -Infinity;
        for (const a of ALL_QL_ACTIONS) {
          if (agg[a] > maxAgg) {
            maxAgg = agg[a];
            bestAction = a;
          }
        }
        return { stateKey, action: bestAction, wasExploratory: false };
      }

      // Safe fallback when trained
      if (obs.nearestPedDistM === null || obs.nearestPedDistM > 5.0) {
        return { stateKey, action: 'MAINTAIN_SPEED', wasExploratory: false };
      }
      if (obs.temporaryObstructionPresent && !obs.pathBlocked) {
        return { stateKey, action: 'REDUCE_SPEED', wasExploratory: false };
      }
      if (obs.pathBlocked && obs.temporaryObstructionPresent) {
        return { stateKey, action: 'LOCAL_AVOIDANCE', wasExploratory: false };
      }
      return { stateKey, action: 'REDUCE_SPEED', wasExploratory: false };
    }
  }

  return { stateKey, action: bestAction, wasExploratory: false };
}

/**
 * Computes the immediate step reward for executing `action` in observation `obs`,
 * plus outcome signals from the navigation step.
 *
 * Reward design (Section 7):
 * - Strongly penalizes collisions and unsafe actions
 * - Penalizes deadlocks and failed missions
 * - Rewards successful deliveries and safe forward progress
 * - Penalizes excessive delays and unnecessary global replanning
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
  reward += outcome.progressMeters * 2.8;

  // 2. Hard safety & collision penalties
  if (outcome.collisionOccurred) {
    reward -= 120.0;
  }
  if (outcome.safetyOverrideTriggered) {
    reward -= 18.0;
  }

  const pedClose = obs.nearestPedDistM !== null && obs.nearestPedDistM < 2.2;
  const pedMed =
    obs.nearestPedDistM !== null &&
    obs.nearestPedDistM >= 2.2 &&
    obs.nearestPedDistM <= 5.2;
  const hasConflict =
    obs.ttcSec !== null && obs.ttcSec < 3.8 && obs.nearestPedDistM !== null;

  // 3. Context-sensitive action shaping
  switch (action) {
    case 'MAINTAIN_SPEED':
      if (!pedClose && !hasConflict && !obs.pathBlocked) {
        reward += 4.5; // Optimal when path is clear
      } else if (pedClose || (obs.ttcSec !== null && obs.ttcSec < 1.8)) {
        reward -= 16.0; // Unsafe to maintain full cruise speed into imminent conflict
      } else if (hasConflict) {
        reward -= 6.5;
      }
      break;

    case 'REDUCE_SPEED':
      if (
        (hasConflict || pedMed) &&
        obs.temporaryObstructionPresent &&
        !obs.pathBlocked
      ) {
        reward += 7.5; // Ideal Level 2 speed regulation for crossing/same-dir pedestrian
      } else if (!pedClose && !pedMed && !hasConflict) {
        reward -= 3.0; // Unnecessary slowdown on open road
      } else {
        reward += 2.5;
      }
      break;

    case 'STOP_TEMPORARILY':
      if (pedClose && (obs.ttcSec !== null && obs.ttcSec < 1.5)) {
        reward += 4.0; // Necessary brief yield
      } else if (!pedClose && !obs.pathBlocked) {
        reward -= 8.5; // Unnecessary stop delays delivery
      } else {
        reward -= 2.2; // Prolonged waiting penalty
      }
      break;

    case 'LOCAL_AVOIDANCE':
      if (obs.pathBlocked || (pedClose && obs.relativePedMovement === 'stationary')) {
        reward += outcome.localBypassSucceeded ? 9.5 : 3.5; // Great local bypass without full A* replan
      } else if (!pedClose && !pedMed && !obs.pathBlocked) {
        reward -= 6.0; // Unnecessary swerve on clear path
      } else {
        reward += 3.0;
      }
      break;

    case 'GLOBAL_REPLAN':
      if (obs.temporaryObstructionPresent || (!obs.pathBlocked && !pedClose)) {
        reward -= 15.0; // Strongly penalize unnecessary global replanning for temporary obstructions!
      } else if (obs.pathBlocked && !obs.temporaryObstructionPresent) {
        reward += 6.5; // Legitimate global replan when corridor is persistently blocked
      } else {
        reward -= 8.0;
      }
      break;
  }

  if (outcome.unnecessaryReplanTriggered) {
    reward -= 12.0;
  }
  if (outcome.speedRegulatedSmoothly) {
    reward += 2.5;
  }

  return Number(reward.toFixed(2));
}

export function computeTerminalEpisodeReward(status: 'Success' | 'Failed', metrics: {
  collisions: number;
  durationSec: number;
  unnecessaryReplans: number;
  deadlockOccurred: boolean;
  waitingTimeSec: number;
}): number {
  let terminal = 0;
  if (status === 'Success') {
    terminal += 110.0;
    // Efficiency bonus for completing quickly with low waiting time
    terminal += Math.max(0, (55 - metrics.durationSec) * 1.1);
    terminal -= metrics.unnecessaryReplans * 8.0;
    terminal -= Math.max(0, metrics.waitingTimeSec - 4.0) * 1.5;
  } else {
    terminal -= 90.0;
    if (metrics.deadlockOccurred) {
      terminal -= 35.0;
    }
  }
  if (metrics.collisions > 0) {
    terminal -= metrics.collisions * 120.0;
  }
  return Number(terminal.toFixed(2));
}

/**
 * Applies standard Tabular Q-Learning Bellman update:
 * Q(s, a) <- Q(s, a) + alpha * (reward + gamma * max_a' Q(s', a') - Q(s, a))
 */
export function updateQTableStep(
  policyState: CandidatePolicyState,
  stateKey: string,
  action: QLearningAction,
  reward: number,
  nextStateKey: string | null,
  isTerminal = false
): void {
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
}
