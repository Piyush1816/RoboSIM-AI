import React from 'react';
import { Cloud, Cpu, LogIn, LogOut, MapPin, Play, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { NavPageId, SimulationRunState } from '../../types/simulation';

interface TopNavBarProps {
  activePage: NavPageId;
  simulationState: SimulationRunState;
  activeRobotName: string;
  activeScenarioName: string;
  activeEnvironmentName?: string;
  onQuickOpenSimLab: () => void;
}

const PAGE_TITLES: Record<NavPageId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview Dashboard',
    subtitle: 'Closed-loop Physical AI pipeline: synthetic scenarios, policy evaluation, failure intelligence & retraining',
  },
  'simulation-lab': {
    title: 'Simulation Lab',
    subtitle: 'Interactive 3D multi-environment testbed with destination routing, elevators & safety layer',
  },
  'environment-studio': {
    title: 'Environment Studio & 2D Map Editor',
    subtitle: 'Design custom multi-floor environments, place walls/doors/charging docks/elevators, import floor plans & validate A* navigation',
  },
  'robot-config': {
    title: 'Robot Hardware Configuration',
    subtitle: 'Multi-robot chassis dimensions, mobility kinematics, battery capacity, payload limits & perception sensors',
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
    title: 'Policy Comparison & Cross-Robot Benchmarking',
    subtitle: 'Fair side-by-side evaluation of Baseline vs. Trained Candidate Policies and Cross-Robot Hardware across held-out test scenarios',
  },
  'performance-analytics': {
    title: 'Performance Analytics',
    subtitle: 'Evidence-based quantitative telemetry derived strictly from recorded simulation & training episodes',
  },
  'experiment-history': {
    title: 'Experiment History',
    subtitle: 'Persistent audit log of interactive, batch, training, and benchmark simulation episodes with environment & hardware snapshots',
  },
};

export const TopNavBar: React.FC<TopNavBarProps> = ({
  activePage,
  simulationState,
  activeRobotName,
  activeScenarioName,
  activeEnvironmentName = 'University Campus',
  onQuickOpenSimLab,
}) => {
  const { user, logout, openWelcomeScreen } = useAuth();
  const pageMeta = PAGE_TITLES[activePage] ?? PAGE_TITLES.overview;

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
      <div className="hidden xl:flex items-center gap-3 text-xs text-slate-400 whitespace-nowrap shrink-0">
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          <span>Env:</span>
          <strong className="text-slate-200 font-medium">{activeEnvironmentName}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>Sim:</span>
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
          <span>Safety Layer</span>
        </span>
      </div>

      {/* Zone 3: Primary Action & Authenticated Workspace Profile */}
      <div className="flex items-center gap-3 shrink-0">
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
          {user ? (
            <>
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <User className="w-4 h-4" />
              </div>
              <div className="hidden md:block text-left">
                <div className="text-xs font-medium text-slate-200 leading-none truncate max-w-[140px]">
                  {user.displayName || user.email?.split('@')[0] || 'Researcher'}
                </div>
                <div className="text-[11px] text-emerald-400 mt-0.5 font-mono flex items-center gap-1">
                  <Cloud className="w-3 h-3" /> Cloud Synced
                </div>
              </div>
              <button
                onClick={() => void logout()}
                title="Sign out of workspace"
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-rose-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <div className="hidden md:block text-left">
                <div className="text-xs font-medium text-slate-200 leading-none">
                  Local Workspace
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                  Browser Storage
                </div>
              </div>
              <button
                onClick={openWelcomeScreen}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In / Cloud Sync</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
