import React from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Box,
  GitCompare,
  History,
  LayoutDashboard,
  Sliders,
} from 'lucide-react';
import { NavPageId } from '../../types/simulation';

interface SidebarProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  totalExperimentsCount: number;
  failedCount: number;
  isPolicyTrained?: boolean;
  benchmarksCount?: number;
}

const NAV_ITEMS: {
  id: NavPageId;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'simulation-lab', label: 'Simulation Lab', icon: Box },
  { id: 'scenario-generator', label: 'Synthetic Scenario Factory', icon: Sliders },
  { id: 'failure-analysis', label: 'Failure Intelligence', icon: AlertTriangle },
  { id: 'robot-policies', label: 'Policy Learning & Training', icon: Bot },
  { id: 'policy-benchmarking', label: 'Policy Benchmarking', icon: GitCompare },
  { id: 'performance-analytics', label: 'Performance Analytics', icon: BarChart3 },
  { id: 'experiment-history', label: 'Experiment History', icon: History },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  totalExperimentsCount,
  failedCount,
  isPolicyTrained = false,
  benchmarksCount = 0,
}) => {
  return (
    <aside className="w-56 xl:w-64 shrink-0 h-full overflow-y-auto bg-[#0a0f1d] border-r border-slate-800/80 flex flex-col justify-between select-none">
      <div>
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80">
          <button
            onClick={() => onSelectPage('overview')}
            className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500/25 transition-colors">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display font-bold text-base tracking-tight text-slate-100 whitespace-nowrap">
                ROBOSIM AI
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap">
                Physical AI Loop
              </div>
            </div>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="p-3 space-y-1">
          <div className="px-3 py-2 text-[11px] font-medium text-slate-500">
            Closed-Loop Pipeline
          </div>
          <nav className="space-y-1" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectPage(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs xl:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-cyan-400' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>

                  {item.id === 'experiment-history' && totalExperimentsCount > 0 && (
                    <span className="font-mono text-xs text-slate-400 tabular-nums ml-1">
                      {totalExperimentsCount}
                    </span>
                  )}
                  {item.id === 'failure-analysis' && failedCount > 0 && (
                    <span className="font-mono text-xs text-amber-400 tabular-nums ml-1">
                      {failedCount}
                    </span>
                  )}
                  {item.id === 'robot-policies' && isPolicyTrained && (
                    <span className="font-mono text-[10px] text-emerald-400 ml-1">
                      RL
                    </span>
                  )}
                  {item.id === 'policy-benchmarking' && benchmarksCount > 0 && (
                    <span className="font-mono text-xs text-cyan-400 tabular-nums ml-1">
                      {benchmarksCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Runtime Specification Summary */}
      <div className="p-4 border-t border-slate-800/80 space-y-3">
        <div className="p-3 rounded-lg bg-[#0d1426] border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Policy Engine</span>
            <span className="font-mono text-cyan-400">A* + Tabular Q-RL</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Safety Layer</span>
            <span className="font-mono text-emerald-400">Hard Enforced</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Batch Runner</span>
            <span className="font-mono text-slate-300">Headless Sim</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
          <span>Browser Prototype</span>
          <span className="font-mono tabular-nums">WebGL + TS</span>
        </div>
      </div>
    </aside>
  );
};
