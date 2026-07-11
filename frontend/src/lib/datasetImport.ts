import { unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import type { Annotation, DatasetSplit, LabelClass } from "../types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"]);
const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
};

export interface VirtualFile {
  path: string;
  file: File;
}

export interface DatasetImportIssue {
  level: "warning" | "error";
  message: string;
  path?: string;
}

export interface DatasetImportImage {
  file: File;
  name: string;
  relativePath: string;
  split: DatasetSplit;
  width: number;
  height: number;
  annotations: Annotation[];
}

export interface DatasetImportManifest {
  format: "yolo" | "classes" | "coco-categories";
  sourceName: string;
  classes: Array<Pick<LabelClass, "id" | "name">>;
  images: DatasetImportImage[];
  issues: DatasetImportIssue[];
}

export interface ClassResolution {
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
  conflict: "none" | "same-name" | "id-conflict" | "new";
}

type DimensionReader = (file: File) => Promise<{ width: number; height: number }>;

export class DatasetImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetImportError";
  }
}

export function folderFilesToVirtualFiles(files: FileList | File[]): VirtualFile[] {
  return createVirtualFiles(Array.from(files).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  })));
}

export async function zipToVirtualFiles(file: File): Promise<VirtualFile[]> {
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new DatasetImportError("ZIP 파일을 해제하지 못했습니다.");
  }
  return createVirtualFiles(Object.entries(unpacked).map(([path, bytes]) => {
    const extension = extensionOf(path);
    return {
      path,
      file: new File([bytes.slice().buffer], basename(path), { type: MIME_TYPES[extension] ?? "application/octet-stream" }),
    };
  }));
}

export function createVirtualFiles(entries: VirtualFile[]): VirtualFile[] {
  const result: VirtualFile[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const raw = entry.path.replaceAll("\\", "/");
    if (raw.split("/").some((part) => part === "__MACOSX") || basename(raw).startsWith(".")) continue;
    const path = normalizePath(raw);
    if (seen.has(path.toLowerCase())) throw new DatasetImportError(`중복된 파일 경로가 있습니다: ${path}`);
    seen.add(path.toLowerCase());
    result.push({ path, file: entry.file });
  }
  return result;
}

