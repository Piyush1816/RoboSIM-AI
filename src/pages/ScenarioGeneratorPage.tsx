import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Dices,
  Flame,
  Layers,
  Play,
  Plus,
  Sliders,
  Sparkles,
  Square,
  Target,
  Zap,
} from 'lucide-react';
import {
  CONSTRUCTION_ZONES,
  DELIVERY_LOCATIONS,
} from '../data/campusConfig';
import { runHeadlessBatchExperiments } from '../simulation/batchRunner';
import {
  computeScenarioDifficulty,
  generateFailureDrivenScenarios,
  generateRandomSyntheticScenarios,
  validateScenarioGeometry,
} from '../simulation/scenarioFactory';
import { useExperimentStore } from '../storage/ExperimentContext';
import {
  DatasetSplit,
  ElevatorFaultMode,
  ExperimentRecord,
  NavPageId,
  PredictionHorizonSec,
  ScenarioConfig,
  ScenarioDifficulty,
  ScenarioGenerationSource,
} from '../types/simulation';

interface ScenarioGeneratorPageProps {
  scenarios: ScenarioConfig[];
  activeScenarioId: string;
  onCreateScenario: (scenario: ScenarioConfig) => void;
  onLaunchScenarioInLab: (scenarioId: string) => void;
  onNavigate?: (page: NavPageId) => void;
}

type GeneratorTabMode = 'Failure-Driven' | 'Random' | 'Custom' | 'Preset';

