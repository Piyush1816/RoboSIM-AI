import {
  LocalEnvironmentFileCategory,
  LocalEnvironmentFileRef,
} from '../types/simulation';

const IDB_DATABASE_NAME = 'robosim_ai_local_files_db_v1';
const IDB_DATABASE_VERSION = 1;
const IDB_STORE_NAME = 'environment_files';

/** Maximum single file size: 25 MB (safe for browser IndexedDB without exhausting quota) */
export const MAX_LOCAL_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export interface StoredLocalFileRecord extends LocalEnvironmentFileRef {
  blob: Blob;
  textPreview?: string;
}

export type LocalFileResolutionStatus =
  | 'available'
  | 'missing-on-device'
  | 'corrupted'
  | 'unsupported-browser';

export interface ResolvedLocalEnvironmentFile {
  status: LocalFileResolutionStatus;
  ref: LocalEnvironmentFileRef;
  blob?: Blob;
  objectUrl?: string;
  dataUrl?: string;
  textContent?: string;
  message: string;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedCategory?: LocalEnvironmentFileCategory;
  normalizedMimeType?: string;
}

/**
 * Storage provider abstraction so a future Firebase Cloud Storage adapter
 * can be swapped in without modifying EnvironmentStudioPage or simulation consumers.
 */
export interface EnvironmentFileStorageProvider {
  readonly backendName: 'indexeddb-local';
  validateFile(
    file: File,
    expectedCategory?: LocalEnvironmentFileCategory
  ): FileValidationResult;
  saveFile(params: {
    file: File;
    category: LocalEnvironmentFileCategory;
    environmentId: string;
    ownerUid?: string | null;
    existingFileId?: string;
  }): Promise<ResolvedLocalEnvironmentFile>;
  getFile(
    ref: LocalEnvironmentFileRef,
    currentUid?: string | null
  ): Promise<ResolvedLocalEnvironmentFile>;
  listFilesForEnvironment(
    environmentId: string,
    currentUid?: string | null
  ): Promise<LocalEnvironmentFileRef[]>;
  listAllWorkspaceFiles(
    currentUid?: string | null
  ): Promise<LocalEnvironmentFileRef[]>;
  deleteFile(localFileId: string): Promise<boolean>;
  claimGuestFilesForUser(uid: string): Promise<number>;
}

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openLocalFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      reject(new Error('IndexedDB is not supported in this browser environment.'));
      return;
    }

    const request = window.indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        const store = db.createObjectStore(IDB_STORE_NAME, {
          keyPath: 'localFileId',
        });
        store.createIndex('environmentId', 'environmentId', { unique: false });
        store.createIndex('ownerUid', 'ownerUid', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB database.'));
  });
}

