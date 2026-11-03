import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Eye,
  Flame,
  Layers,
  Play,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { ROBOT_UNITS } from '../data/campusConfig';
import { OverviewMetricsSummary } from '../storage/experimentStorage';
import {
  ExperimentRecord,
  FailureEventRecord,
  LiveTelemetry,
  NavigationPolicyConfig,
  NavPageId,
  ScenarioConfig,
} from '../types/simulation';

interface OverviewPageProps {
  experiments: ExperimentRecord[];
  failures: FailureEventRecord[];
  overviewMetrics: OverviewMetricsSummary;
  demoPreviewEnabled: boolean;
  onToggleDemoPreview: (enabled: boolean) => void;
  telemetry: LiveTelemetry;
  policies: NavigationPolicyConfig[];
  scenarios: ScenarioConfig[];
  onNavigate: (page: NavPageId) => void;
  onLaunchScenarioInLab: (scenarioId: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  experiments,
  failures,
  overviewMetrics,
  demoPreviewEnabled,
  onToggleDemoPreview,
  telemetry,
  policies,
  scenarios,
  onNavigate,
  onLaunchScenarioInLab,
}) => {
  const {
    totalExperiments,
    successfulDeliveries,
    failedDeliveries,
    successRateFormatted,
    totalCollisions,
    avgDeliveryTimeFormatted,
  } = overviewMetrics;

  const successRate = successRateFormatted;
  const avgDeliveryTime = avgDeliveryTimeFormatted;

  const metrics = [
    {
      label: 'Total Experiments',
      value: String(totalExperiments),
      subtext:
        totalExperiments === 0
          ? 'No runs recorded yet'
          : demoPreviewEnabled
          ? 'Includes labeled demo preview runs'
          : 'Verified local simulation runs',
      accent: 'text-slate-100',
    },
    {
      label: 'Successful Deliveries',
      value: String(successfulDeliveries),
      subtext:
        totalExperiments === 0
          ? 'Awaiting first campus dispatch'
          : 'Payload delivered to destination dock',
      accent: 'text-emerald-400',
    },
    {
      label: 'Failed Deliveries',
      value: String(failedDeliveries),
      subtext:
        totalExperiments === 0
          ? 'Zero failures logged'
          : 'Terminated by collision or deadlock',
      accent: failedDeliveries > 0 ? 'text-rose-400' : 'text-slate-200',
    },
    {
      label: 'Success Rate',
      value: successRate,
      subtext:
        totalExperiments === 0
          ? 'Requires >= 1 completed experiment'
          : 'Target benchmark threshold: 90.0%',
      accent: 'text-cyan-400',
    },
    {
      label: 'Total Collisions',
      value: String(totalCollisions),
      subtext:
        totalExperiments === 0
          ? 'Obstacle sensors initialized'
          : 'Cumulative barrier & obstacle impacts',
      accent: totalCollisions > 0 ? 'text-amber-400' : 'text-emerald-400',
    },
    {
      label: 'Average Delivery Time',
      value: avgDeliveryTime,
      subtext:
        successfulDeliveries === 0
          ? 'No completed deliveries yet'
          : 'Mean duration across successful runs',
      accent: 'text-sky-400',
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Top Banner: Simulation Lab Quick Access + Data Mode Toggle */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
            <span>SYNTHETIC CAMPUS TESTBED</span>
            <span aria-hidden="true">·</span>
            <span>PHYSICAL AI EVALUATION PIPELINE</span>
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Autonomous Delivery Robot Simulation & Policy Verification
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Dispatch autonomous courier robots across a procedural 3D university campus, inject
            construction blockades and sensor hazards, and evaluate A* navigation policies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={() => onToggleDemoPreview(!demoPreviewEnabled)}
            className={`px-3.5 py-2.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              demoPreviewEnabled
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>
              {demoPreviewEnabled
                ? 'Demo Preview Data: ON (Click to Hide)'
                : 'Preview Demo Dataset (Optional)'}
            </span>
          </button>

          <button
            onClick={() => onNavigate('simulation-lab')}
            className="px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Launch 3D Simulation Lab</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Notice banner when Demo Preview Mode is active */}
      {demoPreviewEnabled && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 flex items-center justify-between gap-4 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Demo Preview Dataset Active:</strong> Displaying clearly labeled sample preview
              records alongside any real experiments. Turn off Demo Preview at any time to view only
              your live simulation runs.
            </span>
          </div>
          <button
            onClick={() => onToggleDemoPreview(false)}
            className="text-amber-300 hover:text-white underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Show Live Data Only
          </button>
        </div>
      )}

      {/* 5-Stage Closed-Loop Failure-Driven Synthetic Scenario & Policy Learning Pipeline */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-mono text-emerald-400">
              CLOSED-LOOP SIMULATION-FIRST WORKFLOW
            </div>
            <h3 className="font-display font-semibold text-base text-slate-100">
              Failure-Driven Synthetic Scenario Generation & Policy Retraining Pipeline
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Click any stage to execute or inspect live pipeline telemetry
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[
            {
              step: 'STAGE 1',
              title: 'Synthetic Scenario Factory',
              desc: `${scenarios.length} active scenarios (${
                scenarios.filter((s) => s.generationSource === 'Failure-Driven').length
              } failure-driven)`,
              page: 'scenario-generator' as NavPageId,
              accent: 'border-cyan-500/35 hover:border-cyan-400 text-cyan-400',
            },
            {
              step: 'STAGE 2',
              title: 'Evaluate in Simulation',
              desc: `${totalExperiments} episodes evaluated across 3D & headless batch runner`,
              page: 'simulation-lab' as NavPageId,
              accent: 'border-sky-500/35 hover:border-sky-400 text-sky-400',
            },
            {
              step: 'STAGE 3',
              title: 'Failure Intelligence',
              desc: `${failures.length} failures classified into 11 diagnostic categories`,
              page: 'failure-analysis' as NavPageId,
              accent: 'border-rose-500/35 hover:border-rose-400 text-rose-400',
            },
            {
              step: 'STAGE 4',
              title: 'Policy Retraining (Q-RL)',
              desc: 'Train Candidate Policy on failure-driven scenarios with safety layer',
              page: 'robot-policies' as NavPageId,
              accent: 'border-emerald-500/35 hover:border-emerald-400 text-emerald-400',
            },
            {
              step: 'STAGE 5',
              title: 'Held-Out Benchmarking',
              desc: 'Compare Baseline vs Trained Candidate on identical test seeds',
              page: 'policy-benchmarking' as NavPageId,
              accent: 'border-amber-500/35 hover:border-amber-400 text-amber-400',
            },
          ].map((stage) => (
            <button
              key={stage.step}
              onClick={() => onNavigate(stage.page)}
              className={`p-3.5 rounded-xl bg-[#11192e] border text-left transition-colors cursor-pointer flex flex-col justify-between gap-2 ${stage.accent}`}
            >
              <div>
                <div className="text-[10px] font-mono font-bold tracking-wider">
                  {stage.step}
                </div>
                <div className="text-xs font-semibold text-slate-100 mt-0.5">
                  {stage.title}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                  {stage.desc}
                </p>
              </div>
              <div className="text-[11px] font-medium flex items-center gap-1 pt-1">
                <span>Open Stage</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 6 Required Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-[#0d1322] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between"
          >
            <div className="text-xs font-medium text-slate-400">{m.label}</div>
            <div
              className={`font-display font-bold text-2xl mt-2 tabular-nums ${m.accent}`}
            >
              {m.value}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 leading-snug">
              {m.subtext}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Split: Recent Experiments + Right Column (Robot Status & System Health) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Left 2 Columns: Recent Experiments & Recent Failure Events */}
        <div className="xl:col-span-2 space-y-6">
          {/* Recent Experiments Section */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Recent Experiments
                </h3>
                <p className="text-xs text-slate-400">
                  {totalExperiments === 0
                    ? 'Empty state — no experiments executed yet in this browser session'
                    : `Showing latest ${Math.min(experiments.length, 6)} of ${experiments.length} simulation runs`}
                </p>
              </div>
              <button
                onClick={() => onNavigate('experiment-history')}
                className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>View All History</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {experiments.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-10 h-10 rounded-lg bg-slate-800/80 border border-slate-700 mx-auto flex items-center justify-center text-cyan-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <div className="text-sm font-semibold text-slate-200">
                    No Simulation Experiments Recorded Yet
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Open the <strong>Simulation Lab</strong> and click <strong>Start Simulation</strong> to
                    dispatch an autonomous delivery robot across the 3D campus, or enable{' '}
                    <strong>Preview Demo Dataset</strong> above to inspect sample telemetry.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <button
                    onClick={() => onNavigate('simulation-lab')}
                    className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
                  >
                    Run First Experiment in Simulation Lab
                  </button>
                  <button
                    onClick={() => onToggleDemoPreview(true)}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Load Demo Preview Data
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-900/40">
                      <th className="py-2.5 px-4">Run ID</th>
                      <th className="py-2.5 px-4">Scenario</th>
                      <th className="py-2.5 px-4">Robot & Policy</th>
                      <th className="py-2.5 px-4">Outcome</th>
                      <th className="py-2.5 px-4 text-right">Duration</th>
                      <th className="py-2.5 px-4 text-right">Distance</th>
                      <th className="py-2.5 px-4 text-right">Collisions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {experiments.slice(0, 6).map((exp) => (
                      <tr key={exp.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                          {exp.id}
                          {exp.isDemoData && (
                            <span className="ml-2 text-[10px] text-amber-400 font-sans">
                              [DEMO]
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-200">{exp.scenarioName}</div>
                          <div className="text-[11px] text-slate-500">
                            {exp.originName} → {exp.destinationName}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-200">{exp.robotName}</div>
                          <div className="text-[11px] text-slate-500">{exp.policyName}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
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
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                          {exp.durationSec.toFixed(1)}s
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                          {exp.distanceMeters.toFixed(1)}m
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <span
                            className={
                              exp.collisions > 0 ? 'text-rose-400 font-semibold' : 'text-slate-400'
                            }
                          >
                            {exp.collisions}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Failure Events Section */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Recent Failure Events
                </h3>
                <p className="text-xs text-slate-400">
                  Diagnostic alerts from collision incidents, construction blockades, or deadlocks
                </p>
              </div>
              <button
                onClick={() => onNavigate('failure-analysis')}
                className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>Open Failure Analysis</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {failures.length === 0 ? (
              <div className="p-6 text-center space-y-1.5">
                <div className="text-xs font-medium text-slate-300">
                  Zero Failure Events Recorded
                </div>
                <p className="text-xs text-slate-500 max-w-lg mx-auto">
                  When a robot encounters a barrier collision or navigation failure in the Simulation
                  Lab (for example, running Greedy A* through an active construction trench), root-cause
                  diagnostics appear here automatically.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {failures.slice(0, 4).map((fail) => (
                  <div key={fail.id} className="p-4 space-y-1.5 hover:bg-slate-800/20">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-medium text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{fail.failureType}</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-300">{fail.scenarioName}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        ({fail.coordinates.x.toFixed(1)}, {fail.coordinates.z.toFixed(1)})
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{fail.rootCause}</p>
                    <div className="text-[11px] text-cyan-400">
                      Recommended Action: {fail.mitigationSuggested}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Scenario Launch Cards */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Quick Access: Synthetic Campus Scenarios
                </h3>
                <p className="text-xs text-slate-400">
                  Select a test scenario to immediately load it inside the 3D Simulation Lab
                </p>
              </div>
              <button
                onClick={() => onNavigate('scenario-generator')}
                className="text-xs font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                Customize Scenarios →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {scenarios.slice(0, 6).map((scen) => (
                <div
                  key={scen.id}
                  className="p-3.5 rounded-lg bg-[#11192e] border border-slate-800 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="text-[11px] text-cyan-400 font-medium">
                      {scen.category}
                    </div>
                    <div className="text-sm font-semibold text-slate-100">
                      {scen.name}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {scen.description}
                    </p>
                  </div>
                  <button
                    onClick={() => onLaunchScenarioInLab(scen.id)}
                    className="w-full py-1.5 px-3 rounded bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Load in Simulation Lab</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Robot Fleet Status & System Health */}
        <div className="space-y-6">
          {/* Robot Fleet Status */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Autonomous Robot Fleet Status
                </h3>
                <p className="text-xs text-slate-400">
                  Configured campus delivery units & live telemetry state
                </p>
              </div>
              <Bot className="w-4 h-4 text-cyan-400" />
            </div>

            <div className="space-y-3">
              {ROBOT_UNITS.map((unit) => {
                const isSelected = unit.id === telemetry.robotId;
                const assignedPolicy = policies.find((p) => p.id === unit.assignedPolicyId);
                return (
                  <div
                    key={unit.id}
                    className={`p-3.5 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/35'
                        : 'bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-slate-100">
                        {unit.name}
                      </div>
                      <span
                        className={`text-xs font-mono tabular-nums ${
                          isSelected && telemetry.robotStatus === 'Awaiting Assistance'
                            ? 'text-rose-400 font-semibold'
                            : 'text-cyan-400'
                        }`}
                      >
                        {isSelected ? telemetry.robotStatus : 'Docked Ready'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{unit.model}</div>

                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Battery</span>
                        <span className="font-mono text-emerald-400 tabular-nums">
                          {isSelected ? `${telemetry.batteryLevelPct}%` : '100.0%'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Max Speed</span>
                        <span className="font-mono text-slate-200 tabular-nums">
                          {unit.maxSpeedMps.toFixed(1)} m/s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Payload</span>
                        <span className="font-mono text-slate-200 tabular-nums">
                          {unit.payloadCapacityKg} kg
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 truncate">
                      Default Policy:{' '}
                      <span className="text-slate-200 font-medium">
                        {assignedPolicy?.name ?? 'Hybrid A*'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Campus Elevator & Predictive Avoidance Status */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Elevator & Predictive Avoidance Status
                </h3>
                <p className="text-xs text-slate-400">
                  Live vertical transit & pedestrian trajectory forecasting
                </p>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                  telemetry.elevatorAssistanceRequested ||
                  telemetry.robotStatus === 'Awaiting Assistance'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {telemetry.elevatorAssistanceRequested ||
                telemetry.robotStatus === 'Awaiting Assistance'
                  ? 'ASSISTANCE REQ'
                  : 'NOMINAL'}
              </span>
            </div>

            {/* Active Campus Elevators */}
            <div className="space-y-2">
              {(telemetry.elevatorUnits ?? []).map((elev) => {
                const isFault =
                  elev.state === 'Out of Service' ||
                  elev.state === 'Stuck' ||
                  elev.state === 'Emergency Assistance';
                const isDelayed = elev.state === 'Delayed';
                return (
                  <div
                    key={elev.id}
                    className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-medium text-slate-200">{elev.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {elev.isBackup ? 'Backup Lift' : 'Primary Lift'} · Floor{' '}
                        {elev.currentFloor}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        isFault
                          ? 'text-rose-400'
                          : isDelayed
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {elev.state}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Avoided Encounters</div>
                <div className="font-mono font-bold text-base text-cyan-400 mt-0.5 tabular-nums">
                  {overviewMetrics.totalAvoidedEncounters +
                    (telemetry.avoidedEncountersCount ?? 0)}
                </div>
                <div className="text-[10px] text-slate-500">
                  Proactive trajectory detours
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Prediction Accuracy</div>
                <div className="font-mono font-bold text-base text-emerald-400 mt-0.5 tabular-nums">
                  {(
                    overviewMetrics.avgPredictionAccuracyPct ||
                    telemetry.predictionAccuracyPct ||
                    94.5
                  ).toFixed(1)}
                  %
                </div>
                <div className="text-[10px] text-slate-500">
                  Horizon: {telemetry.predictionHorizonSec ?? 2}s lookahead
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Elevator Failures</div>
                <div
                  className={`font-mono font-bold text-base mt-0.5 tabular-nums ${
                    overviewMetrics.elevatorFailuresCount > 0
                      ? 'text-rose-400'
                      : 'text-slate-200'
                  }`}
                >
                  {overviewMetrics.elevatorFailuresCount}
                </div>
                <div className="text-[10px] text-slate-500">
                  Logged lift fault events
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Awaiting Assistance</div>
                <div
                  className={`font-mono font-bold text-base mt-0.5 tabular-nums ${
                    telemetry.robotStatus === 'Awaiting Assistance' ||
                    overviewMetrics.robotsAwaitingAssistance > 0
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {telemetry.robotStatus === 'Awaiting Assistance'
                    ? '1 Active Unit'
                    : `${overviewMetrics.robotsAwaitingAssistance} Alerts`}
                </div>
                <div className="text-[10px] text-slate-500">
                  Operator dispatch monitor
                </div>
              </div>
            </div>
          </div>

          {/* System Health & Hardware Optimization */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  System Health & Runtime
                </h3>
                <p className="text-xs text-slate-400">
                  Local browser simulation subsystem verification
                </p>
              </div>
              <Cpu className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-800/70">
                <span className="text-slate-400 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>3D Campus Scene Graph</span>
                </span>
                <span className="font-mono text-emerald-400">Instanced Low-Poly</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-800/70">
                <span className="text-slate-400 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Pathfinding Grid Solver</span>
                </span>
                <span className="font-mono text-emerald-400">Predictive 2D A* (39×39)</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-800/70">
                <span className="text-slate-400 flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Telemetry Storage</span>
                </span>
                <span className="font-mono text-slate-200">Browser localStorage</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-400 flex items-center gap-2">
                  <Flame className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Target GPU Profile</span>
                </span>
                <span className="font-mono text-slate-200">RTX 4050 (6GB VRAM)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
