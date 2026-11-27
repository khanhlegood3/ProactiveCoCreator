/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppMode,
  AspectRatio,
  BeliefState,
  Clarification,
  CoCreatorExportBundle,
  CryptoSolanaTrack,
  DomainBlueprint,
  GamePortalTrack,
  GeneratedImage,
  ImagePart,
  Language,
  Proactiveness,
  SavedSessionRecord,
  StoryType,
  WorkspaceSnapshot,
} from '../types';

const DB_NAME = 'proactive_cocreator_idb';
const DB_VERSION = 1;
const WORKSPACE_STORE = 'workspace';
const SESSIONS_STORE = 'sessions';
const MAX_SESSIONS = 100;

const VALID_MODES: AppMode[] = ['image', 'story', 'video', 'game-portal', 'crypto-solana'];
const VALID_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4', '1:4', '1:8', '4:1', '8:1'];
const VALID_STORY_TYPES: StoryType[] = ['generic', 'video-prompt'];
const VALID_PROACTIVENESS: Proactiveness[] = ['low', 'medium', 'high'];
const VALID_GP_TRACKS: GamePortalTrack[] = ['playtest-b2b', 'distribution-liveops', 'gate-pricing'];
const VALID_CRYPTO_TRACKS: CryptoSolanaTrack[] = ['pumpfun-launch', 'solana-escrow', 'usdt-usdc-rails'];

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
          db.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('IndexedDB open failed:', request.error);
        resolve(null);
      };
      request.onblocked = () => {
        console.warn('IndexedDB open blocked.');
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB unavailable:', err);
      resolve(null);
    }
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  executor: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let settled = false;
    let resultValue: T;

    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(resultValue);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('IndexedDB transaction failed.'));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('IndexedDB transaction aborted.'));
      }
    };

    Promise.resolve(executor(tx))
      .then((val) => {
        resultValue = val;
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          try {
            tx.abort();
          } catch {
            // ignore
          }
          reject(err);
        }
      });
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed.'));
  });
}

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    await runTransaction(db, WORKSPACE_STORE, 'readwrite', async (tx) => {
      const store = tx.objectStore(WORKSPACE_STORE);
      await requestToPromise(store.put({ ...snapshot, id: 'current' }));
    });
    return true;
  } catch (err) {
    console.warn('Failed to save workspace snapshot to IndexedDB:', err);
    return false;
  } finally {
    db.close();
  }
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const raw = await runTransaction<WorkspaceSnapshot | undefined>(
      db,
      WORKSPACE_STORE,
      'readonly',
      async (tx) => {
        const store = tx.objectStore(WORKSPACE_STORE);
        return await requestToPromise(store.get('current'));
      }
    );
    return raw ? sanitizeWorkspaceSnapshot(raw) : null;
  } catch (err) {
    console.warn('Failed to load workspace snapshot from IndexedDB:', err);
    return null;
  } finally {
    db.close();
  }
}

export async function listSessionRecords(): Promise<SavedSessionRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const all = await runTransaction<SavedSessionRecord[]>(db, SESSIONS_STORE, 'readonly', async (tx) => {
      const store = tx.objectStore(SESSIONS_STORE);
      return await requestToPromise(store.getAll());
    });
    return (Array.isArray(all) ? all : [])
      .map(sanitizeSessionRecord)
      .filter((s): s is SavedSessionRecord => s !== null)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  } catch (err) {
    console.warn('Failed to list sessions from IndexedDB:', err);
    return [];
  } finally {
    db.close();
  }
}

export async function saveSessionRecord(record: SavedSessionRecord): Promise<SavedSessionRecord[]> {
  const db = await openDb();
  const normalized = sanitizeSessionRecord(record);
  if (!db || !normalized) {
    return listSessionRecords();
  }
  try {
    await runTransaction(db, SESSIONS_STORE, 'readwrite', async (tx) => {
      const store = tx.objectStore(SESSIONS_STORE);
      await requestToPromise(store.put(normalized));
      const all = (await requestToPromise(store.getAll())) as SavedSessionRecord[];
      if (all.length > MAX_SESSIONS) {
        const sorted = [...all].sort(
          (a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)
        );
        const toDelete = sorted.slice(MAX_SESSIONS);
        for (const oldItem of toDelete) {
          await requestToPromise(store.delete(oldItem.id));
        }
      }
    });
  } catch (err) {
    console.warn('Failed to save session to IndexedDB:', err);
  } finally {
    db.close();
  }
  return listSessionRecords();
}

