import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  Firestore,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  setDoc,
} from 'firebase/firestore';
import rawAppletConfig from '../../firebase-applet-config.json';

const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const ACTIVE_FIREBASE_PROJECT_ID =
  envMeta.VITE_FIREBASE_PROJECT_ID?.trim() ||
  rawAppletConfig.projectId?.trim() ||
  'robosim-2db29';

export const ACTIVE_FIRESTORE_DATABASE_ID =
  envMeta.VITE_FIREBASE_DATABASE_ID?.trim() ||
  rawAppletConfig.firestoreDatabaseId?.trim() ||
  '(default)';

export const resolvedFirebaseConfig = {
  projectId: ACTIVE_FIREBASE_PROJECT_ID,
  appId: envMeta.VITE_FIREBASE_APP_ID?.trim() || rawAppletConfig.appId?.trim() || '',
  apiKey: envMeta.VITE_FIREBASE_API_KEY?.trim() || rawAppletConfig.apiKey?.trim() || '',
  authDomain:
    envMeta.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    rawAppletConfig.authDomain?.trim() ||
    `${ACTIVE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  storageBucket:
    envMeta.VITE_FIREBASE_STORAGE_BUCKET?.trim() ||
    rawAppletConfig.storageBucket?.trim() ||
    `${ACTIVE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId:
    envMeta.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
    rawAppletConfig.messagingSenderId?.trim() ||
    '',
  measurementId:
    envMeta.VITE_FIREBASE_MEASUREMENT_ID?.trim() ||
    rawAppletConfig.measurementId?.trim() ||
    '',
};

/**
 * True only when the real Web App credentials (apiKey and appId) for robosim-2db29
 * have been provided in firebase-applet-config.json or VITE_FIREBASE_* environment variables.
 */
export const isFirebaseWebConfigReady: boolean = Boolean(
  resolvedFirebaseConfig.projectId === 'robosim-2db29' &&
    resolvedFirebaseConfig.apiKey &&
    resolvedFirebaseConfig.apiKey.length >= 10 &&
    resolvedFirebaseConfig.appId &&
    resolvedFirebaseConfig.appId.length >= 5
);

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseWebConfigReady) {
  try {
    appInstance =
      getApps().length > 0 ? getApp() : initializeApp(resolvedFirebaseConfig);
    authInstance = getAuth(appInstance);
    // Use the default Firestore database on Spark plan when databaseId is '(default)' or empty
    dbInstance =
      !ACTIVE_FIRESTORE_DATABASE_ID || ACTIVE_FIRESTORE_DATABASE_ID === '(default)'
        ? getFirestore(appInstance)
        : getFirestore(appInstance, ACTIVE_FIRESTORE_DATABASE_ID);
  } catch (err) {
    console.error('Firebase initialization error:', err);
  }
}

export const app = appInstance as FirebaseApp;
export const auth = authInstance as Auth;
export const db = dbInstance as Firestore;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const currentUser = authInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

// Validate connection to Firestore on boot when credentials are configured
async function testConnection() {
  if (!isFirebaseWebConfigReady || !dbInstance) return;
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export type WorkspaceCategoryKey =
  | 'robots'
  | 'environments'
  | 'scenarios'
  | 'policies'
  | 'candidatePolicy'
  | 'trainingStates'
  | 'experiments'
  | 'failures'
  | 'benchmarks'
  | 'robotBenchmarks'
  | 'fdBatches'
  | 'preferences'
  | 'settings';

const PENDING_SYNC_STORAGE_PREFIX = 'robosim_ai_pending_cloud_sync_v2_';
export const CLOUD_SYNC_STATUS_EVENT = 'robosim_ai_cloud_sync_status_v1';

export interface CloudSyncStatusSnapshot {
  isOnline: boolean;
  pendingCategories: WorkspaceCategoryKey[];
  lastSyncedAt: string | null;
  lastError: string | null;
  quotaExceeded: boolean;
}

let activePendingSyncUid: string | null = null;
let lastCloudSyncTime: string | null = null;
let lastCloudErrorMsg: string | null = null;
let isQuotaExceededState = false;

export function setActivePendingSyncUserId(uid: string | null): void {
  if (activePendingSyncUid !== uid) {
    activePendingSyncUid = uid;
    lastCloudSyncTime = null;
    lastCloudErrorMsg = null;
    isQuotaExceededState = false;
    emitCloudSyncStatusChange();
  }
}

function getPendingSyncStorageKey(uid?: string | null): string | null {
  const targetUid = uid ?? activePendingSyncUid;
  if (!targetUid) return null;
  return `${PENDING_SYNC_STORAGE_PREFIX}${targetUid}`;
}

export function getPendingSyncCategories(uid?: string | null): WorkspaceCategoryKey[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const key = getPendingSyncStorageKey(uid);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkspaceCategoryKey[]) : [];
  } catch {
    return [];
  }
}

