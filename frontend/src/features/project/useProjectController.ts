import { useCallback, useEffect, useRef, useState } from "react";
import { downloadProjectBackup, readProjectBackup } from "../../lib/projectBackup";
import type { HydratedProject, ProjectState } from "../../lib/projectDocument";
import {
  clearLocalProject,
  loadLocalProject,
  requestPersistentProjectStorage,
  saveLocalProject,
} from "../../lib/projectStore";
import type { ProjectSaveStatus } from "../../types";

interface ProjectControllerOptions {
  snapshot: ProjectState;
  imageCount: number;
  applyProject: (project: HydratedProject) => void;
}

export function useProjectController({ snapshot, imageCount, applyProject }: ProjectControllerOptions) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProjectSaveStatus>("restoring");
  const [message, setMessage] = useState("이전 로컬 작업을 확인하는 중");
  const autosaveRevisionRef = useRef(0);
  const storageRequestedRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

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
          setMessage(`이전 작업 복구됨 · 이미지 ${project.images.length}장`);
        } else {
          setMessage("로컬 자동 저장 준비됨");
        }
        setStatus("saved");
      })
      .catch((error) => {
        if (!active) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "이전 작업을 복구하지 못했습니다.");
      })
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [applyProject]);

  useEffect(() => {
    if (!ready) return;
    const revision = ++autosaveRevisionRef.current;
    setStatus("saving");
    setMessage("변경사항을 로컬에 저장하는 중");
    const timer = window.setTimeout(() => {
      saveLocalProject(snapshot)
        .then(() => {
          if (revision !== autosaveRevisionRef.current) return;
          setStatus("saved");
          setMessage(`자동 저장됨 · ${formatClock(new Date())}`);
        })
        .catch((error) => {
          if (revision !== autosaveRevisionRef.current) return;
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "로컬 자동 저장에 실패했습니다.");
        });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [ready, snapshot]);

  const requestPersistentStorage = useCallback(() => {
    if (storageRequestedRef.current) return;
    storageRequestedRef.current = true;
    void requestPersistentProjectStorage();
  }, []);

  const clearProject = useCallback(async () => {
    autosaveRevisionRef.current += 1;
    setStatus("saving");
    setMessage("새 프로젝트를 준비하는 중");
    try {
      await clearLocalProject();
      setStatus("saved");
      setMessage("새 프로젝트 · 자동 저장 준비됨");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "기존 자동 저장을 지우지 못했습니다.");
    }
  }, []);

  const openProject = useCallback(async (file: File) => {
    if (busy) return;
    if (imageCount && !window.confirm("현재 작업을 닫고 선택한 프로젝트를 열까요?")) return;
    setBusy(true);
    setStatus("restoring");
    setMessage(`${file.name} 읽는 중`);
    try {
      const project = await readProjectBackup(file);
      applyProject(project);
      await saveLocalProject(project);
      autosaveRevisionRef.current += 1;
      setStatus("saved");
      setMessage(`프로젝트 열림 · 이미지 ${project.images.length}장`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "프로젝트를 열지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [applyProject, busy, imageCount]);

  const saveProject = useCallback(async () => {
    if (busy || !imageCount) return;
    setBusy(true);
    setStatus("saving");
    setMessage("휴대용 프로젝트 백업을 만드는 중");
    try {
      const current = snapshotRef.current;
      await saveLocalProject(current);
      const filename = await downloadProjectBackup(current);
      setStatus("saved");
      setMessage(`${filename} 저장됨`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "프로젝트 백업을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [busy, imageCount]);

  const markChanged = useCallback((nextMessage: string) => {
    setStatus("saving");
    setMessage(nextMessage);
  }, []);

  return {
    ready,
    busy,
    status,
    message,
    requestPersistentStorage,
    clearProject,
    openProject,
    saveProject,
    markChanged,
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