export async function deleteSessionRecord(id: string): Promise<SavedSessionRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    await runTransaction(db, SESSIONS_STORE, 'readwrite', async (tx) => {
      const store = tx.objectStore(SESSIONS_STORE);
      await requestToPromise(store.delete(id));
    });
  } catch (err) {
    console.warn('Failed to delete session from IndexedDB:', err);
  } finally {
    db.close();
  }
  return listSessionRecords();
}

export async function clearAllSessions(): Promise<SavedSessionRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    await runTransaction(db, SESSIONS_STORE, 'readwrite', async (tx) => {
      const store = tx.objectStore(SESSIONS_STORE);
      await requestToPromise(store.clear());
    });
  } catch (err) {
    console.warn('Failed to clear sessions from IndexedDB:', err);
  } finally {
    db.close();
  }
  return [];
}

export async function replaceAllSessions(records: SavedSessionRecord[]): Promise<SavedSessionRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const sanitized = records
    .map(sanitizeSessionRecord)
    .filter((r): r is SavedSessionRecord => r !== null)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, MAX_SESSIONS);

  try {
    await runTransaction(db, SESSIONS_STORE, 'readwrite', async (tx) => {
      const store = tx.objectStore(SESSIONS_STORE);
      for (const rec of sanitized) {
        await requestToPromise(store.put(rec));
      }
      const all = (await requestToPromise(store.getAll())) as SavedSessionRecord[];
      if (all.length > MAX_SESSIONS) {
        const sorted = [...all].sort(
          (a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)
        );
        for (const extra of sorted.slice(MAX_SESSIONS)) {
          await requestToPromise(store.delete(extra.id));
        }
      }
    });
  } catch (err) {
    console.warn('Failed to merge imported sessions into IndexedDB:', err);
  } finally {
    db.close();
  }
  return listSessionRecords();
}

function sanitizeStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

function sanitizeClarifications(raw: unknown): Clarification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Clarification => {
      return (
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as any).question === 'string' &&
        Array.isArray((item as any).options)
      );
    })
    .map((item) => ({
      question: item.question,
      options: item.options.filter((o): o is string => typeof o === 'string'),
    }));
}

function sanitizeBeliefGraph(raw: unknown): BeliefState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as any;
  if (!Array.isArray(obj.entities)) return null;
  return {
    entities: obj.entities,
    relationships: Array.isArray(obj.relationships) ? obj.relationships : [],
    ...(typeof obj.prompt === 'string' ? { prompt: obj.prompt } : {}),
  };
}

function sanitizeImages(raw: unknown): GeneratedImage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item: any) => ({
      url: typeof item.url === 'string' ? item.url : null,
      ...(typeof item.error === 'string' ? { error: item.error } : {}),
    }));
}

function sanitizeUploadedImages(raw: unknown): ImagePart[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ImagePart =>
      Boolean(item) &&
      typeof item === 'object' &&
      Boolean((item as any).inlineData) &&
      typeof (item as any).inlineData.data === 'string' &&
      typeof (item as any).inlineData.mimeType === 'string'
  );
}

function sanitizeBlueprint(raw: unknown): DomainBlueprint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as any;
  if ((b.domain !== 'game-portal' && b.domain !== 'crypto-solana') || typeof b.title !== 'string') {
    return null;
  }
  return {
    domain: b.domain,
    title: b.title,
    executiveSummary: typeof b.executiveSummary === 'string' ? b.executiveSummary : '',
    architecturePhases: Array.isArray(b.architecturePhases) ? b.architecturePhases : [],
    tiersOrTokenomics: Array.isArray(b.tiersOrTokenomics) ? b.tiersOrTokenomics : [],
    gateCriteria: Array.isArray(b.gateCriteria) ? b.gateCriteria : [],
    escrowAndReceiptFlow: sanitizeStringArray(b.escrowAndReceiptFlow),
    risks: Array.isArray(b.risks) ? b.risks : [],
    nextActions: sanitizeStringArray(b.nextActions),
  };
}