function setPendingSyncCategories(
  categories: WorkspaceCategoryKey[],
  uid?: string | null
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = getPendingSyncStorageKey(uid);
    if (!key) return;
    const unique = Array.from(new Set(categories));
    if (unique.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(unique));
    }
  } catch {
    // ignore
  }
}

export function markCategoryPendingSync(
  category: WorkspaceCategoryKey,
  uid?: string | null
): void {
  const current = getPendingSyncCategories(uid);
  if (!current.includes(category)) {
    setPendingSyncCategories([...current, category], uid);
  }
  emitCloudSyncStatusChange();
}

export function clearCategoryPendingSync(
  category: WorkspaceCategoryKey,
  uid?: string | null
): void {
  const current = getPendingSyncCategories(uid);
  if (current.includes(category)) {
    setPendingSyncCategories(
      current.filter((c) => c !== category),
      uid
    );
  }
  emitCloudSyncStatusChange();
}

export function getCloudSyncStatusSnapshot(uid?: string | null): CloudSyncStatusSnapshot {
  const online =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  return {
    isOnline: online,
    pendingCategories: getPendingSyncCategories(uid),
    lastSyncedAt: lastCloudSyncTime,
    lastError: lastCloudErrorMsg,
    quotaExceeded: isQuotaExceededState,
  };
}

function emitCloudSyncStatusChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CLOUD_SYNC_STATUS_EVENT, {
        detail: getCloudSyncStatusSnapshot(),
      })
    );
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => emitCloudSyncStatusChange());
  window.addEventListener('offline', () => emitCloudSyncStatusChange());
}

