import React from 'react';
import {
  Bot,
  Cloud,
  Cpu,
  HardDrive,
  LogIn,
  LogOut,
  MapPin,
  Play,
  ShieldCheck,
  Sliders,
  Sparkles,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { NavPageId, SimulationRunState } from '../../types/simulation';

interface TopNavBarProps {
  activePage: NavPageId;
  simulationState: SimulationRunState;
  activeRobotName: string;
  activeScenarioName: string;
  activeEnvironmentName?: string;
  activePolicyName?: string;
  activePolicyVersion?: string;
  onQuickOpenSimLab: () => void;
}

const PAGE_TITLES: Record<NavPageId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview Dashboard',
    subtitle:
      'Closed-loop Physical AI pipeline: synthetic scenarios, policy evaluation, failure intelligence & retraining',
  },
  'simulation-lab': {
    title: 'Simulation Lab',
    subtitle:
      'Interactive 3D multi-environment testbed with destination routing, elevators & safety layer',
  },
  'environment-studio': {
    title: 'Environment Studio & 2D Map Editor',
    subtitle:
      'Design custom multi-floor environments, place walls/doors/charging docks/elevators, import floor plans & validate A* navigation',
  },
  'robot-config': {
    title: 'Robot Hardware Configuration',
    subtitle:
      'Multi-robot chassis dimensions, mobility kinematics, battery capacity, payload limits & perception sensors',
  },
  'scenario-generator': {
    title: 'Synthetic Scenario Factory',
    subtitle:
      'Generate preset, random, custom, and failure-driven edge-case scenarios & run headless batch evaluations',
  },
  'failure-analysis': {
    title: 'Failure Intelligence',
    subtitle:
      'Automated root-cause classification, 10-field failure diagnostics & targeted scenario synthesis',
  },
  'robot-policies': {
    title: 'Policy Learning & Training',
    subtitle:
      'Tabular Q-Learning candidate policy training loop with hard safety layer & Q-table inspection',
  },
  'policy-benchmarking': {
    title: 'Policy Comparison & Cross-Robot Benchmarking',
    subtitle:
      'Fair side-by-side evaluation of Baseline vs. Trained Candidate Policies and Cross-Robot Hardware across held-out test scenarios',
  },
  'performance-analytics': {
    title: 'Performance Analytics',
    subtitle:
      'Evidence-based quantitative telemetry derived strictly from recorded simulation & training episodes',
  },
  'experiment-history': {
    title: 'Experiment History',
    subtitle:
      'Persistent audit log of interactive, batch, training, and benchmark simulation episodes with environment & hardware snapshots',
  },
};