function sanitizeMode(raw: unknown): AppMode {
  return VALID_MODES.includes(raw as AppMode) ? (raw as AppMode) : 'image';
}

export function sanitizeWorkspaceSnapshot(raw: any): WorkspaceSnapshot {
  const mode = sanitizeMode(raw?.mode);
  const galleryErrorsRaw = raw?.galleryErrors && typeof raw.galleryErrors === 'object' ? raw.galleryErrors : {};
  const blueprintsRaw = raw?.blueprints && typeof raw.blueprints === 'object' ? raw.blueprints : {};
  return {
    id: 'current',
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(raw?.language === 'vi' || raw?.language === 'en' ? { language: raw.language } : {}),
    mode,
    gamePortalTrack: VALID_GP_TRACKS.includes(raw?.gamePortalTrack)
      ? raw.gamePortalTrack
      : 'playtest-b2b',
    cryptoSolanaTrack: VALID_CRYPTO_TRACKS.includes(raw?.cryptoSolanaTrack)
      ? raw.cryptoSolanaTrack
      : 'pumpfun-launch',
    prompt: typeof raw?.prompt === 'string' ? raw.prompt : '',
    uploadedImages: sanitizeUploadedImages(raw?.uploadedImages),
    aspectRatio: VALID_RATIOS.includes(raw?.aspectRatio) ? raw.aspectRatio : '16:9',
    resolution: typeof raw?.resolution === 'string' ? raw.resolution : '1K',
    selectedModel: typeof raw?.selectedModel === 'string' ? raw.selectedModel : 'gemini-2.5-flash-image',
    selectedClarificationModel:
      typeof raw?.selectedClarificationModel === 'string'
        ? raw.selectedClarificationModel
        : 'gemini-3-flash-preview',
    storyType: VALID_STORY_TYPES.includes(raw?.storyType) ? raw.storyType : 'generic',
    proactiveness: VALID_PROACTIVENESS.includes(raw?.proactiveness) ? raw.proactiveness : 'medium',
    beliefGraph: sanitizeBeliefGraph(raw?.beliefGraph),
    clarifications: sanitizeClarifications(raw?.clarifications),
    answeredQuestions: sanitizeStringArray(raw?.answeredQuestions),
    skippedQuestions: sanitizeStringArray(raw?.skippedQuestions),
    pendingAttributeUpdates: sanitizeStringRecord(raw?.pendingAttributeUpdates),
    pendingRelationshipUpdates: sanitizeStringRecord(raw?.pendingRelationshipUpdates),
    pendingClarificationAnswers: sanitizeStringRecord(raw?.pendingClarificationAnswers),
    lastAnalyzedPrompt: typeof raw?.lastAnalyzedPrompt === 'string' ? raw.lastAnalyzedPrompt : null,
    lastAnalyzedMode: raw?.lastAnalyzedMode ? sanitizeMode(raw.lastAnalyzedMode) : null,
    lastAnalyzedImagesSignature:
      typeof raw?.lastAnalyzedImagesSignature === 'string' ? raw.lastAnalyzedImagesSignature : '',
    hasGenerated: Boolean(raw?.hasGenerated),
    isOutdated: Boolean(raw?.isOutdated),
    activeToolTab:
      raw?.activeToolTab === 'graph' || raw?.activeToolTab === 'attributes'
        ? raw.activeToolTab
        : 'clarify',
    isDarkMode: Boolean(raw?.isDarkMode),
    images: sanitizeImages(raw?.images),
    story: typeof raw?.story === 'string' ? raw.story : null,
    video:
      typeof raw?.video === 'string' && !raw.video.startsWith('blob:')
        ? raw.video
        : null,
    blueprints: {
      ...(sanitizeBlueprint(blueprintsRaw['game-portal'])
        ? { 'game-portal': sanitizeBlueprint(blueprintsRaw['game-portal']) }
        : {}),
      ...(sanitizeBlueprint(blueprintsRaw['crypto-solana'])
        ? { 'crypto-solana': sanitizeBlueprint(blueprintsRaw['crypto-solana']) }
        : {}),
    },
    galleryErrors: {
      image: typeof galleryErrorsRaw.image === 'string' ? galleryErrorsRaw.image : null,
      story: typeof galleryErrorsRaw.story === 'string' ? galleryErrorsRaw.story : null,
      video: typeof galleryErrorsRaw.video === 'string' ? galleryErrorsRaw.video : null,
      'game-portal':
        typeof galleryErrorsRaw['game-portal'] === 'string' ? galleryErrorsRaw['game-portal'] : null,
      'crypto-solana':
        typeof galleryErrorsRaw['crypto-solana'] === 'string' ? galleryErrorsRaw['crypto-solana'] : null,
    },
  };
}