export async function importYoloDataset(
  virtualFiles: VirtualFile[],
  sourceName: string,
  readDimensions: DimensionReader = browserImageDimensions,
): Promise<DatasetImportManifest> {
  const fileMap = new Map(virtualFiles.map((entry) => [entry.path, entry.file]));
  const yamlPaths = virtualFiles
    .map((entry) => entry.path)
    .filter((path) => /(^|\/)data\.ya?ml$/i.test(path))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (!yamlPaths.length) throw new DatasetImportError("data.yaml 또는 data.yml을 찾지 못했습니다.");
  const yamlPath = yamlPaths[0];
  const issues: DatasetImportIssue[] = [];
  if (yamlPaths.length > 1) issues.push({ level: "warning", message: `여러 YAML 중 ${yamlPath}을 사용합니다.` });

  const document = parseYamlObject(await fileMap.get(yamlPath)!.text(), yamlPath);
  const classes = parseNames(document.names, yamlPath);
  const yamlDirectory = dirname(yamlPath);
  const configuredRoot = document.path == null ? "" : requireRelativePath(document.path, "path");
  const datasetRoot = joinPath(yamlDirectory, configuredRoot);
  const splitImages = new Map<string, DatasetSplit>();

  for (const split of ["train", "val", "test"] as const) {
    const configured = document[split];
    if (configured == null) continue;
    const values = Array.isArray(configured) ? configured : [configured];
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) {
        issues.push({ level: "error", message: `${split} 경로는 문자열 또는 문자열 목록이어야 합니다.`, path: yamlPath });
        continue;
      }
      let configuredPath: string;
      try {
        configuredPath = requireRelativePath(value, split);
      } catch (error) {
        issues.push({ level: "error", message: error instanceof Error ? error.message : "잘못된 경로입니다.", path: yamlPath });
        continue;
      }
      const resolved = joinPath(datasetRoot, configuredPath);
      if (/\.txt$/i.test(resolved)) {
        const listFile = fileMap.get(resolved);
        if (!listFile) {
          issues.push({ level: "error", message: `${split} 이미지 목록을 찾지 못했습니다.`, path: resolved });
          continue;
        }
        for (const line of (await listFile.text()).split(/\r?\n/)) {
          const cleaned = line.trim();
          if (!cleaned || cleaned.startsWith("#")) continue;
          try {
            const imagePath = joinPath(datasetRoot, requireRelativePath(cleaned.replace(/^\.\//, ""), `${split} 목록`));
            splitImages.set(imagePath, split);
          } catch (error) {
            issues.push({ level: "error", message: error instanceof Error ? error.message : "잘못된 이미지 경로입니다.", path: resolved });
          }
        }
      } else if (isImagePath(resolved)) {
        splitImages.set(resolved, split);
      } else {
        const prefix = resolved ? `${resolved}/` : "";
        const matches = virtualFiles.filter((entry) => entry.path.startsWith(prefix) && isImagePath(entry.path));
        if (!matches.length) issues.push({ level: "warning", message: `${split} 경로에 이미지가 없습니다.`, path: resolved });
        for (const entry of matches) splitImages.set(entry.path, split);
      }
    }
  }

  if (!splitImages.size) issues.push({ level: "error", message: "train, val, test에서 가져올 이미지를 찾지 못했습니다.", path: yamlPath });
  const classMap = new Map(classes.map((item) => [item.id, item.name]));
  const images: DatasetImportImage[] = [];
  for (const [imagePath, split] of splitImages) {
    const file = fileMap.get(imagePath);
    if (!file) {
      issues.push({ level: "error", message: "이미지 파일을 찾지 못했습니다.", path: imagePath });
      continue;
    }
    let dimensions: { width: number; height: number };
    try {
      dimensions = await readDimensions(file);
    } catch {
      issues.push({ level: "error", message: "이미지 크기를 읽지 못했습니다.", path: imagePath });
      continue;
    }
    const labelPath = yoloLabelPath(imagePath);
    const labelFile = labelPath ? fileMap.get(labelPath) : undefined;
    const annotations = labelFile
      ? parseYoloLabels(await labelFile.text(), dimensions.width, dimensions.height, classMap, labelPath!, issues)
      : [];
    if (!labelPath) issues.push({ level: "warning", message: "images 경로 구간이 없어 라벨 경로를 추론하지 못했습니다. 음성 이미지로 가져옵니다.", path: imagePath });
    images.push({
      file,
      name: basename(imagePath),
      relativePath: relativeToDataset(imagePath, datasetRoot),
      split,
      width: dimensions.width,
      height: dimensions.height,
      annotations,
    });
  }
  return { format: "yolo", sourceName, classes, images, issues };
}

export async function importClassFile(file: File): Promise<DatasetImportManifest> {
  const lower = file.name.toLowerCase();
  let classes: Array<Pick<LabelClass, "id" | "name">>;
  let format: DatasetImportManifest["format"] = "classes";
  if (/\.ya?ml$/.test(lower)) {
    const document = parseYamlObject(await file.text(), file.name);
    classes = parseNames(document.names, file.name);
  } else if (lower.endsWith(".txt")) {
    classes = (await file.text()).split(/\r?\n/).map((name) => name.trim()).filter(Boolean).map((name, id) => ({ id, name }));
  } else if (lower.endsWith(".json")) {
    let document: unknown;
    try { document = JSON.parse(await file.text()); } catch { throw new DatasetImportError("COCO JSON을 읽지 못했습니다."); }
    if (!isRecord(document) || !Array.isArray(document.categories)) throw new DatasetImportError("COCO categories 목록이 없습니다.");
    classes = document.categories.map((value, index) => {
      if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 0 || typeof value.name !== "string" || !value.name.trim()) {
        throw new DatasetImportError(`categories[${index}] 형식이 올바르지 않습니다.`);
      }
      return { id: value.id as number, name: value.name.trim() };
    });
    format = "coco-categories";
  } else {
    throw new DatasetImportError("지원하지 않는 클래스 파일입니다.");
  }
  validateClasses(classes);
  return { format, sourceName: file.name, classes, images: [], issues: [] };
}

export function resolveClassConflicts(
  existing: Array<Pick<LabelClass, "id" | "name">>,
  incoming: Array<Pick<LabelClass, "id" | "name">>,
  newProject = false,
): ClassResolution[] {
  if (newProject) return incoming.map((item) => ({ sourceId: item.id, sourceName: item.name, targetId: item.id, targetName: item.name, conflict: "none" }));
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const existingByName = new Map(existing.map((item) => [item.name.trim().toLocaleLowerCase(), item]));
  const reservedIncomingIds = new Set(incoming
    .filter((item) => !existingByName.has(item.name.trim().toLocaleLowerCase()) && !existingById.has(item.id))
    .map((item) => item.id));
  const used = new Set([...existing.map((item) => item.id), ...reservedIncomingIds]);
  const nextFree = () => { let id = 0; while (used.has(id)) id += 1; used.add(id); return id; };
  return incoming.map((item) => {
    const sameName = existingByName.get(item.name.trim().toLocaleLowerCase());
    if (sameName) return { sourceId: item.id, sourceName: item.name, targetId: sameName.id, targetName: sameName.name, conflict: sameName.id === item.id ? "none" : "same-name" };
    const sameId = existingById.get(item.id);
    if (sameId) {
      const targetId = nextFree();
      return { sourceId: item.id, sourceName: item.name, targetId, targetName: item.name, conflict: "id-conflict" };
    }
    return { sourceId: item.id, sourceName: item.name, targetId: item.id, targetName: item.name, conflict: "new" };
  });
}

