import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  Cloud,
  Cpu,
  GitCompare,
  KeyRound,
  Lock,
  Mail,
  Map,
  ShieldCheck,
  Sliders,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Environment & Robot Setup',
    desc: 'Select or build multi-floor environments (Campus, Warehouse, Hospital, Factory) and configure robot hardware kinematics & sensors.',
    icon: Map,
  },
  {
    step: '02',
    title: 'Synthetic Scenario Factory',
    desc: 'Generate seeded edge-case scenarios across congestion, construction detours, low visibility, and elevator faults.',
    icon: Sliders,
  },
  {
    step: '03',
    title: '3D Simulation Evaluation',
    desc: 'Execute real-time WebGL or headless batch trials with A* pathfinding, dynamic pedestrian avoidance, and vertical elevators.',
    icon: Box,
  },
  {
    step: '04',
    title: 'Failure Intelligence & Diagnosis',
    desc: 'Automatically classify collisions, deadlocks, battery depletions, and elevator faults with root-cause evidence.',
    icon: AlertTriangle,
  },
  {
    step: '05',
    title: 'Targeted Scenario Synthesis',
    desc: 'Synthesize new training scenarios specifically targeting the failure clusters discovered in simulation.',
    icon: Sparkles,
  },
  {
    step: '06',
    title: 'RL Policy Training & Benchmarking',
    desc: 'Train Tabular Q-Learning policies on training splits and verify measurable improvements on held-out test benchmarks.',
    icon: GitCompare,
  },
];