export function sanitizeSessionRecord(raw: any): SavedSessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.prompt !== 'string' && !raw.beliefGraph && !raw.results) return null;

  const mode = sanitizeMode(raw.mode);
  const nowIso = new Date().toISOString();
  const settingsRaw = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const resultsRaw = raw.results && typeof raw.results === 'object' ? raw.results : {};
  const actionType =
    raw.actionType === 'analyze' ||
    raw.actionType === 'refine' ||
    raw.actionType === 'generate' ||
    raw.actionType === 'snapshot' ||
    raw.actionType === 'imported'
      ? raw.actionType
      : 'imported';

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createSessionId(),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso,
    actionType,
    mode,
    domainTrack:
      mode === 'game-portal' && VALID_GP_TRACKS.includes(raw.domainTrack)
        ? raw.domainTrack
        : mode === 'crypto-solana' && VALID_CRYPTO_TRACKS.includes(raw.domainTrack)
          ? raw.domainTrack
          : undefined,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    ...(typeof raw.refinedFromPrompt === 'string'
      ? { refinedFromPrompt: raw.refinedFromPrompt }
      : {}),
    ...(Array.isArray(raw.qaPairs)
      ? {
          qaPairs: raw.qaPairs.filter(
            (q: any) => q && typeof q.question === 'string' && typeof q.answer === 'string'
          ),
        }
      : {}),
    ...(Array.isArray(raw.graphUpdatesApplied)
      ? { graphUpdatesApplied: raw.graphUpdatesApplied }
      : {}),
    clarifications: sanitizeClarifications(raw.clarifications),
    answeredQuestions: sanitizeStringArray(raw.answeredQuestions),
    skippedQuestions: sanitizeStringArray(raw.skippedQuestions),
    pendingClarificationAnswers: sanitizeStringRecord(raw.pendingClarificationAnswers),
    beliefGraph: sanitizeBeliefGraph(raw.beliefGraph),
    pendingAttributeUpdates: sanitizeStringRecord(raw.pendingAttributeUpdates),
    pendingRelationshipUpdates: sanitizeStringRecord(raw.pendingRelationshipUpdates),
    settings: {
      aspectRatio: VALID_RATIOS.includes(settingsRaw.aspectRatio) ? settingsRaw.aspectRatio : '16:9',
      resolution: typeof settingsRaw.resolution === 'string' ? settingsRaw.resolution : '1K',
      selectedModel:
        typeof settingsRaw.selectedModel === 'string'
          ? settingsRaw.selectedModel
          : mode === 'image'
            ? 'gemini-2.5-flash-image'
            : mode === 'video'
              ? 'gemini-omni-1.2-flash'
              : 'gemini-3-flash-preview',
      selectedClarificationModel:
        typeof settingsRaw.selectedClarificationModel === 'string'
          ? settingsRaw.selectedClarificationModel
          : 'gemini-3-flash-preview',
      storyType: VALID_STORY_TYPES.includes(settingsRaw.storyType) ? settingsRaw.storyType : 'generic',
      proactiveness: VALID_PROACTIVENESS.includes(settingsRaw.proactiveness)
        ? settingsRaw.proactiveness
        : 'medium',
      uploadedImages: sanitizeUploadedImages(settingsRaw.uploadedImages),
    },
    results: {
      images: sanitizeImages(resultsRaw.images),
      story: typeof resultsRaw.story === 'string' ? resultsRaw.story : null,
      video:
        typeof resultsRaw.video === 'string' && !resultsRaw.video.startsWith('blob:')
          ? resultsRaw.video
          : null,
      blueprint: sanitizeBlueprint(resultsRaw.blueprint),
      error: typeof resultsRaw.error === 'string' ? resultsRaw.error : null,
    },
  };
}

