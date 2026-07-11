import {
  Archive,
  CheckCircle,
  FileText,
  FolderOpen,
  Images,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import {
  folderFilesToVirtualFiles,
  importClassFile,
  importYoloDataset,
  resolveClassConflicts,
  zipToVirtualFiles,
  type ClassResolution,
  type DatasetImportManifest,
} from "../lib/datasetImport";
import type { LabelClass } from "../types";

interface DatasetImportDialogProps {
  open: boolean;
  existingClasses: LabelClass[];
  onClose: () => void;
  onApply: (manifest: DatasetImportManifest, resolutions: ClassResolution[], mode: "new" | "append") => void;
}

type SourceKind = "folder" | "zip" | "classes";

export function DatasetImportDialog(props: DatasetImportDialogProps) {
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceKind>("folder");
  const [mode, setMode] = useState<"new" | "append">("new");
  const [manifest, setManifest] = useState<DatasetImportManifest | null>(null);
  const [resolutions, setResolutions] = useState<ClassResolution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const summary = useMemo(() => {
    const images = manifest?.images ?? [];
    return {
      boxes: images.reduce((total, image) => total + image.annotations.length, 0),
      negative: images.filter((image) => image.annotations.length === 0).length,
      splits: Object.fromEntries(["train", "val", "test", "unspecified"].map((split) => [split, images.filter((image) => image.split === split).length])),
    };
  }, [manifest]);

  if (!props.open) return null;

  const resetResult = () => { setManifest(null); setResolutions([]); setError(""); };
  const parseSelection = async (files: FileList | null) => {
    if (!files?.length) return;
    setLoading(true);
    resetResult();
    try {
      const next = source === "folder"
        ? await importYoloDataset(folderFilesToVirtualFiles(files), files[0].name)
        : source === "zip"
          ? await importYoloDataset(await zipToVirtualFiles(files[0]), files[0].name)
          : await importClassFile(files[0]);
      setManifest(next);
      setResolutions(resolveClassConflicts(mode === "new" ? [] : props.existingClasses, next.classes, mode === "new"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "데이터셋을 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (next: "new" | "append") => {
    setMode(next);
    if (manifest) setResolutions(resolveClassConflicts(next === "new" ? [] : props.existingClasses, manifest.classes, next === "new"));
  };
  const blocking = Boolean(manifest?.issues.some((issue) => issue.level === "error"));

  return (
    <div className="model-browser-backdrop fixed inset-0 z-30 grid place-items-center bg-[#090b0a]/82 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dataset-import-title">
      <div className="model-browser-panel flex max-h-[92dvh] w-full max-w-[920px] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#151916] shadow-[0_28px_80px_rgba(4,8,5,0.58),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <header className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#738078]">Local dataset intake</p>
            <h2 id="dataset-import-title" className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-[#edf1eb]">데이터셋 가져오기</h2>
            <p className="mt-1 text-[10px] text-[#778078]">파일은 브라우저 안에서만 해석되며 서버로 업로드되지 않습니다.</p>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="닫기"><X size={16} /></button>
        </header>

        <div className="scrollbar-visible min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 md:grid-cols-[230px_minmax(0,1fr)]">
            <div className="space-y-4">
              <section>
                <span className="section-label mb-2">01 · 입력 형식</span>
                <div className="space-y-1.5">
                  <SourceButton active={source === "folder"} icon={<FolderOpen size={16} />} title="YOLO 폴더" detail="data.yaml + images + labels" onClick={() => { setSource("folder"); resetResult(); }} />
                  <SourceButton active={source === "zip"} icon={<Archive size={16} />} title="YOLO ZIP" detail="압축을 풀지 않고 검사" onClick={() => { setSource("zip"); resetResult(); }} />
                  <SourceButton active={source === "classes"} icon={<FileText size={16} />} title="클래스 파일" detail="YAML, TXT, COCO JSON" onClick={() => { setSource("classes"); resetResult(); }} />
                </div>
              </section>
              <section>
                <span className="section-label mb-2">02 · 적용 대상</span>
                <label className="option-check rounded-lg border border-white/7 bg-[#101310] p-2.5">
                  <input type="radio" checked={mode === "new"} onChange={() => changeMode("new")} /> 새 작업으로 열기
                </label>
                <label className="option-check mt-1.5 rounded-lg border border-white/7 bg-[#101310] p-2.5">
                  <input type="radio" checked={mode === "append"} onChange={() => changeMode("append")} /> 현재 작업에 추가
                </label>
              </section>
            </div>

            <div className="min-w-0">
              <input
                ref={folderRef}
                type="file"
                multiple
                className="hidden"
                {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(event) => { void parseSelection(event.target.files); event.target.value = ""; }}
              />
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept={source === "zip" ? ".zip,application/zip" : ".yaml,.yml,.txt,.json,application/json,text/yaml"}
                onChange={(event) => { void parseSelection(event.target.files); event.target.value = ""; }}
              />
              {!manifest && !loading && (
                <button
                  type="button"
                  className="grid min-h-[220px] w-full place-content-center justify-items-center rounded-[16px] border border-dashed border-white/12 bg-[#101310] px-6 text-center transition hover:border-[#99c2a2]/35 hover:bg-[#121713] active:scale-[0.995]"
                  onClick={() => source === "folder" ? folderRef.current?.click() : fileRef.current?.click()}
                >
                  <span className="grid size-11 place-items-center rounded-xl border border-white/8 bg-[#1a201b] text-[#a9cdb0]">
                    {source === "folder" ? <FolderOpen size={21} /> : source === "zip" ? <Archive size={21} /> : <FileText size={21} />}
                  </span>
                  <strong className="mt-3 text-[12px] text-[#dce1da]">{source === "folder" ? "데이터셋 루트 폴더 선택" : source === "zip" ? "YOLO ZIP 선택" : "클래스 파일 선택"}</strong>
                  <span className="mt-1 text-[10px] leading-4 text-[#667067]">선택 후 클래스와 라벨을 적용 전에 검사합니다.</span>
                </button>
              )}
              {loading && <ImportSkeleton />}
              {error && (
                <div className="inline-message inline-message-error min-h-[120px] items-center justify-center text-center">
                  <WarningCircle size={18} /><span>{error}</span>
                </div>
              )}
              {manifest && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/8 bg-white/8 sm:grid-cols-4">
                    <Metric label="이미지" value={manifest.images.length} />
                    <Metric label="박스" value={summary.boxes} />
                    <Metric label="클래스" value={manifest.classes.length} />
                    <Metric label="음성 이미지" value={summary.negative} />
                  </div>
                  {manifest.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 font-mono text-[9px] text-[#89938a]">
                      {Object.entries(summary.splits).filter(([, count]) => count > 0).map(([split, count]) => <span key={split} className="rounded-md border border-white/7 bg-[#101310] px-2 py-1">{split.toUpperCase()} {count}</span>)}
                    </div>
                  )}
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="section-label">클래스 매핑</span>
                      <span className="font-mono text-[9px] text-[#69736a]">SOURCE → PROJECT</span>
                    </div>
                    <div className="scrollbar-visible max-h-[260px] overflow-y-auto rounded-xl border border-white/8">
                      {resolutions.map((resolution, index) => (
                        <div key={`${resolution.sourceId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_20px_72px_minmax(0,1fr)] items-center gap-2 border-b border-white/6 px-3 py-2.5 last:border-b-0">
                          <span className="min-w-0 truncate text-[10px] text-[#bec5bd]"><b className="mr-2 font-mono text-[#687269]">{resolution.sourceId}</b>{resolution.sourceName}</span>
                          <span className="text-center text-[#4f5951]">→</span>
                          <input
                            className="control min-h-7 py-1 font-mono"
                            type="number"
                            min="0"
                            step="1"
                            value={resolution.targetId}
                            onChange={(event) => setResolutions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, targetId: Math.max(0, Math.floor(Number(event.target.value) || 0)) } : item))}
                            aria-label={`${resolution.sourceName} 대상 클래스 ID`}
                          />
                          <input
                            className="control min-h-7 py-1"
                            value={resolution.targetName}
                            onChange={(event) => setResolutions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, targetName: event.target.value } : item))}
                            aria-label={`${resolution.sourceName} 대상 클래스 이름`}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                  {manifest.issues.length > 0 && (
                    <section>
                      <span className="section-label mb-2">검사 결과</span>
                      <div className="scrollbar-visible max-h-32 space-y-1 overflow-y-auto">
                        {manifest.issues.map((issue, index) => (
                          <div key={index} className={`flex gap-2 rounded-lg border px-2.5 py-2 text-[9px] leading-4 ${issue.level === "error" ? "border-[#d18d83]/18 bg-[#d18d83]/5 text-[#dba59d]" : "border-[#d0ad78]/15 bg-[#d0ad78]/5 text-[#cbb083]"}`}>
                            {issue.level === "error" ? <WarningCircle className="mt-0.5 shrink-0" size={13} /> : <CheckCircle className="mt-0.5 shrink-0" size={13} />}
                            <span><b className="font-normal">{issue.message}</b>{issue.path && <small className="ml-1 text-[#6f786f]">{issue.path}</small>}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/8 px-5 py-3.5">
          <p className="hidden text-[9px] text-[#626c63] sm:block">오류가 있는 데이터셋은 현재 작업에 반영되지 않습니다.</p>
          <div className="ml-auto flex gap-2">
            <button className="secondary-button" onClick={props.onClose}>취소</button>
            <button
              className="primary-button"
              disabled={!manifest || loading || blocking || resolutions.some((item) => !item.targetName.trim())}
              onClick={() => manifest && props.onApply(manifest, resolutions, mode)}
            >
              <Images size={16} /> {mode === "new" ? "새 작업으로 가져오기" : "현재 작업에 추가"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SourceButton(props: { active: boolean; icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className={`grid w-full grid-cols-[28px_1fr] items-center gap-2 rounded-[10px] border p-2.5 text-left transition active:translate-y-px ${props.active ? "border-[#99c2a2]/24 bg-[#99c2a2]/8" : "border-white/7 bg-[#101310] hover:bg-white/[0.035]"}`} onClick={props.onClick}>
      <span className={props.active ? "text-[#aed2b6]" : "text-[#707a71]"}>{props.icon}</span>
      <span><strong className="block text-[10px] font-medium text-[#cbd1ca]">{props.title}</strong><small className="mt-0.5 block text-[8px] text-[#626b63]">{props.detail}</small></span>
    </button>
  );
}

function Metric(props: { label: string; value: number }) {
  return <div className="bg-[#101310] px-3 py-3"><span className="block text-[8px] uppercase tracking-[0.1em] text-[#667067]">{props.label}</span><strong className="mt-1 block font-mono text-[15px] font-medium text-[#d8ded7]">{props.value}</strong></div>;
}

function ImportSkeleton() {
  return <div className="space-y-3 rounded-[16px] border border-white/8 bg-[#101310] p-4" aria-label="데이터셋 검사 중"><span className="skeleton-block h-4 w-40 rounded" /><div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((item) => <span key={item} className="skeleton-block h-16 rounded-lg" />)}</div><span className="skeleton-block h-28 rounded-lg" /></div>;
}
