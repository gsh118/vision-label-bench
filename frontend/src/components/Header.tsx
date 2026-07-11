import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BoundingBox,
  CaretLeft,
  CaretRight,
  CursorClick,
  DownloadSimple,
  Play,
  Selection,
} from "@phosphor-icons/react";
import type { ToolKind } from "../types";

interface HeaderProps {
  tool: ToolKind;
  setTool: (tool: ToolKind) => void;
  imageIndex: number;
  imageCount: number;
  annotationCount: number;
  canRun: boolean;
  running: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRun: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
}

export function Header(props: HeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center border-b border-white/8 bg-[#111412] px-4 lg:px-5">
      <div className="flex min-w-[232px] items-center gap-3">
        <div className="grid size-9 place-items-center rounded-[10px] border border-[#99c2a2]/30 bg-[#99c2a2]/10 text-[#b8d9bf]">
          <BoundingBox size={20} weight="duotone" />
        </div>
        <div className="leading-none">
          <p className="text-[13px] font-semibold tracking-[-0.01em] text-[#f2f4ef]">Label Bench</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#737b73]">Object worktable / 01</p>
        </div>
      </div>

      <div className="mx-auto flex items-center gap-1 rounded-xl border border-white/8 bg-[#171b18] p-1">
        <ToolButton active={props.tool === "select"} label="선택 V" onClick={() => props.setTool("select")}>
          <CursorClick size={16} />
        </ToolButton>
        <ToolButton active={props.tool === "draw"} label="박스 B" onClick={() => props.setTool("draw")}>
          <Selection size={16} />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-white/8" aria-hidden="true" />
        <HistoryButton label="실행 취소" shortcut="Ctrl+Z" disabled={!props.canUndo} onClick={props.onUndo}>
          <ArrowCounterClockwise size={16} />
        </HistoryButton>
        <HistoryButton label="다시 실행" shortcut="Ctrl+Y" disabled={!props.canRedo} onClick={props.onRedo}>
          <ArrowClockwise size={16} />
        </HistoryButton>
      </div>

      <div className="hidden items-center gap-1.5 border-l border-white/8 pl-4 md:flex">
        <button className="icon-button" onClick={props.onPrevious} disabled={props.imageCount === 0} aria-label="이전 이미지">
          <CaretLeft size={17} />
        </button>
        <span className="min-w-20 text-center font-mono text-[11px] text-[#9aa29a]">
          {props.imageCount ? `${props.imageIndex + 1} / ${props.imageCount}` : "0 / 0"}
        </span>
        <button className="icon-button" onClick={props.onNext} disabled={props.imageCount === 0} aria-label="다음 이미지">
          <CaretRight size={17} />
        </button>
      </div>

      <div className="ml-3 flex items-center gap-2">
        <span className="hidden font-mono text-[10px] text-[#737b73] xl:inline">BOX {props.annotationCount}</span>
        <button className="secondary-button hidden sm:flex" onClick={props.onExport} disabled={props.imageCount === 0}>
          <DownloadSimple size={16} />
          내보내기
        </button>
        <button className="primary-button" onClick={props.onRun} disabled={!props.canRun || props.running}>
          <Play size={15} weight="fill" />
          {props.running ? "추론 중" : "현재 이미지 추론"}
        </button>
      </div>
    </header>
  );
}

function HistoryButton(props: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="grid size-8 place-items-center rounded-lg text-[#8c958d] transition hover:bg-white/5 hover:text-[#dbe0da] active:translate-y-px disabled:hover:bg-transparent disabled:hover:text-[#8c958d]"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={`${props.label} (${props.shortcut})`}
      title={`${props.label} · ${props.shortcut}`}
    >
      {props.children}
    </button>
  );
}

function ToolButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium transition duration-200 active:translate-y-px ${
        props.active ? "bg-[#edf2eb] text-[#172019]" : "text-[#8c958d] hover:bg-white/5 hover:text-[#dbe0da]"
      }`}
      onClick={props.onClick}
    >
      {props.children}
      <span className="hidden lg:inline">{props.label}</span>
    </button>
  );
}
