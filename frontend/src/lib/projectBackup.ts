import {
  createProjectDocument,
  hydrateProjectDocument,
  parseProjectDocument,
  ProjectDocumentError,
  type HydratedProject,
  type ProjectDocumentV1,
  type ProjectState,
} from "./projectDocument";

const BACKUP_SCHEMA = "vision-label-bench-backup";
const BACKUP_VERSION = 1 as const;

interface ProjectBackupFile {
  fileKey: string;
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
}

interface ProjectBackupV1 {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  project: ProjectDocumentV1;
  files: ProjectBackupFile[];
}

export async function downloadProjectBackup(state: ProjectState): Promise<string> {
  const backup = await createProjectBackup(state);
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `vision-label-bench-${dateStamp(new Date())}.vlb.json`;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

export async function createProjectBackup(state: ProjectState): Promise<ProjectBackupV1> {
  const project = createProjectDocument(state);
  const files = await Promise.all(state.images.map(async (image): Promise<ProjectBackupFile> => ({
    fileKey: image.id,
    name: image.file.name,
    type: image.file.type,
    lastModified: image.file.lastModified,
    dataUrl: await fileToDataUrl(image.file),
  })));
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    project,
    files,
  };
}

export async function readProjectBackup(file: File): Promise<HydratedProject> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new ProjectDocumentError("프로젝트 파일의 JSON을 읽지 못했습니다.");
  }
  return hydrateProjectBackup(parseProjectBackup(value));
}

export function parseProjectBackup(value: unknown): ProjectBackupV1 {
  if (!isRecord(value) || value.schema !== BACKUP_SCHEMA) {
    throw new ProjectDocumentError("Vision Label Bench 백업 파일이 아닙니다.");
  }
  if (value.version !== BACKUP_VERSION) {
    throw new ProjectDocumentError(`지원하지 않는 백업 버전입니다: ${String(value.version)}`);
  }
  const project = parseProjectDocument(value.project);
  if (!Array.isArray(value.files)) throw new ProjectDocumentError("백업 이미지 목록이 없습니다.");
  const files = value.files.map((entry, index): ProjectBackupFile => {
    if (!isRecord(entry)) throw new ProjectDocumentError(`files[${index}] 형식이 올바르지 않습니다.`);
    const fileKey = readString(entry.fileKey, `files[${index}].fileKey`);
    const name = readString(entry.name, `files[${index}].name`);
    const type = readString(entry.type, `files[${index}].type`);
    const dataUrl = readString(entry.dataUrl, `files[${index}].dataUrl`);
    if (!type.startsWith("image/") || !dataUrl.startsWith(`data:${type};base64,`)) {
      throw new ProjectDocumentError(`files[${index}] 이미지 데이터 형식이 올바르지 않습니다.`);
    }
    if (typeof entry.lastModified !== "number" || !Number.isFinite(entry.lastModified) || entry.lastModified < 0) {
      throw new ProjectDocumentError(`files[${index}].lastModified 값이 올바르지 않습니다.`);
    }
    return { fileKey, name, type, dataUrl, lastModified: entry.lastModified };
  });
  const keys = new Set<string>();
  for (const entry of files) {
    if (keys.has(entry.fileKey)) throw new ProjectDocumentError(`중복된 백업 이미지 키가 있습니다: ${entry.fileKey}`);
    keys.add(entry.fileKey);
  }
  for (const image of project.images) {
    if (!keys.has(image.fileKey)) throw new ProjectDocumentError(`백업에 이미지가 없습니다: ${image.name}`);
  }
  return { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, project, files };
}

export function hydrateProjectBackup(backup: ProjectBackupV1): HydratedProject {
  const files = new Map(backup.files.map((entry) => [entry.fileKey, dataUrlToFile(entry)]));
  return hydrateProjectDocument(backup.project, files);
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 24_576;
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    let binary = "";
    for (const byte of chunk) binary += String.fromCharCode(byte);
    encoded += btoa(binary);
  }
  return `data:${file.type || "application/octet-stream"};base64,${encoded}`;
}

function dataUrlToFile(entry: ProjectBackupFile): File {
  const separator = entry.dataUrl.indexOf(",");
  const binary = atob(entry.dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], entry.name, { type: entry.type, lastModified: entry.lastModified });
}

function dateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProjectDocumentError(`${path} 값이 올바르지 않습니다.`);
  return value;
}