export async function ensureUserProfileDoc(
  user: User,
  prefs?: {
    selectedRobotId?: string;
    selectedEnvironmentId?: string;
    selectedPolicyId?: string;
    demoPreviewEnabled?: boolean;
  }
): Promise<void> {
  if (!isFirebaseWebConfigReady || !dbInstance || !user?.uid) return;
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(dbInstance, 'users', user.uid);
    const snap = await getDoc(userRef);
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      uid: user.uid,
      updatedAt: nowIso,
    };
    if (user.email) payload.email = user.email.slice(0, 254);
    if (user.displayName) payload.displayName = user.displayName.slice(0, 120);
    if (!snap.exists()) {
      payload.createdAt = nowIso;
    } else {
      const existingData = snap.data();
      if (existingData?.createdAt) {
        payload.createdAt = existingData.createdAt;
      }
    }
    if (prefs?.selectedRobotId) {
      payload.selectedRobotId = prefs.selectedRobotId.slice(0, 120);
    }
    if (prefs?.selectedEnvironmentId) {
      payload.selectedEnvironmentId = prefs.selectedEnvironmentId.slice(0, 120);
    }
    if (typeof prefs?.demoPreviewEnabled === 'boolean') {
      payload.demoPreviewEnabled = prefs.demoPreviewEnabled;
    }
    await setDoc(userRef, payload, { merge: true });
    lastCloudSyncTime = nowIso;
    lastCloudErrorMsg = null;
    emitCloudSyncStatusChange();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Quota exceeded') || msg.includes('resource-exhausted')) {
      isQuotaExceededState = true;
      lastCloudErrorMsg =
        'Firestore Spark daily quota reached. Changes remain safely stored in local browser storage and will sync when quota resets.';
    } else {
      lastCloudErrorMsg = msg;
    }
    emitCloudSyncStatusChange();
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveWorkspaceCategoryToCloud(
  uid: string,
  category: WorkspaceCategoryKey,
  data: unknown
): Promise<boolean> {
  if (!uid) return false;
  if (!isFirebaseWebConfigReady || !dbInstance) {
    markCategoryPendingSync(category, uid);
    return false;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    markCategoryPendingSync(category, uid);
    return false;
  }

  const path = `users/${uid}/workspace/${category}`;
  try {
    const serialized = JSON.stringify(data ?? null);
    const nowIso = new Date().toISOString();

    // Keep within Firestore 1MB document limit (cap at 900KB)
    if (serialized.length > 900000) {
      console.warn(
        `Workspace chunk ${category} exceeds 900KB limit; trimming oldest entries for cloud sync.`
      );
      if (Array.isArray(data)) {
        const trimmed = data.slice(0, Math.max(10, Math.floor(data.length / 2)));
        await setDoc(doc(dbInstance, 'users', uid, 'workspace', category), {
          uid,
          category,
          payloadJson: JSON.stringify(trimmed),
          updatedAt: nowIso,
        });
        clearCategoryPendingSync(category, uid);
        lastCloudSyncTime = nowIso;
        lastCloudErrorMsg = null;
        isQuotaExceededState = false;
        emitCloudSyncStatusChange();
        return true;
      }
      return false;
    }

    await setDoc(doc(dbInstance, 'users', uid, 'workspace', category), {
      uid,
      category,
      payloadJson: serialized,
      updatedAt: nowIso,
    });
    clearCategoryPendingSync(category, uid);
    lastCloudSyncTime = nowIso;
    lastCloudErrorMsg = null;
    isQuotaExceededState = false;
    emitCloudSyncStatusChange();
    return true;
  } catch (err) {
    markCategoryPendingSync(category, uid);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Quota exceeded') || msg.includes('resource-exhausted')) {
      isQuotaExceededState = true;
      lastCloudErrorMsg =
        'Firestore Spark free-tier daily quota reached. Your workspace changes are saved locally and queued for sync.';
    } else {
      lastCloudErrorMsg = msg;
    }
    emitCloudSyncStatusChange();
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export async function loadAllWorkspaceCategoriesFromCloud(
  uid: string
): Promise<{
  categories: Partial<Record<WorkspaceCategoryKey, unknown>>;
  timestamps: Partial<Record<WorkspaceCategoryKey, string>>;
}> {
  if (!uid || !isFirebaseWebConfigReady || !dbInstance) {
    return { categories: {}, timestamps: {} };
  }
  const path = `users/${uid}/workspace`;
  try {
    const snap = await getDocs(collection(dbInstance, 'users', uid, 'workspace'));
    const categories: Partial<Record<WorkspaceCategoryKey, unknown>> = {};
    const timestamps: Partial<Record<WorkspaceCategoryKey, string>> = {};
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && typeof d.category === 'string' && typeof d.payloadJson === 'string') {
        try {
          const catKey = d.category as WorkspaceCategoryKey;
          categories[catKey] = JSON.parse(d.payloadJson);
          if (typeof d.updatedAt === 'string') {
            timestamps[catKey] = d.updatedAt;
          }
        } catch {
          // ignore malformed JSON
        }
      }
    });
    lastCloudSyncTime = new Date().toISOString();
    lastCloudErrorMsg = null;
    emitCloudSyncStatusChange();
    return { categories, timestamps };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Quota exceeded') || msg.includes('resource-exhausted')) {
      isQuotaExceededState = true;
      lastCloudErrorMsg =
        'Firestore Spark daily read quota reached. Operating from local browser workspace.';
    } else {
      lastCloudErrorMsg = msg;
    }
    emitCloudSyncStatusChange();
    handleFirestoreError(err, OperationType.LIST, path);
    return { categories: {}, timestamps: {} };
  }
}

export {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
};
export type { User };
