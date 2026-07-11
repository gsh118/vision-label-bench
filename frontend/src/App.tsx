import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationCanvas } from "./components/AnnotationCanvas";
import { Header } from "./components/Header";
import { Inspector } from "./components/Inspector";
import { ModelBrowser } from "./components/ModelBrowser";
import { ModelInfoPanel } from "./components/ModelInfoPanel";
import { SessionRail } from "./components/SessionRail";
import { exportAnnotations, getHealth, inferImage, loadModel } from "./lib/api";
import { downloadProjectBackup, readProjectBackup } from "./lib/projectBackup";
import type { HydratedProject, ProjectState } from "./lib/projectDocument";
import {
  clearLocalProject,
  loadLocalProject,
  requestPersistentProjectStorage,
  saveLocalProject,
} from "./lib/projectStore";
import type {
  Annotation,
  BoxCoordinates,
  ExportFormat,
  HealthResponse,
  LabelClass,
  ModelConfig,
  ModelInspection,
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [projectReady, setProjectReady] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectStatus, setProjectStatus] = useState<ProjectSaveStatus>("restoring");
  const [projectMessage, setProjectMessage] = useState("이전 로컬 작업을 확인하는 중");
  const imagesRef = useRef(images);
  const autosaveRevisionRef = useRef(0);
  const storageRequestedRef = useRef(false);
  imagesRef.current = images;

  const replaceSessionImages = useCallback((nextImages: SessionImage[]) => {
    const previousImages = imagesRef.current;
    imagesRef.current = nextImages;
    setImages(nextImages);
    for (const image of previousImages) URL.revokeObjectURL(image.url);
  }, []);

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
    setTool("select");
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setExportError("");
  }, [replaceSessionImages]);

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
    },
  }), [classes, exportFormat, exportScope, images, includeConfidence, modelConfig, selectedImageId, zoom]);

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

  const mergeModelClasses = (incoming: Record<string, string>) => {
    setClasses((previous) => {
      const map = new Map(previous.map((item) => [item.id, item]));
      for (const [rawId, name] of Object.entries(incoming)) {
        const id = Number(rawId);
        map.set(id, { id, name, color: map.get(id)?.color ?? PALETTE[id % PALETTE.length] });
      }
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
  };

  const runInference = async (image: SessionImage) => {
    setImages((items) => items.map((item) => item.id === image.id ? { ...item, status: "running", error: null } : item));
    try {
      const response = await inferImage(image, modelConfig);
      mergeModelClasses(response.model.classes);
      const annotations: Annotation[] = response.detections.map((item) => ({
        id: crypto.randomUUID(),
        classId: item.class_id,
        label: item.label,
        score: item.score,
        source: "model",
        x1: item.x1,
        y1: item.y1,
        x2: item.x2,
        y2: item.y2,
      }));
      setImages((items) => items.map((item) => item.id === image.id ? {
        ...item,
        width: response.width,
        height: response.height,
        status: "ready",
        elapsedMs: response.elapsed_ms,
        annotations,
        error: null,
      } : item));
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
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "추론에 실패했습니다.";
      setImages((items) => items.map((item) => item.id === image.id ? { ...item, status: "error", error: message } : item));
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
      mergeModelClasses(response.model.classes);
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

  const updateAnnotation = (id: string, box: BoxCoordinates) => {
    if (!currentImage) return;
    setImages((items) => items.map((image) => image.id === currentImage.id ? {
      ...image,
      annotations: image.annotations.map((annotation) => annotation.id === id ? { ...annotation, ...box } : annotation),
    } : image));
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
      ...box,
    };
    setImages((items) => items.map((image) => image.id === currentImage.id ? {
      ...image,
      status: "ready",
      annotations: [...image.annotations, annotation],
    } : image));
    setSelectedAnnotationId(annotation.id);
    setTool("select");
  };

  const deleteAnnotation = useCallback((id: string) => {
    setImages((items) => items.map((image) => image.id === selectedImageId ? {
      ...image,
      annotations: image.annotations.filter((annotation) => annotation.id !== id),
    } : image));
    setSelectedAnnotationId(null);
  }, [selectedImageId]);

  const changeAnnotationClass = (id: string, classId: number) => {
    const chosenClass = classes.find((item) => item.id === classId);
    if (!currentImage || !chosenClass) return;
    setImages((items) => items.map((image) => image.id === currentImage.id ? {
      ...image,
      annotations: image.annotations.map((annotation) => annotation.id === id ? {
        ...annotation,
        classId,
        label: chosenClass.name,
      } : annotation),
    } : image));
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
    setTool("select");
    setModelStatus("idle");
    setModelMessage("");
    setModelInspection(null);
    setModelInfoOpen(false);
    setExportError("");
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
    setExporting(true);
    setExportError("");
    try {
      await exportAnnotations({ format: exportFormat, images: selectedImages, classes, includeConfidence });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "내보내기에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
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
  }, [deleteAnnotation, saveProject, selectByOffset, selectedAnnotationId]);

  const running = currentImage?.status === "running";
  const classList = useMemo(() => [...classes].sort((a, b) => a.id - b.id), [classes]);

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
        onPrevious={() => selectByOffset(-1)}
        onNext={() => selectByOffset(1)}
        onRun={runCurrent}
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
          onSelect={(id) => { setSelectedImageId(id); setSelectedAnnotationId(null); }}
          onModelChange={(patch) => {
            setModelConfig((config) => ({ ...config, ...patch }));
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
          onSelect={setSelectedAnnotationId}
          onUpdate={updateAnnotation}
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
          exporting={exporting}
          exportError={exportError}
          onSelect={setSelectedAnnotationId}
          onDelete={deleteAnnotation}
          onAnnotationClass={changeAnnotationClass}
          onAddClass={addClass}
          onRenameClass={renameClass}
          onZoom={setZoom}
          onExportFormat={setExportFormat}
          onExportScope={setExportScope}
          onIncludeConfidence={setIncludeConfidence}
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
          setModelConfig((config) => ({ ...config, modelRef }));
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