async function computeBlobSignature(blob: Blob): Promise<string> {
  try {
    const slice = blob.slice(0, Math.min(blob.size, 4096));
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${blob.size}-${(hash >>> 0).toString(16)}`;
  } catch {
    return `size-${blob.size}`;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to convert Blob to Data URL.'));
    reader.readAsDataURL(blob);
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateEnvironmentFile(
  file: File,
  expectedCategory?: LocalEnvironmentFileCategory
): FileValidationResult {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty (0 bytes). Please choose a valid asset file.`,
    };
  }
  if (file.size > MAX_LOCAL_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File "${file.name}" (${formatBytes(
        file.size
      )}) exceeds the 25 MB local IndexedDB limit.`,
    };
  }

  const lowerName = file.name.toLowerCase().trim();
  const ext = lowerName.includes('.')
    ? lowerName.slice(lowerName.lastIndexOf('.'))
    : '';

  if (expectedCategory === 'floorplan-image') {
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const isImageMime = file.type.startsWith('image/');
    if (!allowedExts.includes(ext) && !isImageMime) {
      return {
        valid: false,
        error: `Unsupported floor plan format "${
          ext || file.type || 'unknown'
        }". Please upload a PNG, JPG, or WebP floor plan image.`,
      };
    }
    return {
      valid: true,
      detectedCategory: 'floorplan-image',
      normalizedMimeType: file.type || 'image/png',
    };
  }

  if (expectedCategory === 'ros-occupancy-image') {
    const allowedExts = ['.png', '.pgm', '.jpg', '.jpeg', '.bmp', '.webp'];
    if (!allowedExts.includes(ext) && !file.type.startsWith('image/')) {
      return {
        valid: false,
        error: `Unsupported ROS occupancy grid image "${
          ext || file.type
        }". Allowed: .png, .pgm, .jpg, .bmp.`,
      };
    }
    return {
      valid: true,
      detectedCategory: 'ros-occupancy-image',
      normalizedMimeType: file.type || 'image/png',
    };
  }

  if (expectedCategory === 'ros-yaml') {
    const allowedExts = ['.yaml', '.yml', '.txt'];
    if (!allowedExts.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported ROS metadata file "${ext}". Please upload a .yaml or .yml file.`,
      };
    }
    return {
      valid: true,
      detectedCategory: 'ros-yaml',
      normalizedMimeType: 'text/yaml',
    };
  }

  if (expectedCategory === 'gltf-3d') {
    const allowedExts = ['.glb', '.gltf'];
    if (!allowedExts.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported 3D asset "${ext}". Please select a .glb or .gltf file.`,
      };
    }
    return {
      valid: true,
      detectedCategory: 'gltf-3d',
      normalizedMimeType:
        ext === '.glb' ? 'model/gltf-binary' : 'model/gltf+json',
    };
  }

  if (expectedCategory === 'geojson') {
    const allowedExts = ['.geojson', '.json'];
    if (!allowedExts.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported GeoJSON file "${ext}". Please select a .geojson or .json file.`,
      };
    }
    return {
      valid: true,
      detectedCategory: 'geojson',
      normalizedMimeType: 'application/geo+json',
    };
  }

  // Auto-detect category by extension
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    return {
      valid: true,
      detectedCategory: 'floorplan-image',
      normalizedMimeType: file.type || 'image/png',
    };
  }
  if (ext === '.pgm') {
    return {
      valid: true,
      detectedCategory: 'ros-occupancy-image',
      normalizedMimeType: 'image/x-portable-graymap',
    };
  }
  if (['.yaml', '.yml'].includes(ext)) {
    return {
      valid: true,
      detectedCategory: 'ros-yaml',
      normalizedMimeType: 'text/yaml',
    };
  }
  if (['.glb', '.gltf'].includes(ext)) {
    return {
      valid: true,
      detectedCategory: 'gltf-3d',
      normalizedMimeType:
        ext === '.glb' ? 'model/gltf-binary' : 'model/gltf+json',
    };
  }
  if (['.geojson', '.json'].includes(ext)) {
    return {
      valid: true,
      detectedCategory: 'geojson',
      normalizedMimeType: 'application/geo+json',
    };
  }

  return {
    valid: false,
    error: `Unsupported environment asset format "${
      ext || file.name
    }". Supported formats: PNG, JPG, PGM, YAML, GeoJSON, GLB, GLTF.`,
  };
}

class IndexedDbEnvironmentFileStorage implements EnvironmentFileStorageProvider {
  readonly backendName = 'indexeddb-local' as const;

  validateFile(
    file: File,
    expectedCategory?: LocalEnvironmentFileCategory
  ): FileValidationResult {
    return validateEnvironmentFile(file, expectedCategory);
  }

  async saveFile(params: {
    file: File;
    category: LocalEnvironmentFileCategory;
    environmentId: string;
    ownerUid?: string | null;
    existingFileId?: string;
  }): Promise<ResolvedLocalEnvironmentFile> {
    const validation = this.validateFile(params.file, params.category);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid file.');
    }

