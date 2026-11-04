import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ACTIVE_FIREBASE_PROJECT_ID,
  auth,
  CLOUD_SYNC_STATUS_EVENT,
  CloudSyncStatusSnapshot,
  createUserWithEmailAndPassword,
  ensureUserProfileDoc,
  getCloudSyncStatusSnapshot,
  googleProvider,
  isFirebaseWebConfigReady,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from '../firebase/firebaseClient';
import {
  flushPendingCloudSync,
  hydrateAndMigrateUserWorkspace,
  loadDemoPreviewPreference,
  loadSelectedEnvironmentId,
  loadSelectedPolicyId,
  loadSelectedRobotId,
  setActiveWorkspaceScope,
} from '../storage/experimentStorage';

const GUEST_SESSION_KEY = 'robosim_ai_guest_session_active_v1';

export type WorkspaceSessionMode =
  | 'guest-local'
  | 'authenticated-cloud'
  | 'authenticated-offline-pending';

interface AuthContextValue {
  user: User | null;
  isAuthReady: boolean;
  isWorkspaceLoading: boolean;
  isGuestWorkspace: boolean;
  showWelcomePage: boolean;
  isSyncingCloud: boolean;
  lastSyncSummary: string | null;
  authError: string | null;
  isFirebaseConfigured: boolean;
  activeFirebaseProjectId: string;
  workspaceSessionMode: WorkspaceSessionMode;
  cloudSyncStatus: CloudSyncStatusSnapshot;
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
  const currentHost =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'current preview domain';

