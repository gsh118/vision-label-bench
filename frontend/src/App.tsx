import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationCanvas } from "./components/AnnotationCanvas";
import { ClassMappingDialog } from "./components/ClassMappingDialog";
import { DatasetImportDialog } from "./components/DatasetImportDialog";
import { Header } from "./components/Header";
import { Inspector } from "./components/Inspector";
import { ModelBrowser } from "./components/ModelBrowser";
import { ModelInfoPanel } from "./components/ModelInfoPanel";
import { SessionRail } from "./components/SessionRail";
import { exportAnnotations, getHealth, inferImage, loadModel } from "./lib/api";
import { resolveClassConflicts, type ClassResolution, type DatasetImportManifest } from "./lib/datasetImport";
import {
  applyAnnotationCommand,
  isNoopCommand,
  recordAnnotationCommand,
  redoAnnotationCommand,
  resolveHistoryShortcut,
  undoAnnotationCommand,
  type AnnotationCommand,
  type AnnotationHistory,
} from "./lib/annotationHistory";
import { downloadProjectBackup, readProjectBackup } from "./lib/projectBackup";
import type { HydratedProject, ProjectState } from "./lib/projectDocument";
import {
  clearLocalProject,
  loadLocalProject,
  requestPersistentProjectStorage,
  saveLocalProject,
} from "./lib/projectStore";
import {
  acceptAllSuggestions as acceptPendingSuggestions,
  mergeModelSuggestions,
  prepareImagesForExport,
} from "./lib/review";
import type {
  Annotation,
  BoxCoordinates,
  ExportFormat,
  HealthResponse,
  LabelClass,
  ModelConfig,
  ModelInspection,
  ModelLoadResponse,
  ProjectSaveStatus,
  SessionImage,
  ToolKind,
} from "./types";

const PALETTE = ["#99c2a2", "#d0ad78", "#82a9bd", "#d08f88", "#aaa0c2", "#b9bd79", "#d09caf", "#80b9ad"];
const DEFAULT_CLASSES: LabelClass[] = [{ id: 0, name: "object", color: PALETTE[0] }];
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  adapter: "auto",
  modelRef: "yolo11n.pt",
  device: "auto",
  confidence: 0.25,
  iou: 0.7,
};

