import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Eye,
  Flame,
  Play,
  ShieldAlert,
  Target,
  Wrench,
} from 'lucide-react';
import { CAMPUS_ELEVATORS, CONSTRUCTION_ZONES } from '../data/campusConfig';
import { generateFailureDrivenScenarios } from '../simulation/scenarioFactory';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  FailureCategory,
  FailureEventRecord,
  NavPageId,
} from '../types/simulation';

interface FailureAnalysisPageProps {
  failures: FailureEventRecord[];
  demoPreviewEnabled: boolean;
  onToggleDemoPreview: (enabled: boolean) => void;
  onApplyRecommendedMitigation: (policyId: string) => void;
  onNavigate: (page: NavPageId) => void;
}

const ALL_FAILURE_CATEGORIES: FailureCategory[] = [
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

export const FailureAnalysisPage: React.FC<FailureAnalysisPageProps> = ({
  failures,
  demoPreviewEnabled,
  onToggleDemoPreview,
  onApplyRecommendedMitigation,
  onNavigate,
}) => {
  const {
    experiments,
    scenarios,
    failureDiagnoses,
    weaknessClusters,
    addCustomScenariosBatch,
    recordFailureDrivenBatch,
  } = useExperimentStore();

  const [selectedCategory, setSelectedCategory] = useState<'ALL' | FailureCategory>('ALL');
  const [generatedNotice, setGeneratedNotice] = useState<string | null>(null);

  const filteredDiagnoses = useMemo(() => {
    if (selectedCategory === 'ALL') return failureDiagnoses;
    return failureDiagnoses.filter((d) => d.failureCategory === selectedCategory);
  }, [failureDiagnoses, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<FailureCategory, number>();
    for (const c of ALL_FAILURE_CATEGORIES) counts.set(c, 0);
    for (const d of failureDiagnoses) {
      counts.set(d.failureCategory, (counts.get(d.failureCategory) ?? 0) + 1);
    }
    return counts;
  }, [failureDiagnoses]);

  const handleSynthesizeTargetedScenarios = () => {
    const batch = generateFailureDrivenScenarios(
      experiments,
      scenarios,
      2,
      Math.floor(Date.now() % 9000) + 1000
    );
    addCustomScenariosBatch(batch.generatedScenarios);
    recordFailureDrivenBatch(batch);
    setGeneratedNotice(
      `Synthesized ${batch.generatedScenarios.length} Failure-Driven Scenarios targeting [${batch.weaknessesDiscovered
        .map((w) => w.category)
        .join(', ')}] and added to Synthetic Scenario Factory.`
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-rose-400">
            FAILURE INTELLIGENCE · AUTOMATED 11-CATEGORY TAXONOMY & ROOT-CAUSE EVIDENCE
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Automated Failure Intelligence & Weakness Diagnostics
          </h2>
          <p className="text-sm text-slate-400">
            Classifies actual simulation failures into 11 diagnostic categories, strictly
            distinguishing physical collisions from safe stops, mission timeouts, and unreachable
            routes, and closes the loop by generating targeted retraining scenarios.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={() => onToggleDemoPreview(!demoPreviewEnabled)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
              demoPreviewEnabled
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>
              {demoPreviewEnabled ? 'Demo Failure Data: ON' : 'Preview Sample Failure'}
            </span>
          </button>

          <button
            onClick={handleSynthesizeTargetedScenarios}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Synthesize Failure-Driven Scenarios</span>
          </button>

          <button
            onClick={() => onNavigate('robot-policies')}
            className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Retrain Policy on Failures</span>
          </button>
        </div>
      </div>

      {generatedNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{generatedNotice}</span>
          </div>
          <div className="flex items-center gap-3 ml-4 shrink-0">
            <button
              onClick={() => onNavigate('scenario-generator')}
              className="text-cyan-300 hover:text-white underline cursor-pointer"
            >
              Open Scenario Factory →
            </button>
            <button
              onClick={() => setGeneratedNotice(null)}
              className="text-emerald-200 hover:text-white underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 11 Failure Category Taxonomy Filter Bar */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-300">
            11-Category Failure Intelligence Taxonomy (Click to Filter)
          </span>
          <span className="font-mono text-slate-400">
            Showing {filteredDiagnoses.length} of {failureDiagnoses.length} Diagnosed Failure
            Records
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            All Categories ({failureDiagnoses.length})
          </button>
          {ALL_FAILURE_CATEGORIES.map((cat) => {
            const count = categoryCounts.get(cat) ?? 0;
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  active
                    ? 'bg-rose-500 text-white border-rose-400 font-semibold'
                    : count > 0
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20'
                    : 'bg-slate-900/60 text-slate-500 border-slate-800/80 hover:text-slate-300'
                }`}
              >
                <span>{cat}</span>
                <span className="ml-1.5 font-mono text-[11px]">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Left 7 Cols (10-Field Diagnostic Cards) + Right 5 Cols (Weakness Clusters & 2D Hazard Map) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Automated 10-Field Failure Diagnoses ({filteredDiagnoses.length})
                </h3>
                <p className="text-xs text-slate-400">
                  Strictly distinguishes Actual Collisions from Safe Stops, Timeouts, and Failed
                  Deliveries
                </p>
              </div>
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            </div>

            {filteredDiagnoses.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <div className="text-sm font-semibold text-slate-200">
                    No Failure Records in Selected Category
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Run a Headless Batch in the <strong>Synthetic Scenario Factory</strong> or test
                    a stress scenario in the <strong>Simulation Lab</strong> to populate live
                    failure diagnostics.
                  </p>
                </div>
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => onNavigate('scenario-generator')}
                    className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
                  >
                    Open Synthetic Scenario Factory
                  </button>
                  <button
                    onClick={() => onToggleDemoPreview(true)}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Preview Sample Failure Record
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredDiagnoses.map((d) => {
                  const isCollision = d.outcomeDistinction === 'Actual Collision';
                  const isSafeStop = d.outcomeDistinction === 'Safe Stop (Blocked/Fault)';
                  return (
                    <div key={d.id} className="p-5 space-y-3.5">
                      {/* Top Header: Fields 1, 2, 3, 4 + Outcome Distinction */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-rose-400 font-semibold">
                            1. Exp: {d.experimentId}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-slate-300">
                            2. Scenario: {d.scenarioId}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-cyan-400">
                            3. Policy v{d.policyVersion} ({d.policyName})
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                            isCollision
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                              : isSafeStop
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          }`}
                        >
                          {d.outcomeDistinction}
                        </span>
                      </div>

                      {/* Field 4: Failure Category */}
                      <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="text-slate-500 text-[11px] block">
                            4. Automated Failure Category
                          </span>
                          <span className="font-display font-semibold text-sm text-rose-300">
                            {d.failureCategory}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 text-[11px] block">
                            Scenario & Coordinates
                          </span>
                          <span className="font-mono text-slate-200">
                            {d.scenarioName} · ({d.coordinates.x.toFixed(1)}m,{' '}
                            {d.coordinates.z.toFixed(1)}m)
                          </span>
                        </div>
                      </div>

                      {/* Fields 5, 6, 7: Environmental Conditions, Robot State Before Failure, Actions Taken */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                        <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                          <span className="text-[11px] font-semibold text-cyan-400 block mb-1">
                            5. Environmental Conditions
                          </span>
                          <p className="text-slate-300 text-[11px] leading-relaxed">
                            {d.environmentalConditions}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                          <span className="text-[11px] font-semibold text-amber-400 block mb-1">
                            6. Robot State Before Failure
                          </span>
                          <p className="text-slate-300 text-[11px] leading-relaxed">
                            {d.robotStateBeforeFailure}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                          <span className="text-[11px] font-semibold text-purple-300 block mb-1">
                            7. Actions Taken by Robot
                          </span>
                          <p className="text-slate-300 text-[11px] leading-relaxed">
                            {d.actionsTaken}
                          </p>
                        </div>
                      </div>

                      {/* Fields 8 & 9: Probable Root Cause & Supporting Evidence */}
                      <div className="space-y-2 text-xs bg-slate-900/40 border border-slate-800/70 rounded-lg p-3">
                        <div>
                          <span className="font-semibold text-slate-200">
                            8. Probable Root Cause:{' '}
                          </span>
                          <span className="text-slate-300">{d.probableRootCause}</span>
                        </div>
                        <div className="border-t border-slate-800/80 pt-1.5">
                          <span className="font-semibold text-slate-200">
                            9. Supporting Telemetry Evidence:{' '}
                          </span>
                          <span className="font-mono text-[11px] text-amber-300">
                            {d.supportingEvidence}
                          </span>
                        </div>
                      </div>

                      {/* Field 10: Suggested Improvement */}
                      <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-800/70">
                        <div className="text-xs text-cyan-300 flex items-start gap-1.5">
                          <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                          <span>
                            <strong>10. Suggested Improvement:</strong> {d.suggestedImprovement}
                          </span>
                        </div>
                        <button
                          onClick={() => onApplyRecommendedMitigation('pol-candidate-rl')}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500 hover:text-slate-950 text-cyan-300 border border-cyan-500/40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <span>Activate Candidate Policy</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Weakness Cluster Intelligence + 2D Campus Hazard & Incident Map */}
        <div className="xl:col-span-5 space-y-6">
          {/* Discovered Weakness Clusters Panel */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Weakness Cluster Analysis
                </h3>
                <p className="text-xs text-slate-400">
                  Aggregated failure & suboptimal performance patterns driving scenario generation
                </p>
              </div>
              <Target className="w-4 h-4 text-amber-400" />
            </div>

            {weaknessClusters.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
                No failure or high-delay clusters detected in current history. Run batch evaluations
                to identify policy bottlenecks.
              </div>
            ) : (
              <div className="space-y-2.5">
                {weaknessClusters.map((w) => (
                  <div
                    key={w.category}
                    className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-rose-300">{w.category}</span>
                      <span className="font-mono text-amber-400">
                        {w.failureCount} runs ({w.shareOfFailuresPct}%)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{w.evidenceSummary}</p>
                    <div className="text-[11px] text-cyan-300">
                      Recommended Action: {w.recommendedMutationStrategy}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2D Campus Hazard & Failure Coordinate Plot */}
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  2D Campus Hazard & Incident Map
                </h3>
                <p className="text-xs text-slate-400">
                  Top-down spatial projection (-40m to +40m campus coordinate frame)
                </p>
              </div>
              <Compass className="w-4 h-4 text-cyan-400" />
            </div>

            <div className="w-full aspect-square bg-[#080d1a] border border-slate-800 rounded-lg p-3 relative">
              <svg viewBox="-42 -42 84 84" className="w-full h-full">
                {/* Grid lines */}
                {[-30, -15, 0, 15, 30].map((g) => (
                  <g key={g}>
                    <line
                      x1={-40}
                      y1={g}
                      x2={40}
                      y2={g}
                      stroke="#1e293b"
                      strokeWidth="0.3"
                    />
                    <line
                      x1={g}
                      y1={-40}
                      x2={g}
                      y2={40}
                      stroke="#1e293b"
                      strokeWidth="0.3"
                    />
                  </g>
                ))}

                {/* Main Roads */}
                <rect x={-38} y={-3.5} width={76} height={7} fill="#1e293b" opacity={0.7} />
                <rect x={-3.5} y={-38} width={7} height={76} fill="#1e293b" opacity={0.7} />

                {/* Construction Zones */}
                {CONSTRUCTION_ZONES.map((cz) => (
                  <g key={cz.id}>
                    <rect
                      x={cz.position[0] - cz.size[0] / 2}
                      y={cz.position[2] - cz.size[1] / 2}
                      width={cz.size[0]}
                      height={cz.size[1]}
                      fill="#f59e0b"
                      fillOpacity={0.25}
                      stroke="#f59e0b"
                      strokeWidth="0.5"
                    />
                  </g>
                ))}

                {/* Campus Elevator Towers */}
                {CAMPUS_ELEVATORS.map((elev) => (
                  <g key={elev.id}>
                    <rect
                      x={elev.position.x - 1.8}
                      y={elev.position.z - 1.8}
                      width={3.6}
                      height={3.6}
                      fill="#38bdf8"
                      fillOpacity={0.3}
                      stroke="#38bdf8"
                      strokeWidth="0.5"
                    />
                  </g>
                ))}

                {/* Failure Incident Markers */}
                {failures.map((f) => (
                  <g key={f.id}>
                    <circle
                      cx={f.coordinates.x}
                      cy={f.coordinates.z}
                      r={2.8}
                      fill="#ef4444"
                      fillOpacity={0.35}
                    />
                    <circle
                      cx={f.coordinates.x}
                      cy={f.coordinates.z}
                      r={1.3}
                      fill="#ef4444"
                    />
                  </g>
                ))}
              </svg>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
              <span>Amber: Construction</span>
              <span className="text-sky-400">Cyan Squares: Campus Elevators</span>
              <span className="text-rose-400">Red Markers: Logged Incidents</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