export function triggerJsonDownload(filename: string, payload: unknown): void {
  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseImportedJsonBundle(
  rawText: string,
  fallbackWorkspace: WorkspaceSnapshot,
  language: Language = 'vi'
): {
  workspace?: WorkspaceSnapshot;
  sessions: SavedSessionRecord[];
  summary: string;
} {
  const tr = (vi: string, en: string) => (language === 'vi' ? vi : en);
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(tr('File JSON không hợp lệ hoặc sai cú pháp.', 'Invalid or malformed JSON file.'));
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      tr(
        'Nội dung JSON phải là một đối tượng hoặc danh sách phiên.',
        'JSON content must be an object or session array.'
      )
    );
  }

  // Case 1: Full CoCreatorExportBundle
  if (parsed.currentWorkspace || Array.isArray(parsed.sessions)) {
    const workspace = parsed.currentWorkspace
      ? sanitizeWorkspaceSnapshot(parsed.currentWorkspace)
      : undefined;
    const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : [])
      .map(sanitizeSessionRecord)
      .filter((s): s is SavedSessionRecord => s !== null);

    if (!workspace && sessions.length === 0) {
      throw new Error(
        tr(
          'File JSON không chứa dữ liệu workspace hay phiên làm việc hợp lệ.',
          'JSON file does not contain valid workspace or session records.'
        )
      );
    }

    return {
      workspace,
      sessions,
      summary: tr(
        `Đã nhập ${sessions.length} phiên vào IndexedDB${workspace ? ' và khôi phục trạng thái hiện tại' : ''}.`,
        `Imported ${sessions.length} session(s) into IndexedDB${workspace ? ' and restored current workspace' : ''}.`
      ),
    };
  }

  // Case 2: Array of SavedSessionRecord
  if (Array.isArray(parsed)) {
    const sessions = parsed
      .map(sanitizeSessionRecord)
      .filter((s): s is SavedSessionRecord => s !== null);
    if (sessions.length === 0) {
      throw new Error(
        tr(
          'Danh sách JSON không chứa phiên làm việc hợp lệ.',
          'JSON array does not contain any valid session records.'
        )
      );
    }
    return {
      sessions,
      summary: tr(
        `Đã nhập ${sessions.length} phiên lịch sử vào IndexedDB.`,
        `Imported ${sessions.length} history session(s) into IndexedDB.`
      ),
    };
  }

  // Case 3: Single DomainBlueprint JSON downloaded from OutputGallery
  const blueprint = sanitizeBlueprint(parsed);
  if (blueprint) {
    const nowIso = new Date().toISOString();
    const bpSession: SavedSessionRecord = {
      id: createSessionId(),
      createdAt: nowIso,
      updatedAt: nowIso,
      actionType: 'imported',
      mode: blueprint.domain,
      domainTrack: blueprint.domain === 'game-portal' ? 'playtest-b2b' : 'pumpfun-launch',
      prompt: blueprint.executiveSummary || blueprint.title,
      clarifications: [],
      answeredQuestions: [],
      skippedQuestions: [],
      pendingClarificationAnswers: {},
      beliefGraph: null,
      pendingAttributeUpdates: {},
      pendingRelationshipUpdates: {},
      settings: {
        aspectRatio: fallbackWorkspace.aspectRatio,
        resolution: fallbackWorkspace.resolution,
        selectedModel: 'gemini-3-flash-preview',
        selectedClarificationModel: fallbackWorkspace.selectedClarificationModel,
        storyType: fallbackWorkspace.storyType,
        proactiveness: fallbackWorkspace.proactiveness,
        uploadedImages: [],
      },
      results: {
        images: [],
        story: null,
        video: null,
        blueprint,
        error: null,
      },
    };
    const nextWorkspace: WorkspaceSnapshot = {
      ...fallbackWorkspace,
      updatedAt: nowIso,
      mode: blueprint.domain,
      prompt: bpSession.prompt,
      selectedModel: 'gemini-3-flash-preview',
      hasGenerated: true,
      isOutdated: false,
      blueprints: {
        ...fallbackWorkspace.blueprints,
        [blueprint.domain]: blueprint,
      },
    };
    return {
      workspace: nextWorkspace,
      sessions: [bpSession],
      summary: tr(
        `Đã nhập Blueprint "${blueprint.title}" và lưu vào IndexedDB.`,
        `Imported Blueprint "${blueprint.title}" and saved to IndexedDB.`
      ),
    };
  }

  // Case 4: Single SavedSessionRecord or WorkspaceSnapshot-like object
  if (parsed.id === 'current' && typeof parsed.prompt === 'string') {
    const workspace = sanitizeWorkspaceSnapshot(parsed);
    const activeBlueprint =
      workspace.mode === 'game-portal' || workspace.mode === 'crypto-solana'
        ? workspace.blueprints[workspace.mode] ?? null
        : null;
    const singleSession: SavedSessionRecord = {
      id: createSessionId(),
      createdAt: workspace.updatedAt,
      updatedAt: workspace.updatedAt,
      actionType: 'imported',
      mode: workspace.mode,
      domainTrack:
        workspace.mode === 'game-portal'
          ? workspace.gamePortalTrack
          : workspace.mode === 'crypto-solana'
            ? workspace.cryptoSolanaTrack
            : undefined,
      prompt: workspace.prompt,
      clarifications: workspace.clarifications,
      answeredQuestions: workspace.answeredQuestions,
      skippedQuestions: workspace.skippedQuestions,
      pendingClarificationAnswers: workspace.pendingClarificationAnswers,
      beliefGraph: workspace.beliefGraph,
      pendingAttributeUpdates: workspace.pendingAttributeUpdates,
      pendingRelationshipUpdates: workspace.pendingRelationshipUpdates,
      settings: {
        aspectRatio: workspace.aspectRatio,
        resolution: workspace.resolution,
        selectedModel: workspace.selectedModel,
        selectedClarificationModel: workspace.selectedClarificationModel,
        storyType: workspace.storyType,
        proactiveness: workspace.proactiveness,
        uploadedImages: workspace.uploadedImages,
      },
      results: {
        images: workspace.images,
        story: workspace.story,
        video: workspace.video,
        blueprint: activeBlueprint,
        error: workspace.galleryErrors[workspace.mode] ?? null,
      },
    };
    return {
      workspace,
      sessions: [singleSession],
      summary: tr(
        'Đã khôi phục workspace từ JSON và lưu vào IndexedDB.',
        'Restored workspace from JSON and saved to IndexedDB.'
      ),
    };
  }

  const singleRecord = sanitizeSessionRecord(parsed);
  if (singleRecord) {
    return {
      sessions: [singleRecord],
      summary: tr(
        'Đã nhập 1 phiên làm việc vào IndexedDB.',
        'Imported 1 session record into IndexedDB.'
      ),
    };
  }

  throw new Error(tr('Định dạng JSON không được hỗ trợ.', 'Unsupported JSON format.'));
}

export function buildExportBundle(
  currentWorkspace: WorkspaceSnapshot,
  sessions: SavedSessionRecord[]
): CoCreatorExportBundle {
  return {
    schemaVersion: 1,
    app: 'proactive-co-creator',
    exportedAt: new Date().toISOString(),
    currentWorkspace,
    sessions,
  };
}