export const ScenarioGeneratorPage: React.FC<ScenarioGeneratorPageProps> = ({
  scenarios,
  activeScenarioId,
  onCreateScenario,
  onLaunchScenarioInLab,
  onNavigate,
}) => {
  const {
    experiments,
    policies,
    candidatePolicyState,
    weaknessClusters,
    failureDrivenBatches,
    addCustomScenariosBatch,
    recordExperimentsBatch,
    recordFailureDrivenBatch,
  } = useExperimentStore();

  const [activeTab, setActiveTab] = useState<GeneratorTabMode>('Failure-Driven');
  const [sourceFilter, setSourceFilter] = useState<
    'ALL' | 'Normal' | 'Training' | 'Testing' | 'Failure-Driven' | ScenarioGenerationSource
  >('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'default' | 'diff-desc' | 'diff-asc' | 'name'>('default');
  const [createdBanner, setCreatedBanner] = useState<string | null>(null);

  // Random Generator state
  const [randomCountToGen, setRandomCountToGen] = useState<number>(4);
  const [randomBaseSeed, setRandomBaseSeed] = useState<number>(4040);
  const [randomDiffPref, setRandomDiffPref] = useState<'Mixed' | ScenarioDifficulty>('Mixed');
  const [includeElevFaults, setIncludeElevFaults] = useState<boolean>(true);
  const [includeBatConstraints, setIncludeBatConstraints] = useState<boolean>(true);

  // Failure-Driven Generator state
  const [fdCountPerWeakness, setFdCountPerWeakness] = useState<number>(2);
  const [fdBaseSeed, setFdBaseSeed] = useState<number>(8080);

  // Custom Scenario Builder state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ScenarioConfig['category']>('Construction Detour');
  const [description, setDescription] = useState('');
  const [originId, setOriginId] = useState('loc-eng-dock');
  const [destinationId, setDestinationId] = useState('loc-hostel-a');
  const [selectedZones, setSelectedZones] = useState<string[]>(['cz-central-east']);
  const [commuterCount, setCommuterCount] = useState(2);
  const [randomCount, setRandomCount] = useState(1);
  const [crossingCount, setCrossingCount] = useState(2);
  const [groupCount, setGroupCount] = useState(1);
  const [customSeed, setCustomSeed] = useState(909);
  const [predictionHorizonSec, setPredictionHorizonSec] = useState<PredictionHorizonSec>(2);
  const [requiresElevator, setRequiresElevator] = useState(false);
  const [elevatorFaultMode, setElevatorFaultMode] = useState<ElevatorFaultMode>('none');
  const [surfaceTraction, setSurfaceTraction] = useState(0.88);
  const [sensorNoise, setSensorNoise] = useState(0.14);
  const [initialBatteryPct, setInitialBatteryPct] = useState(98);
  const [datasetSplit, setDatasetSplit] = useState<DatasetSplit>('train');
  const [recommendedPolicyId, setRecommendedPolicyId] = useState('pol-candidate-rl');

  // Headless Batch Experiment Runner state
  const [selectedBatchScenarioIds, setSelectedBatchScenarioIds] = useState<string[]>(() =>
    scenarios.slice(0, 5).map((s) => s.id)
  );
  const [batchPolicyId, setBatchPolicyId] = useState<string>('pol-hybrid-safe');
  const [episodesPerScenario, setEpisodesPerScenario] = useState<number>(1);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [lastBatchResults, setLastBatchResults] = useState<ExperimentRecord[] | null>(null);
  const cancelBatchRef = useRef<boolean>(false);

  const dynamicObstacles = commuterCount + randomCount + crossingCount + groupCount;

  const filteredScenarios = useMemo(() => {
    const diffRank: Record<string, number> = {
      Low: 1,
      Moderate: 2,
      High: 3,
      Extreme: 4,
    };
    const q = searchQuery.trim().toLowerCase();
    const list = scenarios.filter((s) => {
      if (sourceFilter === 'Normal') {
        if (s.isCustom || (s.elevatorFaultMode ?? 'none') !== 'none') return false;
      } else if (sourceFilter === 'Training') {
        if ((s.datasetSplit ?? 'train') !== 'train') return false;
      } else if (sourceFilter === 'Testing') {
        if (s.datasetSplit !== 'test') return false;
      } else if (sourceFilter !== 'ALL') {
        if ((s.generationSource ?? 'Preset') !== sourceFilter) return false;
      }

      if (q) {
        const hay = `${s.name} ${s.category} ${s.description} ${s.targetedFailureCategory ?? ''} ${s.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'diff-desc') {
      return [...list].sort(
        (a, b) =>
          (diffRank[b.difficulty ?? 'Moderate'] ?? 2) -
          (diffRank[a.difficulty ?? 'Moderate'] ?? 2)
      );
    }
    if (sortBy === 'diff-asc') {
      return [...list].sort(
        (a, b) =>
          (diffRank[a.difficulty ?? 'Moderate'] ?? 2) -
          (diffRank[b.difficulty ?? 'Moderate'] ?? 2)
      );
    }
    if (sortBy === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [scenarios, sourceFilter, searchQuery, sortBy]);

  const handleToggleZone = (zoneId: string) => {
    setSelectedZones((prev) =>
      prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]
    );
  };

  const handleGenerateRandomBatch = () => {
    const newBatch = generateRandomSyntheticScenarios(
      {
        count: randomCountToGen,
        baseSeed: randomBaseSeed,
        difficultyPreference: randomDiffPref,
        includeElevatorFaults: includeElevFaults,
        includeBatteryConstraints: includeBatConstraints,
        datasetSplitMode: 'balanced',
      },
      scenarios.length
    );
    addCustomScenariosBatch(newBatch);
    setSelectedBatchScenarioIds((prev) => [
      ...new Set([...prev, ...newBatch.map((s) => s.id)]),
    ]);
    setRandomBaseSeed((s) => s + randomCountToGen * 100);
    setCreatedBanner(
      `Generated ${newBatch.length} geometrically validated Random Synthetic Scenarios (Seeds ${newBatch[0]?.randomSeed}–${newBatch[newBatch.length - 1]?.randomSeed}).`
    );
  };

  const handleGenerateFailureDrivenBatch = () => {
    const batch = generateFailureDrivenScenarios(
      experiments,
      scenarios,
      fdCountPerWeakness,
      fdBaseSeed
    );
    addCustomScenariosBatch(batch.generatedScenarios);
    recordFailureDrivenBatch(batch);
    setSelectedBatchScenarioIds((prev) => [
      ...new Set([...prev, ...batch.generatedScenarios.map((s) => s.id)]),
    ]);
    setFdBaseSeed((s) => s + 500);
    setCreatedBanner(
      `Generated ${batch.generatedScenarios.length} Failure-Driven Targeted Scenarios addressing ${batch.weaknessesDiscovered.length} discovered policy weakness cluster(s).`
    );
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim() || `Custom Synthetic Scenario #${scenarios.length + 1}`;
    const diff = computeScenarioDifficulty(
      dynamicObstacles,
      selectedZones.length,
      sensorNoise,
      surfaceTraction,
      requiresElevator || category === 'Elevator Recovery',
      initialBatteryPct
    );
    const cleanDesc =
      description.trim() ||
      `Custom ${diff.toLowerCase()}-difficulty synthetic scenario (Seed ${customSeed}) with ${selectedZones.length} active construction zones, ${dynamicObstacles} pedestrians (${commuterCount}C/${randomCount}R/${crossingCount}X/${groupCount}G), and ${initialBatteryPct}% initial battery.`;

    const newScenario: ScenarioConfig = {
      id: `scen-custom-${customSeed}-${Date.now().toString().slice(-4)}`,
      name: cleanName,
      category,
      description: cleanDesc,
      originId,
      destinationId,
      activeConstructionZones: selectedZones,
      dynamicObstacleCount: dynamicObstacles,
      pedestrianDistribution: {
        commuterCount,
        randomCount,
        crossingCount,
        groupCount,
        randomSeed: customSeed,
      },
      predictionHorizonSec,
      requiresElevator: requiresElevator || category === 'Elevator Recovery',
      primaryElevatorId: 'elev-north-main',
      backupElevatorId: 'elev-east-backup',
      elevatorFaultMode:
        requiresElevator || category === 'Elevator Recovery'
          ? elevatorFaultMode
          : 'none',
      elevatorTimeoutSec: 3.2,
      surfaceTraction,
      sensorNoiseLevel: sensorNoise,
      batteryDrainMultiplier: Number(
        (1 + (1 - surfaceTraction) + sensorNoise).toFixed(2)
      ),
      initialBatteryPct,
      randomSeed: customSeed,
      difficulty: diff,
      generationSource: 'Custom',
      datasetSplit,
      generationReason: 'User-authored custom synthetic scenario.',
      recommendedPolicyId,
      isCustom: true,
    };

    onCreateScenario(newScenario);
    setSelectedBatchScenarioIds((prev) => [...new Set([...prev, newScenario.id])]);
    setCreatedBanner(
      `Saved custom scenario "${newScenario.name}" (Seed ${customSeed}, ${diff} difficulty).`
    );
    setName('');
    setDescription('');
    setCustomSeed((s) => s + 11);
  };

  const handleToggleBatchScenario = (id: string) => {
    setSelectedBatchScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleRunHeadlessBatch = async () => {
    const selectedScens = scenarios.filter((s) =>
      selectedBatchScenarioIds.includes(s.id)
    );
    if (selectedScens.length === 0) return;

    const chosenPol =
      policies.find((p) => p.id === batchPolicyId) ?? policies[0];

    setIsBatchRunning(true);
    cancelBatchRef.current = false;
    const total = selectedScens.length * episodesPerScenario;
    setBatchProgress({ completed: 0, total });
    setLastBatchResults(null);

    const batchRecords: ExperimentRecord[] = [];
    await runHeadlessBatchExperiments({
      scenarios: selectedScens,
      policy: chosenPol,
      robotId: 'bot-rover-01',
      episodesPerScenario,
      candidatePolicyState: chosenPol.isCandidatePolicy
        ? candidatePolicyState
        : null,
      onEpisodeFinished: (rec, completed, tot) => {
        batchRecords.push(rec);
        setBatchProgress({ completed, total: tot });
      },
      shouldCancel: () => cancelBatchRef.current,
    });

    const saved = recordExperimentsBatch(batchRecords);
    setLastBatchResults(saved);
    setIsBatchRunning(false);
  };

  const latestFdBatch = failureDrivenBatches[0] ?? null;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Top Header Banner */}
      <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-medium text-cyan-400 flex items-center gap-2">
            <span>SYNTHETIC SCENARIO FACTORY</span>
            <span>·</span>
            <span>HEADLESS BATCH RUNNER</span>
            <span>·</span>
            <span>FAILURE-DRIVEN MUTATION</span>
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Synthetic Scenario Factory & Batch Policy Evaluation
          </h2>
          <p className="text-sm text-slate-400">
            Generate deterministically seeded synthetic scenarios across 4 modes (
            <strong>Preset</strong>, <strong>Random</strong>, <strong>Custom</strong>, and{' '}
            <strong>Failure-Driven</strong>) and evaluate policies at scale with the headless batch
            simulation runner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {(
            [
              { id: 'Failure-Driven', label: 'Failure-Driven', icon: Target },
              { id: 'Random', label: 'Random Factory', icon: Dices },
              { id: 'Custom', label: 'Custom Builder', icon: Sliders },
              { id: 'Preset', label: 'Preset Info', icon: Layers },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                  active
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {createdBanner && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{createdBanner}</span>
          </div>
          <button
            onClick={() => setCreatedBanner(null)}
            className="text-emerald-200 hover:text-white underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split: Left 5 Cols (Active Generator Mode + Headless Batch Runner) | Right 7 Cols (Scenario Catalog) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 space-y-6">
          {/* MODE 1: FAILURE-DRIVEN SCENARIO GENERATION (Section 6) */}
          {activeTab === 'Failure-Driven' && (
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <div className="text-[11px] font-mono text-amber-400">
                    CLOSED-LOOP WEAKNESS TARGETING
                  </div>
                  <h3 className="font-display font-semibold text-base text-slate-100">
                    Failure-Driven Scenario Generator
                  </h3>
                  <p className="text-xs text-slate-400">
                    Automatically synthesizes new high-risk scenarios targeting the weakest
                    categories discovered in Experiment History.
                  </p>
                </div>
                <Target className="w-5 h-5 text-amber-400 shrink-0" />
              </div>

              {/* Discovered Weaknesses List */}
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>Weaknesses Discovered from Experiment History</span>
                  <span className="font-mono text-[11px] text-cyan-400">
                    {weaknessClusters.length > 0
                      ? `${weaknessClusters.length} Clusters Active`
                      : 'Baseline Diagnostic Ready'}
                  </span>
                </div>

                {weaknessClusters.length === 0 ? (
                  <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                    <div className="font-medium text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>No Recorded Failures Yet — Using Baseline Risk Profile</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Run a Headless Batch below or click{' '}
                      <strong>Generate Failure-Driven Scenarios</strong> now to synthesize targeted
                      pedestrian-surge and global-replanning stress scenarios.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {weaknessClusters.slice(0, 4).map((w) => (
                      <div
                        key={w.category}
                        className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-rose-300">{w.category}</span>
                          <span className="font-mono text-[11px] text-amber-400">
                            {w.failureCount} incidents ({w.shareOfFailuresPct}%)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">{w.evidenceSummary}</div>
                        <div className="text-[11px] text-cyan-300">
                          Mutation: {w.recommendedMutationStrategy}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Scenarios per Weakness
                  </label>
                  <select
                    value={fdCountPerWeakness}
                    onChange={(e) => setFdCountPerWeakness(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    <option value={1}>1 Scenario / Weakness</option>
                    <option value={2}>2 Scenarios / Weakness (Mod + High)</option>
                    <option value={3}>3 Scenarios / Weakness (Mod → Extreme)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Deterministic Base Seed
                  </label>
                  <input
                    type="number"
                    value={fdBaseSeed}
                    onChange={(e) => setFdBaseSeed(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-slate-100"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateFailureDrivenBatch}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Flame className="w-4 h-4" />
                <span>Generate Targeted Failure-Driven Scenarios</span>
              </button>

              {/* Latest Failure-Driven Generation Report (Section 6 Required Display) */}
              {latestFdBatch && (
                <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-semibold text-amber-200">
                    <span>Latest Failure-Driven Synthesis Report</span>
                    <span className="font-mono text-[11px]">{latestFdBatch.timestamp}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                    <div>
                      <span className="text-slate-400 block">Weaknesses Targeted:</span>
                      <span className="font-medium text-white">
                        {latestFdBatch.weaknessesDiscovered.map((w) => w.category).join(', ')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Scenarios Generated:</span>
                      <span className="font-mono text-emerald-400">
                        {latestFdBatch.generatedScenarios.length} Targeted Scenarios (Mod → Extreme)
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-300 border-t border-amber-500/20 pt-1.5">
                    <strong>Evidence:</strong>{' '}
                    {latestFdBatch.weaknessesDiscovered[0]?.evidenceSummary}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE 2: RANDOM SYNTHETIC SCENARIO GENERATOR */}
          {activeTab === 'Random' && (
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <div className="text-[11px] font-mono text-cyan-400">
                    PROCEDURAL DOMAIN RANDOMIZATION
                  </div>
                  <h3 className="font-display font-semibold text-base text-slate-100">
                    Random Synthetic Scenario Factory
                  </h3>
                  <p className="text-xs text-slate-400">
                    Sample deterministically seeded scenarios across campus routes, crowd mixes,
                    fog, traction, and battery reserves.
                  </p>
                </div>
                <Dices className="w-5 h-5 text-cyan-400 shrink-0" />
              </div>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Number of Scenarios
                    </label>
                    <select
                      value={randomCountToGen}
                      onChange={(e) => setRandomCountToGen(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                    >
                      <option value={2}>2 Scenarios</option>
                      <option value={4}>4 Scenarios</option>
                      <option value={6}>6 Scenarios</option>
                      <option value={8}>8 Scenarios</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Random Seed
                    </label>
                    <input
                      type="number"
                      value={randomBaseSeed}
                      onChange={(e) => setRandomBaseSeed(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Difficulty Distribution
                  </label>
                  <select
                    value={randomDiffPref}
                    onChange={(e) =>
                      setRandomDiffPref(e.target.value as 'Mixed' | ScenarioDifficulty)
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    <option value="Mixed">Mixed Difficulty (Low → Extreme)</option>
                    <option value="Low">Low Difficulty (Nominal / Light Traffic)</option>
                    <option value="Moderate">Moderate Difficulty (Single Detour + Traffic)</option>
                    <option value="High">High Difficulty (Congestion + Noise)</option>
                    <option value="Extreme">Extreme Stress (Multi-Hazard Compound)</option>
                  </select>
                </div>

                <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 cursor-pointer">
                  <span className="text-slate-200">
                    Include Multi-Floor Elevator Fault Variations
                  </span>
                  <input
                    type="checkbox"
                    checked={includeElevFaults}
                    onChange={(e) => setIncludeElevFaults(e.target.checked)}
                    className="accent-cyan-500"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 cursor-pointer">
                  <span className="text-slate-200">
                    Include Constrained Initial Battery Scenarios (24–38%)
                  </span>
                  <input
                    type="checkbox"
                    checked={includeBatConstraints}
                    onChange={(e) => setIncludeBatConstraints(e.target.checked)}
                    className="accent-cyan-500"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleGenerateRandomBatch}
                  className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate {randomCountToGen} Random Synthetic Scenarios</span>
                </button>
              </div>
            </div>
          )}

          {/* MODE 3: CUSTOM SCENARIO BUILDER */}
          {activeTab === 'Custom' && (
            <form
              onSubmit={handleCustomSubmit}
              className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-3.5"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-display font-semibold text-base text-slate-100">
                    Custom Synthetic Scenario Builder
                  </h3>
                  <p className="text-xs text-slate-400">
                    Author exact hazard combinations, seed, battery & dataset split
                  </p>
                </div>
                <Sliders className="w-4 h-4 text-cyan-400" />
              </div>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-slate-300 font-medium mb-1">
                      Scenario Title
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Dusk Fog Pedestrian Bottleneck"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Random Seed
                    </label>
                    <input
                      type="number"
                      value={customSeed}
                      onChange={(e) => setCustomSeed(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Hazard Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as ScenarioConfig['category'])
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      <option value="Nominal">Nominal</option>
                      <option value="Construction Detour">Construction Detour</option>
                      <option value="High Congestion">High Congestion</option>
                      <option value="Low Visibility">Low Visibility</option>
                      <option value="Multi-Failure Stress">Multi-Failure Stress</option>
                      <option value="Elevator Recovery">Elevator Recovery</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Dataset Split
                    </label>
                    <select
                      value={datasetSplit}
                      onChange={(e) => setDatasetSplit(e.target.value as DatasetSplit)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      <option value="train">Training Split (TRAIN)</option>
                      <option value="test">Held-Out Benchmark Split (TEST)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Origin Dock
                    </label>
                    <select
                      value={originId}
                      onChange={(e) => setOriginId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      {DELIVERY_LOCATIONS.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Target Destination
                    </label>
                    <select
                      value={destinationId}
                      onChange={(e) => setDestinationId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      {DELIVERY_LOCATIONS.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 4-Class Pedestrian Distribution */}
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-200">
                      Pedestrian Classes (Commuter / Random / Crossing / Group)
                    </span>
                    <span className="font-mono text-cyan-400">{dynamicObstacles} Total</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <span className="text-[10px] text-cyan-300 block">Commuters</span>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={commuterCount}
                        onChange={(e) => setCommuterCount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-purple-300 block">Random</span>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={randomCount}
                        onChange={(e) => setRandomCount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-amber-300 block">Crossing</span>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={crossingCount}
                        onChange={(e) => setCrossingCount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-300 block">Groups</span>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={groupCount}
                        onChange={(e) => setGroupCount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Construction Zones */}
                <div>
                  <span className="block text-slate-300 font-medium mb-1">
                    Active Construction Blockades
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CONSTRUCTION_ZONES.map((cz) => {
                      const checked = selectedZones.includes(cz.id);
                      return (
                        <label
                          key={cz.id}
                          className={`flex items-center gap-2 p-2 rounded border text-[11px] cursor-pointer ${
                            checked
                              ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleZone(cz.id)}
                            className="accent-cyan-500"
                          />
                          <span className="truncate">{cz.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Sliders: Traction, Sensor Noise, Initial Battery */}
                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400">Traction</span>
                      <span className="font-mono text-cyan-400">
                        {(surfaceTraction * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.55}
                      max={1.0}
                      step={0.02}
                      value={surfaceTraction}
                      onChange={(e) => setSurfaceTraction(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400">Noise</span>
                      <span className="font-mono text-amber-400">
                        {(sensorNoise * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.0}
                      max={0.45}
                      step={0.02}
                      value={sensorNoise}
                      onChange={(e) => setSensorNoise(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400">Init Battery</span>
                      <span className="font-mono text-emerald-400">{initialBatteryPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={18}
                      max={100}
                      step={2}
                      value={initialBatteryPct}
                      onChange={(e) => setInitialBatteryPct(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Save Custom Scenario to Factory</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE 4: PRESET SCENARIO OVERVIEW */}
          {activeTab === 'Preset' && (
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-display font-semibold text-base text-slate-100">
                    Canonical Preset Campus Scenarios
                  </h3>
                  <p className="text-xs text-slate-400">
                    7 deterministic benchmark scenarios spanning nominal, construction, crowd surge,
                    fog, compound stress, elevator recovery, and full blockade.
                  </p>
                </div>
                <Layers className="w-4 h-4 text-cyan-400" />
              </div>
              <p className="text-slate-300 leading-relaxed">
                Preset scenarios are pre-partitioned into <strong>TRAIN</strong> (Nominal,
                Construction Detour, Low Visibility, Full Lockdown) and{' '}
                <strong>HELD-OUT TEST</strong> (Pedestrian Surge, Multi-Hazard Stress, Elevator
                Recovery) splits so you can immediately train the Candidate Q-Learning Policy and
                benchmark it fairly on unseen test scenarios.
              </p>
            </div>
          )}

          {/* SECTION 4: REAL HEADLESS BATCH EXPERIMENT RUNNER */}
          <div className="bg-[#0d1322] border border-cyan-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="text-[11px] font-mono text-cyan-400">
                  HEADLESS SIMULATION ENGINE · MULTI-EPISODE RUNNER
                </div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Batch Experiment Runner
                </h3>
                <p className="text-xs text-slate-400">
                  Execute real navigation episodes across selected scenarios without WebGL overhead
                </p>
              </div>
              <Cpu className="w-5 h-5 text-cyan-400 shrink-0" />
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">
                  Selected Scenarios: {selectedBatchScenarioIds.length} of {scenarios.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBatchScenarioIds(scenarios.map((s) => s.id))}
                    className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedBatchScenarioIds(
                        scenarios
                          .filter((s) => s.id !== 'scen-fully-blocked')
                          .map((s) => s.id)
                      )
                    }
                    className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                  >
                    Traversable Only
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Policy to Evaluate
                  </label>
                  <select
                    value={batchPolicyId}
                    onChange={(e) => setBatchPolicyId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    {policies.map((pol) => (
                      <option key={pol.id} value={pol.id}>
                        {pol.name} ({pol.version})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Episodes / Scenario
                  </label>
                  <select
                    value={episodesPerScenario}
                    onChange={(e) => setEpisodesPerScenario(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    <option value={1}>1 Episode / Scenario</option>
                    <option value={2}>2 Episodes / Scenario</option>
                    <option value={3}>3 Episodes / Scenario</option>
                    <option value={5}>5 Episodes / Scenario</option>
                  </select>
                </div>
              </div>

              {isBatchRunning ? (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs font-mono text-cyan-300">
                    <span>Executing Headless Simulation Loop...</span>
                    <span>
                      {batchProgress.completed} / {batchProgress.total} Episodes
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-150"
                      style={{
                        width: `${
                          batchProgress.total > 0
                            ? (batchProgress.completed / batchProgress.total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      cancelBatchRef.current = true;
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Cancel Batch Execution</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={selectedBatchScenarioIds.length === 0}
                  onClick={handleRunHeadlessBatch}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Zap className="w-4 h-4 fill-current" />
                  <span>
                    Run Batch Evaluation ({selectedBatchScenarioIds.length * episodesPerScenario}{' '}
                    Episodes)
                  </span>
                </button>
              )}

              {lastBatchResults && lastBatchResults.length > 0 && (
                <div className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between font-semibold text-emerald-400">
                    <span>Batch Evaluation Complete ({lastBatchResults.length} Runs Saved)</span>
                    <span className="font-mono">
                      {(
                        (lastBatchResults.filter((r) => r.status === 'Success').length /
                          lastBatchResults.length) *
                        100
                      ).toFixed(1)}
                      % Success
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-300">
                    <div>
                      Successes:{' '}
                      <span className="text-emerald-400">
                        {lastBatchResults.filter((r) => r.status === 'Success').length}
                      </span>
                    </div>
                    <div>
                      Failures:{' '}
                      <span className="text-rose-400">
                        {lastBatchResults.filter((r) => r.status === 'Failed').length}
                      </span>
                    </div>
                    <div>
                      Collisions:{' '}
                      <span className="text-amber-400">
                        {lastBatchResults.reduce((s, r) => s + r.collisions, 0)}
                      </span>
                    </div>
                  </div>
                  {onNavigate && (
                    <div className="pt-1 flex items-center gap-3 text-[11px]">
                      <button
                        type="button"
                        onClick={() => onNavigate('failure-analysis')}
                        className="text-cyan-400 hover:underline cursor-pointer"
                      >
                        Inspect Failure Intelligence →
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('experiment-history')}
                        className="text-slate-300 hover:underline cursor-pointer"
                      >
                        View in Experiment History →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right 7 Cols: Scenario Catalog with Filter & Batch Checkboxes */}
        <div className="xl:col-span-7 space-y-4">
          <div className="space-y-3 bg-[#0d1322] border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Scenario Library ({filteredScenarios.length} of {scenarios.length})
                </h3>
                <p className="text-xs text-slate-400">
                  Filter by Normal, Training, Testing, or Failure-Driven scenarios. Failed episodes never auto-populate this library unless explicitly synthesized.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
                {(
                  [
                    { id: 'ALL', label: 'All Scenarios' },
                    { id: 'Normal', label: 'Normal' },
                    { id: 'Training', label: 'Training' },
                    { id: 'Testing', label: 'Testing' },
                    { id: 'Failure-Driven', label: 'Failure-Driven' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSourceFilter(tab.id)}
                    className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                      sourceFilter === tab.id
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search & Sort Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search scenarios by name, category, weakness, or ID..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(
                      e.target.value as 'default' | 'diff-desc' | 'diff-asc' | 'name'
                    )
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="default">Sort: Default Order</option>
                  <option value="diff-desc">Sort: Difficulty (Extreme → Low)</option>
                  <option value="diff-asc">Sort: Difficulty (Low → Extreme)</option>
                  <option value="name">Sort: Name (A → Z)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredScenarios.map((scen) => {
              const isCurrent = scen.id === activeScenarioId;
              const isBatchChecked = selectedBatchScenarioIds.includes(scen.id);
              const origin = DELIVERY_LOCATIONS.find((l) => l.id === scen.originId);
              const dest = DELIVERY_LOCATIONS.find((l) => l.id === scen.destinationId);
              const dist = scen.pedestrianDistribution;
              const geom = validateScenarioGeometry(
                scen,
                scen.id === 'scen-fully-blocked'
              );
              const genSource = scen.generationSource ?? 'Preset';
              const diff = scen.difficulty ?? 'Moderate';
              const split = scen.datasetSplit ?? 'train';

              const sourceColor =
                genSource === 'Failure-Driven'
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : genSource === 'Random'
                  ? 'text-purple-300 border-purple-500/40 bg-purple-500/10'
                  : genSource === 'Custom'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10';

              return (
                <div
                  key={scen.id}
                  className={`bg-[#0d1322] border rounded-xl p-4 flex flex-col justify-between gap-3.5 transition-colors ${
                    isCurrent ? 'border-cyan-500/70' : 'border-slate-800'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Top Metadata Row: Batch Checkbox + Source + Difficulty + Split */}
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBatchChecked}
                          onChange={() => handleToggleBatchScenario(scen.id)}
                          className="accent-cyan-500"
                        />
                        <span className={`px-2 py-0.5 rounded border font-mono ${sourceColor}`}>
                          {genSource}
                        </span>
                        <span className="font-mono text-slate-400">
                          Seed #{scen.randomSeed ?? dist?.randomSeed ?? 101}
                        </span>
                      </label>

                      <div className="flex items-center gap-1.5 font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            split === 'test'
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                          }`}
                        >
                          {split.toUpperCase()}
                        </span>
                        <span className="text-slate-300">{diff}</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-cyan-400 font-medium">
                        {scen.category} · <span className="font-mono text-slate-500">{scen.id}</span>
                      </div>
                      <h4 className="font-display font-semibold text-base text-slate-100 mt-0.5">
                        {scen.name}
                      </h4>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                      {scen.description}
                    </p>

                    {scen.targetedFailureCategory && (
                      <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 space-y-1">
                        <div>
                          <strong>Diagnosed Weakness:</strong> {scen.targetedFailureCategory}
                        </div>
                        {scen.sourceExperimentIds && scen.sourceExperimentIds.length > 0 && (
                          <div className="font-mono text-[10px] text-amber-300/90">
                            Derived from Failed Run(s): {scen.sourceExperimentIds.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Route & A*</span>
                        <span className="text-slate-200 font-mono">
                          {origin?.code ?? 'ENG'}→{dest?.code ?? 'HST'} (
                          {geom.routeReachable ? `${geom.waypointCount}wp` : 'Blocked'})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Pedestrian Mix</span>
                        <span className="font-mono text-slate-200 tabular-nums">
                          {dist
                            ? `${dist.commuterCount}C·${dist.randomCount}R·${dist.crossingCount}X·${dist.groupCount}G`
                            : `${scen.dynamicObstacleCount} Agents`}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Traction / Noise</span>
                        <span className="font-mono text-cyan-300 tabular-nums">
                          {(scen.surfaceTraction * 100).toFixed(0)}% / ±
                          {(scen.sensorNoiseLevel * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onLaunchScenarioInLab(scen.id)}
                    className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {isCurrent
                        ? 'Active in Simulation Lab — Open Viewport'
                        : 'Load & Test in 3D Simulation Lab'}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
