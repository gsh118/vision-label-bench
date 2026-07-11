import {
  CheckCircle,
  Cpu,
  File as FileIcon,
  Gauge,
  Info,
  MagnifyingGlass,
  Play,
  Tag,
  Timer,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ModelInspection } from "../types";

interface ModelInfoPanelProps {
  open: boolean;
  inspection: ModelInspection | null;
  loading: boolean;
  testing: boolean;
  canTest: boolean;
  onClose: () => void;
  onTest: () => void;
}

export function ModelInfoPanel(props: ModelInfoPanelProps) {
  const [classFilter, setClassFilter] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  useEffect(() => {
    if (props.open) setClassFilter("");
  }, [props.open, props.inspection?.model.model_ref]);

  const classes = useMemo(() => {
    if (!props.inspection) return [];
    const query = classFilter.trim().toLocaleLowerCase();
    return Object.entries(props.inspection.model.classes)
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.id - b.id)
      .filter((item) => !query || item.name.toLocaleLowerCase().includes(query) || String(item.id) === query);
  }, [classFilter, props.inspection]);

  if (!props.open) return null;

  const inspection = props.inspection;
  const model = inspection?.model;
  const verified = Boolean(inspection?.inference);
  const displayName = model?.model_type || model?.model_ref.split(/[\\/]/).pop() || "Model";

  return (
    <div
      className="model-browser-backdrop fixed inset-0 z-40 grid place-items-center bg-[#080a09]/80 p-4 backdrop-blur-[5px]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="model-browser-panel grid h-[min(720px,calc(100dvh-2rem))] w-[min(820px,calc(100vw-2rem))] grid-rows-[auto_1fr_auto] overflow-hidden rounded-[20px] border border-white/10 bg-[#131714] shadow-[0_28px_90px_rgba(3,7,4,0.55),inset_0_1px_0_rgba(255,255,255,0.05)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-info-title"
      >
        <header className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[#99c2a2]/20 bg-[#99c2a2]/8 text-[#b8d9bf]">
              <Info size={18} weight="duotone" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="model-info-title" className="truncate text-[14px] font-semibold tracking-[-0.015em] text-[#edf1eb]">{displayName}</h2>
                {model && (
                  <span className="rounded-md border border-white/8 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#858e86]">
                    {model.adapter}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-[9px] text-[#667067]" title={model?.model_ref}>{model?.model_ref ?? "모델 정보를 불러오는 중"}</p>
            </div>
          </div>
          <button className="icon-button shrink-0" onClick={props.onClose} aria-label="모델 정보 닫기">
            <X size={16} />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 overflow-y-auto">
          {props.loading && !inspection ? (
            <ModelInfoSkeleton />
          ) : !inspection || !model ? (
            <div className="grid h-full min-h-64 place-content-center justify-items-center px-6 text-center">
              <Info size={28} weight="thin" className="text-[#667067]" />
              <p className="mt-3 text-[12px] font-medium text-[#c5cbc4]">표시할 모델 정보가 없습니다</p>
              <span className="mt-1 text-[10px] text-[#737b73]">먼저 모델을 불러오세요.</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 border-b border-white/8 sm:grid-cols-[1.15fr_0.85fr]">
                <section className="border-b border-white/8 p-5 sm:border-b-0 sm:border-r">
                  <span className="section-label mb-4">검증 상태</span>
                  <div className="flex items-start gap-3">
                    <span className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border border-[#99c2a2]/25 bg-[#99c2a2]/8 text-[#b8d9bf]">
                      <CheckCircle size={22} weight="fill" />
                      <span className="absolute inset-0 animate-ping rounded-full border border-[#99c2a2]/20 [animation-duration:2.8s]" />
                    </span>
                    <div>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b8d9bf]">
                        {verified ? "Inference verified" : "Load verified"}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#a5ada5]">
                        {verified
                          ? `${inspection.inference!.imageName}에서 ${inspection.inference!.detectionCount}개 객체를 반환했습니다.`
                          : "가중치와 클래스 구성을 정상적으로 읽었습니다. 실제 추론은 아직 확인하지 않았습니다."}
                      </p>
                    </div>
                  </div>
                </section>
                <section className="grid grid-cols-2 divide-x divide-white/8 p-5">
                  <Metric label="로드 시간" value={inspection.loadTimeMs == null ? "추론으로 로드" : formatDuration(inspection.loadTimeMs)} icon={<Timer size={14} />} />
                  <Metric label={verified ? "추론 시간" : "모델 캐시"} value={verified ? formatDuration(inspection.inference!.elapsedMs) : inspection.cached ? "재사용" : "새로 로드"} icon={<Gauge size={14} />} />
                </section>
              </div>

              <section className="border-b border-white/8 px-5 py-4">
                <span className="section-label mb-3">모델 사양</span>
                <dl className="grid grid-cols-1 divide-y divide-white/7 sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
                  <SpecRow label="장치" value={model.device} icon={<Cpu size={14} />} />
                  <SpecRow label="형식" value={model.format} icon={<FileIcon size={14} />} />
                  <SpecRow label="Task" value={model.task} />
                  <SpecRow label="입력 크기" value={model.input_size} />
                  <SpecRow label="아키텍처" value={model.architecture} />
                  <SpecRow label="런타임" value={`${model.adapter} ${model.runtime_version ?? ""}`.trim()} />
                  <SpecRow label="파라미터" value={model.parameter_count == null ? null : formatCount(model.parameter_count)} />
                  <SpecRow label="파일 크기" value={model.file_size == null ? null : formatBytes(model.file_size)} />
                </dl>
              </section>

              <section className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="section-label"><Tag size={13} /> 클래스 {Object.keys(model.classes).length}</span>
                  <label className="relative block w-full sm:w-56">
                    <span className="sr-only">클래스 검색</span>
                    <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#626b63]" size={13} />
                    <input
                      className="control h-8 pl-8 text-[10px]"
                      value={classFilter}
                      onChange={(event) => setClassFilter(event.target.value)}
                      placeholder="ID 또는 클래스명"
                    />
                  </label>
                </div>
                {classes.length ? (
                  <div className="grid max-h-56 grid-cols-1 gap-x-6 overflow-y-auto rounded-[10px] border border-white/7 bg-[#101310] px-3 scrollbar-thin sm:grid-cols-2">
                    {classes.map((item) => (
                      <div key={item.id} className="grid grid-cols-[32px_1fr] items-center gap-2 border-b border-white/6 py-2 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
                        <span className="font-mono text-[9px] text-[#657067]">{String(item.id).padStart(2, "0")}</span>
                        <span className="truncate text-[10px] font-medium text-[#b8c0b8]">{item.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[10px] border border-dashed border-white/8 px-4 py-8 text-center text-[10px] text-[#727a72]">일치하는 클래스가 없습니다.</div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 bg-[#101310] px-4 py-3">
          <p className="text-[9px] text-[#687168]">
            {props.canTest ? "현재 이미지로 모델의 전체 추론 경로를 확인할 수 있습니다." : "테스트 추론을 하려면 먼저 이미지를 추가하세요."}
          </p>
          <div className="flex gap-2">
            <button className="secondary-button" onClick={props.onClose}>닫기</button>
            <button className="primary-button" onClick={props.onTest} disabled={!props.canTest || props.testing || !inspection}>
              <Play size={15} weight="fill" /> {props.testing ? "테스트 중" : verified ? "다시 테스트" : "현재 이미지로 테스트"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function Metric(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <span className="flex items-center gap-1.5 text-[9px] text-[#687168]">{props.icon}{props.label}</span>
      <strong className="mt-2 block font-mono text-[12px] font-medium text-[#d4d9d3]">{props.value}</strong>
    </div>
  );
}

function SpecRow(props: { label: string; value: string | null; icon?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-3 border-b border-white/7 py-2.5 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="flex items-center gap-1.5 text-[9px] text-[#687168]">{props.icon}{props.label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[10px] font-medium text-[#b8c0b8]" title={props.value ?? undefined}>{props.value || "—"}</dd>
    </div>
  );
}

function ModelInfoSkeleton() {
  return (
    <div className="space-y-6 p-5" aria-label="모델 정보를 불러오는 중">
      <div className="grid grid-cols-2 gap-4">
        <span className="skeleton-block h-24 rounded-xl" />
        <span className="skeleton-block h-24 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        {Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton-block h-8 rounded-lg" />)}
      </div>
      <span className="skeleton-block block h-40 rounded-xl" />
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatBytes(value: number): string {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
}
