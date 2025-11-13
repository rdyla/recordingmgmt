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

  // extra for meetings
  source?: RecordingSource;
  topic?: string;
  host_name?: string;
  host_email?: string;
};

type ApiResponse = {
  next_page_token?: string | null;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
};

type SourceFilter = "phone" | "meetings" | "both";

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

const todayStr = new Date().toISOString().slice(0, 10);

const App: React.FC = () => {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [recordingType, setRecordingType] = useState<
    "Automatic" | "OnDemand" | "All"
  >("OnDemand");
  const [queryDateType, setQueryDateType] = useState<
    "start_time" | "created_time"
  >("start_time");
  const [pageSize, setPageSize] = useState(30);
  const [source, setSource] = useState<SourceFilter>("phone");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [meetingIdentity, setMeetingIdentity] = useState<MeetingIdentity | null>(null);

  // ---- helpers to call backend ----

  const fetchPhonePage = async (tokenOverride: string | null) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("page_size", String(pageSize));

    if (recordingType !== "All") {
      params.set("recording_type", recordingType);
    }

    params.set("query_date_type", queryDateType);

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
    params.set("page_size", String(pageSize));

    if (tokenOverride && tokenOverride.length > 0) {
      params.set("next_page_token", tokenOverride);
    }

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
        });
      }
    }

    return { api, recs };
  };

  const fetchRecordings = async (tokenOverride: string | null = null) => {
    setLoading(true);
    setError(null);

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
      } else if (source === "meetings") {
        const { api, recs } = await fetchMeetingPage(tokenOverride);

        setData({
          from: api.from ?? from,
          to: api.to ?? to,
          total_records: recs.length,
          next_page_token: api.next_page_token ?? null,
          recordings: recs,
        });

        setNextToken(api.next_page_token ?? null);
      } else {
        // BOTH: first page of each, combined, sorted by time desc
        const [phone, meetings] = await Promise.all([
          fetchPhonePage(null),
          fetchMeetingPage(null),
        ]);

        const combined = [...phone.recs, ...meetings.recs].sort((a, b) => {
          const ta = a.date_time ? new Date(a.date_time).getTime() : 0;
          const tb = b.date_time ? new Date(b.date_time).getTime() : 0;
          return tb - ta;
        });

        setData({
          from,
          to,
          total_records: combined.length,
          next_page_token: null,
          recordings: combined,
        });

        // disable pagination in combined mode
        setNextToken(null);
        setPrevTokens([]);
        setCurrentToken(null);
      }

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
    fetchRecordings(null);
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
  const paginationDisabled = source === "both";

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="app-title">Zoom Recording Explorer</h1>
            <p className="app-subtitle">
              Source:{" "}
              {source === "phone"
                ? "Phone"
                : source === "meetings"
                ? "Meetings"
                : "Phone + Meetings"}{" "}
              · {data?.from} → {data?.to}
              {meetingIdentity && (source === "meetings" || source === "both") && (
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
                <select
                  className="form-control"
                  value={source}
                  onChange={(e) => {
                    const val = e.target.value as SourceFilter;
                    setSource(val);
                    setPrevTokens([]);
                    setCurrentToken(null);
                    setNextToken(null);
                  }}
                >
                  <option value="phone">Phone only</option>
                  <option value="meetings">Meetings only</option>
                  <option value="both">Phone + Meetings</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label">Recording type</label>
                <select
                  className="form-control"
                  value={recordingType}
                  onChange={(e) =>
                    setRecordingType(e.target.value as typeof recordingType)
                  }
                  disabled={source === "meetings" || source === "both"}
                  title={
                    source === "meetings" || source === "both"
                      ? "Recording type filter applies to phone recordings only"
                      : undefined
                  }
                >
                  <option value="All">All</option>
                  <option value="Automatic">Automatic</option>
                  <option value="OnDemand">OnDemand</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label">Query date type</label>
                <select
                  className="form-control"
                  value={queryDateType}
                  onChange={(e) =>
                    setQueryDateType(e.target.value as typeof queryDateType)
                  }
                  disabled={source !== "phone"}
                  title={
                    source !== "phone"
                      ? "Date type filter applies to phone recordings only"
                      : undefined
                  }
                >
                  <option value="start_time">Start time</option>
                  <option value="created_time">Created time</option>
                </select>
              </div>

              <div className="filter-group small">
                <label className="filter-label">Page size</label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  className="form-control"
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(Number(e.target.value) || 30)
                  }
                />
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
                  Records:{" "}
                  {typeof data?.total_records === "number"
                    ? data.total_records
                    : recordings.length}
                </span>
                {currentToken && !paginationDisabled && (
                  <span>Page token: {currentToken}</span>
                )}
                {paginationDisabled && (
                  <span>(Pagination disabled in combined view)</span>
                )}
              </div>
            </div>

            {error && <div className="error-banner">Error: {error}</div>}
          </section>

          {/* Table card */}
          <section className="app-card">
            {loading && !recordings.length ? (
              <div className="rec-table-empty">Loading recordings…</div>
            ) : !recordings.length ? (
              <div className="rec-table-empty">
                No recordings found for this range.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="rec-table">
                  <thead>
                    <tr>
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
                    {recordings.map((rec, idx) => {
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
                        <tr
                          key={rec.id || rec.call_id || idx}
                          className="rec-row"
                        >
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
                  onClick={handlePrev}
                  disabled={
                    paginationDisabled || !prevTokens.length || loading
                  }
                  className="pager-btn"
                >
                  Previous
                </button>
                <button
                  onClick={handleNext}
                  disabled={
                    paginationDisabled ||
                    !nextToken ||
                    !nextToken.length ||
                    loading
                  }
                  className="pager-btn"
                >
                  Next
                </button>
              </div>
              <div>
                Next token:{" "}
                {paginationDisabled
                  ? "— (combined view)"
                  : nextToken && nextToken.length
                  ? nextToken
                  : "—"}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
