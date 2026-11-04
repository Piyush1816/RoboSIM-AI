import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  CheckCircle2,
  Cpu,
  Download,
  GitCompare,
  Play,
  ShieldAlert,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { NAVIGATION_POLICIES } from '../data/campusConfig';
import {
  runCrossRobotHardwareBenchmarkSuite,
  runFairPolicyBenchmarkSuite,
} from '../simulation/batchRunner';
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
    robots,
    selectedRobotId,
    activeRobot,
    setSelectedRobotId,
    activeEnvironment,
    candidatePolicyState,
    benchmarkHistory,
    crossRobotBenchmarks,
    recordBenchmarkResult,
    recordCrossRobotBenchmark,
    recordExperimentsBatch,
  } = useExperimentStore();

  const [benchmarkTab, setBenchmarkTab] = useState<'policy' | 'hardware'>('policy');

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

  // Cross-Robot Hardware Benchmark state
  const [selectedHardwareRobotIds, setSelectedHardwareRobotIds] = useState<string[]>(() =>
    robots.map((r) => r.id)
  );
  const [hardwarePolicyId, setHardwarePolicyId] = useState<string>('pol-hybrid-safe');
  const [hardwarePayloadKg, setHardwarePayloadKg] = useState<number>(12);
  const [isRunningHardwareBenchmark, setIsRunningHardwareBenchmark] = useState<boolean>(false);
  const [hardwareProgress, setHardwareProgress] = useState<{
    completed: number;
    total: number;
    label: string;
  }>({ completed: 0, total: 0, label: '' });

  const latestBenchmark = benchmarkHistory[0] ?? null;
  const latestHardwareBenchmark = crossRobotBenchmarks[0] ?? null;

  const handleToggleTestScenario = (id: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleHardwareRobot = (robotId: string) => {
    setSelectedHardwareRobotIds((prev) =>
      prev.includes(robotId) ? prev.filter((id) => id !== robotId) : [...prev, robotId]
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
      label: `Initializing Held-Out Benchmark Suite on ${activeRobot.name} in ${activeEnvironment.name}...`,
    });

    const { benchmarkResult, recordedExperiments } =
      await runFairPolicyBenchmarkSuite({
        heldOutScenarios: activeScens,
        baselinePolicy: basePol,
        candidatePolicyState,
        episodesPerScenario,
        robotId: selectedRobotId,
        environment: activeEnvironment,
        onProgress: (completed, total, label) => {
          setProgressInfo({ completed, total, label });
        },
      });

    recordExperimentsBatch(recordedExperiments);
    recordBenchmarkResult(benchmarkResult);
    setIsRunningBenchmark(false);
  };

  const handleRunCrossRobotHardwareBenchmark = async () => {
    const activeScens = scenarios.filter((s) => selectedTestIds.includes(s.id));
    const chosenRobots = robots.filter((r) => selectedHardwareRobotIds.includes(r.id));
    if (activeScens.length === 0 || chosenRobots.length < 2) return;

    const evalPol =
      policies.find((p) => p.id === hardwarePolicyId) ?? NAVIGATION_POLICIES[0];

    setIsRunningHardwareBenchmark(true);
    setHardwareProgress({
      completed: 0,
      total: chosenRobots.length * activeScens.length,
      label: `Evaluating fleet hardware in ${activeEnvironment.name}...`,
    });

    const { benchmarkResult, recordedExperiments } =
      await runCrossRobotHardwareBenchmarkSuite({
        robots: chosenRobots,
        scenarios: activeScens,
        policy: evalPol,
        environment: activeEnvironment,
        candidatePolicyState,
        requestedPayloadKg: hardwarePayloadKg,
        onProgress: (completed, total, label) => {
          setHardwareProgress({ completed, total, label });
        },
      });

    recordExperimentsBatch(recordedExperiments);
    recordCrossRobotBenchmark(benchmarkResult);
    setIsRunningHardwareBenchmark(false);
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
      {/* Header & Evaluation Mode Switcher */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="text-xs font-medium text-cyan-400">
              DUAL EVALUATION SUITE · ENVIRONMENT: {activeEnvironment.name.toUpperCase()} (v{activeEnvironment.version})
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-100">
              {benchmarkTab === 'policy'
                ? 'Did the trained robot policy perform better than the original policy?'
                : 'Which robot hardware configuration performs best in this environment?'}
            </h2>
            <p className="text-sm text-slate-400">
              {benchmarkTab === 'policy' ? (
                <>
                  Compares the <strong>Baseline Policy</strong> against the{' '}
                  <strong>Candidate / Learned Policy (v{candidatePolicyState.version})</strong> on{' '}
                  <strong className="text-cyan-300">{activeRobot.name}</strong> in{' '}
                  <strong className="text-emerald-300">{activeEnvironment.name}</strong> across the exact
                  same held-out test scenarios and random seeds (Frozen Q-Table, No Training Updates).
                </>
              ) : (
                <>
                  Evaluates multiple <strong>Robot Hardware Configurations</strong> (speed, braking,
                  chassis footprint, LiDAR range, battery capacity, and payload capacity) side-by-side
                  in <strong className="text-emerald-300">{activeEnvironment.name}</strong> under identical scenarios and seeds.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {benchmarkTab === 'policy' && latestBenchmark && (
              <button
                onClick={handleExportBenchmarkCsv}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Policy CSV</span>
              </button>
            )}
            <button
              onClick={() => onNavigate('robot-config')}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>Robot Hardware Config</span>
            </button>
            <button
              onClick={() => onNavigate('robot-policies')}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <span>Open Policy Training</span>
            </button>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
          <button
            onClick={() => setBenchmarkTab('policy')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
              benchmarkTab === 'policy'
                ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>1. Software Policy Comparison (Baseline vs. Candidate RL)</span>
          </button>
          <button
            onClick={() => setBenchmarkTab('hardware')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
              benchmarkTab === 'hardware'
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>2. Cross-Robot Hardware Comparison (Compare {robots.length} Robots)</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* TAB 2: CROSS-ROBOT HARDWARE BENCHMARKING                              */}
      {/* ===================================================================== */}
      {benchmarkTab === 'hardware' && (
        <div className="space-y-6">
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Cross-Robot Hardware Comparison Setup
                </h3>
                <p className="text-xs text-slate-400">
                  Select 2 or more robot configurations, mission payload weight, and navigation
                  policy to evaluate side-by-side
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div>
                  <label className="text-slate-400 mr-1.5">Evaluation Policy:</label>
                  <select
                    value={hardwarePolicyId}
                    onChange={(e) => setHardwarePolicyId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                  >
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.isCandidatePolicy ? `(v${candidatePolicyState.version})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 mr-1.5">Mission Payload:</label>
                  <select
                    value={hardwarePayloadKg}
                    onChange={(e) => setHardwarePayloadKg(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
                  >
                    <option value={5}>5 kg (Light Parcel)</option>
                    <option value={12}>12 kg (Standard Parcel)</option>
                    <option value={22}>22 kg (Medium Lab Crate)</option>
                    <option value={35}>35 kg (Heavy Freight Crate)</option>
                  </select>
                </div>

                <button
                  onClick={handleRunCrossRobotHardwareBenchmark}
                  disabled={
                    isRunningHardwareBenchmark ||
                    selectedHardwareRobotIds.length < 2 ||
                    selectedTestIds.length === 0
                  }
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {isRunningHardwareBenchmark
                      ? 'Evaluating Robot Fleet...'
                      : `Compare ${selectedHardwareRobotIds.length} Robots (${selectedTestIds.length} Scenarios)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Robot Selection Checkboxes */}
            <div className="space-y-2">
              <div className="text-xs text-slate-400">
                Select Robot Hardware Configurations to Compare (Minimum 2):
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                {robots.map((bot) => {
                  const checked = selectedHardwareRobotIds.includes(bot.id);
                  const payloadExceeded = hardwarePayloadKg > bot.payloadCapacityKg;
                  return (
                    <label
                      key={bot.id}
                      className={`p-3 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-colors ${
                        checked
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-slate-100'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleHardwareRobot(bot.id)}
                        className="mt-0.5 accent-emerald-500"
                      />
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100 truncate">{bot.name}</span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                            {bot.maxSpeedMps} m/s
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {bot.lengthM ?? 0.85}×{bot.widthM ?? 0.62}m · Max {bot.payloadCapacityKg}kg
                          · {bot.batteryCapacityWh}Wh · LiDAR {bot.lidarRangeM ?? 24}m
                        </div>
                        {payloadExceeded && (
                          <div className="text-[10px] font-mono text-amber-300">
                            Note: {hardwarePayloadKg}kg exceeds {bot.payloadCapacityKg}kg capacity
                            (heavy load penalty)
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Test Scenarios for Hardware Comparison */}
            <div className="space-y-2 pt-1">
              <div className="text-xs text-slate-400">
                Benchmark Scenarios ({selectedTestIds.length} selected):
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {scenarios
                  .filter((s) => s.datasetSplit === 'test' && s.id !== 'scen-fully-blocked')
                  .map((scen) => {
                    const checked = selectedTestIds.includes(scen.id);
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
                        <span className="font-mono text-[10px] text-slate-400">
                          Seed #{scen.randomSeed ?? 101}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

            {isRunningHardwareBenchmark && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-xs font-mono text-emerald-300">
                  <span>{hardwareProgress.label}</span>
                  <span>
                    {hardwareProgress.completed} / {hardwareProgress.total} Runs
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-150"
                    style={{
                      width: `${
                        hardwareProgress.total > 0
                          ? (hardwareProgress.completed / hardwareProgress.total) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {!latestHardwareBenchmark ? (
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <Cpu className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-lg mx-auto">
                <h3 className="font-display font-semibold text-lg text-slate-100">
                  No Cross-Robot Hardware Benchmark Executed Yet
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Click <strong>&ldquo;Compare {selectedHardwareRobotIds.length} Robots&rdquo;</strong>{' '}
                  above to evaluate how chassis dimensions, max speed, braking deceleration, LiDAR
                  range, battery capacity, and payload weight impact mission performance.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Recommended Robot Winner Banner */}
              <div className="bg-emerald-950/25 border border-emerald-500/40 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                    <Award className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                        Recommended Robot Hardware Configuration
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 font-mono text-[11px]">
                        Payload: {latestHardwareBenchmark.requestedPayloadKg} kg · Policy:{' '}
                        {latestHardwareBenchmark.policyName}
                      </span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-slate-100">
                      {latestHardwareBenchmark.recommendedRobotName}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {latestHardwareBenchmark.recommendationRationale}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    onClick={() => {
                      setSelectedRobotId(latestHardwareBenchmark.recommendedRobotId);
                      onNavigate('simulation-lab');
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Winner in 3D Simulation Lab</span>
                  </button>
                </div>
              </div>

              {/* 9-Metric Cross-Robot Comparison Table */}
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display font-semibold text-base text-slate-100">
                      Cross-Robot Hardware Performance Matrix ({latestHardwareBenchmark.entries.length}{' '}
                      Robots × {latestHardwareBenchmark.scenarioIds.length} Scenarios)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Evaluated at {latestHardwareBenchmark.timestamp} under identical random seeds
                      and {latestHardwareBenchmark.requestedPayloadKg} kg payload
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-slate-900/50">
                        <th className="py-3 px-4">Robot Hardware Profile</th>
                        <th className="py-3 px-3 text-right">1. Success Rate</th>
                        <th className="py-3 px-3 text-right">2. Collision Rate</th>
                        <th className="py-3 px-3 text-right">3. Avg Time</th>
                        <th className="py-3 px-3 text-right">4. Avg Path</th>
                        <th className="py-3 px-3 text-right">5. Nav Failures</th>
                        <th className="py-3 px-3 text-right">6. Replans</th>
                        <th className="py-3 px-3 text-right">7. Safety Stops</th>
                        <th className="py-3 px-3 text-right">8. Battery Drain</th>
                        <th className="py-3 px-3 text-center">9. Payload ({latestHardwareBenchmark.requestedPayloadKg}kg)</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {latestHardwareBenchmark.entries.map((entry) => {
                        const isWinner =
                          entry.robotId === latestHardwareBenchmark.recommendedRobotId;
                        const isSelected = entry.robotId === selectedRobotId;
                        return (
                          <tr
                            key={entry.robotId}
                            className={
                              isWinner
                                ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                                : 'bg-slate-900/20 hover:bg-slate-800/30'
                            }
                          >
                            <td className="py-3 px-4 font-sans">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-100">
                                  {entry.robotName}
                                </span>
                                {isWinner && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-mono text-[10px] font-bold">
                                    BEST FIT
                                  </span>
                                )}
                                {isSelected && (
                                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px]">
                                    ACTIVE
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {entry.maxSpeedMps} m/s · Cap {entry.payloadCapacityKg}kg ·{' '}
                                {entry.batteryCapacityWh}Wh · LiDAR {entry.lidarRangeM}m · R=
                                {entry.collisionRadiusM.toFixed(2)}m
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-emerald-400">
                              {entry.successRatePct.toFixed(1)}%
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span
                                className={
                                  entry.totalCollisions === 0
                                    ? 'text-emerald-400'
                                    : 'text-rose-400 font-semibold'
                                }
                              >
                                {entry.collisionRatePct.toFixed(1)}% ({entry.totalCollisions})
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right text-slate-200">
                              {entry.avgCompletionTimeSec.toFixed(1)}s
                            </td>
                            <td className="py-3 px-3 text-right text-slate-300">
                              {entry.avgDistanceMeters.toFixed(1)}m
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span
                                className={
                                  entry.navigationFailuresCount === 0
                                    ? 'text-slate-400'
                                    : 'text-rose-400 font-semibold'
                                }
                              >
                                {entry.navigationFailuresCount}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right text-cyan-300">
                              {entry.avgGlobalReplans.toFixed(1)}
                            </td>
                            <td className="py-3 px-3 text-right text-amber-300">
                              {entry.totalSafetyInterventions}
                            </td>
                            <td className="py-3 px-3 text-right text-slate-200">
                              <div>{entry.avgBatteryConsumedPct.toFixed(1)}%</div>
                              <div className="text-[10px] text-slate-400">
                                {entry.avgBatteryConsumedWh.toFixed(1)} Wh
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center font-sans">
                              {entry.payloadCompatible ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px]">
                                  Compatible (≤{entry.payloadCapacityKg}kg)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px]">
                                  Overload (&gt;{entry.payloadCapacityKg}kg)
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-sans">
                              <button
                                onClick={() => setSelectedRobotId(entry.robotId)}
                                className={`px-2.5 py-1.5 rounded text-[11px] font-medium cursor-pointer ${
                                  isSelected
                                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                    : 'bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200'
                                }`}
                              >
                                {isSelected ? 'Selected Robot' : 'Select Robot'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: POLICY COMPARISON (BASELINE VS CANDIDATE ON SELECTED ROBOT)    */}
      {/* ===================================================================== */}
      {benchmarkTab === 'policy' && (
        <>
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Held-Out Test Suite Configuration (Robot: {activeRobot.name})
                </h3>
                <p className="text-xs text-slate-400">
                  Held-out test scenarios are kept separate from the default training curriculum
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div>
                  <label className="text-slate-400 mr-1.5">Target Robot:</label>
                  <select
                    value={selectedRobotId}
                    onChange={(e) => setSelectedRobotId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-cyan-300 font-medium"
                  >
                    {robots.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.maxSpeedMps} m/s)
                      </option>
                    ))}
                  </select>
                </div>

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

            {/* Held-Out Test Scenario Checkboxes (Strictly Held-Out Test Split Only) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  Held-Out Testing Scenarios ({scenarios.filter((s) => s.datasetSplit === 'test').length}{' '}
                  Test Scenarios ·{' '}
                  {scenarios.filter((s) => (s.datasetSplit ?? 'train') === 'train').length} Training
                  Scenarios Excluded from Benchmark):
                </span>
              </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {scenarios
              .filter((s) => s.datasetSplit === 'test' && s.id !== 'scen-fully-blocked')
              .map((scen) => {
                const checked = selectedTestIds.includes(scen.id);
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
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                      HELD-OUT TEST · Seed #{scen.randomSeed ?? 101}
                    </span>
                  </label>
                );
              })}
          </div>
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

            {/* 5 Key Comparison Metrics (Prominent Top Row) */}
            <div>
              <div className="text-xs font-semibold text-slate-200 mb-2">
                5 Core Policy Comparison Metrics (Baseline vs. Trained Candidate Policy)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                {[
                  {
                    label: '1. Success Rate',
                    base: `${latestBenchmark.baselineMetrics.successRatePct}%`,
                    cand: `${latestBenchmark.candidateMetrics.successRatePct}%`,
                    delta: `${
                      latestBenchmark.candidateMetrics.successRatePct -
                        latestBenchmark.baselineMetrics.successRatePct >=
                      0
                        ? '+'
                        : ''
                    }${(
                      latestBenchmark.candidateMetrics.successRatePct -
                      latestBenchmark.baselineMetrics.successRatePct
                    ).toFixed(1)}%`,
                    better:
                      latestBenchmark.candidateMetrics.successRatePct >=
                      latestBenchmark.baselineMetrics.successRatePct,
                  },
                  {
                    label: '2. Collision Rate',
                    base: `${latestBenchmark.baselineMetrics.collisionRatePct}% (${latestBenchmark.baselineMetrics.totalCollisions})`,
                    cand: `${latestBenchmark.candidateMetrics.collisionRatePct}% (${latestBenchmark.candidateMetrics.totalCollisions})`,
                    delta: `Δ ${(
                      latestBenchmark.candidateMetrics.collisionRatePct -
                      latestBenchmark.baselineMetrics.collisionRatePct
                    ).toFixed(1)}%`,
                    better:
                      latestBenchmark.candidateMetrics.collisionRatePct <=
                      latestBenchmark.baselineMetrics.collisionRatePct,
                  },
                  {
                    label: '3. Avg Completion Time',
                    base: `${latestBenchmark.baselineMetrics.avgCompletionTimeSec}s`,
                    cand: `${latestBenchmark.candidateMetrics.avgCompletionTimeSec}s`,
                    delta: `Δ ${(
                      latestBenchmark.candidateMetrics.avgCompletionTimeSec -
                      latestBenchmark.baselineMetrics.avgCompletionTimeSec
                    ).toFixed(1)}s`,
                    better:
                      latestBenchmark.candidateMetrics.avgCompletionTimeSec <=
                      latestBenchmark.baselineMetrics.avgCompletionTimeSec,
                  },
                  {
                    label: '4. Navigation Failures',
                    base: String(
                      latestBenchmark.baselineMetrics.episodesCount -
                        Math.round(
                          (latestBenchmark.baselineMetrics.successRatePct / 100) *
                            latestBenchmark.baselineMetrics.episodesCount
                        )
                    ),
                    cand: String(
                      latestBenchmark.candidateMetrics.episodesCount -
                        Math.round(
                          (latestBenchmark.candidateMetrics.successRatePct / 100) *
                            latestBenchmark.candidateMetrics.episodesCount
                        )
                    ),
                    delta: `Deadlocks: ${latestBenchmark.baselineMetrics.totalDeadlocks} → ${latestBenchmark.candidateMetrics.totalDeadlocks}`,
                    better:
                      latestBenchmark.candidateMetrics.successRatePct >=
                      latestBenchmark.baselineMetrics.successRatePct,
                  },
                  {
                    label: '5. Safety Interventions',
                    base: String(
                      latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0
                    ),
                    cand: String(
                      latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0
                    ),
                    delta: `Δ ${
                      (latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0) -
                      (latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0)
                    }`,
                    better:
                      (latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0) <=
                      (latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0),
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="p-3.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-1.5"
                  >
                    <span className="text-slate-300 font-semibold block text-xs">
                      {card.label}
                    </span>
                    <div className="flex items-baseline justify-between font-mono pt-0.5">
                      <span className="text-slate-400 text-xs">
                        Base: {card.base}
                      </span>
                      <span className="text-cyan-300 font-bold text-sm">
                        Trained: {card.cand}
                      </span>
                    </div>
                    <div
                      className={`text-[11px] font-mono font-semibold ${
                        card.better ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {card.delta}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Complete 10-Metric Breakdown */}
            <div className="text-xs font-semibold text-slate-400 pt-1">
              Complete 10-Metric Diagnostic Breakdown:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-2.5 text-xs">
              {[
                {
                  label: 'Success Rate',
                  base: `${latestBenchmark.baselineMetrics.successRatePct}%`,
                  cand: `${latestBenchmark.candidateMetrics.successRatePct}%`,
                  delta: `${
                    latestBenchmark.candidateMetrics.successRatePct -
                      latestBenchmark.baselineMetrics.successRatePct >=
                    0
                      ? '+'
                      : ''
                  }${(
                    latestBenchmark.candidateMetrics.successRatePct -
                    latestBenchmark.baselineMetrics.successRatePct
                  ).toFixed(1)}%`,
                  better:
                    latestBenchmark.candidateMetrics.successRatePct >=
                    latestBenchmark.baselineMetrics.successRatePct,
                },
                {
                  label: 'Collisions',
                  base: `${latestBenchmark.baselineMetrics.totalCollisions} (${latestBenchmark.baselineMetrics.collisionRatePct}%)`,
                  cand: `${latestBenchmark.candidateMetrics.totalCollisions} (${latestBenchmark.candidateMetrics.collisionRatePct}%)`,
                  delta: `Δ ${
                    latestBenchmark.candidateMetrics.totalCollisions -
                    latestBenchmark.baselineMetrics.totalCollisions
                  }`,
                  better:
                    latestBenchmark.candidateMetrics.totalCollisions <=
                    latestBenchmark.baselineMetrics.totalCollisions,
                },
                {
                  label: 'Safety Overrides',
                  base: String(
                    latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0
                  ),
                  cand: String(
                    latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0
                  ),
                  delta: `Δ ${
                    (latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0) -
                    (latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0)
                  }`,
                  better:
                    (latestBenchmark.candidateMetrics.totalSafetyInterventions ?? 0) <=
                    (latestBenchmark.baselineMetrics.totalSafetyInterventions ?? 0),
                },
                {
                  label: 'Elevator Failures',
                  base: String(
                    latestBenchmark.baselineMetrics.elevatorFailuresCount ?? 0
                  ),
                  cand: String(
                    latestBenchmark.candidateMetrics.elevatorFailuresCount ?? 0
                  ),
                  delta: `Δ ${
                    (latestBenchmark.candidateMetrics.elevatorFailuresCount ?? 0) -
                    (latestBenchmark.baselineMetrics.elevatorFailuresCount ?? 0)
                  }`,
                  better:
                    (latestBenchmark.candidateMetrics.elevatorFailuresCount ?? 0) <=
                    (latestBenchmark.baselineMetrics.elevatorFailuresCount ?? 0),
                },
                {
                  label: 'Avg Time',
                  base: `${latestBenchmark.baselineMetrics.avgCompletionTimeSec}s`,
                  cand: `${latestBenchmark.candidateMetrics.avgCompletionTimeSec}s`,
                  delta: `Δ ${(
                    latestBenchmark.candidateMetrics.avgCompletionTimeSec -
                    latestBenchmark.baselineMetrics.avgCompletionTimeSec
                  ).toFixed(1)}s`,
                  better:
                    latestBenchmark.candidateMetrics.avgCompletionTimeSec <=
                    latestBenchmark.baselineMetrics.avgCompletionTimeSec,
                },
                {
                  label: 'Avg Distance',
                  base: `${latestBenchmark.baselineMetrics.avgDistanceMeters}m`,
                  cand: `${latestBenchmark.candidateMetrics.avgDistanceMeters}m`,
                  delta: `Δ ${(
                    latestBenchmark.candidateMetrics.avgDistanceMeters -
                    latestBenchmark.baselineMetrics.avgDistanceMeters
                  ).toFixed(1)}m`,
                  better:
                    latestBenchmark.candidateMetrics.avgDistanceMeters <=
                    latestBenchmark.baselineMetrics.avgDistanceMeters,
                },
                {
                  label: 'Deadlocks',
                  base: String(latestBenchmark.baselineMetrics.totalDeadlocks),
                  cand: String(latestBenchmark.candidateMetrics.totalDeadlocks),
                  delta: `Δ ${
                    latestBenchmark.candidateMetrics.totalDeadlocks -
                    latestBenchmark.baselineMetrics.totalDeadlocks
                  }`,
                  better:
                    latestBenchmark.candidateMetrics.totalDeadlocks <=
                    latestBenchmark.baselineMetrics.totalDeadlocks,
                },
                {
                  label: 'Avg Wait Time',
                  base: `${latestBenchmark.baselineMetrics.avgWaitingTimeSec}s`,
                  cand: `${latestBenchmark.candidateMetrics.avgWaitingTimeSec}s`,
                  delta: `Δ ${(
                    latestBenchmark.candidateMetrics.avgWaitingTimeSec -
                    latestBenchmark.baselineMetrics.avgWaitingTimeSec
                  ).toFixed(1)}s`,
                  better:
                    latestBenchmark.candidateMetrics.avgWaitingTimeSec <=
                    latestBenchmark.baselineMetrics.avgWaitingTimeSec,
                },
                {
                  label: 'Global Replans',
                  base: `${latestBenchmark.baselineMetrics.avgGlobalReplans}/run`,
                  cand: `${latestBenchmark.candidateMetrics.avgGlobalReplans}/run`,
                  delta: `Δ ${(
                    latestBenchmark.candidateMetrics.avgGlobalReplans -
                    latestBenchmark.baselineMetrics.avgGlobalReplans
                  ).toFixed(1)}`,
                  better:
                    latestBenchmark.candidateMetrics.avgGlobalReplans <=
                    latestBenchmark.baselineMetrics.avgGlobalReplans,
                },
                {
                  label: 'Mean Reward',
                  base: `${latestBenchmark.baselineMetrics.avgReward}`,
                  cand: `${latestBenchmark.candidateMetrics.avgReward}`,
                  delta: `${
                    latestBenchmark.candidateMetrics.avgReward -
                      latestBenchmark.baselineMetrics.avgReward >=
                    0
                      ? '+'
                      : ''
                  }${(
                    latestBenchmark.candidateMetrics.avgReward -
                    latestBenchmark.baselineMetrics.avgReward
                  ).toFixed(1)}`,
                  better:
                    latestBenchmark.candidateMetrics.avgReward >=
                    latestBenchmark.baselineMetrics.avgReward,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col justify-between"
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
                    <div className="text-[10px] text-slate-400">{m.delta}</div>
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
        </>
      )}
    </div>
  );
};
