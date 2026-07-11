import type {
  Annotation,
  ExportFormat,
  LabelClass,
  ModelConfig,
  SessionImage,
} from "../types";

export const PROJECT_SCHEMA = "vision-label-bench";
export const PROJECT_VERSION = 1 as const;

export interface ProjectPreferences {
  zoom: number;
  exportFormat: ExportFormat;
  exportScope: "current" | "all";
  includeConfidence: boolean;
}

export interface ProjectState {
  modelConfig: ModelConfig;
  classes: LabelClass[];
  images: SessionImage[];
  selectedImageId: string | null;
  preferences: ProjectPreferences;
}

export interface ProjectImageRecord {
  id: string;
  fileKey: string;
  name: string;
  fileType: string;
  fileSize: number;
  lastModified: number;
  width: number;
  height: number;
  elapsedMs: number | null;
  annotations: Annotation[];
}

export interface ProjectDocumentV1 {
  schema: typeof PROJECT_SCHEMA;
  version: typeof PROJECT_VERSION;
  updatedAt: string;
  modelConfig: ModelConfig;
  classes: LabelClass[];
  selectedImageId: string | null;
  preferences: ProjectPreferences;
  images: ProjectImageRecord[];
}

export interface HydratedProject extends Omit<ProjectState, "images"> {
  images: SessionImage[];
}

export class ProjectDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDocumentError";
  }
}

export function createProjectDocument(
  state: ProjectState,
  updatedAt = new Date().toISOString(),
): ProjectDocumentV1 {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    updatedAt,
    modelConfig: { ...state.modelConfig },
    classes: state.classes.map((item) => ({ ...item })),
    selectedImageId: state.selectedImageId,
    preferences: { ...state.preferences },
    images: state.images.map((image) => ({
      id: image.id,
      fileKey: image.id,
      name: image.name,
      fileType: image.file.type,
      fileSize: image.file.size,
      lastModified: image.file.lastModified,
      width: image.width,
      height: image.height,
      elapsedMs: image.elapsedMs,
      annotations: image.annotations.map((annotation) => ({ ...annotation })),
    })),
  };
}

export function parseProjectDocument(value: unknown): ProjectDocumentV1 {
  if (!isRecord(value)) throw new ProjectDocumentError("프로젝트 데이터가 객체 형식이 아닙니다.");
  if (value.schema !== PROJECT_SCHEMA) throw new ProjectDocumentError("Label Bench 프로젝트 파일이 아닙니다.");
  if (value.version !== PROJECT_VERSION) {
    throw new ProjectDocumentError(`지원하지 않는 프로젝트 버전입니다: ${String(value.version)}`);
  }

  const updatedAt = readString(value.updatedAt, "updatedAt");
  if (Number.isNaN(Date.parse(updatedAt))) throw new ProjectDocumentError("프로젝트 저장 시각이 올바르지 않습니다.");

  const modelConfig = parseModelConfig(value.modelConfig);
  const classes = readArray(value.classes, "classes").map(parseLabelClass);
  if (!classes.length) throw new ProjectDocumentError("프로젝트에 클래스가 없습니다.");
  const classIds = new Set<number>();
  for (const item of classes) {
    if (classIds.has(item.id)) throw new ProjectDocumentError(`중복된 클래스 ID가 있습니다: ${item.id}`);
    classIds.add(item.id);
  }

  const preferences = parsePreferences(value.preferences);
  const images = readArray(value.images, "images").map(parseImageRecord);
  const imageIds = new Set<string>();
  for (const image of images) {
    if (imageIds.has(image.id)) throw new ProjectDocumentError(`중복된 이미지 ID가 있습니다: ${image.id}`);
    imageIds.add(image.id);
  }

  const selectedImageId = value.selectedImageId === null
    ? null
    : readString(value.selectedImageId, "selectedImageId");

  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    updatedAt,
    modelConfig,
    classes,
    selectedImageId,
    preferences,
    images,
  };
}

export function hydrateProjectDocument(
  document: ProjectDocumentV1,
  files: ReadonlyMap<string, File>,
  createObjectUrl: (file: File) => string = URL.createObjectURL,
): HydratedProject {
  for (const image of document.images) {
    if (!files.has(image.fileKey)) {
      throw new ProjectDocumentError(`이미지 파일을 복구하지 못했습니다: ${image.name}`);
    }
  }

  const images = document.images.map((image): SessionImage => {
    const file = files.get(image.fileKey)!;
    return {
      id: image.id,
      file,
      name: image.name,
      url: createObjectUrl(file),
      width: image.width,
      height: image.height,
      status: image.annotations.length ? "ready" : "idle",
      elapsedMs: image.elapsedMs,
      annotations: image.annotations.map((annotation) => ({ ...annotation })),
      error: null,
    };
  });

  return {
    modelConfig: { ...document.modelConfig },
    classes: document.classes.map((item) => ({ ...item })),
    images,
    selectedImageId: images.some((image) => image.id === document.selectedImageId)
      ? document.selectedImageId
      : images[0]?.id ?? null,
    preferences: { ...document.preferences },
  };
}

