import type {
  ExportFormat,
  HealthResponse,
  InferenceResponse,
  LabelClass,
  ModelConfig,
  ModelBrowseResponse,
  ModelLoadResponse,
  SessionImage,
} from "../types";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function loadModel(config: ModelConfig): Promise<ModelLoadResponse> {
  const response = await fetch("/api/models/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adapter: config.adapter,
      model_ref: config.modelRef,
      device: config.device,
    }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function browseModels(path?: string): Promise<ModelBrowseResponse> {
  const query = new URLSearchParams();
  if (path) query.set("path", path);
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`/api/models/browse${suffix}`);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function inferImage(
  image: SessionImage,
  config: ModelConfig,
): Promise<InferenceResponse> {
  const body = new FormData();
  body.append("image", image.file, image.name);
  body.append("adapter", config.adapter);
  body.append("model_ref", config.modelRef);
  body.append("device", config.device);
  body.append("confidence", String(config.confidence));
  body.append("iou", String(config.iou));
  const response = await fetch("/api/infer", { method: "POST", body });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function exportAnnotations(options: {
  format: ExportFormat;
  images: SessionImage[];
  classes: LabelClass[];
  includeConfidence: boolean;
}): Promise<void> {
  const classMap = Object.fromEntries(options.classes.map((item) => [item.id, item.name]));
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: options.format,
      include_confidence: options.includeConfidence,
      classes: classMap,
      images: options.images.map((image) => ({
        filename: image.name,
        width: image.width,
        height: image.height,
        annotations: image.annotations.map((annotation) => ({
          class_id: annotation.classId,
          label: annotation.label,
          score: annotation.score,
          x1: annotation.x1,
          y1: annotation.y1,
          x2: annotation.x2,
          y2: annotation.y2,
        })),
      })),
    }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `label-bench-${options.format}.zip`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item: { msg?: string }) => item.msg ?? "입력 오류").join(" · ");
    }
  } catch {
    // The server may return a non-JSON proxy or runtime error.
  }
  return `요청에 실패했습니다. (${response.status})`;
}
