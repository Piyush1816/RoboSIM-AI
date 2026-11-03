import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  GitCompare,
  Play,
  ShieldAlert,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { NAVIGATION_POLICIES } from '../data/campusConfig';
import { runFairPolicyBenchmarkSuite } from '../simulation/batchRunner';
import { useExperimentStore } from '../storage/ExperimentContext';
import { NavPageId } from '../types/simulation';

interface PolicyBenchmarkingPageProps {
  onNavigate: (page: NavPageId) => void;
  onLaunchScenarioInLab: (scenarioId: string) => void;
}

export const PolicyBenchmarkingPage: React.FC<PolicyBenchmarkingPageProps> = ({
  onNavigate,
  onLaunchScenarioInLab,
}) => {
  const {
    scenarios,
    policies,
    candidatePolicyState,
    benchmarkHistory,
    recordBenchmarkResult,
    recordExperimentsBatch,
  } = useExperimentStore();

  const heldOutTestScenarios = useMemo(() => {
    const testSplit = scenarios.filter(
      (s) => s.datasetSplit === 'test' && s.id !== 'scen-fully-blocked'
    );
    return testSplit.length > 0
      ? testSplit
      : scenarios.filter((s) => s.id !== 'scen-fully-blocked').slice(0, 3);
  }, [scenarios]);

  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() =>
    heldOutTestScenarios.map((s) => s.id)
  );
  const [baselinePolicyId, setBaselinePolicyId] = useState<string>('pol-hybrid-safe');
  const [episodesPerScenario, setEpisodesPerScenario] = useState<number>(1);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState<boolean>(false);
  const [progressInfo, setProgressInfo] = useState<{
    completed: number;
    total: number;
    label: string;
  }>({ completed: 0, total: 0, label: '' });

  const latestBenchmark = benchmarkHistory[0] ?? null;

  const handleToggleTestScenario = (id: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleRunFairBenchmark = async () => {
    const activeScens = scenarios.filter((s) => selectedTestIds.includes(s.id));
    if (activeScens.length === 0) return;

    const basePol =
      policies.find((p) => p.id === baselinePolicyId) ?? NAVIGATION_POLICIES[0];

    setIsRunningBenchmark(true);
    setProgressInfo({
      completed: 0,
      total: activeScens.length * episodesPerScenario * 2,
      label: 'Initializing Held-Out Benchmark Suite...',
    });

    const { benchmarkResult, recordedExperiments } =
      await runFairPolicyBenchmarkSuite({
        heldOutScenarios: activeScens,
        baselinePolicy: basePol,
        candidatePolicyState,
        episodesPerScenario,
        robotId: 'bot-rover-01',
        onProgress: (completed, total, label) => {
          setProgressInfo({ completed, total, label });
        },
      });

    recordExperimentsBatch(recordedExperiments);
    recordBenchmarkResult(benchmarkResult);
    setIsRunningBenchmark(false);
  };

  const handleExportBenchmarkCsv = () => {
    if (!latestBenchmark) return;
    const headers = [
      'ScenarioId',
      'ScenarioName',
      'Seed',
      'Difficulty',
      'GenerationSource',
      'BaselineStatus',
      'BaselineDurationSec',
      'BaselineDistanceM',
      'BaselineCollisions',
      'BaselineGlobalReplans',
      'BaselineWaitSec',
      'BaselineReward',
      'CandidateStatus',
      'CandidateDurationSec',
      'CandidateDistanceM',
      'CandidateCollisions',
      'CandidateGlobalReplans',
      'CandidateWaitSec',
      'CandidateReward',
    ];
    const rows = latestBenchmark.scenarioComparisons.map((c) => [
      c.scenarioId,
      `"${c.scenarioName}"`,
      c.scenarioSeed,
      c.difficulty,
      c.generationSource,
      c.baseline.status,
      c.baseline.durationSec,
      c.baseline.distanceMeters,
      c.baseline.collisions,
      c.baseline.globalReplanCount,
      c.baseline.waitingTimeSec,
      c.baseline.episodeReward,
      c.candidate.status,
      c.candidate.durationSec,
      c.candidate.distanceMeters,
      c.candidate.collisions,
      c.candidate.globalReplanCount,
      c.candidate.waitingTimeSec,
      c.candidate.episodeReward,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `robosim_benchmark_${latestBenchmark.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-cyan-400">
            HELD-OUT TEST SET EVALUATION · IDENTICAL SEEDS · FAIR SIDE-BY-SIDE COMPARISON
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Fair Baseline vs. Trained Candidate Policy Benchmarking
          </h2>
          <p className="text-sm text-slate-400">
            Evaluates the <strong>Baseline Policy</strong> and the{' '}
            <strong>Trained Candidate Q-Learning Policy ({candidatePolicyState.version})</strong> on
            the exact same held-out test scenarios and deterministic random seeds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {latestBenchmark && (
            <button
              onClick={handleExportBenchmarkCsv}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Benchmark CSV</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('robot-policies')}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <span>Open Policy Training</span>
          </button>
        </div>
      </div>

      {/* Benchmark Configuration & Execution Panel */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h3 className="font-display font-semibold text-base text-slate-100">
              Held-Out Test Suite Configuration
            </h3>
            <p className="text-xs text-slate-400">
               Held-out test scenarios are kept separate from the default training curriculum
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div>
              <label className="text-slate-400 mr-1.5">Baseline Policy:</label>
              <select
                value={baselinePolicyId}
                onChange={(e) => setBaselinePolicyId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              >
                {policies
                  .filter((p) => !p.isCandidatePolicy)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-slate-400 mr-1.5">Episodes/Scenario:</label>
              <select
                value={episodesPerScenario}
                onChange={(e) => setEpisodesPerScenario(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
              >
                <option value={1}>1 Episode (Seed Locked)</option>
                <option value={2}>2 Episodes</option>
                <option value={3}>3 Episodes</option>
              </select>
            </div>

            <button
              onClick={handleRunFairBenchmark}
              disabled={isRunningBenchmark || selectedTestIds.length === 0}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>
                {isRunningBenchmark
                  ? 'Running Side-by-Side Benchmark...'
                  : `Run Fair Benchmark (${selectedTestIds.length} Test Scenarios)`}
              </span>
            </button>
          </div>
        </div>

        {/* Held-Out Test Scenario Checkboxes */}
        <div className="flex flex-wrap gap-2 text-xs">
          {scenarios
            .filter((s) => s.id !== 'scen-fully-blocked')
            .map((scen) => {
              const checked = selectedTestIds.includes(scen.id);
              const isHeldOut = scen.datasetSplit === 'test';
              return (
                <label
                  key={scen.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer ${
                    checked
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-slate-100'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleTestScenario(scen.id)}
                    className="accent-cyan-500"
                  />
                  <span>{scen.name}</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      isHeldOut
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {(scen.datasetSplit ?? 'train').toUpperCase()} · Seed #
                    {scen.randomSeed ?? 101}
                  </span>
                </label>
              );
            })}
        </div>

        {isRunningBenchmark && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs font-mono text-cyan-300">
              <span>{progressInfo.label}</span>
              <span>
                {progressInfo.completed} / {progressInfo.total} Runs
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-150"
                style={{
                  width: `${
                    progressInfo.total > 0
                      ? (progressInfo.completed / progressInfo.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Results Display */}
      {!latestBenchmark ? (
        <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-10 text-center space-y-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-cyan-400">
            <GitCompare className="w-5 h-5" />
          </div>
          <div className="text-base font-semibold text-slate-100">
            No Held-Out Benchmark Suite Executed Yet
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Click <strong>Run Fair Benchmark</strong> above to evaluate the Baseline Policy and the
            Candidate Q-Learning Policy side-by-side on the held-out test scenarios with identical
            seeds.
          </p>
        </div>
      ) : (
        <>
          {/* Overall Narrative Summary & Improvements/Remaining Weaknesses */}
          <div className="bg-[#0d1322] border border-cyan-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-cyan-400">
                  BENCHMARK SUITE #{latestBenchmark.id} · {latestBenchmark.timestamp}
                </div>
                <h3 className="font-display font-semibold text-lg text-slate-100">
                  Side-by-Side Policy Verification Summary
                </h3>
              </div>
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>

            <p className="text-xs text-slate-200 leading-relaxed bg-slate-900/70 border border-slate-800 rounded-lg p-3.5">
              {latestBenchmark.overallSummary}
            </p>

            {/* 9 Required Aggregate Comparison Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-3 text-xs">
              {[
                {
                  label: 'Success Rate',
                  base: `${latestBenchmark.baselineMetrics.successRatePct}%`,
                  cand: `${latestBenchmark.candidateMetrics.successRatePct}%`,
                  better:
                    latestBenchmark.candidateMetrics.successRatePct >=
                    latestBenchmark.baselineMetrics.successRatePct,
                },
                {
                  label: 'Collisions',
                  base: `${latestBenchmark.baselineMetrics.totalCollisions} (${latestBenchmark.baselineMetrics.collisionRatePct}%)`,
                  cand: `${latestBenchmark.candidateMetrics.totalCollisions} (${latestBenchmark.candidateMetrics.collisionRatePct}%)`,
                  better:
                    latestBenchmark.candidateMetrics.totalCollisions <=
                    latestBenchmark.baselineMetrics.totalCollisions,
                },
                {
                  label: 'Avg Time',
                  base: `${latestBenchmark.baselineMetrics.avgCompletionTimeSec}s`,
                  cand: `${latestBenchmark.candidateMetrics.avgCompletionTimeSec}s`,
                  better:
                    latestBenchmark.candidateMetrics.avgCompletionTimeSec <=
                    latestBenchmark.baselineMetrics.avgCompletionTimeSec,
                },
                {
                  label: 'Avg Distance',
                  base: `${latestBenchmark.baselineMetrics.avgDistanceMeters}m`,
                  cand: `${latestBenchmark.candidateMetrics.avgDistanceMeters}m`,
                  better:
                    latestBenchmark.candidateMetrics.avgDistanceMeters <=
                    latestBenchmark.baselineMetrics.avgDistanceMeters,
                },
                {
                  label: 'Deadlocks',
                  base: String(latestBenchmark.baselineMetrics.totalDeadlocks),
                  cand: String(latestBenchmark.candidateMetrics.totalDeadlocks),
                  better:
                    latestBenchmark.candidateMetrics.totalDeadlocks <=
                    latestBenchmark.baselineMetrics.totalDeadlocks,
                },
                {
                  label: 'Avg Wait Time',
                  base: `${latestBenchmark.baselineMetrics.avgWaitingTimeSec}s`,
                  cand: `${latestBenchmark.candidateMetrics.avgWaitingTimeSec}s`,
                  better:
                    latestBenchmark.candidateMetrics.avgWaitingTimeSec <=
                    latestBenchmark.baselineMetrics.avgWaitingTimeSec,
                },
                {
                  label: 'Global Replans',
                  base: `${latestBenchmark.baselineMetrics.avgGlobalReplans}/run`,
                  cand: `${latestBenchmark.candidateMetrics.avgGlobalReplans}/run`,
                  better:
                    latestBenchmark.candidateMetrics.avgGlobalReplans <=
                    latestBenchmark.baselineMetrics.avgGlobalReplans,
                },
                {
                  label: 'Avg Battery',
                  base: `${latestBenchmark.baselineMetrics.avgBatteryConsumedPct}%`,
                  cand: `${latestBenchmark.candidateMetrics.avgBatteryConsumedPct}%`,
                  better:
                    latestBenchmark.candidateMetrics.avgBatteryConsumedPct <=
                    latestBenchmark.baselineMetrics.avgBatteryConsumedPct,
                },
                {
                  label: 'Mean Reward',
                  base: `${latestBenchmark.baselineMetrics.avgReward}`,
                  cand: `${latestBenchmark.candidateMetrics.avgReward}`,
                  better:
                    latestBenchmark.candidateMetrics.avgReward >=
                    latestBenchmark.baselineMetrics.avgReward,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col justify-between"
                >
                  <span className="text-[11px] text-slate-400">{m.label}</span>
                  <div className="mt-1.5 space-y-0.5 font-mono">
                    <div className="text-[11px] text-slate-400">
                      Base: <span className="text-slate-200">{m.base}</span>
                    </div>
                    <div
                      className={`text-xs font-bold ${
                        m.better ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      Cand: {m.cand}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Failure Categories Improved vs Regressed vs Remaining Weaknesses */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Categories Improved</span>
                </div>
                <ul className="space-y-1 text-slate-300 text-[11px] list-disc list-inside">
                  {latestBenchmark.failureCategoriesImproved.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Regressions / Trade-offs</span>
                </div>
                {latestBenchmark.failureCategoriesRegressed.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Zero metric regressions observed on held-out test scenarios.
                  </p>
                ) : (
                  <ul className="space-y-1 text-slate-300 text-[11px] list-disc list-inside">
                    {latestBenchmark.failureCategoriesRegressed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5">
                <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Remaining Weaknesses</span>
                </div>
                <ul className="space-y-1 text-slate-300 text-[11px] list-disc list-inside">
                  {latestBenchmark.remainingWeaknesses.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Scenario-by-Scenario Side-by-Side Comparison Table */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Scenario-by-Scenario Held-Out Comparison (Identical Seeds)
                </h3>
                <p className="text-xs text-slate-400">
                  Direct head-to-head comparison of Baseline vs. Candidate ({latestBenchmark.candidatePolicyVersion})
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-slate-900/50">
                    <th className="py-3 px-4">Held-Out Test Scenario & Seed</th>
                    <th className="py-3 px-3">Policy</th>
                    <th className="py-3 px-3">Outcome</th>
                    <th className="py-3 px-3 text-right">Time (s)</th>
                    <th className="py-3 px-3 text-right">Distance (m)</th>
                    <th className="py-3 px-3 text-right">Global Replans</th>
                    <th className="py-3 px-3 text-right">Unnecessary Replans</th>
                    <th className="py-3 px-3 text-right">Wait Time (s)</th>
                    <th className="py-3 px-3 text-right">Collisions</th>
                    <th className="py-3 px-3 text-right">Reward</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {latestBenchmark.scenarioComparisons.map((comp, idx) => (
                    <React.Fragment key={`${comp.scenarioId}-${comp.scenarioSeed}-${idx}`}>
                      {/* Baseline Row */}
                      <tr className="bg-slate-900/20 hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-sans" rowSpan={2}>
                          <div className="font-semibold text-slate-100">
                            {comp.scenarioName}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Seed #{comp.scenarioSeed} · {comp.difficulty} · {comp.generationSource}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">Baseline</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={
                              comp.baseline.status === 'Success'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {comp.baseline.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {comp.baseline.durationSec.toFixed(1)}s
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {comp.baseline.distanceMeters.toFixed(1)}m
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-300">
                          {comp.baseline.globalReplanCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-400">
                          {comp.baseline.unnecessaryReplanCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {comp.baseline.waitingTimeSec.toFixed(1)}s
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {comp.baseline.collisions}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {comp.baseline.episodeReward.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-sans" rowSpan={2}>
                          <button
                            onClick={() => onLaunchScenarioInLab(comp.scenarioId)}
                            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Inspect in 3D</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>

                      {/* Candidate Row */}
                      <tr className="bg-cyan-500/5 hover:bg-cyan-500/10 border-b border-slate-800">
                        <td className="py-2.5 px-3 text-cyan-400 font-semibold">
                          Candidate (RL)
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={
                              comp.candidate.status === 'Success'
                                ? 'text-emerald-400 font-semibold'
                                : 'text-rose-400 font-semibold'
                            }
                          >
                            {comp.candidate.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-300 font-semibold">
                          {comp.candidate.durationSec.toFixed(1)}s
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-300 font-semibold">
                          {comp.candidate.distanceMeters.toFixed(1)}m
                        </td>
                        <td className="py-2.5 px-3 text-right text-cyan-300 font-semibold">
                          {comp.candidate.globalReplanCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-cyan-300">
                          {comp.candidate.unnecessaryReplanCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-cyan-300">
                          {comp.candidate.waitingTimeSec.toFixed(1)}s
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">
                          {comp.candidate.collisions}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                          {comp.candidate.episodeReward.toFixed(1)}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
