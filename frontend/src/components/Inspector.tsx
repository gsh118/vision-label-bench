import {
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  DownloadSimple,
  FileZip,
  Plus,
  Tag,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type {
  Annotation,
  ExportFormat,
  LabelClass,
  SessionImage,
} from "../types";

interface InspectorProps {
  image: SessionImage | null;
  classes: LabelClass[];
  selected: Annotation | null;
  zoom: number;
  exportFormat: ExportFormat;
  exportScope: "current" | "all";
  includeConfidence: boolean;
  includeSuggestions: boolean;
  reviewFilter: "all" | "pending";
  exporting: boolean;
  exportError: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onReviewFilter: (filter: "all" | "pending") => void;
  onAnnotationClass: (id: string, classId: number) => void;
  onAddClass: (name: string) => void;
  onRenameClass: (classId: number, name: string) => void;
  onZoom: (zoom: number) => void;
  onExportFormat: (format: ExportFormat) => void;
  onExportScope: (scope: "current" | "all") => void;
  onIncludeConfidence: (value: boolean) => void;
  onIncludeSuggestions: (value: boolean) => void;
  onExport: () => void;
  onClearError: () => void;
}

export function Inspector(props: InspectorProps) {
  const [newClass, setNewClass] = useState("");
  const [classesExpanded, setClassesExpanded] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const annotations = props.image?.annotations ?? [];
  const pendingCount = annotations.filter((annotation) => annotation.reviewState === "suggested").length;
  const visibleAnnotations = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => props.reviewFilter === "all" || annotation.reviewState === "suggested");
  return (
    <aside className="relative flex min-h-0 w-full flex-col border-l border-white/8 bg-[#141715] lg:h-full lg:w-[304px] lg:shrink-0 lg:overflow-hidden">
      <div
        ref={scrollRef}
        className="scrollbar-visible min-h-0 flex-1 overflow-visible overscroll-contain lg:overflow-y-auto"
        onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 180)}
      >
        <section className="border-b border-white/8 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="section-label"><Tag size={13} /> 객체 {props.image?.annotations.length ?? 0}</span>
          {props.image && <span className="font-mono text-[9px] text-[#646c65]">{props.image.width} × {props.image.height}</span>}
        </div>
        {props.image && annotations.length > 0 && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-[9px] border border-white/8 bg-[#101310] p-1">
              <button
                type="button"
                className={`rounded-md py-1.5 text-[9px] font-medium transition ${props.reviewFilter === "all" ? "bg-white/8 text-[#dce1db]" : "text-[#717a72] hover:text-[#bfc6bf]"}`}
                onClick={() => props.onReviewFilter("all")}
              >
                전체 {annotations.length}
              </button>
              <button
                type="button"
                className={`rounded-md py-1.5 text-[9px] font-medium transition ${props.reviewFilter === "pending" ? "bg-[#d0ad78]/12 text-[#dfc08e]" : "text-[#717a72] hover:text-[#bfc6bf]"}`}
                onClick={() => props.onReviewFilter("pending")}
              >
                검수 필요 {pendingCount}
              </button>
            </div>
            {pendingCount > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                <button type="button" className="secondary-button justify-center px-2" onClick={props.onAcceptAll}>
                  <Check size={13} /> 모두 승인
                </button>
                <button type="button" className="secondary-button justify-center px-2 text-[#c9958d]" onClick={props.onRejectAll}>
                  <Trash size={13} /> 모두 거부
                </button>
              </div>
            )}
          </>
        )}
        {!props.image ? (
          <p className="muted-copy">이미지를 추가하면 객체 목록이 표시됩니다.</p>
        ) : props.image.annotations.length === 0 ? (
          <div className="inspector-empty">
            <p>아직 박스가 없습니다.</p>
            <span>모델을 실행하거나 B 키를 눌러 직접 그리세요.</span>
          </div>
        ) : visibleAnnotations.length === 0 ? (
          <div className="inspector-empty">
            <p>검수할 모델 제안이 없습니다.</p>
            <span>전체 탭에서 확정된 라벨을 볼 수 있습니다.</span>
          </div>
        ) : (
          <div className="scrollbar-visible max-h-[min(32dvh,320px)] space-y-1 overflow-y-auto overscroll-contain pr-1">
            {visibleAnnotations.map(({ annotation, index }) => {
              const labelClass = props.classes.find((item) => item.id === annotation.classId);
              return (
                <button
                  key={annotation.id}
                  onClick={() => props.onSelect(annotation.id)}
                  className={`grid w-full grid-cols-[7px_1fr_auto] items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                    props.selected?.id === annotation.id ? "bg-white/8" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="h-7 w-1 rounded-full" style={{ background: labelClass?.color ?? "#99c2a2" }} />
                  <span className="min-w-0">
                    <strong className="block truncate text-[11px] font-medium text-[#d9ddd7]">{labelClass?.name ?? annotation.label}</strong>
                    <small className="font-mono text-[9px] text-[#6f776f]">#{String(index + 1).padStart(2, "0")} · {Math.round(annotation.x2 - annotation.x1)} × {Math.round(annotation.y2 - annotation.y1)}</small>
                  </span>
                  <span className={`font-mono text-[8px] ${annotation.reviewState === "suggested" ? "text-[#d0ad78]" : "text-[#899188]"}`}>
                    {reviewLabel(annotation)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {props.selected && (
          <div className="mt-3 border-t border-white/8 pt-3">
            <div className={`grid gap-2 ${props.selected.reviewState === "suggested" ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"}`}>
              <select
                className="control"
                value={props.selected.classId}
                onChange={(event) => props.onAnnotationClass(props.selected!.id, Number(event.target.value))}
              >
                {props.classes.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
              </select>
              {props.selected.reviewState === "suggested" && (
                <button className="icon-button text-[#a8cdb0]" onClick={() => props.onAccept(props.selected!.id)} aria-label="모델 제안 승인" title="제안 승인">
                  <Check size={15} />
                </button>
              )}
              <button
                className="danger-button"
                onClick={() => props.onDelete(props.selected!.id)}
                aria-label={props.selected.reviewState === "suggested" ? "모델 제안 거부" : "선택 박스 삭제"}
                title={props.selected.reviewState === "suggested" ? "제안 거부" : "박스 삭제"}
              >
                <Trash size={15} />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {["x1", "y1", "x2", "y2"].map((key) => (
                <span key={key} className="coordinate-cell">
                  <small>{key.toUpperCase()}</small>
                  <strong>{Math.round(props.selected![key as keyof Pick<Annotation, "x1" | "y1" | "x2" | "y2">] as number)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
        </section>

        <section className="border-b border-white/8 p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg text-left text-[#8e978e] transition hover:text-[#d8ddd7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fb899]/50"
            onClick={() => setClassesExpanded((expanded) => !expanded)}
            aria-expanded={classesExpanded}
            aria-controls="inspector-class-list"
          >
            <span className="section-label"><Tag size={13} /> 클래스 {props.classes.length}</span>
            {classesExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>
          {classesExpanded ? (
            <div className="mt-3 space-y-2" id="inspector-class-list">
              <div className="scrollbar-visible max-h-[min(34dvh,300px)] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                {props.classes.map((item) => (
                  <label key={item.id} className="grid grid-cols-[9px_24px_1fr] items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: item.color }} />
                    <span className="font-mono text-[9px] text-[#697169]">{item.id}</span>
                    <input
                      className="control py-1.5"
                      value={item.name}
                      onChange={(event) => props.onRenameClass(item.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <form
                className="grid grid-cols-[1fr_auto] gap-2 pt-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newClass.trim();
                  if (name) props.onAddClass(name);
                  setNewClass("");
                }}
              >
                <input className="control" value={newClass} onChange={(event) => setNewClass(event.target.value)} placeholder="새 클래스" />
                <button className="icon-button" type="submit" aria-label="클래스 추가"><Plus size={15} /></button>
              </form>
            </div>
          ) : (
            <p className="mt-2 text-[10px] leading-4 text-[#626a63]">클래스 이름을 편집하려면 펼치세요.</p>
          )}
        </section>

        <section className="border-b border-white/8 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="section-label">화면 배율</span>
          <span className="font-mono text-[10px] text-[#9ba39a]">{Math.round(props.zoom * 100)}%</span>
        </div>
        <input className="accent-range w-full" type="range" min="0.5" max="2.5" step="0.1" value={props.zoom} onChange={(event) => props.onZoom(Number(event.target.value))} />
        </section>

        <section className="mt-auto p-4" id="export-panel">
        <span className="section-label mb-3"><FileZip size={13} /> 라벨 내보내기</span>
        <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-white/8 bg-[#101310] p-1">
          {(["yolo", "coco", "voc"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              className={`rounded-md py-2 font-mono text-[9px] uppercase transition ${props.exportFormat === format ? "bg-[#edf2eb] text-[#182019]" : "text-[#7e877e] hover:text-[#cfd5ce]"}`}
              onClick={() => props.onExportFormat(format)}
            >{format}</button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="option-check">
            <input type="radio" name="scope" checked={props.exportScope === "current"} onChange={() => props.onExportScope("current")} /> 현재 이미지
          </label>
          <label className="option-check">
            <input type="radio" name="scope" checked={props.exportScope === "all"} onChange={() => props.onExportScope("all")} /> 전체 세션
          </label>
        </div>
        <label className="option-check mt-2">
          <input type="checkbox" checked={props.includeConfidence} onChange={(event) => props.onIncludeConfidence(event.target.checked)} /> 신뢰도 포함
        </label>
        <label className="option-check mt-2">
          <input type="checkbox" checked={props.includeSuggestions} onChange={(event) => props.onIncludeSuggestions(event.target.checked)} /> 검수 전 모델 제안 포함
        </label>
        {pendingCount > 0 && !props.includeSuggestions && (
          <p className="mt-2 text-[9px] leading-4 text-[#8f7a58]">검수 전 제안 {pendingCount}개는 현재 내보내기에서 제외됩니다.</p>
        )}
        {props.exportError && (
          <div className="inline-message inline-message-error mt-3">
            <WarningCircle size={14} />
            <span className="flex-1">{props.exportError}</span>
            <button onClick={props.onClearError} aria-label="오류 닫기"><X size={13} /></button>
          </div>
        )}
        <button className="primary-button mt-3 w-full justify-center" onClick={props.onExport} disabled={!props.image || props.exporting}>
          <DownloadSimple size={16} /> {props.exporting ? "만드는 중" : "ZIP 내려받기"}
        </button>
        </section>
      </div>
      {showScrollTop && (
        <button
          type="button"
          className="absolute bottom-4 right-4 z-10 grid size-9 place-items-center rounded-[10px] border border-white/10 bg-[#202521]/95 text-[#b8c0b8] shadow-[0_10px_24px_rgba(5,9,6,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-white/20 hover:bg-[#293029] hover:text-white active:translate-y-px"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="오른쪽 패널 맨 위로"
          title="맨 위로"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </aside>
  );
}

function reviewLabel(annotation: Annotation): string {
  if (annotation.reviewState === "suggested") {
    return annotation.score == null ? "제안" : `제안 ${Math.round(annotation.score * 100)}%`;
  }
  if (annotation.reviewState === "edited") return "수정됨";
  return annotation.source === "manual" ? "MAN" : "승인";
}