function parseModelConfig(value: unknown): ModelConfig {
  if (!isRecord(value)) throw new ProjectDocumentError("modelConfig 형식이 올바르지 않습니다.");
  const adapter = value.adapter;
  const device = value.device;
  if (adapter !== "auto" && adapter !== "yolo" && adapter !== "detr") {
    throw new ProjectDocumentError("지원하지 않는 모델 어댑터입니다.");
  }
  if (device !== "auto" && device !== "cpu" && device !== "cuda") {
    throw new ProjectDocumentError("지원하지 않는 실행 장치입니다.");
  }
  return {
    adapter,
    modelRef: readString(value.modelRef, "modelConfig.modelRef"),
    device,
    confidence: readFiniteNumber(value.confidence, "modelConfig.confidence", 0.01, 1),
    iou: readFiniteNumber(value.iou, "modelConfig.iou", 0.01, 1),
  };
}

function parsePreferences(value: unknown): ProjectPreferences {
  if (!isRecord(value)) throw new ProjectDocumentError("preferences 형식이 올바르지 않습니다.");
  const exportFormat = value.exportFormat;
  const exportScope = value.exportScope;
  if (exportFormat !== "yolo" && exportFormat !== "coco" && exportFormat !== "voc") {
    throw new ProjectDocumentError("지원하지 않는 내보내기 형식입니다.");
  }
  if (exportScope !== "current" && exportScope !== "all") {
    throw new ProjectDocumentError("지원하지 않는 내보내기 범위입니다.");
  }
  if (typeof value.includeConfidence !== "boolean") {
    throw new ProjectDocumentError("신뢰도 포함 설정이 올바르지 않습니다.");
  }
  return {
    zoom: readFiniteNumber(value.zoom, "preferences.zoom", 0.1, 10),
    exportFormat,
    exportScope,
    includeConfidence: value.includeConfidence,
  };
}

function parseLabelClass(value: unknown, index: number): LabelClass {
  if (!isRecord(value)) throw new ProjectDocumentError(`classes[${index}] 형식이 올바르지 않습니다.`);
  return {
    id: readInteger(value.id, `classes[${index}].id`, 0),
    name: readString(value.name, `classes[${index}].name`),
    color: readString(value.color, `classes[${index}].color`),
  };
}

function parseImageRecord(value: unknown, index: number): ProjectImageRecord {
  if (!isRecord(value)) throw new ProjectDocumentError(`images[${index}] 형식이 올바르지 않습니다.`);
  const elapsedMs = value.elapsedMs === null
    ? null
    : readFiniteNumber(value.elapsedMs, `images[${index}].elapsedMs`, 0);
  return {
    id: readString(value.id, `images[${index}].id`),
    fileKey: readString(value.fileKey, `images[${index}].fileKey`),
    name: readString(value.name, `images[${index}].name`),
    fileType: readString(value.fileType, `images[${index}].fileType`, true),
    fileSize: readInteger(value.fileSize, `images[${index}].fileSize`, 0),
    lastModified: readFiniteNumber(value.lastModified, `images[${index}].lastModified`, 0),
    width: readFiniteNumber(value.width, `images[${index}].width`, 1),
    height: readFiniteNumber(value.height, `images[${index}].height`, 1),
    elapsedMs,
    annotations: readArray(value.annotations, `images[${index}].annotations`).map((item, annotationIndex) => (
      parseAnnotation(item, `images[${index}].annotations[${annotationIndex}]`)
    )),
  };
}

function parseAnnotation(value: unknown, path: string): Annotation {
  if (!isRecord(value)) throw new ProjectDocumentError(`${path} 형식이 올바르지 않습니다.`);
  const source = value.source;
  if (source !== "model" && source !== "manual") throw new ProjectDocumentError(`${path}.source 값이 올바르지 않습니다.`);
  const score = value.score === null ? null : readFiniteNumber(value.score, `${path}.score`, 0, 1);
  const x1 = readFiniteNumber(value.x1, `${path}.x1`, 0);
  const y1 = readFiniteNumber(value.y1, `${path}.y1`, 0);
  const x2 = readFiniteNumber(value.x2, `${path}.x2`, 0);
  const y2 = readFiniteNumber(value.y2, `${path}.y2`, 0);
  if (x2 < x1 || y2 < y1) throw new ProjectDocumentError(`${path} 좌표 순서가 올바르지 않습니다.`);
  return {
    id: readString(value.id, `${path}.id`),
    classId: readInteger(value.classId, `${path}.classId`, 0),
    label: readString(value.label, `${path}.label`),
    score,
    source,
    x1,
    y1,
    x2,
    y2,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ProjectDocumentError(`${path} 값이 배열이 아닙니다.`);
  return value;
}

function readString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ProjectDocumentError(`${path} 값이 올바른 문자열이 아닙니다.`);
  }
  return value;
}

function readFiniteNumber(value: unknown, path: string, min?: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (min != null && value < min) || (max != null && value > max)) {
    throw new ProjectDocumentError(`${path} 숫자 값이 범위를 벗어났습니다.`);
  }
  return value;
}

function readInteger(value: unknown, path: string, min?: number): number {
  const parsed = readFiniteNumber(value, path, min);
  if (!Number.isInteger(parsed)) throw new ProjectDocumentError(`${path} 값이 정수가 아닙니다.`);
  return parsed;
}
