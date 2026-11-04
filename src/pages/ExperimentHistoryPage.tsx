import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  Play,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { ExperimentRecord, NavPageId } from '../types/simulation';

interface ExperimentHistoryPageProps {
  experiments: ExperimentRecord[];
  onClearHistory: () => void;
  onNavigate: (page: NavPageId) => void;
}

type HistoryFilterMode =
  | 'ALL'
  | 'BASELINE'
  | 'CANDIDATE'
  | 'SUCCESS'
  | 'FAILED'
  | 'FAILURE_DRIVEN'
  | 'TRAINING'
  | 'BENCHMARK';

export const ExperimentHistoryPage: React.FC<ExperimentHistoryPageProps> = ({
  experiments,
  onClearHistory,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<HistoryFilterMode>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = experiments.filter((exp) => {
    if (filterMode === 'BASELINE' && exp.isCandidatePolicy) return false;
    if (filterMode === 'CANDIDATE' && !exp.isCandidatePolicy) return false;
    if (filterMode === 'SUCCESS' && exp.status !== 'Success') return false;
    if (filterMode === 'FAILED' && exp.status !== 'Failed') return false;
    if (
      filterMode === 'FAILURE_DRIVEN' &&
      exp.scenarioGenerationSource !== 'Failure-Driven'
    ) {
      return false;
    }
    if (filterMode === 'TRAINING' && exp.runType !== 'Training') return false;
    if (filterMode === 'BENCHMARK' && exp.runType !== 'Benchmark') return false;

    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      exp.id.toLowerCase().includes(q) ||
      exp.scenarioId.toLowerCase().includes(q) ||
      exp.scenarioName.toLowerCase().includes(q) ||
      exp.robotName.toLowerCase().includes(q) ||
      exp.policyName.toLowerCase().includes(q) ||
      (exp.failureCategory ?? '').toLowerCase().includes(q);
    return matchesQuery;
  });

  const handleExportCsv = () => {
    if (filtered.length === 0) return;
    const headers = [
      'ID',
      'Timestamp',
      'ScenarioID',
      'ScenarioName',
      'GenerationSource',
      'Seed',
      'RunType',
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
      'FailureReason',
    ];
    const rows = filtered.map((e) => [
      e.id,
      `"${e.timestamp}"`,
      e.scenarioId,
      `"${e.scenarioName}"`,
      e.scenarioGenerationSource ?? 'Preset',
      e.scenarioSeed ?? 101,
      e.runType ?? 'Interactive',
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
      `"${(e.failureReason ?? '').replace(/"/g, '""')}"`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `robosim_experiments_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-medium text-cyan-400">
            PERSISTENT AUDIT LOG · INTERACTIVE, BATCH, TRAINING & BENCHMARK RUNS
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Experiment History & Episode Telemetry Archive
          </h2>
          <p className="text-sm text-slate-400">
            Filter, inspect, and export all autonomous delivery episodes across Baseline and
            Trained Candidate policies. Click any row to inspect its decision trace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
              filtered.length > 0
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV ({filtered.length})</span>
          </button>

          <button
            onClick={onClearHistory}
            disabled={experiments.length === 0}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
              experiments.length > 0
                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30'
                : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Local History</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by Experiment ID, scenario ID/name, policy, or failure category..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Showing {filtered.length} of {experiments.length} episodes
          </div>
        </div>

        {/* 8 Required Segmented Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: 'All Episodes' },
              { id: 'BASELINE', label: 'Baseline Policy' },
              { id: 'CANDIDATE', label: 'Candidate Policy' },
              { id: 'SUCCESS', label: 'Successful Episodes' },
              { id: 'FAILED', label: 'Failed Episodes' },
              { id: 'FAILURE_DRIVEN', label: 'Failure-Driven Scenarios' },
              { id: 'TRAINING', label: 'Training Runs' },
              { id: 'BENCHMARK', label: 'Benchmark Runs' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterMode(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                filterMode === f.id
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 font-semibold'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
              <History className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-slate-200">
              No Matching Simulation Episodes Found
            </div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Run an experiment in the 3D Simulation Lab or execute a batch in Synthetic Scenario
              Factory to populate persistent experiment logs.
            </p>
            <button
              onClick={() => onNavigate('scenario-generator')}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Open Synthetic Scenario Factory</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-slate-900/40">
                  <th className="py-3 px-3">Experiment ID</th>
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Scenario ID & Name</th>
                  <th className="py-3 px-3">Source & Seed</th>
                  <th className="py-3 px-3">Policy & Version</th>
                  <th className="py-3 px-3">Mission Status</th>
                  <th className="py-3 px-3 text-right">Time</th>
                  <th className="py-3 px-3 text-right">Dist</th>
                  <th className="py-3 px-3 text-right">Collisions</th>
                  <th className="py-3 px-3 text-right">Global Replans</th>
                  <th className="py-3 px-3 text-right">Waiting Time</th>
                  <th className="py-3 px-3 text-right">Battery</th>
                  <th className="py-3 px-3">Failure Category</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((exp) => {
                  const isExpanded = expandedId === exp.id;
                  return (
                    <React.Fragment key={exp.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : exp.id)}
                        className="hover:bg-slate-800/30 cursor-pointer"
                      >
                        <td className="py-3 px-3 font-mono text-slate-200 whitespace-nowrap">
                          <div>{exp.id}</div>
                          <div className="text-[10px] text-slate-500">
                            {exp.runType ?? 'Interactive'}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-400 whitespace-nowrap tabular-nums">
                          {exp.timestamp}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-100">{exp.scenarioName}</div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {exp.scenarioId} · {exp.originName} → {exp.destinationName}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                              exp.scenarioGenerationSource === 'Failure-Driven'
                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                                : exp.scenarioGenerationSource === 'Random'
                                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                                : 'bg-slate-800 border-slate-700 text-slate-300'
                            }`}
                          >
                            {exp.scenarioGenerationSource ?? 'Preset'}
                          </span>
                          <div className="text-[10px] font-mono text-slate-500 mt-1">
                            Seed: {exp.scenarioSeed ?? 101}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-200 font-medium">{exp.policyName}</div>
                          <div className="text-[10px] font-mono text-cyan-400">
                            {exp.policyVersion ?? 'v1.0'}{' '}
                            {exp.isCandidatePolicy ? '[CANDIDATE]' : '[BASELINE]'}
                          </div>
                          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
                            {exp.robotName}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {exp.status === 'Success' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Success</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Failed</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                          {exp.durationSec.toFixed(1)}s
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                          {exp.distanceMeters.toFixed(1)}m
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <span
                            className={
                              exp.collisions > 0
                                ? 'text-rose-400 font-semibold'
                                : 'text-emerald-400'
                            }
                          >
                            {exp.collisions}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-cyan-400">
                          {exp.globalReplanCount ?? exp.replanCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-300">
                          {(exp.totalWaitingTimeSec ?? 0).toFixed(1)}s
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-400">
                          {exp.batteryConsumedPct.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3">
                          {exp.status === 'Failed' ? (
                            <span className="text-rose-400 font-medium">
                              {exp.failureCategory ?? exp.failureType ?? 'Failed Delivery'}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-slate-400">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-900/80 border-b border-slate-800">
                          <td colSpan={14} className="p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                              <div className="p-3 rounded-lg bg-[#0d1322] border border-slate-800 space-y-1">
                                <div className="text-[11px] font-semibold text-cyan-400">
                                  Robot Hardware & Environmental Conditions
                                </div>
                                {exp.robotHardwareSummary && (
                                  <div className="font-mono text-emerald-300 text-[11px]">
                                    {exp.robotHardwareSummary}
                                  </div>
                                )}
                                <div className="font-mono text-slate-300 text-[11px]">
                                  {exp.robotStateBeforeCompletion ?? 'Docked / Completed'}
                                </div>
                                <div className="font-mono text-slate-400 text-[11px]">
                                  {exp.environmentalConditionsSummary ?? 'Standard campus parameters'}
                                </div>
                              </div>

                              <div className="p-3 rounded-lg bg-[#0d1322] border border-slate-800 space-y-1">
                                <div className="text-[11px] font-semibold text-emerald-400">
                                  Hierarchical Avoidance & RL Telemetry
                                </div>
                                <div className="text-slate-300 text-[11px] font-mono">
                                  Speed Reg: {exp.speedBasedAvoidanceCount ?? 0} · Local Bypass:{' '}
                                  {exp.localBypassCount ?? 0} · Global Replans:{' '}
                                  {exp.globalReplanCount ?? exp.replanCount}
                                </div>
                                {exp.episodeReward !== undefined && (
                                  <div className="text-emerald-300 text-[11px] font-mono">
                                    RL Episode Reward:{' '}
                                    {exp.episodeReward >= 0 ? '+' : ''}
                                    {exp.episodeReward.toFixed(1)}
                                  </div>
                                )}
                              </div>

                              <div className="p-3 rounded-lg bg-[#0d1322] border border-slate-800 space-y-1">
                                <div className="text-[11px] font-semibold text-amber-400">
                                  Decision Trace & Root Cause
                                </div>
                                <div className="text-slate-300 text-[11px]">
                                  {exp.rootCause ?? exp.failureReason ?? 'Nominal delivery completion.'}
                                </div>
                                {exp.decisionHistory && exp.decisionHistory.length > 0 && (
                                  <div className="text-[10px] font-mono text-slate-400 pt-1">
                                    Recent decisions:{' '}
                                    {exp.decisionHistory.slice(-4).join(' → ')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
