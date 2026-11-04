import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  GitCompare,
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
import {
  executePolicyTrainingLoop,
  runBeforeAfterDemonstration,
} from '../simulation/batchRunner';
import {
  ALL_QL_ACTIONS,
  createInitialCandidatePolicyState,
  QL_ACTION_LABELS,
} from '../simulation/policyLearner';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  BeforeAfterDemonstrationResult,
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
    saveAndActivateCandidatePolicy,
    resetCandidatePolicy,
    recordExperimentsBatch,
  } = useExperimentStore();

  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [episodesToTrain, setEpisodesToTrain] = useState<number>(18);
  const [selectedTrainScenarioIds, setSelectedTrainScenarioIds] = useState<string[]>(
    () => {
      const curriculumScens = scenarios.filter(
        (s) =>
          (s.id.startsWith('scen-train-') ||
            s.generationSource === 'Failure-Driven') &&
          s.id !== 'scen-fully-blocked'
      );
      if (curriculumScens.length > 0) {
        return curriculumScens.map((s) => s.id);
      }
      const trainScens = scenarios.filter(
        (s) =>
          (s.datasetSplit === 'train' || s.generationSource === 'Failure-Driven') &&
          s.id !== 'scen-fully-blocked'
      );
      return trainScens.length > 0
        ? trainScens.map((s) => s.id)
        : scenarios
            .filter((s) => s.id !== 'scen-fully-blocked')
            .slice(0, 6)
            .map((s) => s.id);
    }
  );

  const [trainingStatus, setTrainingStatus] = useState<
    'idle' | 'running' | 'paused' | 'completed'
  >('idle');
  const [trainingProgress, setTrainingProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });
  const [chartMetricMode, setChartMetricMode] = useState<
    'reward' | 'replans-wait' | 'q-updates'
  >('reward');

  // Before vs After Demonstration state
  const [demoScenarioId, setDemoScenarioId] = useState<string>(() => {
    const preferred = scenarios.find(
      (s) =>
        s.id === 'scen-train-consecutive-obstacles' ||
        s.id === 'scen-train-replan-trap' ||
        s.id === 'scen-multi-stress'
    );
    return preferred?.id ?? scenarios[0]?.id ?? 'scen-train-consecutive-obstacles';
  });
  const [demoBeforeMode, setDemoBeforeMode] = useState<
    'baseline-hybrid' | 'baseline-reactive' | 'untrained-rl'
  >('baseline-hybrid');
  const [isRunningDemo, setIsRunningDemo] = useState<boolean>(false);
  const [demoResult, setDemoResult] =
    useState<BeforeAfterDemonstrationResult | null>(null);
  const [demoPlaybackTimeSec, setDemoPlaybackTimeSec] = useState<number>(0);
  const [isDemoPlaying, setIsDemoPlaying] = useState<boolean>(false);

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
  const latestEpisode =
    trainingHistory.length > 0
      ? trainingHistory[trainingHistory.length - 1]
      : null;
  const trainSuccesses = trainingHistory.filter(
    (e) => e.status === 'Success'
  ).length;
  const trainFailures = trainingHistory.filter(
    (e) => e.status === 'Failed'
  ).length;
  const totalSafetyInterventions = trainingHistory.reduce(
    (s, e) => s + (e.safetyInterventionCount ?? 0),
    0
  );
  const totalQTableUpdates = useMemo(() => {
    if (
      typeof candidatePolicyState.totalQTableUpdates === 'number' &&
      candidatePolicyState.totalQTableUpdates > 0
    ) {
      return candidatePolicyState.totalQTableUpdates;
    }
    return trainingHistory.reduce(
      (s, e) => s + (e.qTableUpdatesCount ?? e.stepsCount ?? 0),
      0
    );
  }, [candidatePolicyState.totalQTableUpdates, trainingHistory]);

  const avgTrainReward =
    totalTrainedEps > 0
      ? trainingHistory.reduce((s, e) => s + e.totalReward, 0) / totalTrainedEps
      : 0;
  const avgTrainReplans =
    totalTrainedEps > 0
      ? trainingHistory.reduce((s, e) => s + (e.globalReplanCount ?? 0), 0) /
        totalTrainedEps
      : 0;
  const avgTrainWaitSec =
    totalTrainedEps > 0
      ? trainingHistory.reduce((s, e) => s + (e.waitingTimeSec ?? 0), 0) /
        totalTrainedEps
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

  const recentReplanDelta = useMemo(() => {
    if (trainingHistory.length < 4) return null;
    const half = Math.floor(trainingHistory.length / 2);
    const firstHalf = trainingHistory.slice(0, half);
    const secondHalf = trainingHistory.slice(half);
    const avg1 =
      firstHalf.reduce((s, e) => s + (e.globalReplanCount ?? 0), 0) /
      Math.max(1, firstHalf.length);
    const avg2 =
      secondHalf.reduce((s, e) => s + (e.globalReplanCount ?? 0), 0) /
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

  const handleSelectCurriculumPreset = () => {
    const currIds = scenarios
      .filter((s) => s.id.startsWith('scen-train-') && s.id !== 'scen-fully-blocked')
      .map((s) => s.id);
    if (currIds.length > 0) {
      setSelectedTrainScenarioIds(currIds);
    }
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

    const wasCancelled = (controlSignalRef.current as string) === 'cancel';
    setTrainingStatus(wasCancelled ? 'idle' : 'completed');
    setErrorNotice(null);
    const activationRes = saveAndActivateCandidatePolicy(updatedPolicyState);
    if (activationRes.success) {
      onSelectPolicy('pol-candidate-rl');
      setSavedNotice(
        `Training completed on ${activeRobot.name} in ${activeEnvironment.name}: Updated ${
          updatedPolicyState.totalQTableUpdates ?? 0
        } Q-values (${
          Object.keys(updatedPolicyState.qTable).length
        } discretized states across ${
          updatedPolicyState.totalEpisodesTrained
        } total episodes) and activated Candidate Policy v${
          updatedPolicyState.version
        }.`
      );
    } else {
      setSavedNotice(
        `Training completed (${bufferedExperiments.length} episodes). Click "Save & Activate Candidate Policy" when ready.`
      );
    }
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
    setTrainingStatus('idle');
    setTrainingProgress({ completed: 0, total: 0 });
    setSavedNotice(
      'Reset Candidate Tabular Q-Learning Policy to untrained initial state (0 episodes, empty Q-table).'
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

  // Run Before vs After Demonstration on selected challenging scenario
  const handleRunBeforeAfterDemo = async () => {
    const targetScen =
      scenarios.find((s) => s.id === demoScenarioId) ?? scenarios[0];
    if (!targetScen) return;

    setIsRunningDemo(true);
    setIsDemoPlaying(false);
    await new Promise((r) => setTimeout(r, 25));

    const chosenBasePolicy =
      demoBeforeMode === 'baseline-reactive'
        ? policies.find((p) => p.id === 'pol-baseline-reactive') ??
          NAVIGATION_POLICIES[1] ??
          baselinePolicy
        : demoBeforeMode === 'untrained-rl'
        ? {
            id: 'pol-candidate-rl',
            name: 'Untrained Q-Learning Policy (0 Episodes)',
            version: '1.0.0-untrained',
            algorithm: 'Tabular Q-Learning + Safety Layer' as const,
            description: 'Untrained initial Q-table prior to curriculum learning',
            safetyClearanceM: 1.75,
            cruiseSpeedFactor: 0.88,
            replanThresholdSec: 1.5,
            constructionAvoidanceWeight: 2.8,
            batteryReserveThresholdPct: 20,
            isCandidatePolicy: true,
          }
        : baselinePolicy;

    const { demonstration, baselineExperiment, candidateExperiment } =
      runBeforeAfterDemonstration({
        scenario: targetScen,
        baselinePolicy: chosenBasePolicy,
        candidatePolicyState:
          demoBeforeMode === 'untrained-rl'
            ? {
                ...candidatePolicyState,
                isTrained: true,
              }
            : candidatePolicyState,
        robotId: selectedRobotId,
        environment: activeEnvironment,
      });

    // If demoBeforeMode === 'untrained-rl', run the "Before" side explicitly with an empty untrained Q-table
    if (demoBeforeMode === 'untrained-rl') {
      const untrainedComparison = runBeforeAfterDemonstration({
        scenario: targetScen,
        baselinePolicy: baselinePolicy,
        candidatePolicyState: createInitialCandidatePolicyState(),
        robotId: selectedRobotId,
        environment: activeEnvironment,
      });
      demonstration.baselineRun = {
        ...untrainedComparison.demonstration.trainedCandidateRun,
        policyLabel: 'Untrained Candidate Q-Policy (0 Episodes)',
        policyVersion: '1.0.0-untrained',
      };
    }

    setDemoResult(demonstration);
    recordExperimentsBatch([baselineExperiment, candidateExperiment]);
    const maxTime = Math.max(
      demonstration.baselineRun.durationSec,
      demonstration.trainedCandidateRun.durationSec,
      1
    );
    setDemoPlaybackTimeSec(maxTime);
    setIsRunningDemo(false);
  };

  const maxDemoDurationSec = useMemo(() => {
    if (!demoResult) return 30;
    return Math.max(
      demoResult.baselineRun.durationSec,
      demoResult.trainedCandidateRun.durationSec,
      1
    );
  }, [demoResult]);

  useEffect(() => {
    if (!isDemoPlaying || !demoResult) return;
    const interval = setInterval(() => {
      setDemoPlaybackTimeSec((prev) => {
        if (prev >= maxDemoDurationSec) {
          setIsDemoPlaying(false);
          return maxDemoDurationSec;
        }
        return Number(Math.min(maxDemoDurationSec, prev + 0.5).toFixed(1));
      });
    }, 60);
    return () => clearInterval(interval);
  }, [isDemoPlaying, demoResult, maxDemoDurationSec]);

  const activeDemoScenario = useMemo(
    () => scenarios.find((s) => s.id === demoScenarioId) ?? scenarios[0],
    [scenarios, demoScenarioId]
  );

  // Sample trajectory points up to demoPlaybackTimeSec
  const getSampleAtTime = (
    samples: BeforeAfterDemonstrationResult['baselineRun']['trajectory'],
    tSec: number
  ) => {
    if (!samples || samples.length === 0) return null;
    let chosen = samples[0];
    for (const s of samples) {
      if ((s.timeSec ?? s.t) <= tSec) {
        chosen = s;
      } else {
        break;
      }
    }
    return chosen;
  };

  const worldToSvg = (x: number, z: number) => {
    // Map world [-40..40] to SVG [20..380]
    const svgX = ((x + 40) / 80) * 360 + 20;
    const svgY = ((z + 40) / 80) * 240 + 15;
    return { x: Number(svgX.toFixed(1)), y: Number(svgY.toFixed(1)) };
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-cyan-400">
            FAILURE-DRIVEN CURRICULUM · TABULAR Q-LEARNING · HARD SAFETY LAYER
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Robot Policy Learning, Telemetry & Before/After Verification
          </h2>
          <p className="text-sm text-slate-300 font-medium">
            Train the candidate navigation policy across challenging corridor bottlenecks, dynamic pedestrian surges, replanning traps, and elevator reroutes—then verify measurable improvements on identical seeds.
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
              <span>Compare Policies (Held-Out Benchmark)</span>
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
              Closed-Loop Policy Improvement Cycle
            </h3>
            <p className="text-xs text-slate-400">
              Challenging Scenario → Baseline Struggle or Failure → Failure Diagnosis → Q-Learning Training → Policy Update → Verified Improvement
            </p>
          </div>
          <span className="font-mono text-xs text-cyan-400">
            Genuine Bellman Q-Table Updates · Frozen Evaluation
          </span>
        </div>

        {/* 5-Stage Visual Pipeline */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs">
          {[
            {
              step: '1',
              title: 'Challenging Curriculum',
              desc: 'Consecutive obstacles, crowd surges, temporary blocks, and replan traps expose baseline weaknesses.',
            },
            {
              step: '2',
              title: 'State-Action Encoding',
              desc: 'Observes pedestrian clearance, relative motion, TTC, corridor blockage, and stall/thrash state.',
            },
            {
              step: '3',
              title: 'Bellman Q-Updates',
              desc: 'Rewards forward goal progress and smooth local bypasses; penalizes stalls, replans, and safety stops.',
            },
            {
              step: '4',
              title: 'Before vs After Demo',
              desc: 'Replays Baseline vs. Frozen Trained Policy on the exact same scenario, seed, robot, and route.',
            },
            {
              step: '5',
              title: 'Held-Out Benchmark',
              desc: 'Evaluates generalization on unseen test scenarios excluded from the training curriculum.',
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
      </div>

      {errorNotice && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-lg px-4 py-2.5 flex items-center justify-between text-xs text-rose-200">
          <span className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorNotice}</span>
          </span>
          <button
            onClick={() => setErrorNotice(null)}
            className="text-rose-300 hover:text-white underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

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

      {/* Row 1: A. Baseline Policy (Read-Only) + B. Candidate Policy Configuration + C. Training Curriculum */}
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
            remain reproducible and unmanipulated.
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
              enforced underneath both Baseline and Candidate policies. Safe stops that fail to
              reach the destination are recorded as <em>Pathway Deadlock (Failed)</em>, never as
              successful deliveries.
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

          <div className="grid grid-cols-4 gap-2 text-xs bg-slate-900/70 border border-slate-800 rounded-lg p-3">
            <div>
              <span className="text-slate-500 block text-[10px]">Episodes</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {candidatePolicyState.totalEpisodesTrained}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Q-States</span>
              <span className="font-mono text-cyan-400 font-semibold">
                {Object.keys(candidatePolicyState.qTable).length}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Q-Updates</span>
              <span className="font-mono text-purple-300 font-semibold">
                {totalQTableUpdates}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Current ε</span>
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

        {/* C. Challenging Training Curriculum & Dataset Split */}
        <div className="xl:col-span-4 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-[11px] font-mono text-emerald-400">
                SECTION C · CHALLENGING TRAINING CURRICULUM
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                6-Hazard Curriculum & Held-Out Split
              </h3>
            </div>
            <button
              onClick={handleSelectCurriculumPreset}
              className="px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-[11px] font-mono cursor-pointer"
            >
              Select 6-Stage Curriculum
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30">
              <span className="text-sky-300 font-semibold block">
                Training Pool ({trainSplitScenarios.length})
              </span>
              <span className="text-[11px] text-slate-400">
                6 Curriculum + Failure-Driven Scenarios
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30">
              <span className="text-rose-300 font-semibold block">
                Held-Out Test ({heldOutTestScenarios.length})
              </span>
              <span className="text-[11px] text-slate-400">
                Strictly Excluded from Training
              </span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs max-h-56 overflow-y-auto pr-1">
            <div className="text-[11px] font-medium text-slate-400">
              Select Scenarios for Training Curriculum ({selectedTrainScenarioIds.length} selected):
            </div>
            {scenarios
              .filter((s) => s.id !== 'scen-fully-blocked' && s.datasetSplit !== 'test')
              .map((scen) => {
                const checked = selectedTrainScenarioIds.includes(scen.id);
                const isCurriculum = scen.id.startsWith('scen-train-');
                return (
                  <label
                    key={scen.id}
                    className={`flex items-start justify-between p-2 rounded border cursor-pointer gap-2 ${
                      checked
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-slate-100'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleTrainScenario(scen.id)}
                        className="accent-cyan-500 mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{scen.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {scen.difficulty} · {scen.dynamicObstacleCount} Peds ·{' '}
                          {(scen.customObstacles?.length ?? 0) > 0
                            ? `${scen.customObstacles?.length} Corridor Obstacles`
                            : `${scen.activeConstructionZones.length} Zones`}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        scen.generationSource === 'Failure-Driven'
                          ? 'bg-amber-500/20 text-amber-300'
                          : isCurriculum
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-sky-500/20 text-sky-300'
                      }`}
                    >
                      {scen.generationSource === 'Failure-Driven'
                        ? 'FAILURE-DRIVEN'
                        : isCurriculum
                        ? 'CURRICULUM'
                        : 'TRAIN'}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      </div>

      {/* Row 2: D. Training Controls, Live Visibility Telemetry & Convergence Chart + E. Action Distribution & Q-Table */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* D. Training Controls & Live Visibility Telemetry */}
        <div className="xl:col-span-7 bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-cyan-400">
                  SECTION D · LIVE POLICY TRAINING TELEMETRY
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold uppercase ${
                    trainingStatus === 'running'
                      ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 animate-pulse'
                      : trainingStatus === 'paused'
                      ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300'
                      : trainingStatus === 'completed' || candidatePolicyState.isTrained
                      ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                      : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}
                >
                  {trainingStatus === 'running'
                    ? `TRAINING RUNNING (${trainingProgress.completed}/${trainingProgress.total})`
                    : trainingStatus === 'paused'
                    ? `TRAINING PAUSED (${trainingProgress.completed}/${trainingProgress.total})`
                    : trainingStatus === 'completed' || candidatePolicyState.isTrained
                    ? `TRAINING COMPLETED (${totalTrainedEps} EPISODES)`
                    : 'STATUS: IDLE (UNTRAINED)'}
                </span>
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100 mt-0.5">
                Episode Execution, Q-Table Updates & Learning Curve
              </h3>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-400">Episodes:</label>
              <select
                value={episodesToTrain}
                disabled={trainingStatus === 'running' || trainingStatus === 'paused'}
                onChange={(e) => setEpisodesToTrain(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
              >
                <option value={6}>6 Episodes (Quick)</option>
                <option value={12}>12 Episodes (1× Curriculum)</option>
                <option value={18}>18 Episodes (Recommended 3× Pass)</option>
                <option value={24}>24 Episodes (Deep Convergence)</option>
              </select>

              {trainingStatus !== 'running' && trainingStatus !== 'paused' ? (
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
                    <span>Stop</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Progress Bar when running or paused */}
          {(trainingStatus === 'running' || trainingStatus === 'paused') && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-cyan-300">
                <span>
                  {trainingStatus === 'paused'
                    ? 'Training Paused — Q-Table State Preserved'
                    : 'Executing Headless Simulation Episodes & Bellman Q-Updates...'}
                </span>
                <span>
                  Episode {trainingProgress.completed} / {trainingProgress.total}
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

          {/* 7 Required Live Training Visibility Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                1. Episode / Total
              </span>
              <span className="font-mono font-bold text-sm text-slate-100">
                {trainingStatus === 'running' || trainingStatus === 'paused'
                  ? `${trainingProgress.completed} / ${trainingProgress.total}`
                  : `${totalTrainedEps} / ${totalTrainedEps || episodesToTrain}`}
              </span>
              <span className="text-[10px] text-cyan-400 block font-mono">
                {trainingStatus.toUpperCase()}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                2. Episode Reward
              </span>
              <span
                className={`font-mono font-bold text-sm ${
                  (latestEpisode?.totalReward ?? 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {latestEpisode ? latestEpisode.totalReward.toFixed(1) : '0.0'}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                Mean: {avgTrainReward.toFixed(1)}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                3. Delivery Status
              </span>
              <span
                className={`font-mono font-bold text-sm ${
                  !latestEpisode
                    ? 'text-slate-400'
                    : latestEpisode.status === 'Success'
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {latestEpisode ? latestEpisode.status : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                {trainSuccesses} OK / {trainFailures} Fail
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                4. Nav Replans
              </span>
              <span className="font-mono font-bold text-sm text-cyan-300">
                {latestEpisode ? latestEpisode.globalReplanCount : 0}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                Avg: {avgTrainReplans.toFixed(1)}/ep
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                5. Waiting Time
              </span>
              <span className="font-mono font-bold text-sm text-amber-300">
                {latestEpisode ? `${latestEpisode.waitingTimeSec.toFixed(1)}s` : '0.0s'}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                Avg: {avgTrainWaitSec.toFixed(1)}s
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                6. Safety Stops
              </span>
              <span className="font-mono font-bold text-sm text-amber-400">
                {latestEpisode ? latestEpisode.safetyInterventionCount ?? 0 : 0}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                Total: {totalSafetyInterventions}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">
                7. Q-Table Updates
              </span>
              <span className="font-mono font-bold text-sm text-purple-300">
                {totalQTableUpdates}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                Ep: +{latestEpisode?.qTableUpdatesCount ?? latestEpisode?.stepsCount ?? 0}
              </span>
            </div>
          </div>

          {/* Learning Progress Chart with Metric Switcher */}
          {trainingHistory.length === 0 ? (
            <div className="p-8 rounded-lg bg-slate-900/50 border border-slate-800 text-center space-y-2">
              <Activity className="w-6 h-6 text-cyan-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-200">
                Candidate Policy Not Trained Yet (0 Q-Table Updates)
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Click <strong>Start Policy Training</strong> above to run episodes across the
                6-stage challenging curriculum, update Q-values via the Bellman equation, and plot
                live reward, replanning, and waiting-time learning curves.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setChartMetricMode('reward')}
                    className={`px-2.5 py-1 rounded font-mono text-[11px] cursor-pointer ${
                      chartMetricMode === 'reward'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    Reward Curve
                  </button>
                  <button
                    onClick={() => setChartMetricMode('replans-wait')}
                    className={`px-2.5 py-1 rounded font-mono text-[11px] cursor-pointer ${
                      chartMetricMode === 'replans-wait'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    Replans & Waiting Time
                  </button>
                  <button
                    onClick={() => setChartMetricMode('q-updates')}
                    className={`px-2.5 py-1 rounded font-mono text-[11px] cursor-pointer ${
                      chartMetricMode === 'q-updates'
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    Q-Updates & Safety Interventions
                  </button>
                </div>

                <div className="flex items-center gap-3 font-mono text-[11px]">
                  {recentRewardDelta !== null && (
                    <span
                      className={
                        recentRewardDelta >= 0 ? 'text-emerald-400' : 'text-amber-400'
                      }
                    >
                      Reward Δ (2nd vs 1st Half):{' '}
                      {recentRewardDelta >= 0 ? `+${recentRewardDelta}` : recentRewardDelta}
                    </span>
                  )}
                  {recentReplanDelta !== null && (
                    <span
                      className={
                        recentReplanDelta <= 0 ? 'text-cyan-300' : 'text-amber-300'
                      }
                    >
                      Replans Δ: {recentReplanDelta > 0 ? `+${recentReplanDelta}` : recentReplanDelta}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-44 w-full bg-[#080d1a] border border-slate-800 rounded-lg p-3 flex items-end gap-1.5 overflow-x-auto">
                {trainingHistory.slice(-28).map((ep) => {
                  let barHeightPct = 20;
                  let barColor =
                    ep.status === 'Success'
                      ? 'bg-cyan-500/80 group-hover:bg-cyan-400'
                      : 'bg-rose-500/80 group-hover:bg-rose-400';
                  let topLabel = ep.totalReward.toFixed(0);

                  if (chartMetricMode === 'reward') {
                    barHeightPct = Math.min(
                      100,
                      Math.max(12, ((ep.totalReward + 600) / 1800) * 100)
                    );
                    topLabel = ep.totalReward.toFixed(0);
                  } else if (chartMetricMode === 'replans-wait') {
                    barHeightPct = Math.min(
                      100,
                      Math.max(
                        10,
                        ((ep.globalReplanCount * 3 + ep.waitingTimeSec) / 45) * 100
                      )
                    );
                    barColor =
                      ep.globalReplanCount <= 3
                        ? 'bg-emerald-500/80 group-hover:bg-emerald-400'
                        : 'bg-amber-500/80 group-hover:bg-amber-400';
                    topLabel = `${ep.globalReplanCount}R/${ep.waitingTimeSec.toFixed(0)}s`;
                  } else {
                    const qUpd = ep.qTableUpdatesCount ?? ep.stepsCount ?? 0;
                    barHeightPct = Math.min(100, Math.max(12, (qUpd / 160) * 100));
                    barColor = 'bg-purple-500/80 group-hover:bg-purple-400';
                    topLabel = `${qUpd}Q`;
                  }

                  return (
                    <div
                      key={ep.id}
                      className="flex-1 min-w-[20px] h-full flex flex-col justify-end items-center gap-1 group"
                      title={`Ep #${ep.episodeNumber} (${ep.scenarioName}): ${
                        ep.status
                      } | Reward ${ep.totalReward.toFixed(1)} | Replans: ${
                        ep.globalReplanCount
                      } | Wait: ${ep.waitingTimeSec.toFixed(1)}s | Safety Stops: ${
                        ep.safetyInterventionCount ?? 0
                      } | Q-Updates: ${
                        ep.qTableUpdatesCount ?? ep.stepsCount ?? 0
                      } | ε=${ep.epsilonUsed}`}
                    >
                      <div className="text-[9px] font-mono text-slate-400 opacity-80 group-hover:opacity-100">
                        {topLabel}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${barColor}`}
                        style={{ height: `${barHeightPct}%` }}
                      />
                      <span className="text-[9px] font-mono text-slate-500">
                        #{ep.episodeNumber}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Episode-by-Episode Training Telemetry Table */}
              <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-48 overflow-y-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-1.5 px-2.5">Ep #</th>
                      <th className="py-1.5 px-2.5">Curriculum Scenario</th>
                      <th className="py-1.5 px-2">Outcome</th>
                      <th className="py-1.5 px-2 text-right">Reward</th>
                      <th className="py-1.5 px-2 text-right">Replans</th>
                      <th className="py-1.5 px-2 text-right">Wait (s)</th>
                      <th className="py-1.5 px-2 text-right">Safety Stops</th>
                      <th className="py-1.5 px-2 text-right">Q-Updates</th>
                      <th className="py-1.5 px-2 text-right">ε</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {trainingHistory
                      .slice()
                      .reverse()
                      .slice(0, 18)
                      .map((ep) => (
                        <tr key={ep.id} className="hover:bg-slate-800/30">
                          <td className="py-1.5 px-2.5 text-slate-300">
                            #{ep.episodeNumber}
                          </td>
                          <td
                            className="py-1.5 px-2.5 font-sans text-slate-200 truncate max-w-[190px]"
                            title={ep.scenarioName}
                          >
                            {ep.scenarioName}
                          </td>
                          <td className="py-1.5 px-2">
                            <span
                              className={
                                ep.status === 'Success'
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-rose-400 font-semibold'
                              }
                            >
                              {ep.status}
                            </span>
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right ${
                              ep.totalReward >= 0 ? 'text-cyan-300' : 'text-amber-300'
                            }`}
                          >
                            {ep.totalReward.toFixed(1)}
                          </td>
                          <td className="py-1.5 px-2 text-right text-slate-300">
                            {ep.globalReplanCount}
                          </td>
                          <td className="py-1.5 px-2 text-right text-slate-300">
                            {ep.waitingTimeSec.toFixed(1)}s
                          </td>
                          <td className="py-1.5 px-2 text-right text-amber-300">
                            {ep.safetyInterventionCount ?? 0}
                          </td>
                          <td className="py-1.5 px-2 text-right text-purple-300">
                            {ep.qTableUpdatesCount ?? ep.stepsCount ?? 0}
                          </td>
                          <td className="py-1.5 px-2 text-right text-slate-400">
                            {ep.epsilonUsed.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
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
                {Object.keys(candidatePolicyState.qTable).length} States · {totalQTableUpdates}{' '}
                Bellman Updates
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
                        <td
                          className="py-1.5 px-2.5 text-slate-300 truncate max-w-[210px]"
                          title={row.stateKey}
                        >
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
              <span className="text-slate-400 block text-[11px]">Q-Table Updates</span>
              <span className="font-display font-bold text-lg text-purple-300 tabular-nums">
                {totalQTableUpdates}
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

          {/* Candidate Policy Metadata & Persistence Status */}
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2 text-[11px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-mono text-slate-400">
                Policy ID: <strong className="text-slate-200">{candidatePolicyState.id}</strong>
              </span>
              {selectedPolicyId === 'pol-candidate-rl' &&
              candidatePolicyState.isTrained &&
              Object.keys(candidatePolicyState.qTable).length > 0 ? (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold">
                  ACTIVE IN SIMULATION LAB
                </span>
              ) : candidatePolicyState.isTrained &&
                Object.keys(candidatePolicyState.qTable).length > 0 ? (
                <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-medium">
                  TRAINED · STANDBY
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
                  UNTRAINED (EMPTY Q-TABLE)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-400">
              <div>
                Learned Q-States:{' '}
                <strong className="text-cyan-300 font-mono">
                  {Object.keys(candidatePolicyState.qTable).length} states
                </strong>
              </div>
              <div>
                Version:{' '}
                <strong className="text-slate-200 font-mono">
                  v{candidatePolicyState.version}
                </strong>
              </div>
              <div
                className="truncate"
                title={candidatePolicyState.trainedRobotName || activeRobot.name}
              >
                Robot Compat.:{' '}
                <strong className="text-slate-200">
                  {candidatePolicyState.trainedRobotName || activeRobot.name}
                </strong>
              </div>
              <div
                className="truncate"
                title={candidatePolicyState.trainedEnvironmentName || activeEnvironment.name}
              >
                Env. Compat.:{' '}
                <strong className="text-slate-200">
                  {candidatePolicyState.trainedEnvironmentName || activeEnvironment.name}
                </strong>
              </div>
              {candidatePolicyState.lastTrainedAt && (
                <div>
                  Last Trained:{' '}
                  <strong className="text-slate-300 font-mono">
                    {new Date(candidatePolicyState.lastTrainedAt).toLocaleTimeString()}
                  </strong>
                </div>
              )}
              {candidatePolicyState.activatedAt && (
                <div>
                  Activated:{' '}
                  <strong className="text-emerald-300 font-mono">
                    {new Date(candidatePolicyState.activatedAt).toLocaleTimeString()}
                  </strong>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                setErrorNotice(null);
                setSavedNotice(null);
                const result = saveAndActivateCandidatePolicy(candidatePolicyState);
                if (!result.success) {
                  setErrorNotice(
                    result.error ||
                      'Cannot activate candidate policy: please train at least 1 episode first so a valid Q-table exists.'
                  );
                  return;
                }
                onSelectPolicy('pol-candidate-rl');
                const learnedStatesCount = Object.keys(
                  result.candidateState.qTable
                ).length;
                setSavedNotice(
                  `Saved & activated ${result.candidateState.name} (v${
                    result.candidateState.version
                  }) with ${learnedStatesCount} learned Q-table states (${
                    result.candidateState.totalEpisodesTrained
                  } episodes, mean reward ${avgTrainReward.toFixed(
                    1
                  )}). Subsequent Simulation Lab runs will now use this trained Q-table.`
                );
              }}
              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                candidatePolicyState.isTrained &&
                Object.keys(candidatePolicyState.qTable).length > 0
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/15'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>
                {selectedPolicyId === 'pol-candidate-rl' &&
                candidatePolicyState.isTrained &&
                Object.keys(candidatePolicyState.qTable).length > 0
                  ? `Saved & Active in Simulation Lab (v${candidatePolicyState.version})`
                  : `Save & Activate Candidate Policy (v${candidatePolicyState.version})`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION F: BEFORE VS. AFTER POLICY DEMONSTRATION (DELIVERABLE 4)      */}
      {/* ===================================================================== */}
      <div className="bg-[#0d1322] border border-cyan-500/40 rounded-xl p-5 space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="text-[11px] font-mono text-cyan-400">
              SECTION F · BEFORE VS. AFTER POLICY DEMONSTRATION (SYNCHRONIZED SEED & ROUTE)
            </div>
            <h3 className="font-display font-semibold text-lg text-slate-100">
              Side-by-Side Trajectory & Telemetry Comparison (Before vs. After Q-Learning)
            </h3>
            <p className="text-xs text-slate-400">
              Select a challenging scenario to run <strong>A. Original Baseline / Untrained Policy</strong> and{' '}
              <strong>B. Trained Candidate Policy (Frozen Q-Table)</strong> under the exact same robot,
              origin, destination, environment, and deterministic random seed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
            <div>
              <label className="text-slate-400 mr-1.5">Challenging Scenario:</label>
              <select
                value={demoScenarioId}
                onChange={(e) => setDemoScenarioId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 max-w-[270px]"
              >
                {scenarios
                  .filter((s) => s.id !== 'scen-fully-blocked')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.difficulty} · Seed #{s.randomSeed ?? 101})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-slate-400 mr-1.5">Run A (Before):</label>
              <select
                value={demoBeforeMode}
                onChange={(e) =>
                  setDemoBeforeMode(
                    e.target.value as
                      | 'baseline-hybrid'
                      | 'baseline-reactive'
                      | 'untrained-rl'
                  )
                }
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              >
                <option value="baseline-hybrid">
                  Original Baseline Policy (Hybrid A* v2.1)
                </option>
                <option value="baseline-reactive">
                  Baseline Reactive Stop-and-Replan
                </option>
                <option value="untrained-rl">
                  Untrained Candidate Q-Policy (0 Episodes)
                </option>
              </select>
            </div>

            <button
              onClick={handleRunBeforeAfterDemo}
              disabled={isRunningDemo}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>
                {isRunningDemo
                  ? 'Running Synchronized Demo...'
                  : 'Run Before vs. After Demonstration'}
              </span>
            </button>
          </div>
        </div>

        {!demoResult ? (
          <div className="p-8 rounded-xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
            <GitCompare className="w-7 h-7 text-cyan-400 mx-auto" />
            <div className="text-sm font-semibold text-slate-100">
              Ready to Run Synchronized Before vs. After Demonstration
            </div>
            <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
              Train the Candidate Policy for 12–18 episodes above, then click{' '}
              <strong>&ldquo;Run Before vs. After Demonstration&rdquo;</strong> to execute both
              policies on <strong>{activeDemoScenario?.name}</strong> with identical robot hardware (
              {activeRobot.name}), origin, destination, and seed (#{activeDemoScenario?.randomSeed ?? 101}).
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Identical Experimental Conditions Verification Bar */}
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-mono text-[11px]">
                  LOCKED SEED #{demoResult.scenarioSeed}
                </span>
                <span className="text-slate-300">
                  <strong>Scenario:</strong> {demoResult.scenarioName}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">
                  <strong>Robot:</strong> {demoResult.robotName}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">
                  <strong>Route:</strong> {demoResult.originPosition.label} →{' '}
                  {demoResult.destinationPosition.label}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">
                  <strong>Env:</strong> {demoResult.environmentName}
                </span>
              </div>
              <span className="font-mono text-[11px] text-emerald-400">
                Candidate Q-Table Frozen During Demo Evaluation
              </span>
            </div>

            {/* Improvement Summary Banner */}
            <div className="p-3.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs text-slate-100 leading-relaxed">
              <strong className="text-cyan-300 mr-1.5">
                Head-to-Head Verification Verdict:
              </strong>
              {demoResult.improvementSummary}
            </div>

            {/* Side-by-Side Trajectory Canvas + Metric Comparison */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              {/* Interactive 2D Trajectory Replay Map */}
              <div className="xl:col-span-6 bg-[#080d1a] border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-semibold text-slate-200">
                    2D Campus Trajectory & Obstacle Bypass Replay
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                      A: Before ({demoResult.baselineRun.status})
                    </span>
                    <span className="flex items-center gap-1.5 text-cyan-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
                      B: Trained ({demoResult.trainedCandidateRun.status})
                    </span>
                  </div>
                </div>

                <svg
                  viewBox="0 0 400 270"
                  className="w-full h-64 bg-[#050912] border border-slate-800/90 rounded-lg"
                >
                  {/* Campus Grid & Main Walkable Corridors */}
                  <g stroke="#1e293b" strokeWidth="18" strokeLinecap="round" fill="none">
                    {/* Horizontal avenues: z=-15, z=0, z=15 */}
                    <line
                      x1={worldToSvg(-34, -15).x}
                      y1={worldToSvg(-34, -15).y}
                      x2={worldToSvg(34, -15).x}
                      y2={worldToSvg(34, -15).y}
                    />
                    <line
                      x1={worldToSvg(-34, 0).x}
                      y1={worldToSvg(-34, 0).y}
                      x2={worldToSvg(34, 0).x}
                      y2={worldToSvg(34, 0).y}
                    />
                    <line
                      x1={worldToSvg(-34, 15).x}
                      y1={worldToSvg(-34, 15).y}
                      x2={worldToSvg(34, 15).x}
                      y2={worldToSvg(34, 15).y}
                    />
                    {/* Vertical avenues: x=-15, x=0, x=15 */}
                    <line
                      x1={worldToSvg(-15, -34).x}
                      y1={worldToSvg(-15, -34).y}
                      x2={worldToSvg(-15, 34).x}
                      y2={worldToSvg(-15, 34).y}
                    />
                    <line
                      x1={worldToSvg(0, -34).x}
                      y1={worldToSvg(0, -34).y}
                      x2={worldToSvg(0, 34).x}
                      y2={worldToSvg(0, 34).y}
                    />
                    <line
                      x1={worldToSvg(15, -34).x}
                      y1={worldToSvg(15, -34).y}
                      x2={worldToSvg(15, 34).x}
                      y2={worldToSvg(15, 34).y}
                    />
                  </g>

                  {/* Custom Corridor Obstacles in Scenario */}
                  {(activeDemoScenario?.customObstacles ?? []).map((obs) => {
                    const pt = worldToSvg(obs.x, obs.z);
                    return (
                      <g key={obs.id}>
                        <rect
                          x={pt.x - 4}
                          y={pt.y - 4}
                          width={8}
                          height={8}
                          rx={1.5}
                          fill="#f43f5e"
                          stroke="#fecdd3"
                          strokeWidth="1"
                        />
                      </g>
                    );
                  })}

                  {/* Origin & Destination Markers */}
                  {(() => {
                    const orig = worldToSvg(
                      demoResult.originPosition.x,
                      demoResult.originPosition.z
                    );
                    const dest = worldToSvg(
                      demoResult.destinationPosition.x,
                      demoResult.destinationPosition.z
                    );
                    return (
                      <>
                        <circle
                          cx={orig.x}
                          cy={orig.y}
                          r={6}
                          fill="#10b981"
                          stroke="#052e16"
                          strokeWidth="1.5"
                        />
                        <text
                          x={orig.x + 8}
                          y={orig.y + 3}
                          fill="#6ee7b7"
                          fontSize="8"
                          fontFamily="monospace"
                        >
                          START
                        </text>
                        <circle
                          cx={dest.x}
                          cy={dest.y}
                          r={6}
                          fill="#38bdf8"
                          stroke="#082f49"
                          strokeWidth="1.5"
                        />
                        <text
                          x={dest.x + 8}
                          y={dest.y + 3}
                          fill="#7dd3fc"
                          fontSize="8"
                          fontFamily="monospace"
                        >
                          GOAL
                        </text>
                      </>
                    );
                  })()}

                  {/* Trajectory A: Baseline / Untrained (Amber) */}
                  {demoResult.baselineRun.trajectory.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="2.2"
                      strokeDasharray="4 2"
                      opacity="0.85"
                      points={demoResult.baselineRun.trajectory
                        .filter((p) => (p.timeSec ?? p.t) <= demoPlaybackTimeSec)
                        .map((p) => {
                          const pt = worldToSvg(p.x, p.z);
                          return `${pt.x},${pt.y}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Trajectory B: Trained Candidate (Cyan) */}
                  {demoResult.trainedCandidateRun.trajectory.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="2.6"
                      opacity="0.95"
                      points={demoResult.trainedCandidateRun.trajectory
                        .filter((p) => (p.timeSec ?? p.t) <= demoPlaybackTimeSec)
                        .map((p) => {
                          const pt = worldToSvg(p.x, p.z);
                          return `${pt.x},${pt.y}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Current Playback Robot Markers */}
                  {(() => {
                    const sampA = getSampleAtTime(
                      demoResult.baselineRun.trajectory,
                      demoPlaybackTimeSec
                    );
                    const sampB = getSampleAtTime(
                      demoResult.trainedCandidateRun.trajectory,
                      demoPlaybackTimeSec
                    );
                    return (
                      <>
                        {sampA && (
                          <circle
                            cx={worldToSvg(sampA.x, sampA.z).x}
                            cy={worldToSvg(sampA.x, sampA.z).y}
                            r={5}
                            fill="#f59e0b"
                            stroke="#fffbeb"
                            strokeWidth="1.5"
                          />
                        )}
                        {sampB && (
                          <circle
                            cx={worldToSvg(sampB.x, sampB.z).x}
                            cy={worldToSvg(sampB.x, sampB.z).y}
                            r={5}
                            fill="#06b6d4"
                            stroke="#ecfeff"
                            strokeWidth="1.5"
                          />
                        )}
                      </>
                    );
                  })()}
                </svg>

                {/* Playback Scrubber Controls */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => {
                        if (demoPlaybackTimeSec >= maxDemoDurationSec) {
                          setDemoPlaybackTimeSec(0);
                        }
                        setIsDemoPlaying((p) => !p);
                      }}
                      className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {isDemoPlaying ? (
                        <>
                          <Pause className="w-3 h-3" />
                          <span>Pause Replay</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Replay Trajectories</span>
                        </>
                      )}
                    </button>
                    <span className="font-mono text-slate-300">
                      t = {demoPlaybackTimeSec.toFixed(1)}s / {maxDemoDurationSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={maxDemoDurationSec}
                    step={0.5}
                    value={demoPlaybackTimeSec}
                    onChange={(e) => {
                      setIsDemoPlaying(false);
                      setDemoPlaybackTimeSec(Number(e.target.value));
                    }}
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>

              {/* Side-by-Side Before vs After Metric Cards & Decision Logs */}
              <div className="xl:col-span-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Card A: Before (Baseline / Untrained) */}
                  <div className="p-4 rounded-xl bg-slate-900/80 border border-amber-500/40 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div>
                        <span className="text-[10px] font-mono text-amber-400 block">
                          RUN A · BEFORE TRAINING
                        </span>
                        <span className="font-semibold text-slate-100">
                          {demoResult.baselineRun.policyLabel}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                          demoResult.baselineRun.status === 'Success'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {demoResult.baselineRun.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                      <div>
                        <span className="text-slate-400 block">Completion Time</span>
                        <span className="text-slate-100 font-semibold">
                          {demoResult.baselineRun.durationSec.toFixed(1)}s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Path Distance</span>
                        <span className="text-slate-100 font-semibold">
                          {demoResult.baselineRun.distanceMeters.toFixed(1)}m
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Global Replans</span>
                        <span className="text-amber-300 font-semibold">
                          {demoResult.baselineRun.globalReplanCount} (Unnec:{' '}
                          {demoResult.baselineRun.unnecessaryReplanCount})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Waiting Time</span>
                        <span className="text-amber-300 font-semibold">
                          {demoResult.baselineRun.waitingTimeSec.toFixed(1)}s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Safety Stops / Collisions</span>
                        <span className="text-slate-200 font-semibold">
                          {demoResult.baselineRun.safetyInterventions} stops /{' '}
                          {demoResult.baselineRun.collisions} col
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Episode Reward</span>
                        <span className="text-amber-300 font-semibold">
                          {demoResult.baselineRun.episodeReward.toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {demoResult.baselineRun.failureReason && (
                      <div className="p-2 rounded bg-rose-950/50 border border-rose-500/30 text-[11px] text-rose-200">
                        {demoResult.baselineRun.failureReason}
                      </div>
                    )}
                  </div>

                  {/* Card B: After (Trained Candidate Policy) */}
                  <div className="p-4 rounded-xl bg-slate-900/80 border border-cyan-500/50 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div>
                        <span className="text-[10px] font-mono text-cyan-400 block">
                          RUN B · AFTER Q-LEARNING (FROZEN)
                        </span>
                        <span className="font-semibold text-slate-100">
                          {demoResult.trainedCandidateRun.policyLabel}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                          demoResult.trainedCandidateRun.status === 'Success'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {demoResult.trainedCandidateRun.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                      <div>
                        <span className="text-slate-400 block">Completion Time</span>
                        <span className="text-emerald-300 font-semibold">
                          {demoResult.trainedCandidateRun.durationSec.toFixed(1)}s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Path Distance</span>
                        <span className="text-emerald-300 font-semibold">
                          {demoResult.trainedCandidateRun.distanceMeters.toFixed(1)}m
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Global Replans</span>
                        <span className="text-cyan-300 font-semibold">
                          {demoResult.trainedCandidateRun.globalReplanCount} (Unnec:{' '}
                          {demoResult.trainedCandidateRun.unnecessaryReplanCount})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Waiting Time</span>
                        <span className="text-cyan-300 font-semibold">
                          {demoResult.trainedCandidateRun.waitingTimeSec.toFixed(1)}s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Safety Stops / Collisions</span>
                        <span className="text-emerald-300 font-semibold">
                          {demoResult.trainedCandidateRun.safetyInterventions} stops /{' '}
                          {demoResult.trainedCandidateRun.collisions} col
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Episode Reward</span>
                        <span className="text-emerald-400 font-bold">
                          {demoResult.trainedCandidateRun.episodeReward.toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {demoResult.trainedCandidateRun.failureReason && (
                      <div className="p-2 rounded bg-rose-950/50 border border-rose-500/30 text-[11px] text-rose-200">
                        {demoResult.trainedCandidateRun.failureReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Decision History Log Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="font-semibold text-amber-300">
                      Run A Decision Trace ({demoResult.baselineRun.decisionHistory.length} events)
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-400">
                      {demoResult.baselineRun.decisionHistory.length === 0 ? (
                        <div>No high-level avoidance transitions logged.</div>
                      ) : (
                        demoResult.baselineRun.decisionHistory.map((d, i) => (
                          <div key={i} className="truncate" title={d}>
                            {d}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="font-semibold text-cyan-300">
                      Run B Learned Q-Policy Decisions (
                      {demoResult.trainedCandidateRun.decisionHistory.length} events)
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-300">
                      {demoResult.trainedCandidateRun.decisionHistory.length === 0 ? (
                        <div>No high-level avoidance transitions logged.</div>
                      ) : (
                        demoResult.trainedCandidateRun.decisionHistory.map((d, i) => (
                          <div key={i} className="truncate" title={d}>
                            {d}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom: All Fleet Navigation Policies Tuning Grid */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-base text-slate-100">
            Active Navigation Policy Selector & Parameter Calibration
          </h3>
          {onNavigate && (
            <button
              onClick={() => onNavigate('policy-benchmarking')}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Proceed to Held-Out Policy Benchmarking</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
                  onClick={() => {
                    setErrorNotice(null);
                    if (pol.id === 'pol-candidate-rl') {
                      const res = saveAndActivateCandidatePolicy(candidatePolicyState);
                      if (!res.success) {
                        setErrorNotice(
                          res.error ||
                            'Cannot activate untrained Candidate Q-Learning Policy. Please run training episodes first.'
                        );
                        return;
                      }
                      onSelectPolicy('pol-candidate-rl');
                      setSavedNotice(
                        `Activated Candidate Q-Learning Policy (v${
                          res.candidateState.version
                        }) with ${
                          Object.keys(res.candidateState.qTable).length
                        } learned Q-table states.`
                      );
                    } else {
                      onSelectPolicy(pol.id);
                      setSavedNotice(
                        `Activated ${pol.name} (v${pol.version}) for Simulation Lab.`
                      );
                    }
                  }}
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
