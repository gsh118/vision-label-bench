import { useCallback, useEffect, useRef, useState } from "react";
import { inferImage, loadModel } from "../../lib/api";
import { resolveClassConflicts, type ClassResolution } from "../../lib/datasetImport";
import { mergeModelSuggestions } from "../../lib/review";
import type { AnnotationCommand } from "../../lib/annotationHistory";
import type {
  Annotation,
  ModelConfig,
  ModelInspection,
  ModelLoadResponse,
  SessionImage,
} from "../../types";
import type { WorkspaceController } from "../workspace/useWorkspaceState";

type ModelStatus = "idle" | "loading" | "ready" | "error";

interface PendingModelMapping {
  response: ModelLoadResponse;
  resolutions: ClassResolution[];
}

interface InferenceControllerOptions {
  workspace: WorkspaceController;
  palette: string[];
  commitAnnotationCommand: (command: AnnotationCommand) => void;
}

export function useInferenceController({
  workspace,
  palette,
  commitAnnotationCommand,
}: InferenceControllerOptions) {
  const {
    images,
    imagesRef,
    classesRef,
    setClasses,
    modelConfig,
    modelConfigRef,
    setModelConfig,
    selectedImageIdRef,
    selectedAnnotationIdRef,
    patchSessionImage,
  } = workspace;
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [modelMessage, setModelMessage] = useState("");
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const [modelInspection, setModelInspection] = useState<ModelInspection | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [pendingModelMapping, setPendingModelMapping] = useState<PendingModelMapping | null>(null);
  const generationRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const activeImageIdsRef = useRef(new Set<string>());

  const cancelActiveRuns = useCallback(() => {
    generationRef.current += 1;
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    const activeImageIds = [...activeImageIdsRef.current];
    activeImageIdsRef.current.clear();
    for (const imageId of activeImageIds) {
      patchSessionImage(imageId, { status: "idle", error: null });
    }
    setBatchRunning(false);
  }, [patchSessionImage]);

  useEffect(() => () => {
    generationRef.current += 1;
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    activeImageIdsRef.current.clear();
  }, []);

  const mergeModelClasses = useCallback((
    incoming: Record<string, string>,
    overrides?: ClassResolution[],
  ): Record<string, number> => {
    const source = Object.entries(incoming).map(([rawId, name]) => ({ id: Number(rawId), name }));
    const configured = modelConfigRef.current.classMap;
    const validConfigured = configured && source.every((item) => configured[String(item.id)] != null);
    const resolutions = overrides ?? (validConfigured
      ? source.map((item) => ({
        sourceId: item.id,
        sourceName: item.name,
        targetId: configured[String(item.id)],
        targetName: classesRef.current.find((entry) => entry.id === configured[String(item.id)])?.name ?? item.name,
        conflict: "none" as const,
      }))
      : resolveClassConflicts(classesRef.current, source));
    const classMap = Object.fromEntries(resolutions.map((item) => [String(item.sourceId), item.targetId]));
    const next = new Map(classesRef.current.map((item) => [item.id, item]));
    for (const resolution of resolutions) {
      if (!next.has(resolution.targetId)) {
        next.set(resolution.targetId, {
          id: resolution.targetId,
          name: resolution.targetName,
          color: palette[resolution.targetId % palette.length],
        });
      }
    }
    setClasses([...next.values()].sort((a, b) => a.id - b.id));
    setModelConfig((config) => ({ ...config, classMap }));
    return classMap;
  }, [classesRef, modelConfigRef, palette, setClasses, setModelConfig]);

  const runInference = useCallback(async (image: SessionImage) => {
    const generation = generationRef.current;
    const config = { ...modelConfigRef.current };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    activeImageIdsRef.current.add(image.id);
    patchSessionImage(image.id, { status: "running", error: null });
    try {
      const response = await inferImage(image, config, controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (!imagesRef.current.some((item) => item.id === image.id)) return;
      const classMap = mergeModelClasses(response.model.classes);
      const annotations: Annotation[] = response.detections.map((item) => {
        const classId = classMap[String(item.class_id)] ?? item.class_id;
        return {
          id: crypto.randomUUID(),
          classId,
          label: classesRef.current.find((entry) => entry.id === classId)?.name ?? item.label,
          score: item.score,
          source: "model",
          reviewState: "suggested",
          x1: item.x1,
          y1: item.y1,
          x2: item.x2,
          y2: item.y2,
        };
      });
      const latestImage = imagesRef.current.find((item) => item.id === image.id);
      if (latestImage) {
        commitAnnotationCommand({
          kind: "replace-all",
          imageId: image.id,
          before: latestImage.annotations,
          after: mergeModelSuggestions(latestImage.annotations, annotations),
          selectionBefore: selectedImageIdRef.current === image.id ? selectedAnnotationIdRef.current : null,
          selectionAfter: null,
        });
      }
      patchSessionImage(image.id, {
        width: response.width,
        height: response.height,
        status: "ready",
        elapsedMs: response.elapsed_ms,
        error: null,
      });
      setModelStatus("ready");
      setModelMessage(`${response.model.adapter.toUpperCase()} · ${response.model.device} · ${response.elapsed_ms.toFixed(0)} ms`);
      setModelInspection((previous) => ({
        model: response.model,
        loadTimeMs: previous?.model.model_ref === response.model.model_ref ? previous.loadTimeMs : null,
        cached: previous?.model.model_ref === response.model.model_ref ? previous.cached : true,
        inference: {
          imageName: image.name,
          detectionCount: response.detections.length,
          elapsedMs: response.elapsed_ms,
          capturedAt: new Date().toISOString(),
          trace: response.trace,
        },
      }));
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      const message = error instanceof Error ? error.message : "추론에 실패했습니다.";
      patchSessionImage(image.id, { status: "error", error: message });
      setModelStatus("error");
      setModelMessage(message);
    } finally {
      controllersRef.current.delete(controller);
      activeImageIdsRef.current.delete(image.id);
    }
  }, [classesRef, commitAnnotationCommand, imagesRef, mergeModelClasses, modelConfigRef, patchSessionImage, selectedAnnotationIdRef, selectedImageIdRef]);

  const runAll = useCallback(async () => {
    if (!images.length || batchRunning) return;
    const generation = generationRef.current;
    setBatchRunning(true);
    try {
      for (const image of images) {
        if (generation !== generationRef.current) break;
        await runInference(image);
      }
    } finally {
      if (generation === generationRef.current) setBatchRunning(false);
    }
  }, [batchRunning, images, runInference]);

  const preflightModel = useCallback(async () => {
    cancelActiveRuns();
    const generation = generationRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setModelStatus("loading");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(true);
    try {
      const response = await loadModel(modelConfigRef.current, controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      const source = Object.entries(response.model.classes).map(([id, name]) => ({ id: Number(id), name }));
      const resolutions = resolveClassConflicts(classesRef.current, source);
      if (resolutions.some((item) => item.conflict === "id-conflict" || item.conflict === "same-name")) {
        setPendingModelMapping({ response, resolutions });
        setModelStatus("idle");
        setModelMessage("클래스 매핑 확인 필요");
        return;
      }
      mergeModelClasses(response.model.classes, resolutions);
      setModelStatus("ready");
      setModelMessage(`${response.model.adapter.toUpperCase()} 준비됨 · ${response.model.device}`);
      setModelInspection({
        model: response.model,
        loadTimeMs: response.load_time_ms,
        cached: response.cached,
        inference: null,
      });
      setModelInfoOpen(true);
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setModelStatus("error");
      setModelInfoOpen(false);
      setModelMessage(error instanceof Error ? error.message : "모델을 불러오지 못했습니다.");
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [cancelActiveRuns, classesRef, mergeModelClasses, modelConfigRef]);

  const changeModelConfig = useCallback((patch: Partial<ModelConfig>) => {
    cancelActiveRuns();
    setModelConfig((config) => ({
      ...config,
      ...patch,
      classMap: patch.modelRef !== undefined || patch.adapter !== undefined ? undefined : config.classMap,
    }));
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setPendingModelMapping(null);
  }, [cancelActiveRuns, setModelConfig]);

  const resetInference = useCallback(() => {
    cancelActiveRuns();
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setPendingModelMapping(null);
  }, [cancelActiveRuns]);

  const cancelPendingMapping = useCallback(() => {
    setPendingModelMapping(null);
    setModelInfoOpen(false);
    setModelMessage("클래스 매핑 취소됨");
  }, []);

  const applyPendingMapping = useCallback(() => {
    if (!pendingModelMapping) return;
    const { response, resolutions } = pendingModelMapping;
    mergeModelClasses(response.model.classes, resolutions);
    setModelStatus("ready");
    setModelMessage(`${response.model.adapter.toUpperCase()} 준비됨 · ${response.model.device}`);
    setModelInspection({
      model: response.model,
      loadTimeMs: response.load_time_ms,
      cached: response.cached,
      inference: null,
    });
    setModelInfoOpen(true);
    setPendingModelMapping(null);
  }, [mergeModelClasses, pendingModelMapping]);

  return {
    modelStatus,
    modelMessage,
    modelInfoOpen,
    setModelInfoOpen,
    modelInspection,
    batchRunning,
    pendingModelMapping,
    setPendingModelMapping,
    runInference,
    runAll,
    preflightModel,
    changeModelConfig,
    resetInference,
    cancelPendingMapping,
    applyPendingMapping,
  };
}
