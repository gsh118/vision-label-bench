import {
  createProjectDocument,
  hydrateProjectDocument,
  parseProjectDocument,
  type HydratedProject,
  type ProjectDocumentV1,
  type ProjectState,
} from "./projectDocument";

const DATABASE_NAME = "vision-label-bench";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const IMAGE_STORE = "imageFiles";
const CURRENT_PROJECT_ID = "current";

interface ProjectMetaRecord {
  id: typeof CURRENT_PROJECT_ID;
  document: ProjectDocumentV1;
}

interface ImageFileRecord {
  id: string;
  file: File;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let databaseInstance: IDBDatabase | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function saveLocalProject(state: ProjectState): Promise<void> {
  const document = createProjectDocument(state);
  const files = new Map(state.images.map((image) => [image.id, image.file]));
  return enqueueWrite(() => persistProject(document, files));
}

export async function loadLocalProject(): Promise<HydratedProject | null> {
  await writeQueue.catch(() => undefined);
  const database = await openDatabase();
  const transaction = database.transaction([PROJECT_STORE, IMAGE_STORE], "readonly");
  const metaRequest = transaction.objectStore(PROJECT_STORE).get(CURRENT_PROJECT_ID);
  const filesRequest = transaction.objectStore(IMAGE_STORE).getAll();
  const [meta, fileRecords] = await Promise.all([
    requestResult<ProjectMetaRecord | undefined>(metaRequest),
    requestResult<ImageFileRecord[]>(filesRequest),
    transactionComplete(transaction),
  ]);
  if (!meta) return null;
  const document = parseProjectDocument(meta.document);
  const files = new Map(fileRecords.map((record) => [record.id, record.file]));
  return hydrateProjectDocument(document, files);
}

export function clearLocalProject(): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    const transaction = database.transaction([PROJECT_STORE, IMAGE_STORE], "readwrite");
    transaction.objectStore(PROJECT_STORE).clear();
    transaction.objectStore(IMAGE_STORE).clear();
    await transactionComplete(transaction);
  });
}

export async function requestPersistentProjectStorage(): Promise<boolean> {
  try {
    return await navigator.storage?.persist?.() ?? false;
  } catch {
    return false;
  }
}

export async function deleteProjectDatabase(): Promise<void> {
  await writeQueue.catch(() => undefined);
  databaseInstance?.close();
  databaseInstance = null;
  databasePromise = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("프로젝트 저장소를 삭제하지 못했습니다."));
    request.onblocked = () => reject(new Error("열려 있는 프로젝트 저장소가 있어 삭제하지 못했습니다."));
  });
  writeQueue = Promise.resolve();
}

async function persistProject(
  document: ProjectDocumentV1,
  files: ReadonlyMap<string, File>,
): Promise<void> {
  const database = await openDatabase();
  const previous = await readCurrentDocument(database);
  const previousImages = new Map(previous?.images.map((image) => [image.fileKey, image]));
  const nextKeys = new Set(document.images.map((image) => image.fileKey));
  const transaction = database.transaction([PROJECT_STORE, IMAGE_STORE], "readwrite");
  const projectStore = transaction.objectStore(PROJECT_STORE);
  const imageStore = transaction.objectStore(IMAGE_STORE);

  projectStore.put({ id: CURRENT_PROJECT_ID, document } satisfies ProjectMetaRecord);
  for (const image of document.images) {
    const previousImage = previousImages.get(image.fileKey);
    const fileChanged = !previousImage
      || previousImage.fileSize !== image.fileSize
      || previousImage.lastModified !== image.lastModified
      || previousImage.fileType !== image.fileType
      || previousImage.name !== image.name;
    if (fileChanged) {
      const file = files.get(image.fileKey);
      if (!file) {
        transaction.abort();
        throw new Error(`저장할 이미지 파일이 없습니다: ${image.name}`);
      }
      imageStore.put({ id: image.fileKey, file } satisfies ImageFileRecord);
    }
  }
  for (const fileKey of previousImages.keys()) {
    if (!nextKeys.has(fileKey)) imageStore.delete(fileKey);
  }
  await transactionComplete(transaction);
}

async function readCurrentDocument(database: IDBDatabase): Promise<ProjectDocumentV1 | null> {
  const transaction = database.transaction(PROJECT_STORE, "readonly");
  const record = await requestResult<ProjectMetaRecord | undefined>(
    transaction.objectStore(PROJECT_STORE).get(CURRENT_PROJECT_ID),
  );
  await transactionComplete(transaction);
  return record ? parseProjectDocument(record.document) : null;
}

function enqueueWrite(operation: () => Promise<void>): Promise<void> {
  const result = writeQueue.catch(() => undefined).then(operation);
  writeQueue = result;
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(IMAGE_STORE)) {
        database.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      databaseInstance = request.result;
      databaseInstance.onversionchange = () => {
        databaseInstance?.close();
        databaseInstance = null;
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("프로젝트 저장소를 열지 못했습니다."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("다른 창에서 프로젝트 저장소를 사용하고 있습니다."));
    };
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("프로젝트 저장 요청에 실패했습니다."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("프로젝트 저장 트랜잭션에 실패했습니다."));
    transaction.onabort = () => reject(transaction.error ?? new Error("프로젝트 저장 트랜잭션이 취소되었습니다."));
  });
}
