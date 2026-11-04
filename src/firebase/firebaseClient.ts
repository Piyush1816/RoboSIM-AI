import { initializeApp } from 'firebase/app';
import {
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
  getDoc,
  getDocFromServer,
  getDocs,
   getFirestore,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
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

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export type WorkspaceCategoryKey =
  | 'robots'
  | 'environments'
  | 'scenarios'
  | 'policies'
  | 'candidatePolicy'
  | 'experiments'
  | 'failures'
  | 'benchmarks'
  | 'robotBenchmarks'
  | 'fdBatches'
  | 'preferences';

export async function ensureUserProfileDoc(
  user: User,
  prefs?: {
    selectedRobotId?: string;
    selectedEnvironmentId?: string;
    demoPreviewEnabled?: boolean;
  }
): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      uid: user.uid,
      updatedAt: nowIso,
    };
    if (user.email) payload.email = user.email;
    if (user.displayName) payload.displayName = user.displayName;
    if (!snap.exists()) {
      payload.createdAt = nowIso;
    }
    if (prefs?.selectedRobotId) payload.selectedRobotId = prefs.selectedRobotId;
    if (prefs?.selectedEnvironmentId)
      payload.selectedEnvironmentId = prefs.selectedEnvironmentId;
    if (typeof prefs?.demoPreviewEnabled === 'boolean') {
      payload.demoPreviewEnabled = prefs.demoPreviewEnabled;
    }
    await setDoc(userRef, payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveWorkspaceCategoryToCloud(
  uid: string,
  category: WorkspaceCategoryKey,
  data: unknown
): Promise<boolean> {
  if (!uid) return false;
  const path = `users/${uid}/workspace/${category}`;
  try {
    const serialized = JSON.stringify(data ?? null);
    // Keep within Firestore 1MB document limit (cap at 900KB)
    if (serialized.length > 900000) {
      console.warn(
        `Workspace chunk ${category} exceeds 900KB limit; trimming oldest entries for cloud sync.`
      );
      if (Array.isArray(data)) {
        const trimmed = data.slice(0, Math.max(10, Math.floor(data.length / 2)));
        await setDoc(doc(db, 'users', uid, 'workspace', category), {
          uid,
          category,
          payloadJson: JSON.stringify(trimmed),
          updatedAt: new Date().toISOString(),
        });
        return true;
      }
      return false;
    }

    await setDoc(doc(db, 'users', uid, 'workspace', category), {
      uid,
      category,
      payloadJson: serialized,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export async function loadAllWorkspaceCategoriesFromCloud(
  uid: string
): Promise<Partial<Record<WorkspaceCategoryKey, unknown>>> {
  if (!uid) return {};
  const path = `users/${uid}/workspace`;
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'workspace'));
    const result: Partial<Record<WorkspaceCategoryKey, unknown>> = {};
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && typeof d.category === 'string' && typeof d.payloadJson === 'string') {
        try {
          result[d.category as WorkspaceCategoryKey] = JSON.parse(d.payloadJson);
        } catch {
          // ignore malformed JSON
        }
      }
    });
    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return {};
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
