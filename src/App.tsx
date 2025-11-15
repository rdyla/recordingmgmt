import React, { useEffect, useState } from "react";

type Owner = {
  type: string;
  id: string;
  name: string;
  extension_number?: number;
};

type Site = {
  id: string;
  name: string;
};

type MeetingIdentity = {
  userId: string;
  source: string; // e.g. "ZOOM_MEETINGS_USER_ID" or "default_me"
};

type RecordingSource = "phone" | "meetings";

type Recording = {
  id: string;
  caller_number: string;
  caller_number_type: number;
  caller_name?: string;
  callee_number: string;
  callee_number_type: number;
  callee_name?: string;
  direction: "inbound" | "outbound" | string;
  duration: number;
  download_url?: string;
  date_time: string;
  recording_type: string;
  call_log_id?: string;
  call_history_id?: string;
  call_id?: string;
  owner?: Owner;
  site?: Site;
  call_element_id?: string;
  end_time?: string;
  disclaimer_status?: number;

  // extras
  source?: RecordingSource;
  topic?: string;
  host_name?: string;
  host_email?: string;
  meetingId?: string; // numeric meeting id for delete API
};

type ApiResponse = {
  next_page_token?: string | null;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
};

type SourceFilter = "phone" | "meetings";

type MeetingRecordingFile = {
  id?: string;
  recording_start?: string;
  recording_end?: string;
  download_url?: string;
  file_type?: string;
};

type MeetingItem = {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  duration?: number;
  host_id: string;
  host_email: string;
  recording_files?: MeetingRecordingFile[];
};

type MeetingApiResponse = {
  from?: string;
  to?: string;
  page_size?: number;
  next_page_token?: string;
  meetings?: MeetingItem[];
};

type DeleteProgress = {
  total: number;
  done: number;
};

const todayStr = new Date().toISOString().slice(0, 10);

// small helper to safely string-ify values
const S = (v: unknown) => (v == null ? "" : String(v));