  if (raw.includes('auth/unauthorized-domain')) {
    return `Domain "${currentHost}" is not yet authorized in Firebase project "${ACTIVE_FIREBASE_PROJECT_ID}". Add "${currentHost}" under Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Browser blocked the Google Sign-In popup window. Please allow popups for this site or sign in with Email & Password.';
  }
  if (
    raw.includes('auth/popup-closed-by-user') ||
    raw.includes('auth/cancelled-popup-request')
  ) {
    return 'Sign-in popup was closed before completing authentication.';
  }
  if (raw.includes('auth/operation-not-allowed')) {
    return `This sign-in provider is not enabled in Firebase project "${ACTIVE_FIREBASE_PROJECT_ID}" (Authentication → Sign-in method).`;
  }
  if (
    raw.includes('auth/invalid-credential') ||
    raw.includes('auth/wrong-password') ||
    raw.includes('auth/invalid-login-credentials')
  ) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }
  if (raw.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (raw.includes('auth/user-not-found')) {
    return 'No account found with this email address. Please create an account first.';
  }
  if (raw.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Please sign in instead.';
  }
  if (raw.includes('auth/weak-password')) {
    return 'Password is too weak. Please use at least 6 characters.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network connection error while reaching Firebase Authentication. You can continue in Local Workspace mode while offline.';
  }
  if (raw.includes('auth/invalid-api-key') || raw.includes('api-key-not-valid')) {
    return `Firebase Web App API key for project "${ACTIVE_FIREBASE_PROJECT_ID}" is missing or invalid in firebase-applet-config.json.`;
  }
  return raw;
}

const MISSING_CONFIG_MESSAGE = `Firebase project "${ACTIVE_FIREBASE_PROJECT_ID}" is selected, but Web App credentials (apiKey and appId) are not yet populated in firebase-applet-config.json. Provide your robosim-2db29 Web App config or click "Continue in Local Mode" to use the full simulator locally.`;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(
    !isFirebaseWebConfigReady
  );
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(
    isFirebaseWebConfigReady
  );
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
  const [cloudSyncStatus, setCloudSyncStatus] =
    useState<CloudSyncStatusSnapshot>(() => getCloudSyncStatusSnapshot());

  // Monotonic session sequence counter to cancel stale async workspace loads when switching accounts
  const authSessionSeqRef = useRef<number>(0);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSyncStatus = () => {
      setCloudSyncStatus(getCloudSyncStatusSnapshot(user?.uid ?? null));
    };
    const handleOnline = async () => {
      const uid = user?.uid ?? null;
      setCloudSyncStatus(getCloudSyncStatusSnapshot(uid));
      if (uid && isFirebaseWebConfigReady) {
        setIsSyncingCloud(true);
        try {
          const flushed = await flushPendingCloudSync(uid);
          if (flushed > 0) {
            setLastSyncSummary(
              `Flushed ${flushed} pending offline workspace update${
                flushed === 1 ? '' : 's'
              } to Firestore`
            );
          }
        } finally {
          setIsSyncingCloud(false);
          setCloudSyncStatus(getCloudSyncStatusSnapshot(uid));
        }
      }
    };

    window.addEventListener(CLOUD_SYNC_STATUS_EVENT, handleSyncStatus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleSyncStatus);

    return () => {
      window.removeEventListener(CLOUD_SYNC_STATUS_EVENT, handleSyncStatus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleSyncStatus);
    };
  }, [user]);

  useEffect(() => {
    if (!isFirebaseWebConfigReady || !auth) {
      let guestActive = false;
      try {
        guestActive =
          typeof localStorage !== 'undefined' &&
          localStorage.getItem(GUEST_SESSION_KEY) === 'true';
      } catch {
        guestActive = false;
      }
      setActiveWorkspaceScope(guestActive ? 'guest' : 'unauthenticated', null);
      setIsAuthReady(true);
      setIsWorkspaceLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const sessionSeq = ++authSessionSeqRef.current;
      const isSessionStillValid = () =>
        authSessionSeqRef.current === sessionSeq;

      if (currentUser) {
        // 1. Immediately switch storage namespace to this user's isolated UID scope BEFORE any await
        setActiveWorkspaceScope('user', currentUser.uid);
        setUser(currentUser);
        setIsGuestWorkspace(false);
        try {
          localStorage.removeItem(GUEST_SESSION_KEY);
        } catch {
          // ignore
        }
        setShowWelcomePage(false);
        setIsAuthReady(true);
        setIsWorkspaceLoading(true);
        setIsSyncingCloud(true);

        try {
          const res = await hydrateAndMigrateUserWorkspace(
            currentUser.uid,
            isSessionStillValid
          );
          if (!isSessionStillValid()) return;

          await ensureUserProfileDoc(currentUser, {
            selectedRobotId: loadSelectedRobotId(),
            selectedEnvironmentId: loadSelectedEnvironmentId(),
            selectedPolicyId: loadSelectedPolicyId(),
            demoPreviewEnabled: loadDemoPreviewPreference(),
          });
          if (!isSessionStillValid()) return;

          setLastSyncSummary(
            `Cloud Workspace Synced (${res.migratedCounts.experiments} runs, ${res.migratedCounts.scenarios} custom scenarios, ${res.migratedCounts.environments} custom maps)`
          );
        } catch (err) {
          console.error('Failed to sync cloud workspace:', err);
        } finally {
          if (isSessionStillValid()) {
            setIsWorkspaceLoading(false);
            setIsSyncingCloud(false);
            setCloudSyncStatus(getCloudSyncStatusSnapshot(currentUser.uid));
          }
        }
      } else {
        let guestActive = false;
        try {
          guestActive =
            typeof localStorage !== 'undefined' &&
            localStorage.getItem(GUEST_SESSION_KEY) === 'true';
        } catch {
          guestActive = false;
        }
        setActiveWorkspaceScope(guestActive ? 'guest' : 'unauthenticated', null);
        setUser(null);
        setIsGuestWorkspace(guestActive);
        setIsAuthReady(true);
        setIsWorkspaceLoading(false);
        setIsSyncingCloud(false);
        setCloudSyncStatus(getCloudSyncStatusSnapshot(null));
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setAuthError(null);
      if (!isFirebaseWebConfigReady || !auth) {
        setAuthError(MISSING_CONFIG_MESSAGE);
        return false;
      }
      try {
        const cred = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (cred.user?.uid) {
          setActiveWorkspaceScope('user', cred.user.uid);
        }
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
      if (!isFirebaseWebConfigReady || !auth) {
        setAuthError(MISSING_CONFIG_MESSAGE);
        return false;
      }
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (cred.user?.uid) {
          setActiveWorkspaceScope('user', cred.user.uid);
        }
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
        await ensureUserProfileDoc(cred.user, {
          selectedRobotId: loadSelectedRobotId(),
          selectedEnvironmentId: loadSelectedEnvironmentId(),
          selectedPolicyId: loadSelectedPolicyId(),
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
    if (!isFirebaseWebConfigReady || !auth) {
      setAuthError(MISSING_CONFIG_MESSAGE);
      return false;
    }
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user?.uid) {
        setActiveWorkspaceScope('user', cred.user.uid);
      }
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
      if (!isFirebaseWebConfigReady || !auth) {
        setAuthError(MISSING_CONFIG_MESSAGE);
        return false;
      }
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
    // Invalidate any in-flight cloud workspace hydration for the outgoing account
    authSessionSeqRef.current += 1;
    try {
      localStorage.removeItem(GUEST_SESSION_KEY);
    } catch {
      // ignore
    }
    // Clear active in-memory workspace state immediately while preserving saved per-UID storage
    setActiveWorkspaceScope('unauthenticated', null);
    setUser(null);
    setIsGuestWorkspace(false);
    setIsWorkspaceLoading(false);
    setIsSyncingCloud(false);
    setLastSyncSummary(null);
    setShowWelcomePage(true);

    try {
      if (auth) {
        await signOut(auth);
      }
    } catch {
      // ignore
    }
    setCloudSyncStatus(getCloudSyncStatusSnapshot(null));
  }, []);

  const continueInLocalWorkspace = useCallback(() => {
    setAuthError(null);
    authSessionSeqRef.current += 1;
    try {
      localStorage.setItem(GUEST_SESSION_KEY, 'true');
    } catch {
      // ignore
    }
    setActiveWorkspaceScope('guest', null);
    setIsGuestWorkspace(true);
    setIsWorkspaceLoading(false);
    setShowWelcomePage(false);
  }, []);

  const openWelcomeScreen = useCallback(() => {
    setShowWelcomePage(true);
  }, []);

  const syncWorkspaceNow = useCallback(async () => {
    if (!user || !isFirebaseWebConfigReady) return;
    const currentSeq = authSessionSeqRef.current;
    const isSessionStillValid = () => authSessionSeqRef.current === currentSeq;
    setIsSyncingCloud(true);
    try {
      await flushPendingCloudSync(user.uid);
      const res = await hydrateAndMigrateUserWorkspace(
        user.uid,
        isSessionStillValid
      );
      if (isSessionStillValid()) {
        setLastSyncSummary(
          `Synced ${res.migratedCounts.experiments} runs, ${res.migratedCounts.environments} custom maps`
        );
      }
    } finally {
      if (isSessionStillValid()) {
        setIsSyncingCloud(false);
        setCloudSyncStatus(getCloudSyncStatusSnapshot(user.uid));
      }
    }
  }, [user]);

  const workspaceSessionMode: WorkspaceSessionMode = useMemo(() => {
    if (!user) return 'guest-local';
    if (
      !cloudSyncStatus.isOnline ||
      cloudSyncStatus.pendingCategories.length > 0 ||
      cloudSyncStatus.quotaExceeded
    ) {
      return 'authenticated-offline-pending';
    }
    return 'authenticated-cloud';
  }, [user, cloudSyncStatus]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthReady,
      isWorkspaceLoading,
      isGuestWorkspace,
      showWelcomePage,
      isSyncingCloud,
      lastSyncSummary,
      authError,
      isFirebaseConfigured: isFirebaseWebConfigReady,
      activeFirebaseProjectId: ACTIVE_FIREBASE_PROJECT_ID,
      workspaceSessionMode,
      cloudSyncStatus,
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
      isWorkspaceLoading,
      isGuestWorkspace,
      showWelcomePage,
      isSyncingCloud,
      lastSyncSummary,
      authError,
      workspaceSessionMode,
      cloudSyncStatus,
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