export const WelcomeAuthPage: React.FC = () => {
  const {
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    sendPasswordReset,
    continueInLocalWorkspace,
    authError,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSentMessage, setResetSentMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setResetSentMessage(null);
    setSubmitting(true);

    try {
      if (mode === 'signin') {
        await loginWithEmail(email, password);
      } else if (mode === 'signup') {
        await registerWithEmail(displayName, email, password);
      } else if (mode === 'reset') {
        const ok = await sendPasswordReset(email);
        if (ok) {
          setResetSentMessage(
            `Password reset instructions sent to ${email}. Check your inbox.`
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    clearAuthError();
    setResetSentMessage(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#070b14] text-slate-100 flex flex-col justify-between overflow-y-auto">
      {/* Top Bar */}
      <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="font-display font-bold text-lg tracking-tight text-slate-100">
              ROBOSIM AI
            </div>
            <div className="text-xs text-slate-400">
              Failure-Driven Synthetic Scenario & Policy Verification Platform
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={continueInLocalWorkspace}
            className="px-3.5 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <span>Open Local Workspace</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="w-full max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start flex-1">
        {/* Left Column: Platform Introduction & Closed-Loop Pipeline */}
        <div className="lg:col-span-7 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-cyan-400">
              <Cpu className="w-3.5 h-3.5" />
              <span>Simulation-First Physical AI Verification</span>
            </div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-slate-100 tracking-tight leading-tight">
              Discover Robot Edge-Case Failures, Synthesize Targeted Scenarios & Verify Policy Improvements.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              Autonomous delivery robots fail in rare, unpredictable real-world situations where collecting physical failure data is prohibitively expensive.{' '}
              <strong className="text-white font-semibold">RoboSim AI</strong> provides an end-to-end closed-loop engineering workbench to design custom multi-floor environments, stress-test multi-robot hardware profiles, diagnose root causes, retrain navigation policies, and benchmark measurable safety gains.
            </p>
          </div>

          {/* Closed-Loop Pipeline Diagram */}
          <div className="bg-[#0b1120] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Closed-Loop Verification & Learning Workflow
                </h2>
                <p className="text-xs text-slate-400">
                  Scenario Generation → Simulation → Failure Analysis → Targeted Synthesis → RL Training → Benchmarking
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Reproducible Seeds</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {WORKFLOW_STEPS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.step}
                    className="p-3.5 rounded-lg bg-[#0f172a] border border-slate-800/90 flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-cyan-400">
                          {item.step}
                        </span>
                        <h3 className="text-xs font-semibold text-slate-100 truncate">
                          {item.title}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workspace Persistence Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-[#0b1120] border border-slate-800 flex items-start gap-2.5">
              <Cloud className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-slate-200">Isolated User Workspaces</div>
                <div className="text-slate-400 mt-0.5">
                  Per-user Firestore cloud storage for custom environments, robots, Q-tables, and experiments.
                </div>
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0b1120] border border-slate-800 flex items-start gap-2.5">
              <Bot className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-slate-200">Multi-Robot Kinematics</div>
                <div className="text-slate-400 mt-0.5">
                  CortexRover X1, OmniStride S4, SwiftPulse A2, and custom chassis/LiDAR hardware profiles.
                </div>
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0b1120] border border-slate-800 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-slate-200">Safe Local Migration</div>
                <div className="text-slate-400 mt-0.5">
                  Existing browser experiments & custom scenarios automatically merge into your account upon sign-in.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Authentication Card */}
        <div className="lg:col-span-5 bg-[#0b1120] border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-xl text-slate-100">
              {mode === 'signin'
                ? 'Sign In to Your Workspace'
                : mode === 'signup'
                ? 'Create Your RoboSim AI Account'
                : 'Reset Your Account Password'}
            </h2>
            <p className="text-xs text-slate-400">
              {mode === 'signin'
                ? 'Access your saved robot configurations, custom 2D environments, trained policies, and experiment history.'
                : mode === 'signup'
                ? 'Provision an isolated cloud workspace and automatically migrate any existing local simulation data.'
                : 'Enter your account email to receive a password reset link.'}
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#070b14] border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                clearAuthError();
                setResetSentMessage(null);
              }}
              className={`py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'signin'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                clearAuthError();
                setResetSentMessage(null);
              }}
              className={`py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {resetSentMessage && (
            <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{resetSentMessage}</span>
            </div>
          )}

          {/* Google Sign-In Button */}
          {mode !== 'reset' && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={submitting}
                onClick={handleGoogleLogin}
                className="w-full py-2.5 px-4 rounded-lg bg-slate-100 hover:bg-white text-slate-900 font-semibold text-xs flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.08.72-2.45 1.16-4.22 1.16-3.24 0-5.98-2.18-6.96-5.12H1.04v3.14C3.05 21.16 7.21 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.04 14.03c-.25-.72-.38-1.49-.38-2.28s.13-1.56.38-2.28V6.33H1.04C.38 7.64 0 9.13 0 11.75s.38 4.11 1.04 5.42l4-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.21 0 3.05 2.84 1.04 6.83l4 3.14c.98-2.94 3.72-5.22 6.96-5.22z"
                  />
                </svg>
                <span>Continue with Google Account</span>
              </button>

              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <div className="flex-1 h-px bg-slate-800" />
                <span>OR EMAIL & PASSWORD</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
            </div>
          )}

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Full Name or Callsign
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Dr. Elena Vance"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#070b14] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="engineer@robotics-lab.org"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#070b14] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        clearAuthError();
                      }}
                      className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#070b14] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>
                {submitting
                  ? 'Processing...'
                  : mode === 'signin'
                  ? 'Sign In to Workspace'
                  : mode === 'signup'
                  ? 'Create Account & Sync Data'
                  : 'Send Password Reset Email'}
              </span>
            </button>

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  clearAuthError();
                }}
                className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Back to Sign In
              </button>
            )}
          </form>

          {/* Local Workspace Quick Entry */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Evaluating locally without cloud sync?</span>
            <button
              type="button"
              onClick={continueInLocalWorkspace}
              className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>Continue in Local Mode</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <span>RoboSim AI — Simulation-First Autonomous Robot Verification & Policy Learning</span>
        <span className="font-mono">Firebase Auth + Firestore Isolated Workspaces · Three.js WebGL</span>
      </footer>
    </div>
  );
};
