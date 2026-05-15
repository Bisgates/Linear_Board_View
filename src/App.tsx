import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CanvasBoard, { type CanvasBoardHandle } from "./components/CanvasBoard";
import { TopBar, type ActiveView } from "./components/TopBar";
import { WorkingOnDropdown } from "./components/WorkingOnDropdown";
import { FilterBar } from "./components/FilterBar";
import { DetailPanel } from "./components/DetailPanel";
import { IssuePickerPopover } from "./components/IssuePickerPopover";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ToastStack, type ToastItem } from "./components/Toast";
import { loadIssues, type SnapshotFile } from "./lib/loadIssues";
import { maybeSynthesize } from "./lib/synthetic";
import { applyFilter, deriveOptions, EMPTY_FILTER, type FilterState } from "./lib/filter";
import { useAllIssuesBoardState, useBoardState } from "./lib/useBoardState";
import { useWorkingOnViews } from "./lib/useWorkingOnViews";
import { findNextSlotNear } from "./lib/workingOn";
import { computeInitialLayout } from "./lib/layout";
import type { IssueRecord } from "./linear/types";
import type { IssuePatch } from "./linear/updateIssue";
import type { ClipboardPayload } from "./lib/clipboard";

let toastSeq = 0;

export default function App() {
  const [snapshot, setSnapshot] = useState<SnapshotFile | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("working_on");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dropdownAnchor, setDropdownAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const workingOnBoardRef = useRef<CanvasBoardHandle | null>(null);
  const allIssuesBoardRef = useRef<CanvasBoardHandle | null>(null);

  const pushToast = useCallback((kind: ToastItem["kind"], msg: string) => {
    const id = `t${++toastSeq}`;
    setToasts((prev) => [...prev.slice(-2), { id, kind, msg }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const wov = useWorkingOnViews((e) => pushToast("error", `Views save failed: ${String(e)}`));
  const workingOn = useBoardState(wov.boardEndpoint, (e) =>
    pushToast("error", `Working-on save failed: ${String(e)}`),
  );
  const allIssuesBoard = useAllIssuesBoardState((e) =>
    pushToast("error", `All-issues board save failed: ${String(e)}`),
  );

  useEffect(() => {
    (async () => {
      try {
        const snap = await loadIssues();
        setSnapshot(snap);
        setLastSyncAt(snap.fetchedAt);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/refetch");
      const json = (await res.json()) as { ok: boolean; count?: number; elapsedMs?: number; error?: string };
      if (!json.ok) throw new Error(json.error ?? "refresh failed");
      console.log(`[refresh] ${json.count} issues in ${json.elapsedMs}ms`);
      const snap = await loadIssues();
      setSnapshot(snap);
      setLastSyncAt(snap.fetchedAt);
      pushToast("success", `Refreshed · ${json.count} issues`);
    } catch (e) {
      setError(String(e));
      pushToast("error", `Refresh failed: ${String(e)}`);
      console.error("[refresh] failed", e);
    } finally {
      setSyncing(false);
    }
  }, [pushToast]);

  const mutate = useCallback(
    async (id: string, patch: IssuePatch): Promise<void> => {
      if (!snapshot) return;
      const prevIssue = snapshot.issues.find((i) => i.id === id);
      if (!prevIssue) return;

      const lookups = (() => {
        const states = new Map<string, IssueRecord["state"]>();
        const projects = new Map<string, IssueRecord["project"]>();
        const cycles = new Map<string, IssueRecord["cycle"]>();
        const assignees = new Map<string, IssueRecord["assignee"]>();
        const labels = new Map<string, IssueRecord["labels"][number]>();
        for (const i of snapshot.issues) {
          if (i.state.id) states.set(i.state.id, i.state);
          if (i.project) projects.set(i.project.id, i.project);
          if (i.cycle) cycles.set(i.cycle.id, i.cycle);
          if (i.assignee) assignees.set(i.assignee.id, i.assignee);
          for (const l of i.labels) labels.set(l.id, l);
        }
        for (const w of snapshot.meta?.workflowStates ?? []) {
          if (!states.has(w.id)) {
            states.set(w.id, { id: w.id, name: w.name, type: w.type });
          }
        }
        return { states, projects, cycles, assignees, labels };
      })();

      const optimistic: IssueRecord = { ...prevIssue };
      if (patch.title !== undefined) optimistic.title = patch.title;
      if (patch.description !== undefined) optimistic.description = patch.description;
      if (patch.priority !== undefined) optimistic.priority = patch.priority;
      if (patch.stateId !== undefined) {
        const s = lookups.states.get(patch.stateId);
        if (s) optimistic.state = s;
      }
      if (patch.assigneeId !== undefined) {
        optimistic.assignee = patch.assigneeId === null ? null : lookups.assignees.get(patch.assigneeId) ?? null;
      }
      if (patch.projectId !== undefined) {
        optimistic.project = patch.projectId === null ? null : lookups.projects.get(patch.projectId) ?? null;
      }
      if (patch.cycleId !== undefined) {
        optimistic.cycle = patch.cycleId === null ? null : lookups.cycles.get(patch.cycleId) ?? null;
      }
      if (patch.labelIds !== undefined) {
        optimistic.labels = patch.labelIds
          .map((lid) => lookups.labels.get(lid))
          .filter((l): l is NonNullable<typeof l> => Boolean(l));
      }

      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          issues: prev.issues.map((i) => (i.id === id ? optimistic : i)),
        };
      });

      try {
        const res = await fetch(`/api/issue/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json()) as { ok: boolean; issue?: IssueRecord; error?: string };
        if (!json.ok || !json.issue) throw new Error(json.error ?? "mutation failed");
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            issues: prev.issues.map((i) => (i.id === id ? json.issue! : i)),
          };
        });
        const field = Object.keys(patch)[0] ?? "issue";
        console.log(`[mutation] field=${field} ok`);
      } catch (e) {
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            issues: prev.issues.map((i) => (i.id === id ? prevIssue : i)),
          };
        });
        pushToast("error", `Update failed: ${String(e)}`);
        console.error("[mutation] failed", e);
      }
    },
    [snapshot, pushToast],
  );

  const allIssues = useMemo(
    () => (snapshot ? maybeSynthesize(snapshot.issues) : []),
    [snapshot],
  );
  const issuesById = useMemo(() => {
    const m = new Map<string, IssueRecord>();
    for (const i of allIssues) m.set(i.id, i);
    return m;
  }, [allIssues]);
  const options = useMemo(() => deriveOptions(allIssues), [allIssues]);
  const filtered = useMemo(() => applyFilter(allIssues, filter), [allIssues, filter]);
  const selectedIssue = useMemo(
    () => (selectedId ? allIssues.find((i) => i.id === selectedId) ?? null : null),
    [selectedId, allIssues],
  );

  const workingOnIds = useMemo(() => new Set(Object.keys(workingOn.data.issueMembers)), [workingOn.data.issueMembers]);

  // Working On displays only explicit members of the snapshot; keep insertion
  // order of issueMembers so newly-added issues land next to where the picker
  // placed them.
  const workingOnDisplayed = useMemo(() => {
    const out: IssueRecord[] = [];
    for (const id of Object.keys(workingOn.data.issueMembers)) {
      const iss = issuesById.get(id);
      if (iss) out.push(iss);
    }
    return out;
  }, [workingOn.data.issueMembers, issuesById]);

  // Auto-layout computes per-team / per-project grid coordinates and is used
  // as the fallback whenever an issue has no stored position yet. Computed
  // from the full snapshot (not filtered) so positions stay stable as the
  // user toggles filters.
  const allIssuesInitialPositions = useMemo(() => computeInitialLayout(allIssues), [allIssues]);

  const addToWorkingOn = useCallback(
    (issueId: string) => {
      // Anchor the placement search at the current viewport centre so the new
      // card lands inside what the user is looking at. Fall back to (0,0) if
      // the board hasn't mounted yet.
      const center = workingOnBoardRef.current?.getViewportCenter() ?? { x: 0, y: 0 };
      workingOn.setData((prev) => {
        if (prev.issueMembers[issueId]) return prev;
        const taken: { x: number; y: number }[] = [];
        for (const p of Object.values(prev.issueMembers)) taken.push(p);
        for (const n of prev.noteNodes) taken.push({ x: n.x, y: n.y });
        const slot = findNextSlotNear(center, taken);
        return { ...prev, issueMembers: { ...prev.issueMembers, [issueId]: slot } };
      });
    },
    [workingOn],
  );

  const displayCount = activeView === "all" ? filtered.length : workingOnIds.size;
  const displayTotal = activeView === "all" ? allIssues.length : undefined;

  const activeViewName = useMemo(() => {
    if (!wov.manifest || !wov.activeId) return undefined;
    return wov.manifest.views.find((v) => v.id === wov.activeId)?.name;
  }, [wov.manifest, wov.activeId]);

  const handleCreate = useCallback(async () => {
    const newId = await wov.createView();
    if (newId) {
      setActiveView("working_on");
      pushToast("success", `已创建 view`);
    }
  }, [wov, pushToast]);

  const handlePick = useCallback(
    (id: string) => {
      wov.setActiveId(id);
      setActiveView("working_on");
    },
    [wov],
  );

  const handleRenameActive = useCallback(
    (name: string) => {
      if (!wov.activeId) return;
      void wov.renameView(wov.activeId, name);
    },
    [wov],
  );

  // Dropdown lists views newest-first (by createdAt). Manifest order on disk
  // stays insertion order — we sort only for display.
  const sortedViews = useMemo(() => {
    if (!wov.manifest) return [];
    return [...wov.manifest.views].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [wov.manifest]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopBar
        lastSyncAt={lastSyncAt}
        syncing={syncing}
        onRefresh={refresh}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        issueCount={displayCount}
        totalCount={displayTotal}
        activeView={activeView}
        onViewChange={setActiveView}
        workingOnLabel={activeViewName}
        onWorkingOnExpand={(a) => setDropdownAnchor(a)}
        onRenameActiveWorkingOn={handleRenameActive}
        leftSlot={
          activeView === "working_on" ? (
            <IssuePickerPopover issues={allIssues} workingOnIds={workingOnIds} onAdd={addToWorkingOn} />
          ) : null
        }
      />
      {dropdownAnchor && wov.manifest && (
        <WorkingOnDropdown
          views={sortedViews}
          activeId={wov.activeId}
          onPick={handlePick}
          onCreate={handleCreate}
          onRename={wov.renameView}
          onDelete={wov.deleteView}
          onClose={() => setDropdownAnchor(null)}
          anchor={dropdownAnchor}
        />
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {activeView === "all" && (
        <FilterBar filter={filter} options={options} onChange={setFilter} />
      )}
      <div style={{ flex: 1, position: "relative", minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {error && (
            <div style={{ padding: 20, color: "var(--warm-red)" }}>{error}</div>
          )}
          {activeView === "all" ? (
            <CanvasBoard
              ref={allIssuesBoardRef}
              viewKey="all"
              displayedIssues={filtered}
              data={allIssuesBoard.data}
              loaded={allIssuesBoard.loaded}
              setData={allIssuesBoard.setData}
              undo={allIssuesBoard.undo}
              redo={allIssuesBoard.redo}
              initialPositions={allIssuesInitialPositions}
              loadingLabel="loading all_issues_board…"
              onSelectIssue={setSelectedId}
              selectedIssueId={selectedId}
              clipboard={clipboard}
              setClipboard={setClipboard}
              onClipboardToast={pushToast}
            />
          ) : (
            <CanvasBoard
              ref={workingOnBoardRef}
              viewKey={wov.activeId ? `wo-${wov.activeId}` : "wo-loading"}
              displayedIssues={workingOnDisplayed}
              data={workingOn.data}
              loaded={workingOn.loaded}
              setData={workingOn.setData}
              undo={workingOn.undo}
              redo={workingOn.redo}
              loadingLabel={`loading ${activeViewName ?? "working_on"}…`}
              onSelectIssue={setSelectedId}
              selectedIssueId={selectedId}
              clipboard={clipboard}
              setClipboard={setClipboard}
              onClipboardToast={pushToast}
            />
          )}
        </div>
        {selectedIssue && (
          <DetailPanel
            issue={selectedIssue}
            allIssues={allIssues}
            workflowStates={snapshot?.meta?.workflowStates ?? []}
            onClose={() => setSelectedId(null)}
            onMutate={mutate}
          />
        )}
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
