import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const WelcomeAuthPage: React.FC = () => {
  const {
    user,
    isAuthReady,
    isAuthModalOpen,
    handleGetStarted,
    closeAuthModal,
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    sendPasswordReset,
    continueInLocalWorkspace,
    authError,
    clearAuthError,
    isFirebaseConfigured,
    activeFirebaseProjectId,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSentMessage, setResetSentMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        closeAuthModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthModalOpen, submitting, closeAuthModal]);

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
    <div className="relative min-h-screen w-screen bg-[#070b14] text-slate-100 flex flex-col justify-between overflow-x-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Subtle Robotics-Inspired Background Graphics & Kinematic Trajectory Vectors */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        {/* Radial Atmospheric Glows */}
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[820px] h-[520px] rounded-full bg-cyan-500/[0.07] blur-[130px]" />
        <div className="absolute bottom-[-20%] left-[20%] w-[560px] h-[420px] rounded-full bg-teal-500/[0.05] blur-[120px]" />

        {/* Coordinate Grid & Autonomous Trajectory SVG */}
        <svg
          className="w-full h-full opacity-[0.22]"
          viewBox="0 0 1440 900"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern
              id="robosim-grid"
              width="64"
              height="64"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 64 0 L 0 0 0 64"
                fill="none"
                stroke="#1e293b"
                strokeWidth="0.75"
              />
            </pattern>
            <linearGradient
              id="trajectory-cyan"
              x1="120"
              y1="680"
              x2="1320"
              y2="220"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
              <stop offset="35%" stopColor="#22d3ee" stopOpacity="0.65" />
              <stop offset="70%" stopColor="#14b8a6" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width="1440" height="900" fill="url(#robosim-grid)" />

          {/* Simulated A* & RL Replanned Navigation Spline */}
          <path
            d="M 80 680 C 340 660, 440 460, 720 450 C 1000 440, 1100 240, 1360 220"
            stroke="url(#trajectory-cyan)"
            strokeWidth="1.75"
            strokeDasharray="6 6"
          />
          <path
            d="M 140 730 C 420 700, 520 510, 720 450 C 920 390, 1080 280, 1320 260"
            stroke="url(#trajectory-cyan)"
            strokeWidth="1"
            opacity="0.55"
          />

          {/* Kinematic Waypoint Rings */}
          <circle
            cx="412"
            cy="558"
            r="5"
            stroke="#22d3ee"
            strokeWidth="1.5"
            fill="#070b14"
          />
          <circle
            cx="720"
            cy="450"
            r="28"
            stroke="#14b8a6"
            strokeWidth="0.75"
            strokeDasharray="3 3"
          />
          <circle
            cx="1028"
            cy="342"
            r="5"
            stroke="#22d3ee"
            strokeWidth="1.5"
            fill="#070b14"
          />
        </svg>
      </div>

      {/* Minimal Top Brand Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-sm shadow-cyan-500/10">
            <Activity className="w-5 h-5" />
          </div>
          <span className="font-display font-bold text-base sm:text-lg tracking-tight text-slate-100">
            RoboSim AI
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400">
          {isAuthReady && user && (
            <span className="hidden sm:inline text-slate-400">
              Signed in as{' '}
              <strong className="text-slate-200 font-medium">
                {user.displayName || user.email}
              </strong>
            </span>
          )}
          <button
            type="button"
            onClick={handleGetStarted}
            className="text-xs font-medium text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
          >
            {isAuthReady && user ? 'Open Dashboard' : 'Sign In'}
          </button>
        </div>
      </header>

      {/* Main Centered Welcome Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12 sm:py-16">
        <div className="w-full max-w-3xl mx-auto text-center space-y-8">
          {/* Primary Heading & Tagline */}
          <div className="space-y-4">
            <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl tracking-tight text-slate-50 leading-[1.1] text-balance">
              Welcome to RoboSim AI
            </h1>

            <p className="font-display font-medium text-xl sm:text-2xl lg:text-[26px] text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-teal-200 to-cyan-400 tracking-tight text-balance">
              Turn Robot Failures Into Intelligent Improvements.
            </p>
          </div>

          {/* Three-Paragraph Platform Description */}
          <div className="max-w-2xl mx-auto space-y-4 text-sm sm:text-base text-slate-300/95 leading-relaxed">
            <p>
              RoboSim AI is a failure-driven robot simulation and policy verification platform designed to help developers test, analyze and improve autonomous robot behaviour.
            </p>
            <p>
              Generate synthetic scenarios, simulate real-world challenges, identify failures and train smarter robot policies.
            </p>
            <p>
              Evaluate performance across different robots and environments through reproducible experiments and benchmarking.
            </p>
          </div>

          {/* Prominent Centrally Positioned CTA & Supporting Tagline */}
          <div className="pt-2 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={handleGetStarted}
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-display font-semibold text-base tracking-tight shadow-lg shadow-cyan-500/20 hover:shadow-cyan-400/30 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>

            <p className="text-xs sm:text-sm font-medium tracking-wide text-slate-400">
              Simulate. Analyze. Learn. Improve.
            </p>
          </div>
        </div>
      </main>

      {/* Quiet Minimal Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-6 py-5 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <span>RoboSim AI Platform</span>
        <span>Autonomous Robot Simulation & Policy Verification</span>
      </footer>

      {/* Sign-In / Sign-Up Modal Popup (Opens when unauthenticated visitor clicks Get Started) */}
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="robosim-auth-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              closeAuthModal();
            }
          }}
        >
          <div className="relative w-full max-w-md bg-[#0b1120] border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-black/60 space-y-5 max-h-[92vh] overflow-y-auto">
            {/* Close Button */}
            <button
              type="button"
              disabled={submitting}
              onClick={closeAuthModal}
              aria-label="Close authentication modal"
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Modal Header */}
            <div className="space-y-1.5 pr-6">
              <h2
                id="robosim-auth-modal-title"
                className="font-display font-bold text-xl text-slate-100"
              >
                {mode === 'signin'
                  ? 'Sign In to RoboSim AI'
                  : mode === 'signup'
                  ? 'Create Your RoboSim AI Account'
                  : 'Reset Your Account Password'}
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {mode === 'signin'
                  ? 'Access your personal UID-isolated workspace, custom environments, robot profiles, and policy experiments.'
                  : mode === 'signup'
                  ? 'Create an independent RoboSim AI workspace for your robot simulation experiments and policies.'
                  : 'Enter your account email to receive a password reset link.'}
              </p>
            </div>

            {!isFirebaseConfigured && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Awaiting Web App Config for {activeFirebaseProjectId}
                  </span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Provide your Web App <code className="font-mono">apiKey</code>{' '}
                  and <code className="font-mono">appId</code> in{' '}
                  <code className="font-mono">firebase-applet-config.json</code>{' '}
                  to enable Cloud Auth, or click{' '}
                  <strong className="text-white">Continue in Local Mode</strong>{' '}
                  below.
                </p>
              </div>
            )}

            {/* Mode Switcher Tabs */}
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
                  <span>Or with Email & Password</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
              </div>
            )}

            {/* Email / Password Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Full Name
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
                    ? 'Create Account'
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

            {/* Local Workspace Entry */}
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Evaluating locally without cloud sync?
              </span>
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
        </div>
      )}
    </div>
  );
};