function parseYoloLabels(
  text: string, width: number, height: number, classes: Map<number, string>, path: string, issues: DatasetImportIssue[],
): Annotation[] {
  const annotations: Annotation[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) {
      issues.push({ level: "error", message: `${index + 1}행은 detect 형식(5열 또는 confidence 포함 6열)이 아닙니다.`, path });
      return;
    }
    const values = parts.map(Number);
    const [classId, xc, yc, boxWidth, boxHeight, score] = values;
    if (!values.every(Number.isFinite) || !Number.isInteger(classId) || !classes.has(classId)) {
      issues.push({ level: "error", message: `${index + 1}행의 클래스 ID 또는 숫자 값이 올바르지 않습니다.`, path });
      return;
    }
    if ([xc, yc, boxWidth, boxHeight].some((value) => value < 0 || value > 1) || boxWidth <= 0 || boxHeight <= 0 || (score != null && (score < 0 || score > 1))) {
      issues.push({ level: "error", message: `${index + 1}행의 좌표 또는 confidence가 범위를 벗어났습니다.`, path });
      return;
    }
    const x1 = (xc - boxWidth / 2) * width;
    const y1 = (yc - boxHeight / 2) * height;
    const x2 = (xc + boxWidth / 2) * width;
    const y2 = (yc + boxHeight / 2) * height;
    if (x1 < 0 || y1 < 0 || x2 > width || y2 > height) {
      issues.push({ level: "error", message: `${index + 1}행의 박스가 이미지 경계를 벗어났습니다.`, path });
      return;
    }
    annotations.push({
      id: crypto.randomUUID(), classId, label: classes.get(classId)!, score: score ?? null,
      source: "import", reviewState: "accepted", x1, y1, x2, y2,
    });
  });
  return annotations;
}

function parseYamlObject(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try { value = parseYaml(text); } catch { throw new DatasetImportError(`${path} YAML을 읽지 못했습니다.`); }
  if (!isRecord(value)) throw new DatasetImportError(`${path}의 최상위 값은 객체여야 합니다.`);
  return value;
}

function parseNames(value: unknown, path: string): Array<Pick<LabelClass, "id" | "name">> {
  let result: Array<Pick<LabelClass, "id" | "name">>;
  if (Array.isArray(value)) {
    result = value.map((name, id) => {
      if (typeof name !== "string" || !name.trim()) throw new DatasetImportError(`${path} names[${id}]가 올바르지 않습니다.`);
      return { id, name: name.trim() };
    });
  } else if (isRecord(value)) {
    result = Object.entries(value).map(([rawId, name]) => {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id < 0 || typeof name !== "string" || !name.trim()) throw new DatasetImportError(`${path} names 항목이 올바르지 않습니다: ${rawId}`);
      return { id, name: name.trim() };
    }).sort((a, b) => a.id - b.id);
  } else {
    throw new DatasetImportError(`${path}에 names 목록이 없습니다.`);
  }
  validateClasses(result);
  return result;
}

function validateClasses(classes: Array<Pick<LabelClass, "id" | "name">>): void {
  if (!classes.length) throw new DatasetImportError("클래스 목록이 비어 있습니다.");
  const ids = new Set<number>();
  for (const item of classes) {
    if (ids.has(item.id)) throw new DatasetImportError(`중복된 클래스 ID가 있습니다: ${item.id}`);
    ids.add(item.id);
  }
}

function requireRelativePath(value: unknown, field: string): string {
  if (typeof value !== "string") throw new DatasetImportError(`${field} 경로는 문자열이어야 합니다.`);
  const path = value.trim().replaceAll("\\", "/");
  if (/^(?:[a-z]:|\/|\\|[a-z][a-z0-9+.-]*:)/i.test(path)) throw new DatasetImportError(`${field}에 절대 또는 원격 경로를 사용할 수 없습니다: ${value}`);
  return path;
}

function normalizePath(path: string): string {
  if (/^(?:[a-z]:|\/|\\)/i.test(path)) throw new DatasetImportError(`절대 경로를 사용할 수 없습니다: ${path}`);
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new DatasetImportError(`상위 경로로 벗어날 수 없습니다: ${path}`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function joinPath(base: string, child: string): string { return normalizePath(base ? `${base}/${child}` : child); }
function dirname(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
function basename(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
function extensionOf(path: string): string { return basename(path).split(".").pop()?.toLowerCase() ?? ""; }
function isImagePath(path: string): boolean { return IMAGE_EXTENSIONS.has(extensionOf(path)); }
function relativeToDataset(path: string, root: string): string { return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path; }

function yoloLabelPath(imagePath: string): string | null {
  const parts = imagePath.split("/");
  const index = parts.lastIndexOf("images");
  if (index < 0) return null;
  parts[index] = "labels";
  parts[parts.length - 1] = basename(parts[parts.length - 1]).replace(/\.[^.]+$/, ".txt");
  return parts.join("/");
}

async function browserImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
