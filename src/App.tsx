import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(
    null
  );
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [meetingIdentity, setMeetingIdentity] = useState<MeetingIdentity | null>(
    null
  );
  const [demoMode] = useState<boolean>(() => useInitialDemoMode());

  const {
    data,
    recordings,
    loading,
    error,
    nextToken,
    prevTokens,
    currentToken,
    handleSearch,
    handleNext,
    handlePrev,
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
    () => recordings.filter(matchesQuery),
    [matchesQuery, recordings]
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
  } = useOwnerGroups(pageRecordsWithIndex, makeRecordKey, selectedKeys, setSelectedKeys);

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

  const onApiNext = () => {
    setPageIndex(0);
    clearSelection();
    handleNext();
  };

  const onApiPrev = () => {
    setPageIndex(0);
    clearSelection();
    handlePrev();
  };

  const handleDeleteSelected = async () => {
    if (!window.confirm(`Delete ${selectedCount} recordings?`)) return;

    const toDelete = filteredRecordings.filter((rec, idx) =>
      selectedKeys.has(makeRecordKey(rec, idx))
    );

    setDeleting(true);
    setDeleteProgress({ total: toDelete.length, done: 0 });

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
            if (source === "phone") {
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
          const remaining = prev.recordings.filter((r) => !toDelete.includes(r));
          return {
            ...prev,
            recordings: remaining,
            total_records: remaining.length,
          };
        });
        setDeleteMessage(`Demo delete: removed ${success} record(s) from the table.`);
        clearSelection();
      } else {
        setDeleteMessage(`Delete complete: ${success} succeeded, ${failed} failed.`);
        await fetchRecordings(currentToken);
        clearSelection();
      }
    } finally {
      setDeleting(false);
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

              <div className="filter-group">
                <label className="filter-label">Source</label>
                <select
                  className="form-control"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as SourceFilter);
                    setPageIndex(0);
                    clearSelection();
                  }}
                >
                  <option value="phone">Phone</option>
                  <option value="meetings">Meetings</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label">Page size</label>
                <input
                  type="number"
                  className="form-control"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                />
              </div>

              <div className="filter-group flex-1">
                <label className="filter-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Name, number, topic, host email, ..."
                  value={query}
                  onChange={(e) => {
                    setPageIndex(0);
                    setQuery(e.target.value);
                  }}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label">&nbsp;</label>
                <button className="btn-primary" onClick={onSearch} disabled={loading}>
                  Search
                </button>
              </div>
            </div>

            <div className="actions-row">
              <div className="status-group">
                <span>
                  {totalFiltered} recording{totalFiltered !== 1 ? "s" : ""}
                  {data?.total_records != null && data.total_records !== totalFiltered && (
                    <> ({data.total_records} on server)</>
                  )}
                </span>
                <span>· Page {safePageIndex + 1} / {totalPages}</span>
                {error && <span className="error-text">Error: {error}</span>}
              </div>

              <div className="button-group">
                <button className="btn" onClick={() => setPageIndex((idx) => Math.max(0, idx - 1))} disabled={safePageIndex <= 0 || deleting}>
                  Prev page
                </button>
                <button
                  className="btn"
                  onClick={() => setPageIndex((idx) => (idx + 1 < totalPages ? idx + 1 : idx))}
                  disabled={safePageIndex + 1 >= totalPages || deleting}
                >
                  Next page
                </button>
                <button className="btn" onClick={onApiPrev} disabled={!prevTokens.length || loading}>
                  « API prev
                </button>
                <button className="btn" onClick={onApiNext} disabled={!nextToken || !nextToken.length || loading}>
                  API next »
                </button>
              </div>
            </div>

            <div className="actions-row">
              <div className="status-group">
                <label className="filter-label">Selected</label>
                <input className="form-control" readOnly value={selectedCount} />
                <button className="btn" onClick={() => setSelectedKeys(new Set())}>
                  Clear
                </button>
                <button className="btn" onClick={expandAllGroups} disabled={deleting}>
                  Expand all groups
                </button>
                <button className="btn" onClick={collapseAllGroups} disabled={deleting}>
                  Collapse all groups
                </button>
              </div>

              <div className="button-group">
                <button className="btn-primary" onClick={handleDeleteSelected} disabled={selectedCount === 0 || deleting}>
                  Delete selected
                </button>
                {deleteMessage && <span className="status-text">{deleteMessage}</span>}
                {deleteProgress && (
                  <div className="delete-progress">
                    <div className="delete-progress-bar" style={{ width: `${(deleteProgress.done / deleteProgress.total) * 100}%` }} />
                    <span className="delete-progress-text">
                      Deleting {deleteProgress.done}/{deleteProgress.total}…
                    </span>
                  </div>
                )}
              </div>
            </div>

            {loading && !recordings.length ? (
              <div className="rec-table-empty">Loading recordings…</div>
            ) : !filteredRecordings.length ? (
              <div className="rec-table-empty">No recordings match this range/search.</div>
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

            <div className="pager">
              <div className="pager-buttons">
                <button
                  onClick={() => setPageIndex((idx) => Math.max(0, idx - 1))}
                  disabled={safePageIndex <= 0 || deleting}
                  className="pager-btn"
                >
                  Prev page
                </button>
                <button
                  onClick={() =>
                    setPageIndex((idx) => (idx + 1 < totalPages ? idx + 1 : idx))
                  }
                  disabled={safePageIndex + 1 >= totalPages || deleting}
                  className="pager-btn"
                >
                  Next page
                </button>

                <button
                  onClick={onApiPrev}
                  disabled={!prevTokens.length || loading}
                  className="pager-btn"
                >
                  « API prev
                </button>
                <button
                  onClick={onApiNext}
                  disabled={!nextToken || !nextToken.length || loading}
                  className="pager-btn"
                >
                  API next »
                </button>
              </div>
              <div>
                API next token: {nextToken && nextToken.length ? nextToken : "—"}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
