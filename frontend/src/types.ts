export type AdapterKind = "auto" | "yolo" | "detr";
export type DeviceKind = "auto" | "cpu" | "cuda";
export type ToolKind = "select" | "draw";
export type ExportFormat = "yolo" | "coco" | "voc";
export type ProjectSaveStatus = "restoring" | "saving" | "saved" | "error";

export interface ModelConfig {
  adapter: AdapterKind;
  modelRef: string;
  device: DeviceKind;
  confidence: number;
  iou: number;
}

export interface LabelClass {
  id: number;
  name: string;
  color: string;
}

export interface BoxCoordinates {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Annotation extends BoxCoordinates {
  id: string;
  classId: number;
  label: string;
  score: number | null;
  source: "model" | "manual";
  reviewState: "suggested" | "accepted" | "edited";
}

export type ImageStatus = "idle" | "running" | "ready" | "error";

export interface SessionImage {
  id: string;
  file: File;
  name: string;
  url: string;
  width: number;
  height: number;
  status: ImageStatus;
  elapsedMs: number | null;
  annotations: Annotation[];
  error: string | null;
}

export interface ModelInfo {
  adapter: "yolo" | "detr";
  model_ref: string;
  device: string;
  classes: Record<string, string>;
  model_type: string | null;
  architecture: string | null;
  task: string | null;
  format: string | null;
  runtime_version: string | null;
  input_size: string | null;
  parameter_count: number | null;
  file_size: number | null;
}

export interface ModelLoadResponse {
  model: ModelInfo;
  load_time_ms: number;
  cached: boolean;
}

export interface ModelInspection {
  model: ModelInfo;
  loadTimeMs: number | null;
  cached: boolean | null;
  inference: {
    imageName: string;
    detectionCount: number;
    elapsedMs: number;
  } | null;
}

export interface ModelBrowseEntry {
  name: string;
  path: string;
  kind: "directory" | "model";
  size: number | null;
}

export interface ModelBrowseResponse {
  current: string;
  parent: string | null;
  home: string;
  roots: string[];
  entries: ModelBrowseEntry[];
}

export interface InferenceResponse {
  width: number;
  height: number;
  elapsed_ms: number;
  model: ModelInfo;
  detections: Array<{
    class_id: number;
    label: string;
    score: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
}

export interface HealthResponse {
  status: string;
  version: string;
  adapters: { yolo: boolean; detr: boolean };
  device: { cuda: boolean; name: string | null };
}
