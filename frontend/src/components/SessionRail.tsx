import {
  CheckCircle,
  Cpu,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  ImageSquare,
  Info,
  Plus,
  SlidersHorizontal,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRef } from "react";
import type { HealthResponse, ModelConfig, ProjectSaveStatus, SessionImage } from "../types";

interface SessionRailProps {
  images: SessionImage[];
  selectedId: string | null;
  modelConfig: ModelConfig;
  health: HealthResponse | null;
  modelStatus: "idle" | "loading" | "ready" | "error";
  modelMessage: string;
  projectStatus: ProjectSaveStatus;
  projectMessage: string;
  projectBusy: boolean;
  onFiles: (files: FileList | File[]) => void;
  onNewProject: () => void;
  onOpenProject: (file: File) => void;
  onSaveProject: () => void;
  onSelect: (id: string) => void;
  onModelChange: (patch: Partial<ModelConfig>) => void;
  onLoadModel: () => void;
  onBrowseModel: () => void;
  hasModelInfo: boolean;
  onShowModelInfo: () => void;
  onRunAll: () => void;
  batchRunning: boolean;
}

export function SessionRail(props: SessionRailProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  return (
    <aside className="scrollbar-thin flex min-h-0 w-full flex-col overflow-y-auto border-r border-white/8 bg-[#141715] md:w-[264px] md:shrink-0">
      <section className="border-b border-white/8 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="section-label"><FloppyDisk size={13} /> 프로젝트</span>
          <ProjectState status={props.projectStatus} />
        </div>
        <p
          className={`mb-3 truncate text-[9px] leading-4 ${props.projectStatus === "error" ? "text-[#dba59d]" : "text-[#687169]"}`}
          title={props.projectMessage}
          aria-live="polite"
        >
          {props.projectMessage}
        </p>
        <input
          ref={projectInputRef}
          type="file"
          accept=".vlb.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onOpenProject(file);
            event.target.value = "";
          }}
        />
        <div className="grid grid-cols-3 gap-1.5">
          <button className="secondary-button justify-center px-2" onClick={props.onNewProject} disabled={props.projectBusy} title="새 프로젝트">
            <FilePlus size={14} /> 새 작업
          </button>
          <button className="secondary-button justify-center px-2" onClick={() => projectInputRef.current?.click()} disabled={props.projectBusy} title="프로젝트 백업 열기">
            <FolderOpen size={14} /> 열기
          </button>
          <button className="secondary-button justify-center px-2" onClick={props.onSaveProject} disabled={props.projectBusy || props.images.length === 0} title="프로젝트 백업 저장">
            <FloppyDisk size={14} /> 저장
          </button>
        </div>
      </section>

      <section className="border-b border-white/8 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="section-label"><Cpu size={13} /> 모델</span>
          <span className={`status-dot ${props.health?.status === "ok" ? "status-dot-ready" : ""}`} />
        </div>
        <div className="space-y-3">
          <Field label="어댑터">
            <select
              value={props.modelConfig.adapter}
              onChange={(event) => props.onModelChange({ adapter: event.target.value as ModelConfig["adapter"] })}
              className="control"
            >
              <option value="auto">자동 판별</option>
              <option value="yolo">Ultralytics YOLO</option>
              <option value="detr">Transformers DETR</option>
            </select>
          </Field>
          <Field label="가중치 / 모델 ID">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="control min-w-0 font-mono text-[11px]"
                value={props.modelConfig.modelRef}
                onChange={(event) => props.onModelChange({ modelRef: event.target.value })}
                placeholder="yolo11n.pt 또는 경로"
              />
              <button className="icon-button" type="button" onClick={props.onBrowseModel} aria-label="로컬 모델 파일 찾기" title="로컬 모델 파일 찾기">
                <FolderOpen size={16} />
              </button>
            </div>
            <span className="block text-[9px] leading-relaxed text-[#596159]">모델 ID를 입력하거나 로컬 파일·폴더를 선택하세요.</span>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="장치">
              <select
                value={props.modelConfig.device}
                onChange={(event) => props.onModelChange({ device: event.target.value as ModelConfig["device"] })}
                className="control"
              >
                <option value="auto">AUTO</option>
                <option value="cuda">CUDA</option>
                <option value="cpu">CPU</option>
              </select>
            </Field>
            <Field label="신뢰도">
              <input
                className="control font-mono"
                type="number"
                min="0.01"
                max="1"
                step="0.01"
                value={props.modelConfig.confidence}
                onChange={(event) => props.onModelChange({ confidence: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Field label={`NMS IoU · ${props.modelConfig.iou.toFixed(2)}`}>
            <input
              className="accent-range w-full"
              type="range"
              min="0.05"
              max="0.95"
              step="0.05"
              value={props.modelConfig.iou}
              disabled={props.modelConfig.adapter === "detr"}
              onChange={(event) => props.onModelChange({ iou: Number(event.target.value) })}
            />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button className="secondary-button w-full justify-center" onClick={props.onLoadModel} disabled={props.modelStatus === "loading"}>
              <SlidersHorizontal size={15} />
              {props.modelStatus === "loading" ? "불러오는 중" : "모델 미리 불러오기"}
            </button>
            <button className="icon-button" onClick={props.onShowModelInfo} disabled={!props.hasModelInfo} aria-label="불러온 모델 상세 정보" title="모델 상세 정보">
              <Info size={16} />
            </button>
          </div>
          {props.modelMessage && (
            <div className={`inline-message ${props.modelStatus === "error" ? "inline-message-error" : ""}`}>
              {props.modelStatus === "error" ? <WarningCircle size={14} /> : <CheckCircle size={14} />}
              <span>{props.modelMessage}</span>
            </div>
          )}
        </div>
      </section>

      <section className="flex min-h-[220px] flex-1 flex-col p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="section-label"><ImageSquare size={13} /> 이미지 {props.images.length}</span>
          <button className="icon-button" onClick={() => inputRef.current?.click()} aria-label="이미지 추가">
            <Plus size={15} />
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
          multiple
          className="hidden"
          onChange={(event) => event.target.files && props.onFiles(event.target.files)}
        />
        {props.images.length === 0 ? (
          <button className="rail-empty" onClick={() => inputRef.current?.click()}>
            <Plus size={18} />
            <span>이미지 추가</span>
            <small>JPG, PNG, WEBP, BMP, TIFF</small>
          </button>
        ) : (
          <div className="space-y-1">
            {props.images.map((image, index) => (
              <button
                key={image.id}
                onClick={() => props.onSelect(image.id)}
                className={`group grid w-full grid-cols-[42px_1fr_auto] items-center gap-2 rounded-[10px] p-2 text-left transition duration-200 ${
                  props.selectedId === image.id ? "bg-white/8" : "hover:bg-white/[0.04]"
                }`}
              >
                <img src={image.url} className="size-[42px] rounded-md object-cover" alt="" />
                <span className="min-w-0">
                  <strong className="block truncate text-[11px] font-medium text-[#d9ddd7]">{image.name}</strong>
                  <small className="mt-1 block font-mono text-[9px] text-[#717970]">
                    {index + 1} · {image.annotations.length} BOX
                  </small>
                </span>
                <ImageState image={image} />
              </button>
            ))}
          </div>
        )}
      </section>
      {props.images.length > 1 && (
        <div className="border-t border-white/8 p-3">
          <button className="secondary-button w-full justify-center" onClick={props.onRunAll} disabled={props.batchRunning}>
            {props.batchRunning ? "전체 추론 중" : `전체 ${props.images.length}장 추론`}
          </button>
        </div>
      )}
    </aside>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10px] font-medium text-[#7d867e]">{props.label}</span>
      {props.children}
    </label>
  );
}

function ImageState({ image }: { image: SessionImage }) {
  const status = image.status;
  if (status === "running") return <span className="size-3 animate-pulse rounded-full bg-[#99c2a2]" />;
  const pending = image.annotations.filter((annotation) => annotation.reviewState === "suggested").length;
  if (pending > 0) return <WarningCircle size={14} className="text-[#d0ad78]" weight="fill" aria-label={`검수 필요 ${pending}개`} />;
  if (status === "ready") return <CheckCircle size={14} className="text-[#99c2a2]" weight="fill" />;
  if (status === "error") return <WarningCircle size={14} className="text-[#d18d83]" weight="fill" />;
  return <span className="size-1.5 rounded-full bg-[#505750]" />;
}

function ProjectState({ status }: { status: ProjectSaveStatus }) {
  if (status === "restoring" || status === "saving") {
    return <span className="h-1.5 w-5 animate-pulse rounded-full bg-[#758278]" aria-hidden="true" />;
  }
  if (status === "error") return <WarningCircle size={14} className="text-[#d18d83]" weight="fill" />;
  return <CheckCircle size={14} className="text-[#99c2a2]" weight="fill" />;
}
