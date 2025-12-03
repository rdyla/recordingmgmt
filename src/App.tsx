import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import AppHeader from "./components/AppHeader";
import RecordingsTable from "./components/RecordingsTable";
import useOwnerGroups, { type PageRecord } from "./hooks/useOwnerGroups";
import useRecordings from "./hooks/useRecordings";
import useSelection from "./hooks/useSelection";
import type {
  DeleteProgress,
  MeetingIdentity,
  Recording,
  SourceFilter,
} from "./types";
import { safeString as S } from "./utils/recordingFormatters";

const todayStr = new Date().toISOString().slice(0, 10);

const useInitialDemoMode = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1";
  } catch {
    return false;
  }
};

const App: React.FC = () => {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [pageSize, setPageSize] = useState<number>(100);
  const [source, setSource] = useState<SourceFilter>("phone");
  const [query, setQuery] = useState<string>("");
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] =
    useState<DeleteProgress | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [meetingIdentity, setMeetingIdentity] =
    useState<MeetingIdentity | null>(null);
  const [demoMode] = useState<boolean>(() => useInitialDemoMode());

  // auto-delete filter (meetings only)
  const [autoDeleteFilter, setAutoDeleteFilter] = useState<
    "all" | "auto" | "manual"
  >("all");

  // modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Recording[]>([]);

  const {
    data,
    recordings,
    loading,
    error,
    handleSearch,
    fetchRecordings,
    setData,
  } = useRecordings(from, to, pageSize, source, demoMode);

  const {
    selectedKeys,
    setSelectedKeys,
    clearSelection,
    toggleSelection,
    applySelection,
  } = useSelection();

  const normalizedQuery = query.trim().toLowerCase();

  const makeRecordKey = useCallback((rec: Recording, idx: number): string => {
    if (rec.source === "meetings") {
      return `m|${rec.meetingId ?? ""}|${rec.id ?? idx}`;
    }
    return `p|${rec.id ?? idx}`;
  }, []);

  const matchesQuery = useCallback(
    (rec: Recording): boolean => {
      if (!normalizedQuery) return true;

      const haystack =
        [
          rec.caller_name,
          rec.caller_number,
          rec.callee_name,
          rec.callee_number,
          rec.owner?.name,
          rec.topic,
          rec.host_email,
          rec.host_name,
        ]
          .map(S)
          .join(" ")
          .toLowerCase() || "";

      return haystack.includes(normalizedQuery);
    },
    [normalizedQuery]
  );

  const filteredRecordings = useMemo(
    () =>
      recordings
        .filter(matchesQuery)
        .filter((rec) => {
          if (source !== "meetings") return true;

          if (autoDeleteFilter === "all") return true;

          const val: boolean | null | undefined =
            (rec as any).autoDelete ?? (rec as any).auto_delete;

          if (autoDeleteFilter === "auto") return val === true;
          if (autoDeleteFilter === "manual") return val === false;

          return true;
        }),
    [matchesQuery, recordings, source, autoDeleteFilter]
  );

  const effectivePageSize = pageSize || 100;
  const totalFiltered = filteredRecordings.length;
  const totalPages = totalFiltered
    ? Math.ceil(totalFiltered / effectivePageSize)
    : 1;
  const safePageIndex =
    pageIndex >= totalPages ? Math.max(0, totalPages - 1) : pageIndex;

  const pageStart = safePageIndex * effectivePageSize;
  const pageEnd = pageStart + effectivePageSize;
  const pageRecords = filteredRecordings.slice(pageStart, pageEnd);

  const pageRecordsWithIndex: PageRecord[] = useMemo(
    () =>
      pageRecords.map((rec: Recording, idxOnPage: number) => ({
        rec,
        globalIndex: pageStart + idxOnPage,
      })),
    [pageRecords, pageStart]
  );

  const selectedCount = useMemo(
    () =>
      filteredRecordings.reduce((acc, rec, idx) => {
        const key = makeRecordKey(rec, idx);
        return acc + (selectedKeys.has(key) ? 1 : 0);
      }, 0),
    [filteredRecordings, makeRecordKey, selectedKeys]
  );

  const allOnPageSelected =
    pageRecords.length > 0 &&
    pageRecords.every((rec, idx) =>
      selectedKeys.has(makeRecordKey(rec, pageStart + idx))
    );

  const toggleRowSelection = (rec: Recording, globalIndex: number) => {
    const key = makeRecordKey(rec, globalIndex);
    toggleSelection(key);
  };

  const selectAllOnPage = (checked: boolean) => {
    const keys = pageRecords.map((rec, idx) =>
      makeRecordKey(rec, pageStart + idx)
    );
    applySelection(keys, checked);
  };

  const {
    ownerGroups,
    collapseAllGroups,
    expandAllGroups,
    isGroupCollapsed,
    toggleGroupCollapse,
    isGroupFullySelected,
    toggleGroupSelection,
  } = useOwnerGroups(
    pageRecordsWithIndex,
    makeRecordKey,
    selectedKeys,
    setSelectedKeys
  );

  useEffect(() => {
    const loadMeetingIdentity = async () => {
      try {
        const res = await fetch("/api/meeting/identity");
        if (!res.ok) return;

        const json = (await res.json()) as MeetingIdentity;
        setMeetingIdentity(json);
      } catch {
        // ignore
      }
    };

    loadMeetingIdentity();
  }, []);

  const onSearch = () => {
    setPageIndex(0);
    clearSelection();
    handleSearch();
  };

  const handlePrevPage = () => {
    setPageIndex((idx) => Math.max(0, idx - 1));
  };

  const handleNextPage = () => {
    setPageIndex((idx) => (idx + 1 < totalPages ? idx + 1 : idx));
  };

  // open the modal with current selection
  const openDeleteModal = () => {
    const toDelete = filteredRecordings.filter((rec, idx) =>
      selectedKeys.has(makeRecordKey(rec, idx))
    );
    if (!toDelete.length) return;
    setPendingDelete(toDelete);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setPendingDelete([]);
  };

  const handleConfirmDelete = async () => {
    const toDelete = pendingDelete;
    if (!toDelete.length) {
      setShowDeleteModal(false);
      return;
    }

    setDeleting(true);
    setDeleteProgress({ total: toDelete.length, done: 0 });
    setDeleteMessage(null);

    let success = 0;
    let failed = 0;

    try {
      for (let i = 0; i < toDelete.length; i++) {
        const rec = toDelete[i];

        try {
          if (demoMode) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            success += 1;
          } else {
            if (rec.source === "phone") {
              if (!rec.id) {
                throw new Error("Missing recording id for phone recording");
              }
              const res = await fetch("/api/phone/recordings/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recordingId: rec.id }),
              });
              if (!res.ok) {
                const txt = await res.text();
                console.error("Phone delete failed", res.status, txt);
                throw new Error(
                  `Phone delete failed: ${res.status} ${txt || ""}`.trim()
                );
              }
            } else {
              if (!rec.meetingId) {
                throw new Error("Missing meetingId for meeting recording");
              }
              const res = await fetch("/api/meeting/recordings/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  meetingId: rec.meetingId,
                  action: "trash",
                }),
              });

              if (!res.ok) {
                const txt = await res.text();
                console.error("Meeting delete failed", res.status, txt);
                throw new Error(
                  `Meeting delete failed: ${res.status} ${txt || ""}`.trim()
                );
              }
            }
            success += 1;
          }
        } catch (err) {
          console.error("Delete error", err);
          failed += 1;
        } finally {
          setDeleteProgress({ total: toDelete.length, done: i + 1 });
        }
      }

      if (demoMode) {
        setData((prev) => {
          if (!prev || !prev.recordings) return prev;
          const remaining = prev.recordings.filter(
            (r) => !toDelete.includes(r)
          );
          return {
            ...prev,
            recordings: remaining,
            total_records: remaining.length,
          };
        });
        setDeleteMessage(
          `Demo delete: removed ${success} record(s) from the table.`
        );
        clearSelection();
      } else {
        setDeleteMessage(
          `Delete complete: ${success} succeeded, ${failed} failed.`
        );
        clearSelection();
        await fetchRecordings();
      }
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setPendingDelete([]);
      setTimeout(() => setDeleteProgress(null), 2000);
    }
  };

  return (
    <div className="app-page">
      <AppHeader
        from={from}
        to={to}
        source={source}
        dataFrom={data?.from}
        dataTo={data?.to}
        demoMode={demoMode}
        meetingIdentity={meetingIdentity}
      />

      <main className="app-main">
        <div className="app-main-inner">
          <section className="app-card">
            {/* Row 1: dates + toggles */}
            <div className="filters-row">
              <div className="filter-group">
                <label className="filter-label">From</label>
                <input
                  type="date"
                  className="form-control"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label">To</label>
                <input
                  type="date"
                  className="form-control"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>

              {/* Source toggle */}
              <div className="filter-group">
                <label className="filter-label">Source</label>
                <div className="toggle-pill-group">
                  <button
                    type="button"
                    className={
                      "toggle-pill" +
                      (source === "phone" ? " toggle-pill-active" : "")
                    }
                    onClick={() => {
                      setSource("phone");
                      setPageIndex(0);
                      clearSelection();
                      setAutoDeleteFilter("all");
                    }}
                  >
                    Phone
                  </button>
                  <button
                    type="button"
                    className={
                      "toggle-pill" +
                      (source === "meetings" ? " toggle-pill-active" : "")
                    }
                    onClick={() => {
                      setSource("meetings");
                      setPageIndex(0);
                      clearSelection();
                    }}
                  >
                    Meetings
                  </button>
                </div>
              </div>

              {/* Auto-delete toggle (meetings only) */}
              <div className="filter-group">
                <label className="filter-label">Auto-delete</label>
                <div className="toggle-pill-group">
                  <button
                    type="button"
                    className={
                      "toggle-pill" +
                      (autoDeleteFilter === "all" ? " toggle-pill-active" : "")
                    }
                    onClick={() => setAutoDeleteFilter("all")}
                    disabled={source !== "meetings"}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={
                      "toggle-pill" +
                      (autoDeleteFilter === "auto" ? " toggle-pill-active" : "")
                    }
                    onClick={() => setAutoDeleteFilter("auto")}
                    disabled={source !== "meetings"}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    className={
                      "toggle-pill" +
                      (autoDeleteFilter === "manual"
                        ? " toggle-pill-active"
                        : "")
                    }
                    onClick={() => setAutoDeleteFilter("manual")}
                    disabled={source !== "meetings"}
                  >
                    Off
                  </button>
                </div>
              </div>

              {/* Page size buttons */}
              <div className="filter-group">
                <label className="filter-label">Page size</label>
                <div className="toggle-pill-group">
                  {[25, 100, 1000].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={
                        "toggle-pill" +
                        (pageSize === size ? " toggle-pill-active" : "")
                      }
                      onClick={() => {
                        setPageSize(size);
                        setPageIndex(0);
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: search + delete button */}
            <div className="filters-row" style={{ marginTop: 12 }}>
              <div className="filter-group flex-1">
                <label className="filter-label">Search</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="form-control flex-1"
                    placeholder="Name, number, topic, host email, ..."
                    value={query}
                    onChange={(e) => {
                      setPageIndex(0);
                      setQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSearch();
                    }}
                  />
                  <button
                    className="btn-primary"
                    onClick={onSearch}
                    disabled={loading}
                  >
                    Search
                  </button>
                </div>
              </div>

              <div
                className="flex gap-3 items-end"
                style={{ alignSelf: "stretch", justifyContent: "flex-end" }}
              >
                <button
                  className="btn-primary"
                  onClick={openDeleteModal}
                  disabled={selectedCount === 0 || deleting}
                >
                  Review &amp; delete…
                </button>
              </div>
            </div>

            {/* Status summary */}
            <div className="actions-row" style={{ marginTop: 10 }}>
              <div className="status-group">
                <span>
                  {totalFiltered} recording{totalFiltered !== 1 ? "s" : ""}
                  {data?.total_records != null &&
                    data.total_records !== totalFiltered && (
                      <> ({data.total_records} on server)</>
                    )}
                </span>
                <span>
                  {" "}
                  · Page {totalPages ? safePageIndex + 1 : 0} / {totalPages}
                </span>
                {error && <span className="error-text">Error: {error}</span>}
                {deleteMessage && (
                  <span className="status-text"> · {deleteMessage}</span>
                )}
              </div>
            </div>

            {/* Selection + group controls */}
            <div className="actions-row" style={{ marginTop: 8 }}>
              <div className="status-group flex items-center gap-2">
                <label className="filter-label">Selected</label>
                <input
                  className="form-control"
                  readOnly
                  value={selectedCount}
                  style={{ width: 72 }}
                />
                <button
                  className="pager-btn"
                  onClick={() => setSelectedKeys(new Set())}
                  disabled={deleting}
                >
                  Clear
                </button>
                <button
                  className="pager-btn"
                  onClick={expandAllGroups}
                  disabled={deleting}
                >
                  Expand all groups
                </button>
                <button
                  className="pager-btn"
                  onClick={collapseAllGroups}
                  disabled={deleting}
                >
                  Collapse all groups
                </button>
              </div>

              {deleteProgress && (
                <div className="delete-progress-wrapper">
                  <div className="delete-progress-bar">
                    <div
                      className="delete-progress-bar-fill"
                      style={{
                        width: `${
                          (deleteProgress.done / deleteProgress.total) * 100
                        }%`,
                      }}
                    />
                  </div>
                  <span className="delete-progress-text">
                    Deleting {deleteProgress.done}/{deleteProgress.total}…
                  </span>
                </div>
              )}
            </div>

            {/* Table */}
            {loading && !recordings.length ? (
              <div className="rec-table-empty">Loading recordings…</div>
            ) : !filteredRecordings.length ? (
              <div className="rec-table-empty">
                No recordings match this range/search.
              </div>
            ) : (
              <RecordingsTable
                ownerGroups={ownerGroups}
                isGroupCollapsed={isGroupCollapsed}
                toggleGroupCollapse={toggleGroupCollapse}
                isGroupFullySelected={isGroupFullySelected}
                toggleGroupSelection={toggleGroupSelection}
                makeRecordKey={makeRecordKey}
                toggleRowSelection={toggleRowSelection}
                selectedKeys={selectedKeys}
                selectAllOnPage={selectAllOnPage}
                allOnPageSelected={allOnPageSelected}
                demoMode={demoMode}
              />
            )}

            {/* Bottom pager */}
            <div className="pager" style={{ marginTop: 12 }}>
              <div className="pager-buttons">
                <button
                  onClick={handlePrevPage}
                  disabled={safePageIndex <= 0 || deleting}
                  className="pager-btn"
                >
                  Prev page
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={safePageIndex + 1 >= totalPages || deleting}
                  className="pager-btn"
                >
                  Next page
                </button>
              </div>
              <div>
                Page {totalPages ? safePageIndex + 1 : 0} / {totalPages}
              </div>
            </div>
          </section>
        </div>

        {/* Delete review modal */}
        {showDeleteModal && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2 className="modal-title">Review &amp; delete recordings</h2>
              <p className="modal-subtitle">
                You are about to delete{" "}
                <strong>{pendingDelete.length}</strong> recording
                {pendingDelete.length !== 1 ? "s" : ""}. This will move them to
                the Zoom trash (or remove them in demo mode).
              </p>

              <div className="modal-body">
                <div className="modal-list">
                  {pendingDelete.slice(0, 5).map((rec, idx) => (
                    <div key={idx} className="modal-list-item">
                      <div className="modal-list-primary">
                        {rec.date_time
                          ? new Date(rec.date_time).toLocaleString()
                          : "—"}{" "}
                        · {rec.topic || rec.caller_name || "Recording"}
                      </div>
                      <div className="modal-list-meta">
                        {rec.host_email || rec.owner?.name || "Unknown owner"}
                      </div>
                    </div>
                  ))}
                  {pendingDelete.length > 5 && (
                    <div className="modal-list-more">
                      …and {pendingDelete.length - 5} more
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="pager-btn"
                  onClick={closeDeleteModal}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
