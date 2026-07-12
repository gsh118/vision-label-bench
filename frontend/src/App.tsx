import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationCanvas } from "./components/AnnotationCanvas";
import { ClassMappingDialog } from "./components/ClassMappingDialog";
import { DatasetImportDialog } from "./components/DatasetImportDialog";
import { Header } from "./components/Header";
import { Inspector } from "./components/Inspector";
import { ModelBrowser } from "./components/ModelBrowser";
import { ModelInfoPanel } from "./components/ModelInfoPanel";
import { SessionRail } from "./components/SessionRail";
import { useInferenceController } from "./features/inference/useInferenceController";
import { useProjectController } from "./features/project/useProjectController";
import { useWorkspaceState } from "./features/workspace/useWorkspaceState";
import { exportAnnotations, getHealth } from "./lib/api";
import { type ClassResolution, type DatasetImportManifest } from "./lib/datasetImport";
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
import type { HydratedProject, ProjectState } from "./lib/projectDocument";
import {
  acceptAllSuggestions as acceptPendingSuggestions,
  prepareImagesForExport,
} from "./lib/review";
import type {
  Annotation,
  BoxCoordinates,
  ExportFormat,
  HealthResponse,
  LabelClass,
  ModelConfig,
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
  const workspace = useWorkspaceState(DEFAULT_CLASSES, DEFAULT_MODEL_CONFIG);
  const {
    images,
    imagesRef,
    setImages,
    appendSessionImages,
    replaceSessionImages,
    replaceImageAnnotations,
    patchSessionImage,
    selectedImageId,
    selectedImageIdRef,
    setSelectedImageId,
    selectedAnnotationId,
    selectedAnnotationIdRef,
    setSelectedAnnotationId,
    classes,
    classesRef,
    setClasses,
    modelConfig,
    setModelConfig,
  } = workspace;
  const [tool, setTool] = useState<ToolKind>("select");
  const [zoom, setZoom] = useState(1);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [modelBrowserOpen, setModelBrowserOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("yolo");
  const [exportScope, setExportScope] = useState<"current" | "all">("all");
  const [includeConfidence, setIncludeConfidence] = useState(false);
  const [includeSuggestions, setIncludeSuggestions] = useState(false);
  const [includeOriginalImages, setIncludeOriginalImages] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "pending">("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [datasetImportOpen, setDatasetImportOpen] = useState(false);
  const [annotationHistory, setAnnotationHistory] = useState<AnnotationHistory>({});
  const historyRef = useRef(annotationHistory);
  historyRef.current = annotationHistory;

  const replaceHistory = useCallback((nextHistory: AnnotationHistory) => {
    historyRef.current = nextHistory;
    setAnnotationHistory(nextHistory);
  }, []);

  const resetHistory = useCallback(() => replaceHistory({}), [replaceHistory]);

  const commitAnnotationCommand = useCallback((command: AnnotationCommand) => {
    if (isNoopCommand(command)) return;
    const image = imagesRef.current.find((item) => item.id === command.imageId);
    if (!image) return;
    const applied = applyAnnotationCommand(image.annotations, command, "forward");
    replaceImageAnnotations(command.imageId, applied.annotations);
    replaceHistory(recordAnnotationCommand(historyRef.current, command));
    if (selectedImageIdRef.current === command.imageId) setSelectedAnnotationId(applied.selection);
  }, [replaceHistory, replaceImageAnnotations]);

  const {
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
  } = useInferenceController({ workspace, palette: PALETTE, commitAnnotationCommand });

  const applyProject = useCallback((project: HydratedProject) => {
    resetInference();
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
    setExportError("");
    resetHistory();
  }, [replaceSessionImages, resetHistory, resetInference, setClasses, setModelConfig, setSelectedAnnotationId, setSelectedImageId]);

  useEffect(() => {
    let active = true;
    getHealth().then((result) => active && setHealth(result)).catch(() => active && setHealth(null));
    return () => {
      active = false;
    };
  }, []);

  const currentIndex = Math.max(0, images.findIndex((item) => item.id === selectedImageId));
  const currentImage = images[currentIndex] ?? null;
  const selectedAnnotation = currentImage?.annotations.find((item) => item.id === selectedAnnotationId) ?? null;

  const projectSnapshot = useMemo<ProjectState>(() => ({
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

  const {
    busy: projectBusy,
    status: projectStatus,
    message: projectMessage,
    requestPersistentStorage,
    clearProject,
    openProject,
    saveProject,
    markChanged: markProjectChanged,
  } = useProjectController({ snapshot: projectSnapshot, imageCount: images.length, applyProject });

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const loaded = await Promise.all(accepted.map(readSessionImage));
    if (!loaded.length) return;
    requestPersistentStorage();
    appendSessionImages(loaded);
    setSelectedImageId((previous) => previous ?? loaded[0].id);
    setSelectedAnnotationId(null);
  }, [appendSessionImages, requestPersistentStorage, setSelectedAnnotationId, setSelectedImageId]);

  const selectByOffset = useCallback((offset: number) => {
    setSelectedImageId((currentId) => {
      const index = imagesRef.current.findIndex((item) => item.id === currentId);
      if (!imagesRef.current.length) return null;
      const next = (Math.max(index, 0) + offset + imagesRef.current.length) % imagesRef.current.length;
      return imagesRef.current[next].id;
    });
    setSelectedAnnotationId(null);
  }, []);

  const runCurrent = () => {
    if (currentImage && modelConfig.modelRef.trim()) void runInference(currentImage);
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
    resetInference();
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
    setExportError("");
    resetHistory();
    void clearProject();
  };

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
      resetInference();
      replaceSessionImages(importedImages);
      setSelectedImageId(importedImages[0]?.id ?? null);
      setModelConfig({ ...DEFAULT_MODEL_CONFIG });
      resetHistory();
    } else {
      appendSessionImages(importedImages);
      setSelectedImageId((current) => current ?? importedImages[0]?.id ?? null);
    }
    if (importedImages.length) requestPersistentStorage();
    setSelectedAnnotationId(null);
    setDatasetImportOpen(false);
    markProjectChanged(`${manifest.sourceName} 가져옴 · 이미지 ${importedImages.length}장 · 클래스 ${nextClasses.length}개`);
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
          onModelChange={changeModelConfig}
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
        onSelect={(modelRef) => changeModelConfig({ modelRef })}
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
        onClose={cancelPendingMapping}
        onApply={applyPendingMapping}
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
