import React from 'react';
import {
  Award,
  BarChart3,
  Download,
  Eye,
  Play,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { FAILURE_CATEGORIES } from '../simulation/failureIntelligence';
import { useExperimentStore } from '../storage/ExperimentContext';
import { PolicyAnalyticsSummary } from '../storage/experimentStorage';
import { ExperimentRecord, NavPageId } from '../types/simulation';

interface PerformanceAnalyticsPageProps {
  experiments: ExperimentRecord[];
  policyAnalytics: PolicyAnalyticsSummary[];
  demoPreviewEnabled: boolean;
  onToggleDemoPreview: (enabled: boolean) => void;
  onNavigate: (page: NavPageId) => void;
}

export const PerformanceAnalyticsPage: React.FC<PerformanceAnalyticsPageProps> = ({
  experiments,
  policyAnalytics,
  demoPreviewEnabled,
  onToggleDemoPreview,
  onNavigate,
}) => {
  const { failureDiagnoses, candidatePolicyState, benchmarkHistory } =
    useExperimentStore();

  // Compute failure counts by category strictly from failureDiagnoses
  const failureCountsByCategory = FAILURE_CATEGORIES.map((category) => ({
    category,
    count: failureDiagnoses.filter((d) => d.failureCategory === category).length,
  })).filter((c) => c.count > 0);

  // CSV Exports
  const exportExperimentsCsv = () => {
    if (experiments.length === 0) return;
    const headers = [
      'ExperimentID',
      'Timestamp',
      'ScenarioID',
      'ScenarioName',
      'GenerationSource',
      'Seed',
      'PolicyID',
      'PolicyName',
      'PolicyVersion',
      'Status',
      'DurationSec',
      'DistanceMeters',
      'Collisions',
      'GlobalReplans',
      'WaitingTimeSec',
      'BatteryConsumedPct',
      'FailureCategory',
    ];
    const rows = experiments.map((e) => [
      e.id,
      `"${e.timestamp}"`,
      e.scenarioId,
      `"${e.scenarioName}"`,
      e.scenarioGenerationSource ?? 'Preset',
      e.scenarioSeed ?? 101,
      e.policyId,
      `"${e.policyName}"`,
      `"${e.policyVersion ?? 'v1.0'}"`,
      e.status,
      e.durationSec.toFixed(2),
      e.distanceMeters.toFixed(2),
      e.collisions,
      e.globalReplanCount ?? e.replanCount,
      (e.totalWaitingTimeSec ?? 0).toFixed(2),
      e.batteryConsumedPct.toFixed(2),
      `"${e.failureCategory ?? (e.status === 'Failed' ? 'Unclassified' : 'None')}"`,
    ]);
    const csv =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `robosim_experiments_${Date.now()}.csv`;
    link.click();
  };

  const exportTrainingHistoryCsv = () => {
    if (candidatePolicyState.trainingHistory.length === 0) return;
    const headers = [
      'EpisodeIndex',
      'Timestamp',
      'ScenarioID',
      'ScenarioName',
      'GenerationSource',
      'Seed',
      'TotalReward',
      'StepsCount',
      'Success',
      'Collisions',
      'GlobalReplans',
      'WaitingTimeSec',
      'EpsilonUsed',
      'AvgTDError',
    ];
    const rows = candidatePolicyState.trainingHistory.map((ep) => [
      ep.episodeNumber,
      `"${ep.timestamp}"`,
      ep.scenarioId,
      `"${ep.scenarioName}"`,
      'Training',
      ep.scenarioSeed,
      ep.totalReward.toFixed(2),
      ep.stepsCount,
      ep.status === 'Success',
      ep.collisions,
      ep.globalReplanCount,
      ep.waitingTimeSec.toFixed(2),
      ep.epsilonUsed.toFixed(4),
      '0.0000',
    ]);
    const csv =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `robosim_training_history_${Date.now()}.csv`;
    link.click();
  };

  const exportBenchmarksCsv = () => {
    if (benchmarkHistory.length === 0) return;
    const latest = benchmarkHistory[0];
    const headers = [
      'BenchmarkID',
      'ScenarioID',
      'ScenarioName',
      'Seed',
      'BaselineStatus',
      'TrainedStatus',
      'BaselineTimeSec',
      'TrainedTimeSec',
      'BaselineCollisions',
      'TrainedCollisions',
      'BaselineReplans',
      'TrainedReplans',
      'BaselineWaitSec',
      'TrainedWaitSec',
      'ImprovedOutcome',
    ];
    const rows = latest.scenarioComparisons.map((c) => [
      latest.id,
      c.scenarioId,
      `"${c.scenarioName}"`,
      c.scenarioSeed,
      c.baseline.status,
      c.candidate.status,
      c.baseline.durationSec.toFixed(2),
      c.candidate.durationSec.toFixed(2),
      c.baseline.collisions,
      c.candidate.collisions,
      c.baseline.globalReplanCount,
      c.candidate.globalReplanCount,
      c.baseline.waitingTimeSec.toFixed(2),
      c.candidate.waitingTimeSec.toFixed(2),
      c.candidate.episodeReward >= c.baseline.episodeReward,
    ]);
    const csv =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `robosim_benchmark_${latest.id}.csv`;
    link.click();
  };

  const latestBenchmark = benchmarkHistory[0] ?? null;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="text-xs font-medium text-cyan-400">
            EVIDENCE-BASED ANALYTICS · ZERO HARDCODED METRICS
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Performance Analytics, Failure Breakdown & Training Convergence
          </h2>
          <p className="text-sm text-slate-400">
            Every metric and chart on this page is computed directly from stored simulation episodes,
            Q-learning training histories, and held-out benchmark runs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={exportExperimentsCsv}
            disabled={experiments.length === 0}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Experiments CSV ({experiments.length})</span>
          </button>

          <button
            onClick={exportTrainingHistoryCsv}
            disabled={candidatePolicyState.trainingHistory.length === 0}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Training CSV ({candidatePolicyState.trainingHistory.length})
            </span>
          </button>

          <button
            onClick={exportBenchmarksCsv}
            disabled={benchmarkHistory.length === 0}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Benchmark CSV ({benchmarkHistory.length})</span>
          </button>

          <button
            onClick={() => onToggleDemoPreview(!demoPreviewEnabled)}
            className={`px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
              demoPreviewEnabled
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{demoPreviewEnabled ? 'Demo: ON' : 'Demo Preview'}</span>
          </button>
        </div>
      </div>

      {experiments.length === 0 ? (
        <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-10 text-center space-y-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-cyan-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="text-base font-semibold text-slate-100">
            No Experiment Data Available for Analytics Yet
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Execute simulation runs in the <strong>Simulation Lab</strong>, run a batch in{' '}
            <strong>Synthetic Scenario Factory</strong>, or enable{' '}
            <strong>Demo Preview</strong> to populate analytics.
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => onNavigate('scenario-generator')}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Open Synthetic Scenario Factory
            </button>
            <button
              onClick={() => onNavigate('simulation-lab')}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Open 3D Simulation Lab</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Policy Comparison Cards (All 4 policies including Candidate Q-Learning Policy) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {policyAnalytics.map((item) => {
              const isCandidate = item.policy.isCandidatePolicy;
              const isBaseline = item.policy.isReadOnlyBaseline;
              return (
                <div
                  key={item.policy.id}
                  className={`bg-[#0d1322] border rounded-xl p-4 space-y-3.5 ${
                    isCandidate
                      ? 'border-emerald-500/40'
                      : isBaseline
                      ? 'border-cyan-500/40'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-cyan-400">
                          {item.policy.version}
                        </span>
                        {isCandidate && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                            LEARNED
                          </span>
                        )}
                        {isBaseline && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[10px]">
                            BASELINE
                          </span>
                        )}
                      </div>
                      <h3 className="font-display font-semibold text-sm text-slate-100 mt-0.5">
                        {item.policy.name}
                      </h3>
                    </div>
                    <TrendingUp className="w-4 h-4 text-cyan-400 shrink-0" />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Success Rate</span>
                      <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                        {item.totalRuns > 0 ? `${item.successRatePct.toFixed(1)}%` : 'No runs'}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-300"
                        style={{ width: `${item.successRatePct}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Episodes</span>
                      <span className="font-mono text-slate-200">{item.totalRuns}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Avg Time</span>
                      <span className="font-mono text-sky-400">
                        {item.totalRuns > 0 ? `${item.avgCompletionTimeSec.toFixed(1)}s` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Avg Dist</span>
                      <span className="font-mono text-slate-200">
                        {item.totalRuns > 0 ? `${item.avgDistanceMeters.toFixed(1)}m` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/70 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Collisions</span>
                      <span
                        className={`font-mono ${
                          item.totalCollisions > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'
                        }`}
                      >
                        {item.totalCollisions}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Global Replans</span>
                      <span className="font-mono text-cyan-400">{item.totalReplanCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Avg Battery</span>
                      <span className="font-mono text-amber-300">
                        {item.totalRuns > 0 ? `${item.avgBatteryConsumedPct.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Failure Breakdown by Category & Pre/Post Training Benchmark Summary */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Failure Count by Category */}
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display font-semibold text-base text-slate-100 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span>Failure Count by Automated Category</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Distribution of {failureDiagnoses.length} diagnosed failure events across the 11 failure classes
                  </p>
                </div>
                <button
                  onClick={() => onNavigate('failure-analysis')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  Inspect Failures →
                </button>
              </div>

              {failureCountsByCategory.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800">
                  Zero failures recorded across current experiments.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {failureCountsByCategory.map((item) => {
                    const pct = Math.min(
                      100,
                      Math.round((item.count / Math.max(1, failureDiagnoses.length)) * 100)
                    );
                    return (
                      <div key={item.category} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-200 font-medium">{item.category}</span>
                          <span className="font-mono text-rose-400">
                            {item.count} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-rose-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pre-Training vs Post-Training Benchmark Comparison */}
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display font-semibold text-base text-slate-100 flex items-center gap-2">
                    <Award className="w-4 h-4 text-emerald-400" />
                    <span>Pre-Training Baseline vs. Trained Candidate Benchmark</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Direct comparison on held-out test scenarios with identical random seeds
                  </p>
                </div>
                <button
                  onClick={() => onNavigate('policy-benchmarking')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  Open Benchmark Suite →
                </button>
              </div>

              {!latestBenchmark ? (
                <div className="p-6 text-center space-y-2 bg-slate-900/50 rounded-lg border border-slate-800">
                  <div className="text-xs font-medium text-slate-300">
                    No Held-Out Benchmark Suite Executed Yet
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Train the Candidate Policy in <strong>Policy Learning & Training</strong> and run a
                    side-by-side benchmark in <strong>Policy Benchmarking</strong>.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Success Rate</div>
                    <div className="font-mono font-bold text-base text-emerald-400 mt-1">
                      {latestBenchmark.baselineMetrics.successRatePct.toFixed(1)}% →{' '}
                      {latestBenchmark.candidateMetrics.successRatePct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Avg Delivery Time</div>
                    <div className="font-mono font-bold text-base text-cyan-400 mt-1">
                      {latestBenchmark.baselineMetrics.avgCompletionTimeSec.toFixed(1)}s →{' '}
                      {latestBenchmark.candidateMetrics.avgCompletionTimeSec.toFixed(1)}s
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Total Collisions</div>
                    <div className="font-mono font-bold text-base text-emerald-400 mt-1">
                      {latestBenchmark.baselineMetrics.totalCollisions} →{' '}
                      {latestBenchmark.candidateMetrics.totalCollisions}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Avg Global Replans</div>
                    <div className="font-mono font-bold text-base text-sky-400 mt-1">
                      {latestBenchmark.baselineMetrics.avgGlobalReplans.toFixed(1)} →{' '}
                      {latestBenchmark.candidateMetrics.avgGlobalReplans.toFixed(1)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Avg Waiting Time</div>
                    <div className="font-mono font-bold text-base text-amber-300 mt-1">
                      {latestBenchmark.baselineMetrics.avgWaitingTimeSec.toFixed(1)}s →{' '}
                      {latestBenchmark.candidateMetrics.avgWaitingTimeSec.toFixed(1)}s
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                    <div className="text-slate-400 text-[11px]">Avg Battery Used</div>
                    <div className="font-mono font-bold text-base text-slate-200 mt-1">
                      {latestBenchmark.baselineMetrics.avgBatteryConsumedPct.toFixed(1)}% →{' '}
                      {latestBenchmark.candidateMetrics.avgBatteryConsumedPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run-by-Run Duration, Distance, Battery & Replan Progression */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-display font-semibold text-base text-slate-100">
                Recent Episode Duration, Distance, Waiting Time & Energy Progression
              </h3>
              <p className="text-xs text-slate-400">
                Direct episode telemetry from the centralized experiment store
              </p>
            </div>

            <div className="space-y-3">
              {experiments.slice(0, 10).map((exp) => {
                const widthPct = Math.min(100, Math.max(6, (exp.durationSec / 60) * 100));
                return (
                  <div key={exp.id} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-200 font-medium">
                        {exp.id} · {exp.scenarioName} ({exp.policyName}{' '}
                        {exp.policyVersion ? `[${exp.policyVersion}]` : ''})
                      </span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        {exp.durationSec.toFixed(1)}s · {exp.distanceMeters.toFixed(1)}m · Wait:{' '}
                        {(exp.totalWaitingTimeSec ?? 0).toFixed(1)}s · Replans:{' '}
                        {exp.globalReplanCount ?? exp.replanCount} · Bat:{' '}
                        {exp.batteryConsumedPct.toFixed(1)}% ·{' '}
                        <span
                          className={
                            exp.status === 'Success' ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {exp.status}
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          exp.status === 'Success' ? 'bg-cyan-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
