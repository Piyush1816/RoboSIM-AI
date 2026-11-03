import React from 'react';
import { Cpu, Play, ShieldCheck, User } from 'lucide-react';
import { NavPageId, SimulationRunState } from '../../types/simulation';

interface TopNavBarProps {
  activePage: NavPageId;
  simulationState: SimulationRunState;
  activeRobotName: string;
  activeScenarioName: string;
  onQuickOpenSimLab: () => void;
}

const PAGE_TITLES: Record<NavPageId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview Dashboard',
    subtitle: 'Closed-loop Physical AI pipeline: synthetic scenarios, policy evaluation, failure intelligence & retraining',
  },
  'simulation-lab': {
    title: 'Simulation Lab',
    subtitle: 'Interactive 3D university campus & real-time autonomous robot testbed',
  },
  'scenario-generator': {
    title: 'Synthetic Scenario Factory',
    subtitle: 'Generate preset, random, custom, and failure-driven edge-case scenarios & run headless batch evaluations',
  },
  'failure-analysis': {
    title: 'Failure Intelligence',
    subtitle: 'Automated root-cause classification, 10-field failure diagnostics & targeted scenario synthesis',
  },
  'robot-policies': {
    title: 'Policy Learning & Training',
    subtitle: 'Tabular Q-Learning candidate policy training loop with hard safety layer & Q-table inspection',
  },
  'policy-benchmarking': {
    title: 'Policy Benchmarking',
    subtitle: 'Fair side-by-side evaluation of Baseline Policy vs. Trained Candidate Policy on held-out test scenarios',
  },
  'performance-analytics': {
    title: 'Performance Analytics',
    subtitle: 'Evidence-based quantitative telemetry derived strictly from recorded simulation & training episodes',
  },
  'experiment-history': {
    title: 'Experiment History',
    subtitle: 'Persistent local audit log of interactive, batch, training, and benchmark simulation episodes',
  },
};

export const TopNavBar: React.FC<TopNavBarProps> = ({
  activePage,
  simulationState,
  activeRobotName,
  activeScenarioName,
  onQuickOpenSimLab,
}) => {
  const pageMeta = PAGE_TITLES[activePage];

  const simStatusLabel =
    simulationState === 'running'
      ? 'Running Simulation'
      : simulationState === 'paused'
      ? 'Simulation Paused'
      : simulationState === 'completed'
      ? 'Delivery Complete'
      : simulationState === 'failed'
      ? 'Failure Detected'
      : 'Standby Ready';

  const simStatusColor =
    simulationState === 'running'
      ? 'text-cyan-400'
      : simulationState === 'paused'
      ? 'text-amber-400'
      : simulationState === 'completed'
      ? 'text-emerald-400'
      : simulationState === 'failed'
      ? 'text-rose-400'
      : 'text-slate-300';

  return (
    <header className="h-16 shrink-0 bg-[#0a0f1d] border-b border-slate-800/80 px-6 flex items-center justify-between gap-6">
      {/* Zone 1: Page Title & Context */}
      <div className="flex items-center gap-4 min-w-0">
        <div>
          <h1 className="font-display font-semibold text-lg text-slate-100 leading-tight truncate">
            {pageMeta.title}
          </h1>
          <p className="text-xs text-slate-400 truncate hidden sm:block">
            {pageMeta.subtitle}
          </p>
        </div>
      </div>

      {/* Zone 2: Simulation Status & System Status */}
      <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400 whitespace-nowrap shrink-0">
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>Simulation:</span>
          <strong className={`font-medium ${simStatusColor}`}>{simStatusLabel}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Unit: <strong className="text-slate-200 font-medium">{activeRobotName}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Scenario: <strong className="text-slate-200 font-medium">{activeScenarioName}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1 text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Safety Layer Active</span>
        </span>
      </div>

      {/* Zone 3: Primary Action & Operator Profile */}
      <div className="flex items-center gap-4 shrink-0">
        {activePage !== 'simulation-lab' && (
          <button
            onClick={onQuickOpenSimLab}
            className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Open Simulation Lab</span>
          </button>
        )}

        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden md:block text-left">
            <div className="text-xs font-medium text-slate-200 leading-none">
              Robotics Lead
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              Lab Operator #01
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