const App: React.FC = () => {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);

  const [pageSize, setPageSize] = useState<number>(100);
  const [source, setSource] = useState<SourceFilter>("phone");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [meetingIdentity, setMeetingIdentity] =
    useState<MeetingIdentity | null>(null);

  const [query, setQuery] = useState<string>("");
  const [pageIndex, setPageIndex] = useState<number>(0);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] =
    useState<DeleteProgress | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);


  // ---- helpers ----

  const makeRecordKey = (rec: Recording, idx: number): string => {
    if (rec.source === "meetings") {
      return `m|${rec.meetingId ?? ""}|${rec.id ?? idx}`;
    }
    return `p|${rec.id ?? idx}`;
  };

  const fetchPhonePage = async (tokenOverride: string | null) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);

    // Zoom max is 300; clamp to avoid 4xx
    const zoomPageSize = Math.min(pageSize || 100, 300);
    params.set("page_size", String(zoomPageSize));

    // phone-only endpoint supports query_date_type; keep simple: start_time
    params.set("query_date_type", "start_time");

    if (tokenOverride && tokenOverride.length > 0) {
      params.set("next_page_token", tokenOverride);
    }

    const res = await fetch(`/api/phone/recordings?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const api: ApiResponse = await res.json();
    const recs: Recording[] = (api.recordings ?? []).map((r) => ({
      ...r,
      source: "phone" as const,
    }));

    return { api, recs };
  };

  const fetchMeetingPage = async (tokenOverride: string | null) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);

    const zoomPageSize = Math.min(pageSize || 100, 300);
    params.set("page_size", String(zoomPageSize));

    if (tokenOverride && tokenOverride.length > 0) {
      params.set("next_page_token", tokenOverride);
    }

    // backend already supports aggregated per-user call
    const res = await fetch(`/api/meeting/recordings?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const api: MeetingApiResponse = await res.json();

    const recs: Recording[] = [];
    for (const m of api.meetings ?? []) {
      for (const f of m.recording_files ?? []) {
        recs.push({
          id:
            f.id ||
            `${m.id}-${f.file_type ?? "file"}-${f.recording_start ?? ""}`,
          caller_number: "",
          caller_number_type: 0,
          callee_number: "",
          callee_number_type: 0,
          date_time: f.recording_start || m.start_time,
          end_time: f.recording_end,
          duration: m.duration ?? 0,
          recording_type: f.file_type || "Recording",
          download_url: f.download_url,
          caller_name: m.topic,
          callee_name: m.host_email,
          owner: {
            type: "user",
            id: m.host_id,
            name: m.host_email,
          },
          site: { id: "", name: "Meeting" },
          direction: "meeting",
          disclaimer_status: undefined,
          source: "meetings",
          topic: m.topic,
          host_name: m.host_email,
          host_email: m.host_email,
          meetingId: m.uuid,
        });
      }
    }

    return { api, recs };
  };

  const fetchRecordings = async (tokenOverride: string | null = null) => {
    setLoading(true);
    setError(null);
    setDeleteMessage(null);

    try {
      if (source === "phone") {
        const { api, recs } = await fetchPhonePage(tokenOverride);

        setData({
          from: api.from ?? from,
          to: api.to ?? to,
          total_records: api.total_records ?? recs.length,
          next_page_token: api.next_page_token ?? null,
          recordings: recs,
        });

        setNextToken(api.next_page_token ?? null);
      } else {
        const { api, recs } = await fetchMeetingPage(tokenOverride);

        setData({
          from: api.from ?? from,
          to: api.to ?? to,
          total_records: recs.length,
          next_page_token: api.next_page_token ?? null,
          recordings: recs,
        });

        setNextToken(api.next_page_token ?? null);
      }

      // reset paging + selection when we load a new server page
      setPageIndex(0);
      setSelectedKeys(new Set());
      console.debug("fetchRecordings done");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPrevTokens([]);
    setCurrentToken(null);
    setPageIndex(0);
    setSelectedKeys(new Set());
    fetchRecordings(null);
  };

  const handleNext = () => {
    if (!nextToken) return;
    setPrevTokens((prev) => [...prev, currentToken || ""]);
    setCurrentToken(nextToken);
    fetchRecordings(nextToken);
  };

  const handlePrev = () => {
    if (!prevTokens.length) return;
    const newPrev = [...prevTokens];
    const last = newPrev.pop() || null;
    setPrevTokens(newPrev);
    setCurrentToken(last);
    fetchRecordings(last);
  };

    useEffect(() => {
      const checkAuth = async () => {
        try {
          const res = await fetch("/api/auth/me");
          if (res.ok) {
            const json = await res.json();
            setAuthed(true);
            setAuthEmail(json.email || null);
            // only fetch recordings once we know we're authenticated
            fetchRecordings(null);
          } else {
            setAuthed(false);
          }
        } catch {
          setAuthed(false);
        }
      };

      checkAuth();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


  useEffect(() => {
    const loadMeetingIdentity = async () => {
      try {
        const res = await fetch("/api/meeting/identity");
        if (!res.ok) return; // fail silently if not configured

        const json = (await res.json()) as MeetingIdentity;
        setMeetingIdentity(json);
      } catch {
        // ignore – identity is just a nice-to-have
      }
    };

    loadMeetingIdentity();
  }, []);

  const recordings: Recording[] = data?.recordings ?? [];

  // ------ free text filtering & client-side paging ------

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = (rec: Recording): boolean => {
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
  };

  const filteredRecordings = recordings.filter(matchesQuery);

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

  const selectedCount = filteredRecordings.reduce((acc, rec, idx) => {
    const key = makeRecordKey(rec, idx);
    return acc + (selectedKeys.has(key) ? 1 : 0);
  }, 0);

  const allOnPageSelected =
    pageRecords.length > 0 &&
    pageRecords.every((rec, idx) =>
      selectedKeys.has(makeRecordKey(rec, pageStart + idx))
    );

  const toggleRowSelection = (rec: Recording, globalIndex: number) => {
    const key = makeRecordKey(rec, globalIndex);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllOnPage = (checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      pageRecords.forEach((rec, idx) => {
        const key = makeRecordKey(rec, pageStart + idx);
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  };

  const selectAllFiltered = () => {
    const next = new Set<string>();
    filteredRecordings.forEach((rec, idx) => {
      next.add(makeRecordKey(rec, idx));
    });
    setSelectedKeys(next);
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  if (authed === false) {
  return (
    <div className="app-page auth-page">
      <div className="auth-card">
        <h1 className="app-title">Zoom Recording Explorer</h1>
        <p className="app-subtitle">
          Sign in with your Zoom account to continue.
        </p>
        <a href="/zoom/login" className="btn-primary" style={{ marginTop: "1.5rem" }}>
          Sign in with Zoom
        </a>
        <p className="auth-help">
          You’ll be redirected to Zoom, then back here once authenticated.
        </p>
      </div>
    </div>
  );
}

  const handleBulkDelete = async () => {
    if (!filteredRecordings.length || !selectedCount) return;

    const confirmed = window.confirm(
      `Delete ${selectedCount} ${source === "phone" ? "phone" : "meeting"
      } recording(s)? This will move them to trash or permanently delete them based on your Zoom settings.`
    );
    if (!confirmed) return;

    // Build flat list of selected records (from filtered set, not only current page)
    const toDelete: Recording[] = [];
    filteredRecordings.forEach((rec, idx) => {
      const key = makeRecordKey(rec, idx);
      if (selectedKeys.has(key)) {
        toDelete.push(rec);
      }
    });

    if (!toDelete.length) return;

    setDeleting(true);
    setDeleteProgress({ total: toDelete.length, done: 0 });
    setDeleteMessage(null);

    let success = 0;
    let failed = 0;

    try {
      for (let i = 0; i < toDelete.length; i++) {
        const rec = toDelete[i];

        try {
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
            // meetings
            if (!rec.id || !rec.meetingId) {
              throw new Error(
                "Missing meetingId or recordingId for meeting recording"
              );
            }
            const res = await fetch("/api/meeting/recordings/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                meetingId: rec.meetingId,
                recordingId: rec.id,
                action: "trash", // or "delete" to permanently delete
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
        } catch (err) {
          console.error("Delete error", err);
          failed += 1;
        } finally {
          setDeleteProgress({ total: toDelete.length, done: i + 1 });
        }
      }

      setDeleteMessage(
        `Delete complete: ${success} succeeded, ${failed} failed.`
      );

      // After delete, refresh data from server
      await fetchRecordings(currentToken);
      setSelectedKeys(new Set());
    } finally {
      setDeleting(false);
      setTimeout(() => setDeleteProgress(null), 2000);
    }
  };

  const paginationDisabled = false; // server-side pagination still available

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="app-title">Zoom Recording Explorer</h1>
          <p className="app-subtitle">
            Source: {source === "phone" ? "Phone" : "Meetings"} · {data?.from} →{" "}
            {data?.to}
            {meetingIdentity && source === "meetings" && (
              <>
                {" "}
                · Meetings user: {meetingIdentity.userId}
                {meetingIdentity.source === "default_me" && " (me)"}
              </>
            )}
          </p>
        </div>
      </header>

      <main className="app-main">
        <div className="app-main-inner">
          {/* Filters card */}
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
                <div className="toggle-group">
                  <button
                    type="button"
                    className={
                      source === "phone"
                        ? "btn-toggle active"
                        : "btn-toggle"
                    }
                    onClick={() => {
                      setSource("phone");
                      setPrevTokens([]);
                      setCurrentToken(null);
                      setSelectedKeys(new Set());
                    }}
                  >
                    Phone
                  </button>
                  <button
                    type="button"
                    className={
                      source === "meetings"
                        ? "btn-toggle active"
                        : "btn-toggle"
                    }
                    onClick={() => {
                      setSource("meetings");
                      setPrevTokens([]);
                      setCurrentToken(null);
                      setSelectedKeys(new Set());
                    }}
                  >
                    Meetings
                  </button>
                </div>
              </div>

              <div className="filter-group wide">
                <label className="filter-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder={
                    source === "phone"
                      ? "Search name, number, owner…"
                      : "Search topic, host, email…"
                  }
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPageIndex(0);
                  }}
                />
              </div>

              <div className="filter-group small">
                <label className="filter-label">Page size</label>
                <select
                  className="form-control"
                  value={pageSize}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 100;
                    setPageSize(val);
                    setPageIndex(0);
                  }}
                >
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </div>
            </div>

            <div className="filter-actions">
              <button
                onClick={handleSearch}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? "Loading…" : "Search"}
              </button>

              <div className="stats">
                <span>
                  Filtered records: {totalFiltered} (showing{" "}
                  {pageRecords.length} on page {safePageIndex + 1} of{" "}
                  {totalPages})
                </span>
                {currentToken && !paginationDisabled && (
                  <span style={{ marginLeft: 12 }}>
                    API page token: {currentToken}
                  </span>
                )}
              </div>
            </div>

            {error && <div className="error-banner">Error: {error}</div>}
            {deleteMessage && (
              <div className="info-banner">{deleteMessage}</div>
            )}
          </section>

          {/* Table card */}
          <section className="app-card">
            <div className="bulk-toolbar">
              <span>
                Selected {selectedCount} of {totalFiltered} filtered
              </span>
              <div className="bulk-actions">
                {filteredRecordings.length > 0 &&
                  selectedCount < filteredRecordings.length && (
                    <button
                      className="pager-btn"
                      onClick={selectAllFiltered}
                      disabled={deleting}
                    >
                      Select all filtered
                    </button>
                  )}
                {selectedCount > 0 && (
                  <>
                    <button
                      className="pager-btn"
                      onClick={clearSelection}
                      disabled={deleting}
                    >
                      Clear selection
                    </button>
                    <button
                      className="btn-danger"
                      onClick={handleBulkDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting…" : "Delete selected"}
                    </button>
                  </>
                )}
                {deleting && deleteProgress && (
                  <div className="delete-progress-wrapper">
                    <div className="delete-progress-bar">
                      <div
                        className="delete-progress-bar-fill"
                        style={{
                          width: `${
                            (deleteProgress.done / Math.max(deleteProgress.total, 1)) * 100
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
            </div>

            {loading && !recordings.length ? (
              <div className="rec-table-empty">Loading recordings…</div>
            ) : !filteredRecordings.length ? (
              <div className="rec-table-empty">
                No recordings match this range/search.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={(e) =>
                            selectAllOnPage(e.target.checked)
                          }
                        />
                      </th>
                      <th>Date / Time</th>
                      <th>Source</th>
                      <th>Primary</th>
                      <th>Secondary</th>
                      <th>Owner / Host</th>
                      <th>Site</th>
                      <th>Duration (s)</th>
                      <th>Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRecords.map((rec, idxOnPage) => {
                      const globalIdx = pageStart + idxOnPage;
                      const key = makeRecordKey(rec, globalIdx);
                      const isMeeting = rec.source === "meetings";

                      const dt = rec.date_time
                        ? new Date(rec.date_time)
                        : rec.end_time
                        ? new Date(rec.end_time)
                        : null;

                      const dateDisplay = dt
                        ? dt.toLocaleString(undefined, {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—";

                      const primary = isMeeting
                        ? rec.topic || rec.caller_name || "Meeting"
                        : rec.caller_name && rec.caller_number
                        ? `${rec.caller_name} (${rec.caller_number})`
                        : rec.caller_name || rec.caller_number || "—";

                      const secondary = isMeeting
                        ? rec.host_email || rec.callee_name || "—"
                        : rec.callee_name && rec.callee_number
                        ? `${rec.callee_name} (${rec.callee_number})`
                        : rec.callee_name || rec.callee_number || "—";

                      const ownerDisplay = isMeeting
                        ? rec.host_email || rec.owner?.name || "—"
                        : rec.owner?.name && rec.owner?.extension_number
                        ? `${rec.owner.name} (${rec.owner.extension_number})`
                        : rec.owner?.name || "—";

                      const siteName = isMeeting
                        ? "—"
                        : rec.site?.name || "—";

                      const sourceLabel = isMeeting ? "Meeting" : "Phone";

                      return (
                        <tr key={key} className="rec-row">
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              onChange={() =>
                                toggleRowSelection(rec, globalIdx)
                              }
                            />
                          </td>
                          <td>{dateDisplay}</td>
                          <td>{sourceLabel}</td>
                          <td>{primary}</td>
                          <td>{secondary}</td>
                          <td>{ownerDisplay}</td>
                          <td>{siteName}</td>
                          <td>{rec.duration ?? "—"}</td>
                          <td>{rec.recording_type || "—"}</td>
                          <td>
                            {rec.download_url && (
                              <a
                                href={`/api/phone/recordings/download?url=${encodeURIComponent(
                                  rec.download_url
                                )}`}
                                className="text-sky-400 hover:underline mr-2"
                              >
                                Download
                              </a>
                            )}

                            {rec.call_history_id && !isMeeting && (
                              <button
                                className="pager-btn"
                                onClick={() => {
                                  alert(
                                    "Details view coming soon for this recording."
                                  );
                                }}
                              >
                                Details
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pager">
              <div className="pager-buttons">
                <button
                  onClick={() =>
                    setPageIndex((idx) => Math.max(0, idx - 1))
                  }
                  disabled={safePageIndex <= 0 || deleting}
                  className="pager-btn"
                >
                  Prev page
                </button>
                <button
                  onClick={() =>
                    setPageIndex((idx) =>
                      idx + 1 < totalPages ? idx + 1 : idx
                    )
                  }
                  disabled={safePageIndex + 1 >= totalPages || deleting}
                  className="pager-btn"
                >
                  Next page
                </button>

                <button
                  onClick={handlePrev}
                  disabled={!prevTokens.length || loading}
                  className="pager-btn"
                >
                  « API prev
                </button>
                <button
                  onClick={handleNext}
                  disabled={!nextToken || !nextToken.length || loading}
                  className="pager-btn"
                >
                  API next »
                </button>
              </div>
              <div>
                API next token:{" "}
                {nextToken && nextToken.length ? nextToken : "—"}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
