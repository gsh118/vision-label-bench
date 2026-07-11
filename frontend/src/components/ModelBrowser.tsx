import {
  ArrowUp,
  Check,
  File as FileIcon,
  Folder,
  HardDrive,
  House,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browseModels } from "../lib/api";
import type { AdapterKind, ModelBrowseEntry, ModelBrowseResponse } from "../types";

interface ModelBrowserProps {
  open: boolean;
  adapter: AdapterKind;
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function ModelBrowser(props: ModelBrowserProps) {
  const [listing, setListing] = useState<ModelBrowseResponse | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selected, setSelected] = useState<ModelBrowseEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const response = await browseModels(path);
      setListing(response);
      setPathInput(response.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "폴더를 열지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!props.open) return;
    const isLocalPath = /^[a-zA-Z]:[\\/]/.test(props.initialPath) || props.initialPath.startsWith("/");
    void navigate(isLocalPath ? props.initialPath : undefined);
  }, [navigate, props.initialPath, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  const selectionPath = selected?.path ?? listing?.current ?? "";
  const selectedIsFolder = !selected;
  const selectionLabel = selectedIsFolder
    ? props.adapter === "detr" ? "이 모델 폴더 사용" : "현재 폴더 경로 사용"
    : "이 모델 파일 사용";
  const rootLabel = useMemo(() => (root: string) => root.replace(/[\\/]+$/, "") || root, []);

  if (!props.open) return null;

  const confirm = () => {
    if (!selectionPath) return;
    props.onSelect(selectionPath);
    props.onClose();
  };

  return (
    <div
      className="model-browser-backdrop fixed inset-0 z-40 grid place-items-center bg-[#080a09]/80 p-4 backdrop-blur-[5px]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="model-browser-panel grid h-[min(680px,calc(100dvh-2rem))] w-[min(760px,calc(100vw-2rem))] grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-[20px] border border-white/10 bg-[#131714] shadow-[0_28px_90px_rgba(3,7,4,0.55),inset_0_1px_0_rgba(255,255,255,0.05)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-browser-title"
      >
        <header className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg border border-[#99c2a2]/20 bg-[#99c2a2]/8 text-[#b8d9bf]">
                <HardDrive size={17} weight="duotone" />
              </span>
              <div>
                <h2 id="model-browser-title" className="text-[13px] font-semibold tracking-[-0.01em] text-[#edf1eb]">로컬 모델 선택</h2>
                <p className="mt-0.5 text-[10px] text-[#737c74]">파일은 복사하지 않고 원래 경로에서 불러옵니다.</p>
              </div>
            </div>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="모델 탐색기 닫기">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 border-b border-white/8 px-4 py-3">
          <form
            className="grid grid-cols-[auto_1fr_auto] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (pathInput.trim()) void navigate(pathInput.trim());
            }}
          >
            <button
              type="button"
              className="icon-button"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && void navigate(listing.parent)}
              aria-label="상위 폴더"
            >
              <ArrowUp size={16} />
            </button>
            <label className="relative block">
              <span className="sr-only">폴더 경로</span>
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667067]" size={14} />
              <input
                className="control h-9 pl-9 font-mono text-[10px]"
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                spellCheck={false}
                placeholder="D:\\models"
              />
            </label>
            <button className="secondary-button h-9" type="submit" disabled={loading || !pathInput.trim()}>이동</button>
          </form>

          <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-0.5">
            <button className="browser-location-button" onClick={() => listing && void navigate(listing.home)} disabled={loading}>
              <House size={13} /> 홈
            </button>
            {listing?.roots.map((root) => (
              <button key={root} className="browser-location-button font-mono" onClick={() => void navigate(root)} disabled={loading}>
                <HardDrive size={13} /> {rootLabel(root)}
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-1 p-1" aria-label="폴더를 불러오는 중">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="grid grid-cols-[30px_1fr_72px] items-center gap-3 rounded-lg px-3 py-2.5" style={{ animationDelay: `${index * 55}ms` }}>
                  <span className="skeleton-block size-7 rounded-md" />
                  <span className="skeleton-block h-2.5 rounded-full" style={{ width: `${48 + (index % 4) * 11}%` }} />
                  <span className="skeleton-block h-2 rounded-full" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="grid h-full min-h-48 place-content-center justify-items-center px-6 text-center">
              <span className="grid size-11 place-items-center rounded-xl border border-[#d18d83]/20 bg-[#d18d83]/8 text-[#d9a098]">
                <WarningCircle size={22} />
              </span>
              <p className="mt-3 text-[12px] font-medium text-[#d7dbd5]">폴더를 표시하지 못했습니다</p>
              <span className="mt-1 max-w-[48ch] text-[10px] leading-relaxed text-[#858e85]">{error}</span>
              <button className="secondary-button mt-4" onClick={() => void navigate(listing?.current)}>다시 시도</button>
            </div>
          ) : listing?.entries.length ? (
            <div className="space-y-0.5">
              {listing.entries.map((entry, index) => {
                const active = selected?.path === entry.path;
                return (
                  <button
                    key={entry.path}
                    className={`browser-file-row ${active ? "browser-file-row-active" : ""}`}
                    style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                    onClick={() => entry.kind === "model" ? setSelected(entry) : void navigate(entry.path)}
                    onDoubleClick={() => {
                      if (entry.kind === "model") {
                        props.onSelect(entry.path);
                        props.onClose();
                      }
                    }}
                  >
                    <span className={`grid size-8 place-items-center rounded-lg border ${entry.kind === "directory" ? "border-white/7 bg-white/[0.025] text-[#879189]" : "border-[#99c2a2]/15 bg-[#99c2a2]/7 text-[#a9cdb1]"}`}>
                      {entry.kind === "directory" ? <Folder size={16} weight="fill" /> : <FileIcon size={16} weight="duotone" />}
                    </span>
                    <span className="min-w-0 text-left">
                      <strong className="block truncate text-[11px] font-medium text-[#d8ddd7]">{entry.name}</strong>
                      <small className="mt-0.5 block truncate font-mono text-[8px] uppercase tracking-[0.08em] text-[#606861]">
                        {entry.kind === "directory" ? "Directory" : entry.name.split(".").pop()}
                      </small>
                    </span>
                    <span className="font-mono text-[9px] text-[#687168]">
                      {entry.kind === "model" && entry.size != null ? formatBytes(entry.size) : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid h-full min-h-48 place-content-center justify-items-center text-center">
              <Folder size={28} weight="thin" className="text-[#606961]" />
              <p className="mt-3 text-[11px] font-medium text-[#adb5ad]">표시할 모델 파일이 없습니다</p>
              <span className="mt-1 text-[9px] text-[#646c65]">하위 폴더로 이동하거나 현재 폴더를 모델 경로로 선택할 수 있습니다.</span>
            </div>
          )}
        </div>

        <footer className="grid grid-cols-1 gap-3 border-t border-white/8 bg-[#101310] px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-[#626a63]">선택 경로</span>
            <strong className="mt-1 block truncate font-mono text-[10px] font-medium text-[#aeb7ae]" title={selectionPath}>{selectionPath || "선택 없음"}</strong>
          </div>
          <div className="flex justify-end gap-2">
            <button className="secondary-button" onClick={props.onClose}>취소</button>
            <button className="primary-button" onClick={confirm} disabled={!selectionPath || loading}>
              <Check size={15} weight="bold" /> {selectionLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
