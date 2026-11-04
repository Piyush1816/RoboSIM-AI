import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  Square,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { NAVIGATION_POLICIES } from '../data/campusConfig';
import { executePolicyTrainingLoop } from '../simulation/batchRunner';
import { ALL_QL_ACTIONS, QL_ACTION_LABELS } from '../simulation/policyLearner';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  ExperimentRecord,
  NavigationPolicyConfig,
  NavPageId,
  QLearningAction,
} from '../types/simulation';

interface RobotPoliciesPageProps {
  policies: NavigationPolicyConfig[];
  selectedPolicyId: string;
  onSelectPolicy: (policyId: string) => void;
  onUpdatePolicies: (updated: NavigationPolicyConfig[]) => void;
  onOpenSimLab: () => void;
  onNavigate?: (page: NavPageId) => void;
}

export const RobotPoliciesPage: React.FC<RobotPoliciesPageProps> = ({
  policies,
  selectedPolicyId,
  onSelectPolicy,
  onUpdatePolicies,
  onOpenSimLab,
  onNavigate,
}) => {
  const {
    scenarios,
    robots,
    selectedRobotId,
    activeRobot,
    setSelectedRobotId,
    environments,
    selectedEnvironmentId,
    activeEnvironment,
    setSelectedEnvironmentId,
    candidatePolicyState,
    updateCandidatePolicyState,
    resetCandidatePolicy,
    recordExperimentsBatch,
  } = useExperimentStore();

  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [episodesToTrain, setEpisodesToTrain] = useState<number>(12);
  const [selectedTrainScenarioIds, setSelectedTrainScenarioIds] = useState<string[]>(
    () => {
      const trainScens = scenarios.filter(
        (s) =>
          (s.datasetSplit === 'train' || s.generationSource === 'Failure-Driven') &&
          s.id !== 'scen-fully-blocked'
      );
      return trainScens.length > 0
        ? trainScens.map((s) => s.id)
        : scenarios.filter((s) => s.id !== 'scen-fully-blocked').slice(0, 4).map((s) => s.id);
    }
  );

  const [trainingStatus, setTrainingStatus] = useState<
    'idle' | 'running' | 'paused'
  >('idle');
  const [trainingProgress, setTrainingProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });

  const controlSignalRef = useRef<'run' | 'pause' | 'cancel'>('run');

  const baselinePolicy =
    policies.find((p) => p.id === 'pol-hybrid-safe') ?? NAVIGATION_POLICIES[0];

  const trainSplitScenarios = useMemo(
    () =>
      scenarios.filter(
        (s) =>
          (s.datasetSplit ?? 'train') === 'train' ||
          s.generationSource === 'Failure-Driven'
      ),
    [scenarios]
  );

  const heldOutTestScenarios = useMemo(
    () => scenarios.filter((s) => s.datasetSplit === 'test'),
    [scenarios]
  );

  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const trainingHistory = candidatePolicyState.trainingHistory ?? [];
  const totalTrainedEps = trainingHistory.length;
  const trainSuccesses = trainingHistory.filter((e) => e.status === 'Success').length;
  const trainFailures = trainingHistory.filter((e) => e.status === 'Failed').length;
  const totalSafetyInterventions = trainingHistory.reduce(
    (s, e) => s + (e.safetyInterventionCount ?? 0),
    0
  );
  const avgTrainReward =
    totalTrainedEps > 0
      ? trainingHistory.reduce((s, e) => s + e.totalReward, 0) / totalTrainedEps
      : 0;

  const recentRewardDelta = useMemo(() => {
    if (trainingHistory.length < 4) return null;
    const half = Math.floor(trainingHistory.length / 2);
    const firstHalf = trainingHistory.slice(0, half);
    const secondHalf = trainingHistory.slice(half);
    const avg1 =
      firstHalf.reduce((s, e) => s + e.totalReward, 0) /
      Math.max(1, firstHalf.length);
    const avg2 =
      secondHalf.reduce((s, e) => s + e.totalReward, 0) /
      Math.max(1, secondHalf.length);
    return Number((avg2 - avg1).toFixed(1));
  }, [trainingHistory]);

  const totalActionsTaken = useMemo(() => {
    return ALL_QL_ACTIONS.reduce(
      (sum, act) => sum + (candidatePolicyState.actionDistribution[act] ?? 0),
      0
    );
  }, [candidatePolicyState.actionDistribution]);

  const topVisitedStates = useMemo(() => {
    const entries = Object.entries(candidatePolicyState.qTable);
    return entries
      .map(([stateKey, qRow]) => {
        const visits = candidatePolicyState.stateVisitCounts[stateKey] ?? 1;
        let bestAction: QLearningAction = 'MAINTAIN_SPEED';
        let bestVal = -Infinity;
        for (const a of ALL_QL_ACTIONS) {
          if ((qRow[a] ?? 0) > bestVal) {
            bestVal = qRow[a] ?? 0;
            bestAction = a;
          }
        }
        return { stateKey, qRow, visits, bestAction, bestVal };
      })
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);
  }, [candidatePolicyState.qTable, candidatePolicyState.stateVisitCounts]);

  const handleToggleTrainScenario = (id: string) => {
    setSelectedTrainScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleHyperparamChange = (
    field: keyof typeof candidatePolicyState.hyperparameters,
    value: number
  ) => {
    updateCandidatePolicyState({
      ...candidatePolicyState,
      hyperparameters: {
        ...candidatePolicyState.hyperparameters,
        [field]: value,
      },
    });
  };

  const handleStartTraining = async () => {
    const activeScens = scenarios.filter((s) =>
      selectedTrainScenarioIds.includes(s.id)
    );
    if (activeScens.length === 0) return;

    setTrainingStatus('running');
    controlSignalRef.current = 'run';
    setTrainingProgress({ completed: 0, total: episodesToTrain });

    const bufferedExperiments: ExperimentRecord[] = [];

    const { updatedPolicyState } = await executePolicyTrainingLoop({
      trainingScenarios: activeScens,
      candidatePolicyState,
      episodesCount: episodesToTrain,
      robotId: selectedRobotId,
      environment: activeEnvironment,
      onEpisodeTrained: (_epRec, expRec, latestPol, completed, total) => {
        bufferedExperiments.push(expRec);
        updateCandidatePolicyState(latestPol);
        setTrainingProgress({ completed, total });
      },
      shouldPauseOrCancel: () => controlSignalRef.current,
    });

    updateCandidatePolicyState(updatedPolicyState);
    if (bufferedExperiments.length > 0) {
      recordExperimentsBatch(bufferedExperiments);
    }

    setTrainingStatus('idle');
    onSelectPolicy('pol-candidate-rl');
    setSavedNotice(
      `Training completed on ${activeRobot.name} in ${activeEnvironment.name}: Candidate Policy updated to v${updatedPolicyState.version} across ${bufferedExperiments.length} simulated episodes and activated.`
    );
  };

  const handlePauseResume = () => {
    if (trainingStatus === 'running') {
      controlSignalRef.current = 'pause';
      setTrainingStatus('paused');
    } else if (trainingStatus === 'paused') {
      controlSignalRef.current = 'run';
      setTrainingStatus('running');
    }
  };

  const handleCancelTraining = () => {
    controlSignalRef.current = 'cancel';
    setTrainingStatus('idle');
  };

  const handleResetQPolicy = () => {
    resetCandidatePolicy();
    setConfirmReset(false);
    setSavedNotice(
      'Reset Candidate Tabular Q-Learning Policy to untrained initial state.'
    );
  };

  const handleParamChange = (
    policyId: string,
    field: keyof NavigationPolicyConfig,
    value: number
  ) => {
    const updated = policies.map((p) =>
      p.id === policyId ? { ...p, [field]: value } : p
    );
    onUpdatePolicies(updated);
    setSavedNotice(`Updated ${field} for policy ${policyId}`);
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-cyan-400">
            SOFTWARE DECISION-POLICY TRAINING · HARD SAFETY LAYER ENFORCEMENT
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Robot Policy Learning & Training
          </h2>
          <p className="text-sm text-slate-300 font-medium">
            Training improves the robot&apos;s software decision-making policy in simulation. It does not physically modify or train a robot&apos;s motors or hardware.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {confirmReset ? (
            <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-500/50 rounded-lg px-2.5 py-1.5 text-xs">
              <span className="text-rose-200 font-medium">
                Reset learned Q-table?
              </span>
              <button
                onClick={handleResetQPolicy}
                className="px-2 py-1 rounded bg-rose-500 hover:bg-rose-400 text-slate-950 font-semibold cursor-pointer"
              >
                Confirm Reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Training</span>
            </button>
          )}
          {onNavigate && (
            <button
              onClick={() => onNavigate('policy-benchmarking')}
              className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Compare Policies (Benchmark)</span>
            </button>
          )}
          <button
            onClick={onOpenSimLab}
            className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Test in 3D Simulation Lab</span>
          </button>
        </div>
      </div>

      {/* Clear 5-Step Workflow & Plain-Language Explanation */}
      <div className="bg-[#0d1322] border border-cyan-500/30 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              How Simulation Policy Learning Works
            </h3>
            <p className="text-xs text-slate-400">
              The learning agent uses failure-driven scenarios to refine high-level navigation decisions while the Hard Safety Layer prevents physical collisions.
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400">
            5-Stage Closed-Loop Improvement
          </span>
        </div>

        {/* 5-Stage Visual Pipeline */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs">
          {[
            {
              step: '1',
              title: 'Failed Simulation Experience',
              desc: 'Edge-case runs expose deadlocks, delays, or excessive replanning.',
            },
            {
              step: '2',
              title: 'Learning Agent',
              desc: 'Tabular Q-Learning observes pedestrian distance, TTC, and corridor hazards.',
            },
            {
              step: '3',
              title: 'Updated Candidate Policy',
              desc: 'Updates Q-table values to favor smooth speed regulation or local bypass.',
            },
            {
              step: '4',
              title: 'New Simulation Episodes',
              desc: 'Executes multi-episode training runs to verify higher cumulative reward.',
            },
            {
              step: '5',
              title: 'Policy Evaluation',
              desc: 'Benchmarks Candidate Policy against Baseline Policy on held-out test scenarios.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1"
            >
              <div className="font-mono text-[11px] font-semibold text-cyan-400">
                Step {item.step} · {item.title}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Plain-Language Glossary of Key Concepts */}
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2.5 pt-2 border-t border-slate-800/80 text-[11px]">
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-slate-200 block">Baseline Policy</strong>
            <span className="text-slate-400">
              Frozen reference navigation policy used as a control benchmark.
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-cyan-300 block">Candidate Policy</strong>
            <span className="text-slate-400">
              Trainable software policy updated after each learning episode.
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-sky-300 block">Training Scenarios</strong>
            <span className="text-slate-400">
              Preset and failure-driven scenarios used during Q-learning updates.
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-emerald-300 block">Learning Episodes</strong>
            <span className="text-slate-400">
              Simulated delivery trips where the agent tests decisions and observes outcomes.
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-amber-300 block">Episode Reward</strong>
            <span className="text-slate-400">
              Score rewarding safe goal progress and penalizing stops, replans, or safety overrides.
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800/80">
            <strong className="text-purple-300 block">Learned Q-Table</strong>
            <span className="text-slate-400">
              State-action lookup table mapping sensor observations to best navigation actions.
            </span>
          </div>
        </div>
      </div>

      {savedNotice && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-4 py-2.5 flex items-center justify-between text-xs text-cyan-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{savedNotice}</span>
          </span>
          <button
            onClick={() => setSavedNotice(null)}
            className="text-cyan-300 hover:text-white underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Row 1: A. Baseline Policy (Read-Only) + B. Candidate Policy Configuration + C. Training Dataset */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* A. Baseline Policy (Read-Only Reference) */}
        <div className="xl:col-span-4 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-slate-400">
                SECTION A · READ-ONLY BASELINE REFERENCE
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                {baselinePolicy.name}
              </h3>
            </div>
            <Shield className="w-5 h-5 text-slate-400" />
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            {baselinePolicy.description} Preserved unmodified so Baseline vs. Candidate comparisons
            remain reproducible.
          </p>

          <div className="grid grid-cols-2 gap-2.5 text-xs bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <div>
              <span className="text-slate-500 block text-[11px]">Version</span>
              <span className="font-mono text-slate-200">v{baselinePolicy.version} (Frozen)</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Algorithm</span>
              <span className="font-mono text-cyan-400">{baselinePolicy.algorithm}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Safety Clearance</span>
              <span className="font-mono text-slate-200">
                {baselinePolicy.safetyClearanceM.toFixed(1)} m
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Replan Threshold</span>
              <span className="font-mono text-slate-200">
                {baselinePolicy.replanThresholdSec.toFixed(1)} s
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <strong>Hard Safety Layer Guarantee:</strong> Minimum collision clearance (1.38m),
              swept circle-AABB collision braking, and physical acceleration limits remain strictly
              enforced underneath both Baseline and Candidate policies.
            </span>
          </div>
        </div>

        {/* B. Candidate Policy (Tabular Q-Learning Hyperparameters & State) */}
        <div className="xl:col-span-4 bg-[#0d1322] border border-cyan-500/40 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-cyan-400">
                SECTION B · TRAINABLE CANDIDATE POLICY
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                {candidatePolicyState.name}
              </h3>
            </div>
            <span
              className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                candidatePolicyState.isTrained
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              }`}
            >
              v{candidatePolicyState.version}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs bg-slate-900/70 border border-slate-800 rounded-lg p-3">
            <div>
              <span className="text-slate-500 block text-[11px]">Episodes Trained</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {candidatePolicyState.totalEpisodesTrained}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Q-States Visited</span>
              <span className="font-mono text-cyan-400 font-semibold">
                {Object.keys(candidatePolicyState.qTable).length}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Current ε</span>
              <span className="font-mono text-amber-400 font-semibold">
                {candidatePolicyState.hyperparameters.explorationRate.toFixed(3)}
              </span>
            </div>
          </div>

          {/* Target Environment & Robot Hardware Profile for Policy Training */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 space-y-2.5 text-xs">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">
                  Target Environment:
                </span>
                {candidatePolicyState.trainedEnvironmentName && (
                  <span className="text-[11px] font-mono text-emerald-300">
                    Env: {candidatePolicyState.trainedEnvironmentName}
                  </span>
                )}
              </div>
              <select
                value={selectedEnvironmentId}
                onChange={(e) => setSelectedEnvironmentId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} ({env.templateType} · {env.floors.length}F)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">
                  Target Robot Hardware Profile:
                </span>
                {candidatePolicyState.trainedRobotName && (
                  <span className="text-[11px] font-mono text-cyan-300">
                    Trained on: {candidatePolicyState.trainedRobotName}
                  </span>
                )}
              </div>
              <select
                value={selectedRobotId}
                onChange={(e) => setSelectedRobotId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              >
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.maxSpeedMps} m/s · {r.payloadCapacityKg} kg ·{' '}
                    {r.lidarRangeM ?? 28}m LiDAR)
                  </option>
                ))}
              </select>
            </div>

            {candidatePolicyState.isTrained &&
              candidatePolicyState.trainedRobotId &&
              candidatePolicyState.trainedRobotId !== selectedRobotId && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                  Note: Current Q-table was last trained on{' '}
                  <strong>{candidatePolicyState.trainedRobotName}</strong>. Run a training batch on{' '}
                  <strong>{activeRobot.name}</strong> to adapt Q-values to its speed ({activeRobot.maxSpeedMps} m/s) and footprint (r={(activeRobot.collisionRadiusM ?? 0.68).toFixed(2)}m).
                </div>
              )}
          </div>

          {/* Q-Learning Hyperparameter Controls */}
          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Learning Rate (α)</span>
                <span className="font-mono text-cyan-400">
                  {candidatePolicyState.hyperparameters.learningRate.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.6}
                step={0.01}
                value={candidatePolicyState.hyperparameters.learningRate}
                onChange={(e) =>
                  handleHyperparamChange('learningRate', Number(e.target.value))
                }
                className="w-full accent-cyan-500"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Discount Factor (γ)</span>
                <span className="font-mono text-cyan-400">
                  {candidatePolicyState.hyperparameters.discountFactor.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.7}
                max={0.99}
                step={0.01}
                value={candidatePolicyState.hyperparameters.discountFactor}
                onChange={(e) =>
                  handleHyperparamChange('discountFactor', Number(e.target.value))
                }
                className="w-full accent-cyan-500"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-300">Exploration Rate (ε) & Decay</span>
                <span className="font-mono text-amber-400">
                  ε={candidatePolicyState.hyperparameters.explorationRate.toFixed(2)} · decay=
                  {candidatePolicyState.hyperparameters.explorationDecay.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.04}
                max={0.6}
                step={0.02}
                value={candidatePolicyState.hyperparameters.explorationRate}
                onChange={(e) =>
                  handleHyperparamChange('explorationRate', Number(e.target.value))
                }
                className="w-full accent-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* C. Training Dataset & Curriculum Split */}
        <div className="xl:col-span-4 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-emerald-400">
                SECTION C · TRAINING DATASET & SPLIT
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                Train vs. Held-Out Test Split
              </h3>
            </div>
            <Cpu className="w-5 h-5 text-emerald-400" />
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30">
              <span className="text-sky-300 font-semibold block">
                Training Pool ({trainSplitScenarios.length})
              </span>
              <span className="text-[11px] text-slate-400">
                Preset Train + Failure-Driven Scenarios
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30">
              <span className="text-rose-300 font-semibold block">
                Held-Out Test ({heldOutTestScenarios.length})
              </span>
              <span className="text-[11px] text-slate-400">
                Reserved for Fair Benchmarking
              </span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs max-h-48 overflow-y-auto pr-1">
            <div className="text-[11px] font-medium text-slate-400">
              Select Scenarios for Training Curriculum ({selectedTrainScenarioIds.length} selected):
            </div>
            {scenarios
              .filter((s) => s.id !== 'scen-fully-blocked')
              .map((scen) => {
                const checked = selectedTrainScenarioIds.includes(scen.id);
                const isTest = scen.datasetSplit === 'test';
                return (
                  <label
                    key={scen.id}
                    className={`flex items-center justify-between p-2 rounded border cursor-pointer ${
                      checked
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-slate-100'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleTrainScenario(scen.id)}
                        className="accent-cyan-500"
                      />
                      <span className="truncate">{scen.name}</span>
                    </div>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ml-2 shrink-0 ${
                        scen.generationSource === 'Failure-Driven'
                          ? 'bg-amber-500/20 text-amber-300'
                          : isTest
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-sky-500/20 text-sky-300'
                      }`}
                    >
                      {scen.generationSource === 'Failure-Driven'
                        ? 'FAILURE-DRIVEN'
                        : (scen.datasetSplit ?? 'train').toUpperCase()}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      </div>

      {/* Row 2: D. Training Controls & Convergence Curve + E. Training Results & Action Distribution */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* D. Training Controls & Live Reward Convergence Curve */}
        <div className="xl:col-span-7 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-cyan-400">
                SECTION D · INTERACTIVE RL TRAINING CONTROLS
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                Episode Training Execution & Reward Convergence
              </h3>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-400">Episodes:</label>
              <select
                value={episodesToTrain}
                disabled={trainingStatus !== 'idle'}
                onChange={(e) => setEpisodesToTrain(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
              >
                <option value={6}>6 Episodes (Quick)</option>
                <option value={12}>12 Episodes (Standard)</option>
                <option value={20}>20 Episodes (Deep)</option>
                <option value={30}>30 Episodes (Extended)</option>
              </select>

              {trainingStatus === 'idle' ? (
                <button
                  onClick={handleStartTraining}
                  disabled={selectedTrainScenarioIds.length === 0}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>Start Policy Training</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={handlePauseResume}
                    className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>{trainingStatus === 'paused' ? 'Resume' : 'Pause'}</span>
                  </button>
                  <button
                    onClick={handleCancelTraining}
                    className="px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Cancel</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Progress Bar when running */}
          {trainingStatus !== 'idle' && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-cyan-300">
                <span>
                  {trainingStatus === 'paused'
                    ? 'Training Paused'
                    : 'Running Tabular Q-Learning Episodes...'}
                </span>
                <span>
                  {trainingProgress.completed} / {trainingProgress.total} Episodes
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-150"
                  style={{
                    width: `${
                      trainingProgress.total > 0
                        ? (trainingProgress.completed / trainingProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Reward & Success Trend Chart */}
          {trainingHistory.length === 0 ? (
            <div className="p-8 rounded-lg bg-slate-900/50 border border-slate-800 text-center space-y-2">
              <Activity className="w-6 h-6 text-cyan-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-200">
                Candidate Policy Not Trained Yet
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Click <strong>Start Policy Training</strong> above to run headless episodes across
                the selected training scenarios, update the Q-table, and plot the live episode
                reward curve.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  Episode Reward Progression ({trainingHistory.length} Episodes)
                </span>
                {recentRewardDelta !== null && (
                  <span
                    className={`font-mono ${
                      recentRewardDelta >= 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    2nd-Half vs 1st-Half Mean Reward:{' '}
                    {recentRewardDelta >= 0 ? `+${recentRewardDelta}` : recentRewardDelta}
                  </span>
                )}
              </div>

              <div className="h-44 w-full bg-[#080d1a] border border-slate-800 rounded-lg p-3 flex items-end gap-1.5 overflow-x-auto">
                {trainingHistory.slice(-28).map((ep) => {
                  const normalized = Math.min(
                    100,
                    Math.max(12, ((ep.totalReward + 120) / 280) * 100)
                  );
                  return (
                    <div
                      key={ep.id}
                      className="flex-1 min-w-[16px] h-full flex flex-col justify-end items-center gap-1 group"
                      title={`Ep #${ep.episodeNumber} (${ep.scenarioName}): Reward ${ep.totalReward.toFixed(
                        1
                      )}, ${ep.status}, ε=${ep.epsilonUsed}`}
                    >
                      <div className="text-[9px] font-mono text-slate-400 opacity-0 group-hover:opacity-100">
                        {ep.totalReward.toFixed(0)}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${
                          ep.status === 'Success'
                            ? 'bg-cyan-500/80 group-hover:bg-cyan-400'
                            : 'bg-rose-500/80 group-hover:bg-rose-400'
                        }`}
                        style={{ height: `${normalized}%` }}
                      />
                      <span className="text-[9px] font-mono text-slate-500">
                        {ep.episodeNumber}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Visited Q-Table State-Action Inspector */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Learned Tabular Q-Table Inspector (Top Visited Discretized States)
              </span>
              <span className="font-mono text-slate-400">
                {Object.keys(candidatePolicyState.qTable).length} States in Q-Table
              </span>
            </div>

            {topVisitedStates.length === 0 ? (
              <div className="p-3 rounded bg-slate-900/40 border border-slate-800 text-xs text-slate-500">
                Q-Table is currently empty (0 states visited). Start training to populate state-action values.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-900/70 border-b border-slate-800 text-slate-400">
                      <th className="py-2 px-2.5">Discretized Observation State Key</th>
                      <th className="py-2 px-2 text-right">Visits</th>
                      <th className="py-2 px-2 text-right">Maintain</th>
                      <th className="py-2 px-2 text-right">Reduce Spd</th>
                      <th className="py-2 px-2 text-right">Temp Stop</th>
                      <th className="py-2 px-2 text-right">Local Bypass</th>
                      <th className="py-2 px-2 text-right">Global Replan</th>
                      <th className="py-2 px-2.5">Learned Policy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {topVisitedStates.map((row) => (
                      <tr key={row.stateKey} className="hover:bg-slate-800/30">
                        <td className="py-1.5 px-2.5 text-slate-300 truncate max-w-[210px]" title={row.stateKey}>
                          {row.stateKey}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-400">{row.visits}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">
                          {(row.qRow.MAINTAIN_SPEED ?? 0).toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-cyan-300">
                          {(row.qRow.REDUCE_SPEED ?? 0).toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-amber-300">
                          {(row.qRow.STOP_TEMPORARILY ?? 0).toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-emerald-300">
                          {(row.qRow.LOCAL_AVOIDANCE ?? 0).toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-rose-300">
                          {(row.qRow.GLOBAL_REPLAN ?? 0).toFixed(1)}
                        </td>
                        <td className="py-1.5 px-2.5 text-emerald-400 font-semibold">
                          {row.bestAction}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* E. Training Results & Learned Action Distribution */}
        <div className="xl:col-span-5 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-emerald-400">
                SECTION E · TRAINING TELEMETRY & ACTION DISTRIBUTION
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                Candidate Policy Summary (v{candidatePolicyState.version})
              </h3>
            </div>
            <Bot className="w-5 h-5 text-cyan-400" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Episodes Completed</span>
              <span className="font-display font-bold text-lg text-slate-100 tabular-nums">
                {totalTrainedEps}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Success / Fail</span>
              <span className="font-display font-bold text-lg text-emerald-400 tabular-nums">
                {trainSuccesses} / <span className="text-rose-400">{trainFailures}</span>
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Mean Ep. Reward</span>
              <span className="font-display font-bold text-lg text-cyan-400 tabular-nums">
                {avgTrainReward.toFixed(1)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Safety Interventions</span>
              <span className="font-display font-bold text-lg text-amber-400 tabular-nums">
                {totalSafetyInterventions}
              </span>
            </div>
          </div>

          {/* Learned Action Distribution */}
          <div className="space-y-2.5 pt-1 text-xs">
            <div className="flex justify-between font-medium text-slate-300">
              <span>Learned Action Selection Distribution</span>
              <span className="font-mono text-slate-400">{totalActionsTaken} Decisions</span>
            </div>

            {ALL_QL_ACTIONS.map((act) => {
              const count = candidatePolicyState.actionDistribution[act] ?? 0;
              const pct =
                totalActionsTaken > 0 ? (count / totalActionsTaken) * 100 : 0;
              return (
                <div key={act} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">{QL_ACTION_LABELS[act]}</span>
                    <span className="font-mono text-cyan-300 tabular-nums">
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                onSelectPolicy('pol-candidate-rl');
                setSavedNotice(
                  `Saved & activated Candidate Q-Learning Policy (${candidatePolicyState.version}) in localStorage.`
                );
              }}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>
                Save & Activate Candidate Policy (v{candidatePolicyState.version})
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: All Fleet Navigation Policies Tuning Grid */}
      <div className="space-y-3 pt-2">
        <h3 className="font-display font-semibold text-base text-slate-100">
          Active Navigation Policy Selector & Parameter Calibration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {policies.map((pol) => {
            const isActive = pol.id === selectedPolicyId;
            return (
              <div
                key={pol.id}
                className={`bg-[#0d1322] border rounded-xl p-4 flex flex-col justify-between gap-4 ${
                  isActive ? 'border-cyan-500/70' : 'border-slate-800'
                }`}
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-mono text-cyan-400">
                      {pol.algorithm} · v{pol.version}
                    </div>
                    <h4 className="font-display font-semibold text-base text-slate-100 mt-0.5">
                      {pol.name}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {pol.description}
                  </p>

                  {!pol.isReadOnlyBaseline && (
                    <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                      <div>
                        <div className="flex justify-between mb-0.5">
                          <span className="text-slate-400">Safety Clearance</span>
                          <span className="font-mono text-cyan-400">
                            {pol.safetyClearanceM.toFixed(2)}m
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.6}
                          max={2.6}
                          step={0.05}
                          value={pol.safetyClearanceM}
                          onChange={(e) =>
                            handleParamChange(
                              pol.id,
                              'safetyClearanceM',
                              Number(e.target.value)
                            )
                          }
                          className="w-full accent-cyan-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onSelectPolicy(pol.id)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {isActive ? 'Active Policy in Lab' : 'Select Policy'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