    const nowIso = new Date().toISOString();
    const localFileId =
      params.existingFileId ||
      `idb-file-${params.environmentId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
    const ownerUid = params.ownerUid || 'local-workspace';
    const mimeType =
      validation.normalizedMimeType ||
      params.file.type ||
      'application/octet-stream';

    const blob = new Blob([await params.file.arrayBuffer()], { type: mimeType });
    const checksum = await computeBlobSignature(blob);

    let textPreview: string | undefined;
    if (
      params.category === 'ros-yaml' ||
      params.category === 'geojson' ||
      params.file.name.endsWith('.gltf')
    ) {
      try {
        textPreview = (await params.file.text()).slice(0, 200000);
      } catch {
        textPreview = undefined;
      }
    }

    const ref: LocalEnvironmentFileRef = {
      localFileId,
      fileName: params.file.name,
      mimeType,
      sizeBytes: blob.size,
      category: params.category,
      ownerUid,
      environmentId: params.environmentId,
      createdAt: nowIso,
      updatedAt: nowIso,
      storageBackend: 'indexeddb-local',
      checksum,
    };

    const record: StoredLocalFileRecord = {
      ...ref,
      blob,
      textPreview,
    };

    const db = await openLocalFilesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('Failed to write file to IndexedDB.'));
      };
    });

    let dataUrl: string | undefined;
    let objectUrl: string | undefined;
    if (
      params.category === 'floorplan-image' ||
      params.category === 'ros-occupancy-image'
    ) {
      dataUrl = await blobToDataUrl(blob);
    } else if (typeof URL !== 'undefined' && URL.createObjectURL) {
      objectUrl = URL.createObjectURL(blob);
    }

    return {
      status: 'available',
      ref,
      blob,
      dataUrl,
      objectUrl,
      textContent: textPreview,
      message: `Saved "${ref.fileName}" (${formatBytes(
        ref.sizeBytes
      )}) in browser IndexedDB (device-local storage).`,
    };
  }

  async getFile(
    ref: LocalEnvironmentFileRef,
    currentUid?: string | null
  ): Promise<ResolvedLocalEnvironmentFile> {
    if (!isIndexedDbSupported()) {
      return {
        status: 'unsupported-browser',
        ref,
        message: 'IndexedDB is unavailable in this browser.',
      };
    }

    try {
      const db = await openLocalFilesDb();
      const record = await new Promise<StoredLocalFileRecord | undefined>(
        (resolve, reject) => {
          const tx = db.transaction(IDB_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDB_STORE_NAME);
          const req = store.get(ref.localFileId);
          req.onsuccess = () => {
            db.close();
            resolve(req.result as StoredLocalFileRecord | undefined);
          };
          req.onerror = () => {
            db.close();
            reject(req.error);
          };
        }
      );

      if (!record) {
        return {
          status: 'missing-on-device',
          ref,
          message: `File "${ref.fileName}" (${formatBytes(
            ref.sizeBytes
          )}) was saved in IndexedDB on another browser or device and is not present in this browser's local storage. Re-upload the file to preview it on this device.`,
        };
      }

      // Enforce strict per-user workspace isolation:
      // Authenticated users only access files owned by their UID;
      // Guest workspace only accesses files owned by 'local-workspace'.
      const expectedOwner = currentUid || 'local-workspace';
      const recordOwner = record.ownerUid || 'local-workspace';
      if (recordOwner !== expectedOwner) {
        return {
          status: 'missing-on-device',
          ref,
          message: `File "${ref.fileName}" belongs to a different workspace account on this device.`,
        };
      }

      if (
        !record.blob ||
        typeof record.blob.size !== 'number' ||
        record.blob.size <= 0 ||
        (ref.sizeBytes > 0 && record.blob.size !== ref.sizeBytes)
      ) {
        return {
          status: 'corrupted',
          ref,
          message: `Local IndexedDB file "${ref.fileName}" appears corrupted or incomplete (expected ${formatBytes(
            ref.sizeBytes
          )}, found ${formatBytes(record.blob?.size ?? 0)}). Please re-upload the file.`,
        };
      }

      if (ref.checksum) {
        const actualChecksum = await computeBlobSignature(record.blob);
        if (actualChecksum !== ref.checksum) {
          return {
            status: 'corrupted',
            ref,
            message: `Checksum mismatch for local file "${ref.fileName}". Please re-upload the file.`,
          };
        }
      }

      let dataUrl: string | undefined;
      let objectUrl: string | undefined;
      if (
        record.category === 'floorplan-image' ||
        record.category === 'ros-occupancy-image'
      ) {
        dataUrl = await blobToDataUrl(record.blob);
      } else if (typeof URL !== 'undefined' && URL.createObjectURL) {
        objectUrl = URL.createObjectURL(record.blob);
      }

      return {
        status: 'available',
        ref: {
          localFileId: record.localFileId,
          fileName: record.fileName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          category: record.category,
          ownerUid: record.ownerUid,
          environmentId: record.environmentId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          storageBackend: 'indexeddb-local',
          checksum: record.checksum,
        },
        blob: record.blob,
        dataUrl,
        objectUrl,
        textContent: record.textPreview,
        message: `Loaded "${record.fileName}" (${formatBytes(
          record.sizeBytes
        )}) from browser IndexedDB.`,
      };
    } catch (err) {
      return {
        status: 'corrupted',
        ref,
        message:
          err instanceof Error
            ? err.message
            : `Failed to read "${ref.fileName}" from IndexedDB.`,
      };
    }
  }

  async listFilesForEnvironment(
    environmentId: string,
    currentUid?: string | null
  ): Promise<LocalEnvironmentFileRef[]> {
    const all = await this.listAllWorkspaceFiles(currentUid);
    return all.filter((f) => f.environmentId === environmentId);
  }

  async listAllWorkspaceFiles(
    currentUid?: string | null
  ): Promise<LocalEnvironmentFileRef[]> {
    if (!isIndexedDbSupported()) return [];
    try {
      const db = await openLocalFilesDb();
      const records = await new Promise<StoredLocalFileRecord[]>(
        (resolve, reject) => {
          const tx = db.transaction(IDB_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDB_STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as StoredLocalFileRecord[]) || []);
          };
          req.onerror = () => {
            db.close();
            reject(req.error);
          };
        }
      );

      const expectedOwner = currentUid || 'local-workspace';
      return records
        .filter((r) => {
          if (!r || !r.localFileId) return false;
          const recordOwner = r.ownerUid || 'local-workspace';
          return recordOwner === expectedOwner;
        })
        .map((r) => ({
          localFileId: r.localFileId,
          fileName: r.fileName,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
          category: r.category,
          ownerUid: r.ownerUid,
          environmentId: r.environmentId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          storageBackend: 'indexeddb-local' as const,
          checksum: r.checksum,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async deleteFile(localFileId: string): Promise<boolean> {
    if (!isIndexedDbSupported() || !localFileId) return false;
    try {
      const db = await openLocalFilesDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.delete(localFileId);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
      return true;
    } catch {
      return false;
    }
  }

  async claimGuestFilesForUser(uid: string): Promise<number> {
    if (!isIndexedDbSupported() || !uid) return 0;
    try {
      const db = await openLocalFilesDb();
      const records = await new Promise<StoredLocalFileRecord[]>(
        (resolve, reject) => {
          const tx = db.transaction(IDB_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDB_STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve((req.result as StoredLocalFileRecord[]) || []);
          req.onerror = () => reject(req.error);
        }
      );

      const guestRecords = records.filter(
        (r) => !r.ownerUid || r.ownerUid === 'local-workspace'
      );
      if (guestRecords.length === 0) {
        db.close();
        return 0;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        for (const rec of guestRecords) {
          store.put({
            ...rec,
            ownerUid: uid,
            updatedAt: new Date().toISOString(),
          });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });

      return guestRecords.length;
    } catch {
      return 0;
    }
  }
}

export const localEnvironmentFileStorage: EnvironmentFileStorageProvider =
  new IndexedDbEnvironmentFileStorage();
