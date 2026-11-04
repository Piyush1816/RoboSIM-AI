import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  auth,
  createUserWithEmailAndPassword,
  ensureUserProfileDoc,
  googleProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from '../firebase/firebaseClient';
import {
  hydrateAndMigrateUserWorkspace,
  loadDemoPreviewPreference,
  loadSelectedEnvironmentId,
  loadSelectedRobotId,
  setActiveCloudUserId,
} from '../storage/experimentStorage';

const GUEST_SESSION_KEY = 'robosim_ai_guest_session_active_v1';

interface AuthContextValue {
  user: User | null;
  isAuthReady: boolean;
  isGuestWorkspace: boolean;
  showWelcomePage: boolean;
  isSyncingCloud: boolean;
  lastSyncSummary: string | null;
  authError: string | null;
  clearAuthError: () => void;
  loginWithEmail: (email: string, password: string) => Promise<boolean>;
  registerWithEmail: (
    displayName: string,
    email: string,
    password: string
  ) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  logout: () => Promise<void>;
  continueInLocalWorkspace: () => void;
  openWelcomeScreen: () => void;
  syncWorkspaceNow: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatFirebaseAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/operation-not-allowed')) {
    return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method). Please use Google Sign-In or enable Email/Password in the console.';
  }
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }
  if (raw.includes('auth/user-not-found')) {
    return 'No account found with this email address. Please create an account first.';
  }
  if (raw.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Please sign in instead.';
  }
  if (raw.includes('auth/weak-password')) {
    return 'Password must be at least 6 characters long.';
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Sign-in popup was closed before completing authentication.';
  }
  return raw;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isGuestWorkspace, setIsGuestWorkspace] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem(GUEST_SESSION_KEY) === 'true'
        : false;
    } catch {
      return false;
    }
  });
  const [showWelcomePage, setShowWelcomePage] = useState<boolean>(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        setShowWelcomePage(false);
        setIsSyncingCloud(true);
        try {
          await ensureUserProfileDoc(currentUser, {
            selectedRobotId: loadSelectedRobotId(),
            selectedEnvironmentId: loadSelectedEnvironmentId(),
            demoPreviewEnabled: loadDemoPreviewPreference(),
          });
          const res = await hydrateAndMigrateUserWorkspace(currentUser.uid);
          setLastSyncSummary(
            `Cloud Workspace Synced (${res.migratedCounts.experiments} runs, ${res.migratedCounts.scenarios} custom scenarios)`
          );
        } catch (err) {
          console.error('Failed to sync cloud workspace:', err);
        } finally {
          setIsSyncingCloud(false);
        }
      } else {
        setActiveCloudUserId(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setAuthError(null);
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        setShowWelcomePage(false);
        return true;
      } catch (err) {
        setAuthError(formatFirebaseAuthError(err));
        return false;
      }
    },
    []
  );

  const registerWithEmail = useCallback(
    async (
      displayName: string,
      email: string,
      password: string
    ): Promise<boolean> => {
      setAuthError(null);
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
        await ensureUserProfileDoc(cred.user, {
          selectedRobotId: loadSelectedRobotId(),
          selectedEnvironmentId: loadSelectedEnvironmentId(),
          demoPreviewEnabled: loadDemoPreviewPreference(),
        });
        setShowWelcomePage(false);
        return true;
      } catch (err) {
        setAuthError(formatFirebaseAuthError(err));
        return false;
      }
    },
    []
  );

  const loginWithGoogle = useCallback(async (): Promise<boolean> => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setShowWelcomePage(false);
      return true;
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err));
      return false;
    }
  }, []);

  const sendPasswordReset = useCallback(
    async (email: string): Promise<boolean> => {
      setAuthError(null);
      try {
        await sendPasswordResetEmail(auth, email.trim());
        return true;
      } catch (err) {
        setAuthError(formatFirebaseAuthError(err));
        return false;
      }
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    setAuthError(null);
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setActiveCloudUserId(null);
    setIsGuestWorkspace(false);
    try {
      localStorage.removeItem(GUEST_SESSION_KEY);
    } catch {
      // ignore
    }
    setShowWelcomePage(true);
  }, []);

  const continueInLocalWorkspace = useCallback(() => {
    setIsGuestWorkspace(true);
    setShowWelcomePage(false);
    try {
      localStorage.setItem(GUEST_SESSION_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  const openWelcomeScreen = useCallback(() => {
    setShowWelcomePage(true);
  }, []);

  const syncWorkspaceNow = useCallback(async () => {
    if (!user) return;
    setIsSyncingCloud(true);
    try {
      const res = await hydrateAndMigrateUserWorkspace(user.uid);
      setLastSyncSummary(
        `Synced ${res.migratedCounts.experiments} runs, ${res.migratedCounts.environments} custom maps`
      );
    } finally {
      setIsSyncingCloud(false);
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthReady,
      isGuestWorkspace,
      showWelcomePage,
      isSyncingCloud,
      lastSyncSummary,
      authError,
      clearAuthError,
      loginWithEmail,
      registerWithEmail,
      loginWithGoogle,
      sendPasswordReset,
      logout,
      continueInLocalWorkspace,
      openWelcomeScreen,
      syncWorkspaceNow,
    }),
    [
      user,
      isAuthReady,
      isGuestWorkspace,
      showWelcomePage,
      isSyncingCloud,
      lastSyncSummary,
      authError,
      clearAuthError,
      loginWithEmail,
      registerWithEmail,
      loginWithGoogle,
      sendPasswordReset,
      logout,
      continueInLocalWorkspace,
      openWelcomeScreen,
      syncWorkspaceNow,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
