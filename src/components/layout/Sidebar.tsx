import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  GitCompare,
  History,
  LayoutDashboard,
  Map,
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
  robotsCount?: number;
  environmentsCount?: number;
}

const PRIMARY_WORKFLOW_STAGES: {
  id: NavPageId;
  stageNum: number;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'scenario-generator', stageNum: 1, label: 'Scenario Factory', icon: Sliders },
  { id: 'simulation-lab', stageNum: 2, label: 'Simulation Lab', icon: Box },
  { id: 'failure-analysis', stageNum: 3, label: 'Failure Analysis', icon: AlertTriangle },
  { id: 'robot-policies', stageNum: 4, label: 'Policy Training', icon: Bot },
  { id: 'policy-benchmarking', stageNum: 5, label: 'Policy Comparison', icon: GitCompare },
];

const SUPPORTING_ITEMS: {
  id: NavPageId;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'environment-studio', label: 'Environment Studio', icon: Map },
  { id: 'robot-config', label: 'Robot Configuration', icon: Cpu },
];

const ADVANCED_ITEMS: {
  id: NavPageId;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
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
  robotsCount = 4,
  environmentsCount = 8,
}) => {
  const isAdvancedActive =
    activePage === 'performance-analytics' ||
    activePage === 'experiment-history';
  const [showAdvanced, setShowAdvanced] = useState<boolean>(true);

  const expandedAdvanced = showAdvanced || isAdvancedActive;

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
                Failure-Driven Sim Loop
              </div>
            </div>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="p-3 space-y-4">
          {/* 5 Primary Workflow Stages */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Primary Workflow
            </div>
            <nav className="space-y-1" aria-label="5-Stage Closed-Loop Workflow">
              {PRIMARY_WORKFLOW_STAGES.map((item) => {
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
                      <span
                        className={`w-4 h-4 rounded text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-cyan-400 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.stageNum}
                      </span>
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-cyan-400' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>

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

          {/* Supporting Pages */}
          <div className="space-y-1 pt-2 border-t border-slate-800/70">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Supporting Pages
            </div>
            <nav className="space-y-1" aria-label="Supporting Pages">
              {SUPPORTING_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectPage(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs xl:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
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

                    {item.id === 'environment-studio' && environmentsCount > 0 && (
                      <span className="font-mono text-xs text-emerald-400 tabular-nums ml-1">
                        {environmentsCount}
                      </span>
                    )}
                    {item.id === 'robot-config' && robotsCount > 0 && (
                      <span className="font-mono text-xs text-cyan-400 tabular-nums ml-1">
                        {robotsCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Advanced Sections */}
          <div className="space-y-1 pt-2 border-t border-slate-800/70">
            <button
              onClick={() => setShowAdvanced(!expandedAdvanced)}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              <span>Advanced Sections</span>
              {expandedAdvanced ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {expandedAdvanced && (
              <nav className="space-y-1" aria-label="Advanced Navigation">
                {ADVANCED_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectPage(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? 'text-cyan-400' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>

                      {item.id === 'experiment-history' &&
                        totalExperimentsCount > 0 && (
                          <span className="font-mono text-xs text-slate-400 tabular-nums ml-1">
                            {totalExperimentsCount}
                          </span>
                        )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
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
            <span className="text-slate-400">Elevators</span>
            <span className="font-mono text-slate-300">G / 1F / 2F Shaft</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
          <span>Simulation Testbed</span>
          <span className="font-mono tabular-nums">WebGL + TS</span>
        </div>
      </div>
    </aside>
  );
};