export const TopNavBar: React.FC<TopNavBarProps> = ({
  activePage,
  simulationState,
  activeRobotName,
  activeScenarioName,
  activeEnvironmentName = 'University Campus',
  activePolicyName,
  activePolicyVersion,
  onQuickOpenSimLab,
}) => {
  const { user, logout, openWelcomeScreen } = useAuth();
  const pageMeta = PAGE_TITLES[activePage] ?? PAGE_TITLES.overview;

  const simStatusMeta =
    simulationState === 'running'
      ? {
          label: 'Running Simulation',
          color: 'text-cyan-300',
          badgeBg: 'bg-cyan-500/15 border-cyan-500/40',
          dot: 'bg-cyan-400 animate-ping',
          solidDot: 'bg-cyan-400',
        }
      : simulationState === 'paused'
      ? {
          label: 'Simulation Paused',
          color: 'text-amber-300',
          badgeBg: 'bg-amber-500/15 border-amber-500/40',
          dot: '',
          solidDot: 'bg-amber-400',
        }
      : simulationState === 'completed'
      ? {
          label: 'Delivery Complete',
          color: 'text-emerald-300',
          badgeBg: 'bg-emerald-500/15 border-emerald-500/40',
          dot: '',
          solidDot: 'bg-emerald-400',
        }
      : simulationState === 'failed'
      ? {
          label: 'Failure Detected',
          color: 'text-rose-300',
          badgeBg: 'bg-rose-500/15 border-rose-500/40',
          dot: 'bg-rose-400 animate-ping',
          solidDot: 'bg-rose-400',
        }
      : {
          label: 'Standby Ready',
          color: 'text-slate-200',
          badgeBg: 'bg-slate-900/90 border-slate-700/80',
          dot: '',
          solidDot: 'bg-slate-400',
        };

  const fullPolicyLabel = activePolicyName
    ? `${activePolicyName}${activePolicyVersion ? ` (${activePolicyVersion})` : ''}`
    : undefined;

  return (
    <header className="shrink-0 bg-[#0a0f1d] border-b border-slate-800/80 px-4 lg:px-6 py-2.5 flex flex-col gap-2">
      {/* Row 1: Top Navigation Row — Current Page Title, Primary Action Button, User Profile & Account Menu */}
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        {/* Left: Current Page Title & Subtitle */}
        <div className="min-w-0 flex-1 pr-2">
          <h1
            className="font-display font-semibold text-base lg:text-lg text-slate-100 leading-tight truncate"
            title={pageMeta.title}
          >
            {pageMeta.title}
          </h1>
          <p
            className="text-xs text-slate-400 truncate hidden sm:block mt-0.5"
            title={pageMeta.subtitle}
          >
            {pageMeta.subtitle}
          </p>
        </div>

        {/* Right: Primary Action & Authenticated Workspace Profile */}
        <div className="flex items-center gap-2.5 shrink-0">
          {activePage !== 'simulation-lab' && (
            <button
              onClick={onQuickOpenSimLab}
              title="Open the interactive 3D Simulation Lab"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm shadow-cyan-500/20"
            >
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>Open Simulation Lab</span>
            </button>
          )}

          <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-800">
            {user ? (
              <>
                <div
                  className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0"
                  title={`${user.displayName || 'Researcher'} (${user.email || 'Cloud Synced'})`}
                >
                  <User className="w-3.5 h-3.5" />
                </div>
                <div
                  className="hidden md:block text-left max-w-[140px] lg:max-w-[180px]"
                  title={`${user.displayName || 'Researcher'} — ${user.email || 'Cloud Synced'}`}
                >
                  <div className="text-xs font-medium text-slate-200 leading-none truncate">
                    {user.displayName || user.email?.split('@')[0] || 'Researcher'}
                  </div>
                  <div className="text-[10px] text-emerald-400 mt-0.5 font-mono flex items-center gap-1">
                    <Cloud className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">Cloud Synced</span>
                  </div>
                </div>
                <button
                  onClick={() => void logout()}
                  title="Sign out of workspace"
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300 whitespace-nowrap"
                  title="Local Workspace — Browser Storage"
                >
                  <HardDrive className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="font-medium text-slate-200">Local Workspace</span>
                </div>
                <button
                  onClick={openWelcomeScreen}
                  title="Sign in or configure Cloud Sync"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  <span>Sign In / Cloud Sync</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Simulation Context Row — Simulation Status, Selected Robot, Selected Scenario, Environment, Active Policy & Safety Layer */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-1.5 border-t border-slate-800/60 text-xs">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0 flex-1">
          {/* Simulation Status */}
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] shrink-0 ${simStatusMeta.badgeBg}`}
            title={`Simulation Status: ${simStatusMeta.label}`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {simStatusMeta.dot && (
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${simStatusMeta.dot}`}
                />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${simStatusMeta.solidDot}`}
              />
            </span>
            <Cpu className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="text-slate-400">Sim:</span>
            <strong className={`font-semibold ${simStatusMeta.color}`}>
              {simStatusMeta.label}
            </strong>
          </div>

          {/* Selected Robot */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 min-w-0 max-w-[180px] sm:max-w-[220px] xl:max-w-[260px]"
            title={`Selected Robot: ${activeRobotName}`}
          >
            <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="shrink-0">Unit:</span>
            <strong className="text-slate-200 font-medium truncate">
              {activeRobotName}
            </strong>
          </div>

          {/* Selected Scenario */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 min-w-0 max-w-[200px] sm:max-w-[250px] xl:max-w-[300px]"
            title={`Selected Scenario: ${activeScenarioName}`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="shrink-0">Scenario:</span>
            <strong className="text-slate-200 font-medium truncate">
              {activeScenarioName}
            </strong>
          </div>

          {/* Active Environment */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 min-w-0 max-w-[170px] sm:max-w-[210px] xl:max-w-[240px]"
            title={`Active Environment: ${activeEnvironmentName}`}
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="shrink-0">Env:</span>
            <strong className="text-slate-200 font-medium truncate">
              {activeEnvironmentName}
            </strong>
          </div>

          {/* Active Policy */}
          {fullPolicyLabel && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 min-w-0 max-w-[190px] sm:max-w-[230px] xl:max-w-[260px]"
              title={`Active Navigation Policy: ${fullPolicyLabel}`}
            >
              <Sliders className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="shrink-0">Policy:</span>
              <strong className="text-indigo-300 font-medium truncate">
                {activePolicyName}
              </strong>
              {activePolicyVersion && (
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shrink-0">
                  {activePolicyVersion}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Safety Layer Status */}
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 font-medium shrink-0"
          title="Hard Safety Layer Active — Enforces collision clearance & emergency braking across all policies"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Safety Layer</span>
        </div>
      </div>
    </header>
  );
};

