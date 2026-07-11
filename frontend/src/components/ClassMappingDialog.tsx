import { ArrowsLeftRight, Check, WarningCircle, X } from "@phosphor-icons/react";
import type { ClassResolution } from "../lib/datasetImport";

interface ClassMappingDialogProps {
  open: boolean;
  modelName: string;
  resolutions: ClassResolution[];
  onChange: (resolutions: ClassResolution[]) => void;
  onApply: () => void;
  onClose: () => void;
}

export function ClassMappingDialog(props: ClassMappingDialogProps) {
  if (!props.open) return null;
  return (
    <div className="model-browser-backdrop fixed inset-0 z-40 grid place-items-center bg-[#090b0a]/84 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="class-map-title">
      <div className="model-browser-panel w-full max-w-[660px] overflow-hidden rounded-[20px] border border-white/10 bg-[#151916] shadow-[0_28px_80px_rgba(4,8,5,0.58),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <header className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#778179]">Model class mapping</p>
            <h2 id="class-map-title" className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-[#edf1eb]">모델 클래스 연결 확인</h2>
            <p className="mt-1 max-w-[52ch] text-[10px] leading-4 text-[#778078]">{props.modelName}의 클래스 ID가 현재 프로젝트와 충돌합니다. 추론 결과에 사용할 프로젝트 ID를 확인하세요.</p>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="닫기"><X size={16} /></button>
        </header>
        <div className="p-5">
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_24px_72px_minmax(0,1fr)] gap-2 px-3 font-mono text-[8px] uppercase tracking-[0.1em] text-[#626c63]">
            <span>모델 클래스</span><span /><span>ID</span><span>프로젝트 클래스</span>
          </div>
          <div className="scrollbar-visible max-h-[52dvh] overflow-y-auto rounded-xl border border-white/8">
            {props.resolutions.map((resolution, index) => (
              <div key={`${resolution.sourceId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_24px_72px_minmax(0,1fr)] items-center gap-2 border-b border-white/6 px-3 py-2.5 last:border-0">
                <span className="min-w-0 truncate text-[10px] text-[#c2c9c1]"><b className="mr-2 font-mono text-[#687269]">{resolution.sourceId}</b>{resolution.sourceName}</span>
                <ArrowsLeftRight size={13} className="text-[#566057]" />
                <input className="control min-h-7 py-1 font-mono" type="number" min="0" step="1" value={resolution.targetId} onChange={(event) => props.onChange(props.resolutions.map((item, itemIndex) => itemIndex === index ? { ...item, targetId: Math.max(0, Math.floor(Number(event.target.value) || 0)) } : item))} />
                <input className="control min-h-7 py-1" value={resolution.targetName} onChange={(event) => props.onChange(props.resolutions.map((item, itemIndex) => itemIndex === index ? { ...item, targetName: event.target.value } : item))} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#d0ad78]/14 bg-[#d0ad78]/5 px-3 py-2 text-[9px] leading-4 text-[#bea579]">
            <WarningCircle size={13} className="mt-0.5 shrink-0" /> 기존 프로젝트 클래스명은 자동으로 변경하지 않습니다.
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/8 px-5 py-3.5">
          <button className="secondary-button" onClick={props.onClose}>취소</button>
          <button className="primary-button" disabled={props.resolutions.some((item) => !item.targetName.trim())} onClick={props.onApply}><Check size={15} /> 매핑 적용</button>
        </footer>
      </div>
    </div>
  );
}