export default function App() {
  const [images, setImages] = useState<SessionImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [classes, setClasses] = useState<LabelClass[]>(() => DEFAULT_CLASSES.map((item) => ({ ...item })));
  const [tool, setTool] = useState<ToolKind>("select");
  const [zoom, setZoom] = useState(1);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => ({ ...DEFAULT_MODEL_CONFIG }));
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modelMessage, setModelMessage] = useState("");
  const [modelBrowserOpen, setModelBrowserOpen] = useState(false);
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const [modelInspection, setModelInspection] = useState<ModelInspection | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("yolo");
  const [exportScope, setExportScope] = useState<"current" | "all">("all");
  const [includeConfidence, setIncludeConfidence] = useState(false);
  const [includeSuggestions, setIncludeSuggestions] = useState(false);
  const [includeOriginalImages, setIncludeOriginalImages] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "pending">("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [projectReady, setProjectReady] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectStatus, setProjectStatus] = useState<ProjectSaveStatus>("restoring");
  const [projectMessage, setProjectMessage] = useState("이전 로컬 작업을 확인하는 중");
  const [datasetImportOpen, setDatasetImportOpen] = useState(false);
  const [pendingModelMapping, setPendingModelMapping] = useState<{ response: ModelLoadResponse; resolutions: ClassResolution[] } | null>(null);
  const [annotationHistory, setAnnotationHistory] = useState<AnnotationHistory>({});
  const imagesRef = useRef(images);
  const selectedImageIdRef = useRef(selectedImageId);
  const selectedAnnotationIdRef = useRef(selectedAnnotationId);
  const historyRef = useRef(annotationHistory);
  const classesRef = useRef(classes);
  const modelConfigRef = useRef(modelConfig);
  const autosaveRevisionRef = useRef(0);
  const storageRequestedRef = useRef(false);
  imagesRef.current = images;
  selectedImageIdRef.current = selectedImageId;
  selectedAnnotationIdRef.current = selectedAnnotationId;
  historyRef.current = annotationHistory;
  classesRef.current = classes;
  modelConfigRef.current = modelConfig;

  const replaceHistory = useCallback((nextHistory: AnnotationHistory) => {
    historyRef.current = nextHistory;
    setAnnotationHistory(nextHistory);
  }, []);

  const resetHistory = useCallback(() => replaceHistory({}), [replaceHistory]);

  const replaceSessionImages = useCallback((nextImages: SessionImage[]) => {
    const previousImages = imagesRef.current;
    imagesRef.current = nextImages;
    setImages(nextImages);
    for (const image of previousImages) URL.revokeObjectURL(image.url);
  }, []);

  const replaceImageAnnotations = useCallback((imageId: string, annotations: Annotation[]) => {
    const nextImages = imagesRef.current.map((image) => image.id === imageId
      ? { ...image, annotations }
      : image);
    imagesRef.current = nextImages;
    setImages(nextImages);
  }, []);

  const patchSessionImage = useCallback((imageId: string, patch: Partial<Omit<SessionImage, "id">>) => {
    const nextImages = imagesRef.current.map((image) => image.id === imageId
      ? { ...image, ...patch }
      : image);
    imagesRef.current = nextImages;
    setImages(nextImages);
  }, []);

  const commitAnnotationCommand = useCallback((command: AnnotationCommand) => {
    if (isNoopCommand(command)) return;
    const image = imagesRef.current.find((item) => item.id === command.imageId);
    if (!image) return;
    const applied = applyAnnotationCommand(image.annotations, command, "forward");
    replaceImageAnnotations(command.imageId, applied.annotations);
    replaceHistory(recordAnnotationCommand(historyRef.current, command));
    if (selectedImageIdRef.current === command.imageId) setSelectedAnnotationId(applied.selection);
  }, [replaceHistory, replaceImageAnnotations]);

  const applyProject = useCallback((project: HydratedProject) => {
    replaceSessionImages(project.images);
    setSelectedImageId(project.selectedImageId);
    setSelectedAnnotationId(null);
    setClasses(project.classes);
    setModelConfig(project.modelConfig);
    setZoom(project.preferences.zoom);
    setExportFormat(project.preferences.exportFormat);
    setExportScope(project.preferences.exportScope);
    setIncludeConfidence(project.preferences.includeConfidence);
    setIncludeSuggestions(project.preferences.includeSuggestions);
    setIncludeOriginalImages(project.preferences.includeOriginalImages);
    setReviewFilter("all");
    setTool("select");
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setExportError("");
    resetHistory();
  }, [replaceSessionImages, resetHistory]);

  useEffect(() => {
    let active = true;
    getHealth().then((result) => active && setHealth(result)).catch(() => active && setHealth(null));
    return () => {
      active = false;
      for (const image of imagesRef.current) URL.revokeObjectURL(image.url);
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadLocalProject()
      .then((project) => {
        if (!active) {
          if (project) for (const image of project.images) URL.revokeObjectURL(image.url);
          return;
        }
        if (project) {
          applyProject(project);
          setProjectMessage(`이전 작업 복구됨 · 이미지 ${project.images.length}장`);
        } else {
          setProjectMessage("로컬 자동 저장 준비됨");
        }
        setProjectStatus("saved");
      })
      .catch((error) => {
        if (!active) return;
        setProjectStatus("error");
        setProjectMessage(error instanceof Error ? error.message : "이전 작업을 복구하지 못했습니다.");
      })
      .finally(() => active && setProjectReady(true));
    return () => {
      active = false;
    };
  }, [applyProject]);

  const currentIndex = Math.max(0, images.findIndex((item) => item.id === selectedImageId));
  const currentImage = images[currentIndex] ?? null;
  const selectedAnnotation = currentImage?.annotations.find((item) => item.id === selectedAnnotationId) ?? null;

  const createCurrentProjectState = useCallback((): ProjectState => ({
    modelConfig,
    classes,
    images,
    selectedImageId,
    preferences: {
      zoom,
      exportFormat,
      exportScope,
      includeConfidence,
      includeSuggestions,
      includeOriginalImages,
    },
  }), [classes, exportFormat, exportScope, images, includeConfidence, includeOriginalImages, includeSuggestions, modelConfig, selectedImageId, zoom]);

  useEffect(() => {
    if (!projectReady) return;
    const revision = ++autosaveRevisionRef.current;
    const snapshot = createCurrentProjectState();
    setProjectStatus("saving");
    setProjectMessage("변경사항을 로컬에 저장하는 중");
    const timer = window.setTimeout(() => {
      saveLocalProject(snapshot)
        .then(() => {
          if (revision !== autosaveRevisionRef.current) return;
          setProjectStatus("saved");
          setProjectMessage(`자동 저장됨 · ${formatClock(new Date())}`);
        })
        .catch((error) => {
          if (revision !== autosaveRevisionRef.current) return;
          setProjectStatus("error");
          setProjectMessage(error instanceof Error ? error.message : "로컬 자동 저장에 실패했습니다.");
        });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [createCurrentProjectState, projectReady]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const loaded = await Promise.all(accepted.map(readSessionImage));
    if (!loaded.length) return;
    if (!storageRequestedRef.current) {
      storageRequestedRef.current = true;
      void requestPersistentProjectStorage();
    }
    setImages((previous) => [...previous, ...loaded]);
    setSelectedImageId((previous) => previous ?? loaded[0].id);
    setSelectedAnnotationId(null);
  }, []);

  const selectByOffset = useCallback((offset: number) => {
    setSelectedImageId((currentId) => {
      const index = imagesRef.current.findIndex((item) => item.id === currentId);
      if (!imagesRef.current.length) return null;
      const next = (Math.max(index, 0) + offset + imagesRef.current.length) % imagesRef.current.length;
      return imagesRef.current[next].id;
    });
    setSelectedAnnotationId(null);
  }, []);

  const mergeModelClasses = (incoming: Record<string, string>, overrides?: ClassResolution[]): Record<string, number> => {
    const source = Object.entries(incoming).map(([rawId, name]) => ({ id: Number(rawId), name }));
    const configured = modelConfigRef.current.classMap;
    const validConfigured = configured && source.every((item) => configured[String(item.id)] != null);
    const resolutions = overrides ?? (validConfigured
      ? source.map((item) => ({ sourceId: item.id, sourceName: item.name, targetId: configured[String(item.id)], targetName: classesRef.current.find((entry) => entry.id === configured[String(item.id)])?.name ?? item.name, conflict: "none" as const }))
      : resolveClassConflicts(classesRef.current, source));
    const classMap = Object.fromEntries(resolutions.map((item) => [String(item.sourceId), item.targetId]));
    const next = new Map(classesRef.current.map((item) => [item.id, item]));
    for (const resolution of resolutions) {
      if (!next.has(resolution.targetId)) next.set(resolution.targetId, { id: resolution.targetId, name: resolution.targetName, color: PALETTE[resolution.targetId % PALETTE.length] });
    }
    const nextClasses = [...next.values()].sort((a, b) => a.id - b.id);
    classesRef.current = nextClasses;
    setClasses(nextClasses);
    modelConfigRef.current = { ...modelConfigRef.current, classMap };
    setModelConfig((config) => ({ ...config, classMap }));
    return classMap;
  };

  const runInference = async (image: SessionImage) => {
    patchSessionImage(image.id, { status: "running", error: null });
    try {
      const response = await inferImage(image, modelConfig);
      const classMap = mergeModelClasses(response.model.classes);
      const annotations: Annotation[] = response.detections.map((item) => ({
        id: crypto.randomUUID(),
        classId: classMap[String(item.class_id)] ?? item.class_id,
        label: classesRef.current.find((entry) => entry.id === (classMap[String(item.class_id)] ?? item.class_id))?.name ?? item.label,
        score: item.score,
        source: "model",
        reviewState: "suggested",
        x1: item.x1,
        y1: item.y1,
        x2: item.x2,
        y2: item.y2,
      }));
      const latestImage = imagesRef.current.find((item) => item.id === image.id);
      if (latestImage) {
        const mergedAnnotations = mergeModelSuggestions(latestImage.annotations, annotations);
        commitAnnotationCommand({
          kind: "replace-all",
          imageId: image.id,
          before: latestImage.annotations,
          after: mergedAnnotations,
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
      const message = error instanceof Error ? error.message : "추론에 실패했습니다.";
      patchSessionImage(image.id, { status: "error", error: message });
      setModelStatus("error");
      setModelMessage(message);
    }
  };

  const runCurrent = () => {
    if (currentImage && modelConfig.modelRef.trim()) void runInference(currentImage);
  };

  const runAll = async () => {
    if (!images.length || batchRunning) return;
    setBatchRunning(true);
    for (const image of images) await runInference(image);
    setBatchRunning(false);
  };

  const preflightModel = async () => {
    setModelStatus("loading");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(true);
    try {
      const response = await loadModel(modelConfig);
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
      setModelStatus("error");
      setModelInfoOpen(false);
      setModelMessage(error instanceof Error ? error.message : "모델을 불러오지 못했습니다.");
    }
  };

  const commitBoxChange = (
    id: string,
    before: BoxCoordinates,
    after: BoxCoordinates,
    gesture: "move" | "resize",
  ) => {
    if (!currentImage) return;
    const annotation = currentImage.annotations.find((item) => item.id === id);
    if (!annotation) return;
    const selectionAfter = annotation.reviewState === "suggested" && reviewFilter === "pending"
      ? currentImage.annotations.find((item) => item.id !== id && item.reviewState === "suggested")?.id ?? null
      : id;
    commitAnnotationCommand({
      kind: "box",
      imageId: currentImage.id,
      annotationId: id,
      gesture,
      before,
      after,
      reviewBefore: annotation.reviewState,
      reviewAfter: annotation.reviewState === "suggested" ? "edited" : annotation.reviewState,
      selectionBefore: id,
      selectionAfter,
    });
  };

  const createAnnotation = (box: BoxCoordinates) => {
    if (!currentImage) return;
    const chosenClass = classes[0] ?? { id: 0, name: "object", color: PALETTE[0] };
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      classId: chosenClass.id,
      label: chosenClass.name,
      score: null,
      source: "manual",
      reviewState: "accepted",
      ...box,
    };
    commitAnnotationCommand({
      kind: "create",
      imageId: currentImage.id,
      annotation,
      index: currentImage.annotations.length,
      selectionBefore: selectedAnnotationId,
      selectionAfter: annotation.id,
    });
    patchSessionImage(currentImage.id, { status: "ready" });
    if (reviewFilter === "pending") setReviewFilter("all");
    setTool("select");
  };

  const deleteAnnotation = useCallback((id: string) => {
    const imageId = selectedImageIdRef.current;
    const image = imagesRef.current.find((item) => item.id === imageId);
    const index = image?.annotations.findIndex((annotation) => annotation.id === id) ?? -1;
    if (!image || index < 0) return;
    const nextPending = reviewFilter === "pending"
      ? image.annotations.find((annotation) => annotation.id !== id && annotation.reviewState === "suggested")?.id ?? null
      : null;
    commitAnnotationCommand({
      kind: "delete",
      imageId: image.id,
      annotation: image.annotations[index],
      index,
      selectionBefore: id,
      selectionAfter: nextPending,
    });
  }, [commitAnnotationCommand, reviewFilter]);

  const changeAnnotationClass = (id: string, classId: number) => {
    const chosenClass = classes.find((item) => item.id === classId);
    if (!currentImage || !chosenClass) return;
    const annotation = currentImage.annotations.find((item) => item.id === id);
    if (!annotation) return;
    const selectionAfter = annotation.reviewState === "suggested" && reviewFilter === "pending"
      ? currentImage.annotations.find((item) => item.id !== id && item.reviewState === "suggested")?.id ?? null
      : id;
    commitAnnotationCommand({
      kind: "class",
      imageId: currentImage.id,
      annotationId: id,
      before: { classId: annotation.classId, label: annotation.label },
      after: { classId, label: chosenClass.name },
      reviewBefore: annotation.reviewState,
      reviewAfter: annotation.reviewState === "suggested" ? "edited" : annotation.reviewState,
      selectionBefore: id,
      selectionAfter,
    });
  };

  const acceptAnnotation = (id: string) => {
    if (!currentImage) return;
    const annotation = currentImage.annotations.find((item) => item.id === id);
    if (!annotation || annotation.reviewState !== "suggested") return;
    const nextPending = reviewFilter === "pending"
      ? currentImage.annotations.find((item) => item.id !== id && item.reviewState === "suggested")?.id ?? null
      : id;
    commitAnnotationCommand({
      kind: "review",
      imageId: currentImage.id,
      annotationId: id,
      before: "suggested",
      after: "accepted",
      selectionBefore: id,
      selectionAfter: nextPending,
    });
  };

  const acceptAllAnnotations = () => {
    if (!currentImage) return;
    const after = acceptPendingSuggestions(currentImage.annotations);
    commitAnnotationCommand({
      kind: "replace-all",
      imageId: currentImage.id,
      before: currentImage.annotations,
      after,
      selectionBefore: selectedAnnotationId,
      selectionAfter: reviewFilter === "pending" ? null : selectedAnnotationId,
    });
  };

  const rejectAllAnnotations = () => {
    if (!currentImage) return;
    const after = currentImage.annotations.filter((annotation) => annotation.reviewState !== "suggested");
    commitAnnotationCommand({
      kind: "replace-all",
      imageId: currentImage.id,
      before: currentImage.annotations,
      after,
      selectionBefore: selectedAnnotationId,
      selectionAfter: null,
    });
  };

  const renameClass = (classId: number, name: string) => {
    setClasses((items) => items.map((item) => item.id === classId ? { ...item, name } : item));
    setImages((items) => items.map((image) => ({
      ...image,
      annotations: image.annotations.map((annotation) => annotation.classId === classId ? { ...annotation, label: name } : annotation),
    })));
  };

  const addClass = (name: string) => {
    setClasses((items) => {
      const id = items.length ? Math.max(...items.map((item) => item.id)) + 1 : 0;
      return [...items, { id, name, color: PALETTE[id % PALETTE.length] }];
    });
  };

  const undoCurrent = useCallback(() => {
    const imageId = selectedImageIdRef.current;
    const image = imagesRef.current.find((item) => item.id === imageId);
    if (!imageId || !image) return;
    const transition = undoAnnotationCommand(historyRef.current, imageId, image.annotations);
    if (!transition) return;
    replaceImageAnnotations(imageId, transition.annotations);
    replaceHistory(transition.history);
    setSelectedAnnotationId(transition.selection);
  }, [replaceHistory, replaceImageAnnotations]);

  const redoCurrent = useCallback(() => {
    const imageId = selectedImageIdRef.current;
    const image = imagesRef.current.find((item) => item.id === imageId);
    if (!imageId || !image) return;
    const transition = redoAnnotationCommand(historyRef.current, imageId, image.annotations);
    if (!transition) return;
    replaceImageAnnotations(imageId, transition.annotations);
    replaceHistory(transition.history);
    setSelectedAnnotationId(transition.selection);
  }, [replaceHistory, replaceImageAnnotations]);

  const newProject = () => {
    if (imagesRef.current.length && !window.confirm("현재 작업을 닫고 새 프로젝트를 시작할까요? 자동 저장된 작업도 교체됩니다.")) return;
    autosaveRevisionRef.current += 1;
    replaceSessionImages([]);
    setSelectedImageId(null);
    setSelectedAnnotationId(null);
    setClasses(DEFAULT_CLASSES.map((item) => ({ ...item })));
    setModelConfig({ ...DEFAULT_MODEL_CONFIG });
    setZoom(1);
    setExportFormat("yolo");
    setExportScope("all");
    setIncludeConfidence(false);
    setIncludeSuggestions(false);
    setIncludeOriginalImages(false);
    setReviewFilter("all");
    setTool("select");
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setExportError("");
    resetHistory();
    setProjectStatus("saving");
    setProjectMessage("새 프로젝트를 준비하는 중");
    void clearLocalProject()
      .then(() => {
        setProjectStatus("saved");
        setProjectMessage("새 프로젝트 · 자동 저장 준비됨");
      })
      .catch((error) => {
        setProjectStatus("error");
        setProjectMessage(error instanceof Error ? error.message : "기존 자동 저장을 지우지 못했습니다.");
      });
  };

  const openProject = async (file: File) => {
    if (projectBusy) return;
    if (imagesRef.current.length && !window.confirm("현재 작업을 닫고 선택한 프로젝트를 열까요?")) return;
    setProjectBusy(true);
    setProjectStatus("restoring");
    setProjectMessage(`${file.name} 읽는 중`);
    try {
      const project = await readProjectBackup(file);
      applyProject(project);
      await saveLocalProject(project);
      autosaveRevisionRef.current += 1;
      setProjectStatus("saved");
      setProjectMessage(`프로젝트 열림 · 이미지 ${project.images.length}장`);
    } catch (error) {
      setProjectStatus("error");
      setProjectMessage(error instanceof Error ? error.message : "프로젝트를 열지 못했습니다.");
    } finally {
      setProjectBusy(false);
    }
  };

  const saveProject = useCallback(async () => {
    if (projectBusy || !images.length) return;
    setProjectBusy(true);
    setProjectStatus("saving");
    setProjectMessage("휴대용 프로젝트 백업을 만드는 중");
    try {
      const snapshot = createCurrentProjectState();
      await saveLocalProject(snapshot);
      const filename = await downloadProjectBackup(snapshot);
      setProjectStatus("saved");
      setProjectMessage(`${filename} 저장됨`);
    } catch (error) {
      setProjectStatus("error");
      setProjectMessage(error instanceof Error ? error.message : "프로젝트 백업을 만들지 못했습니다.");
    } finally {
      setProjectBusy(false);
    }
  }, [createCurrentProjectState, images.length, projectBusy]);

  const doExport = async () => {
    const selectedImages = exportScope === "current" && currentImage ? [currentImage] : images;
    if (!selectedImages.length) return;
    const exportImages = prepareImagesForExport(selectedImages, includeSuggestions);
    setExporting(true);
    setExportError("");
    try {
      await exportAnnotations({ format: exportFormat, images: exportImages, classes, includeConfidence, includeOriginalImages });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "내보내기에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  const applyDatasetImport = (
    manifest: DatasetImportManifest,
    resolutions: ClassResolution[],
    mode: "new" | "append",
  ) => {
    if (mode === "new" && imagesRef.current.length && !window.confirm("현재 작업을 가져온 데이터셋으로 교체할까요?")) return;
    const idMap = new Map(resolutions.map((item) => [item.sourceId, item.targetId]));
    const targetClasses = mode === "append"
      ? new Map(classesRef.current.map((item) => [item.id, item]))
      : new Map<number, LabelClass>();
    for (const resolution of resolutions) {
      if (!targetClasses.has(resolution.targetId)) {
        targetClasses.set(resolution.targetId, {
          id: resolution.targetId,
          name: resolution.targetName.trim(),
          color: PALETTE[resolution.targetId % PALETTE.length],
        });
      }
    }
    const importedImages: SessionImage[] = manifest.images.map((image) => ({
      id: crypto.randomUUID(),
      file: image.file,
      name: image.name,
      url: URL.createObjectURL(image.file),
      width: image.width,
      height: image.height,
      status: "ready",
      elapsedMs: null,
      annotations: image.annotations.map((annotation) => {
        const classId = idMap.get(annotation.classId) ?? annotation.classId;
        return {
          ...annotation,
          id: crypto.randomUUID(),
          classId,
          label: targetClasses.get(classId)?.name ?? annotation.label,
        };
      }),
      error: null,
      relativePath: image.relativePath,
      split: image.split,
    }));
    const nextClasses = [...targetClasses.values()].sort((a, b) => a.id - b.id);
    classesRef.current = nextClasses;
    setClasses(nextClasses);
    if (mode === "new") {
      autosaveRevisionRef.current += 1;
      replaceSessionImages(importedImages);
      setSelectedImageId(importedImages[0]?.id ?? null);
      modelConfigRef.current = { ...DEFAULT_MODEL_CONFIG };
      setModelConfig({ ...DEFAULT_MODEL_CONFIG });
      resetHistory();
    } else {
      const nextImages = [...imagesRef.current, ...importedImages];
      imagesRef.current = nextImages;
      setImages(nextImages);
      setSelectedImageId((current) => current ?? importedImages[0]?.id ?? null);
    }
    if (!storageRequestedRef.current && importedImages.length) {
      storageRequestedRef.current = true;
      void requestPersistentProjectStorage();
    }
    setSelectedAnnotationId(null);
    setDatasetImportOpen(false);
    setProjectStatus("saving");
    setProjectMessage(`${manifest.sourceName} 가져옴 · 이미지 ${importedImages.length}장 · 클래스 ${nextClasses.length}개`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editingText = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || Boolean(target?.isContentEditable);
      const modifier = event.ctrlKey || event.metaKey;
      const historyAction = resolveHistoryShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        editingText,
        isComposing: event.isComposing,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
      });
      if (historyAction) {
        event.preventDefault();
        if (historyAction === "redo") redoCurrent();
        else undoCurrent();
        return;
      }
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (editingText || modifier) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedAnnotationId) {
        event.preventDefault();
        deleteAnnotation(selectedAnnotationId);
      } else if (event.key.toLowerCase() === "v") {
        setTool("select");
      } else if (event.key.toLowerCase() === "b") {
        setTool("draw");
      } else if (event.key === "[") {
        selectByOffset(-1);
      } else if (event.key === "]") {
        selectByOffset(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteAnnotation, redoCurrent, saveProject, selectByOffset, selectedAnnotationId, undoCurrent]);

  const running = currentImage?.status === "running";
  const classList = useMemo(() => [...classes].sort((a, b) => a.id - b.id), [classes]);
  const currentHistory = currentImage ? annotationHistory[currentImage.id] : null;

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-hidden bg-[#0e100f] text-[#e8ebe6] lg:h-[100dvh] lg:max-h-[100dvh]">
      <Header
        tool={tool}
        setTool={setTool}
        imageIndex={currentIndex}
        imageCount={images.length}
        annotationCount={currentImage?.annotations.length ?? 0}
        canRun={Boolean(currentImage && modelConfig.modelRef.trim())}
        running={Boolean(running)}
        canUndo={Boolean(currentHistory?.past.length)}
        canRedo={Boolean(currentHistory?.future.length)}
        onPrevious={() => selectByOffset(-1)}
        onNext={() => selectByOffset(1)}
        onRun={runCurrent}
        onUndo={undoCurrent}
        onRedo={redoCurrent}
        onExport={() => document.getElementById("export-panel")?.scrollIntoView({ behavior: "smooth" })}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[264px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)_304px]">
        <SessionRail
          images={images}
          selectedId={selectedImageId}
          modelConfig={modelConfig}
          health={health}
          modelStatus={modelStatus}
          modelMessage={modelMessage}
          projectStatus={projectStatus}
          projectMessage={projectMessage}
          projectBusy={projectBusy}
          onFiles={addFiles}
          onNewProject={newProject}
          onOpenProject={(file) => void openProject(file)}
          onSaveProject={() => void saveProject()}
          onImportDataset={() => setDatasetImportOpen(true)}
          onSelect={(id) => { setSelectedImageId(id); setSelectedAnnotationId(null); }}
          onModelChange={(patch) => {
            setModelConfig((config) => ({
              ...config,
              ...patch,
              classMap: patch.modelRef !== undefined || patch.adapter !== undefined ? undefined : config.classMap,
            }));
            setModelStatus("idle");
            setModelMessage("");
            setModelInspection(null);
            setModelInfoOpen(false);
          }}
          onLoadModel={() => void preflightModel()}
          onBrowseModel={() => setModelBrowserOpen(true)}
          hasModelInfo={Boolean(modelInspection)}
          onShowModelInfo={() => setModelInfoOpen(true)}
          onRunAll={() => void runAll()}
          batchRunning={batchRunning}
        />
        <AnnotationCanvas
          image={currentImage}
          classes={classList}
          selectedId={selectedAnnotationId}
          tool={tool}
          zoom={zoom}
          reviewFilter={reviewFilter}
          onSelect={setSelectedAnnotationId}
          onCommitBox={commitBoxChange}
          onCreate={createAnnotation}
          onFiles={addFiles}
        />
        <Inspector
          image={currentImage}
          classes={classList}
          selected={selectedAnnotation}
          zoom={zoom}
          exportFormat={exportFormat}
          exportScope={exportScope}
          includeConfidence={includeConfidence}
          includeSuggestions={includeSuggestions}
          includeOriginalImages={includeOriginalImages}
          reviewFilter={reviewFilter}
          exporting={exporting}
          exportError={exportError}
          onSelect={setSelectedAnnotationId}
          onDelete={deleteAnnotation}
          onAccept={acceptAnnotation}
          onAcceptAll={acceptAllAnnotations}
          onRejectAll={rejectAllAnnotations}
          onReviewFilter={(filter) => {
            setReviewFilter(filter);
            if (filter === "pending" && selectedAnnotation?.reviewState !== "suggested") setSelectedAnnotationId(null);
          }}
          onAnnotationClass={changeAnnotationClass}
          onAddClass={addClass}
          onRenameClass={renameClass}
          onZoom={setZoom}
          onExportFormat={setExportFormat}
          onExportScope={setExportScope}
          onIncludeConfidence={setIncludeConfidence}
          onIncludeSuggestions={setIncludeSuggestions}
          onIncludeOriginalImages={setIncludeOriginalImages}
          onExport={() => void doExport()}
          onClearError={() => setExportError("")}
        />
      </div>
      <ModelBrowser
        open={modelBrowserOpen}
        adapter={modelConfig.adapter}
        initialPath={modelConfig.modelRef}
        onClose={() => setModelBrowserOpen(false)}
        onSelect={(modelRef) => {
          setModelConfig((config) => ({ ...config, modelRef, classMap: undefined }));
          setModelStatus("idle");
          setModelMessage("");
          setModelInspection(null);
          setModelInfoOpen(false);
        }}
      />
      <ModelInfoPanel
        open={modelInfoOpen}
        inspection={modelInspection}
        loading={modelStatus === "loading"}
        testing={currentImage?.status === "running"}
        canTest={Boolean(currentImage && modelInspection)}
        onClose={() => setModelInfoOpen(false)}
        onTest={() => currentImage && void runInference(currentImage)}
      />
      <DatasetImportDialog
        open={datasetImportOpen}
        existingClasses={classList}
        onClose={() => setDatasetImportOpen(false)}
        onApply={applyDatasetImport}
      />
      <ClassMappingDialog
        open={Boolean(pendingModelMapping)}
        modelName={pendingModelMapping?.response.model.model_ref ?? ""}
        resolutions={pendingModelMapping?.resolutions ?? []}
        onChange={(resolutions) => setPendingModelMapping((pending) => pending ? { ...pending, resolutions } : null)}
        onClose={() => {
          setPendingModelMapping(null);
          setModelInfoOpen(false);
          setModelMessage("클래스 매핑 취소됨");
        }}
        onApply={() => {
          if (!pendingModelMapping) return;
          const { response, resolutions } = pendingModelMapping;
          mergeModelClasses(response.model.classes, resolutions);
          setModelStatus("ready");
          setModelMessage(`${response.model.adapter.toUpperCase()} 준비됨 · ${response.model.device}`);
          setModelInspection({ model: response.model, loadTimeMs: response.load_time_ms, cached: response.cached, inference: null });
          setModelInfoOpen(true);
          setPendingModelMapping(null);
        }}
      />
    </div>
  );
}

async function readSessionImage(file: File): Promise<SessionImage> {
  const url = URL.createObjectURL(file);
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
    image.src = url;
  });
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    url,
    width: dimensions.width,
    height: dimensions.height,
    status: "idle",
    elapsedMs: null,
    annotations: [],
    error: null,
    relativePath: null,
    split: "unspecified",
  };
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
