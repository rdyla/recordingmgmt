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
  source: string; // e.g. "account_recordings"
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
  meetingId?: string; // UUID for meeting delete API
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

/** Demo mode: enabled via ?demo=1 in the URL */
const useInitialDemoMode = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1";
  } catch {
    return false;
  }
};

/** Generate ~200 fake phone recordings for demo mode, constrained to [from,to] if provided */
function generateDemoRecordings(from?: string, to?: string): Recording[] {
  const owners = [
    { name: "Alex Parker", ext: 101 },
    { name: "Jamie Lee", ext: 102 },
    { name: "Morgan Smith", ext: 103 },
    { name: "Taylor Johnson", ext: 104 },
    { name: "Chris Walker", ext: 105 },
    { name: "Jordan Davis", ext: 106 },
    { name: "Riley Thompson", ext: 107 },
    { name: "Casey Martinez", ext: 108 },
    { name: "Drew Allen", ext: 109 },
    { name: "Sam Nguyen", ext: 110 },
    { name: "Avery Patel", ext: 111 },
    { name: "Logan Rivera", ext: 112 },
    { name: "Quinn Brooks", ext: 113 },
    { name: "Harper Green", ext: 114 },
    { name: "Reese Carter", ext: 115 },
    { name: "Devon Flores", ext: 116 },
    { name: "Skyler Reed", ext: 117 },
    { name: "Rowan Young", ext: 118 },
    { name: "Kendall King", ext: 119 },
    { name: "Parker Lewis", ext: 120 },
  ];

  const sites = [
    { id: "site-hq", name: "HQ – Irvine" },
    { id: "site-sj", name: "San Jose" },
    { id: "site-chi", name: "Chicago" },
    { id: "site-phx", name: "Phoenix" },
  ];

  const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const randomPhone = () =>
    `555${randomInt(1000000, 9999999).toString().padStart(7, "0")}`;

  const directions: Array<"inbound" | "outbound"> = ["inbound", "outbound"];
  const types = ["Automatic", "On-demand"] as const;

  const now = Date.now();

  // Determine time range to generate within
  let startMs: number | null = null;
  let endMs: number | null = null;

  if (from && to) {
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T23:59:59");
    if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
      startMs = Math.min(fromDate.getTime(), toDate.getTime());
      endMs = Math.max(fromDate.getTime(), toDate.getTime());
    }
  }

  // Fallback: last 14 days
  if (startMs == null || endMs == null || startMs === endMs) {
    endMs = now;
    startMs = now - 14 * 24 * 60 * 60 * 1000;
  }

  const range = endMs - startMs || 1;

  const records: Recording[] = [];

  for (let i = 0; i < 200; i++) {
    const owner = owners[i % owners.length];
    const site = sites[i % sites.length];
    const direction = directions[i % directions.length];

    const offsetMs = Math.floor(Math.random() * range);
    const start = new Date(startMs + offsetMs);
    const duration = randomInt(30, 1200); // 30s–20m

    const callerName = direction === "inbound" ? "Customer" : owner.name;
    const calleeName = direction === "inbound" ? owner.name : "Customer";

    const callerNumber =
      direction === "inbound" ? randomPhone() : `+1${owner.ext}00`;
    const calleeNumber =
      direction === "inbound" ? `+1${owner.ext}00` : randomPhone();

    records.push({
      id: `demo-${i + 1}`,
      caller_number: callerNumber,
      caller_number_type: 1,
      caller_name: callerName,
      callee_number: calleeNumber,
      callee_number_type: 1,
      callee_name: calleeName,
      direction,
      duration,
      date_time: start.toISOString(),
      recording_type: types[i % types.length],
      owner: {
        type: "user",
        id: `demo-user-${owner.ext}`,
        name: owner.name,
        extension_number: owner.ext,
      },
      site,
      source: "phone",
    });
  }

  // sort newest first
  records.sort(
    (a, b) =>
      new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
  );

  return records;
}

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

  const [demoMode] = useState<boolean>(() => useInitialDemoMode());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set()
  );

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

    const zoomPageSize = Math.min(pageSize || 100, 300);
    params.set("page_size", String(zoomPageSize));
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
      if (demoMode) {
        // Demo: generate ~200 fake records within [from,to] (or last 14 days if unset)
        const recs = generateDemoRecordings(from, to);

        setData({
          from,
          to,
          total_records: recs.length,
          next_page_token: null,
          recordings: recs,
        });
        setNextToken(null);
        setPageIndex(0);
        setSelectedKeys(new Set());
        return;
      }

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

  // Auto-load on first render
  useEffect(() => {
    fetchRecordings(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleBulkDelete = async () => {
    if (!filteredRecordings.length || !selectedCount) return;

    const confirmed = window.confirm(
      `Delete ${selectedCount} ${
        source === "phone" ? "phone" : "meeting"
      } recording(s)? This will move them to trash or permanently delete them based on your Zoom settings.`
    );
    if (!confirmed) return;

    const toDelete: Recording[] = [];
    filteredRecordings.forEach((rec, idx) => {
      const key = makeRecordKey(rec, idx);
      if (selectedKeys.has(key)) {
        toDelete.push(rec);
      }
    });

    if (!toDelete.length) return;

    // DEMO MODE: in-memory delete only
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
      setSelectedKeys(new Set());
      setDeleteMessage(
        `Demo delete: removed ${toDelete.length} record(s) from the table.`
      );
      return;
    }

    // REAL MODE
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

      await fetchRecordings(currentToken);
      setSelectedKeys(new Set());
    } finally {
      setDeleting(false);
      setTimeout(() => setDeleteProgress(null), 2000);
    }
  };

  const paginationDisabled = false;

  // ----- grouping by owner (per page) -----

  type PageRecord = { rec: Recording; globalIndex: number };

  const pageRecordsWithIndex: PageRecord[] = pageRecords.map(
    (rec, idxOnPage) => ({
      rec,
      globalIndex: pageStart + idxOnPage,
    })
  );

  type OwnerGroup = {
    key: string;
    ownerLabel: string;
    sourceLabel: string;
    siteLabel: string;
    items: PageRecord[];
    count: number;
    totalDuration: number;
    firstDate: Date | null;
    lastDate: Date | null;
  };

  const groupsMap = new Map<string, OwnerGroup>();

  for (const item of pageRecordsWithIndex) {
    const { rec } = item;
    const isMeeting = rec.source === "meetings";

    const ownerLabel = isMeeting
      ? rec.host_email || rec.owner?.name || "Unknown"
      : rec.owner?.name && rec.owner?.extension_number
      ? `${rec.owner.name} (${rec.owner.extension_number})`
      : rec.owner?.name || "Unknown";

    const sourceLabel = isMeeting ? "Meeting" : "Phone";
    const siteLabel = isMeeting ? "—" : rec.site?.name || "—";

    const groupKey = `${sourceLabel}|${ownerLabel}`;

    const dt = rec.date_time
      ? new Date(rec.date_time)
      : rec.end_time
      ? new Date(rec.end_time)
      : null;

    const existing = groupsMap.get(groupKey);
    if (!existing) {
      groupsMap.set(groupKey, {
        key: groupKey,
        ownerLabel,
        sourceLabel,
        siteLabel,
        items: [item],
        count: 1,
        totalDuration: rec.duration ?? 0,
        firstDate: dt,
        lastDate: dt,
      });
    } else {
      existing.items.push(item);
      existing.count += 1;
      existing.totalDuration += rec.duration ?? 0;
      if (dt) {
        if (!existing.firstDate || dt < existing.firstDate) {
          existing.firstDate = dt;
        }
        if (!existing.lastDate || dt > existing.lastDate) {
          existing.lastDate = dt;
        }
      }
    }
  }

  const ownerGroups = Array.from(groupsMap.values()).sort((a, b) =>
    a.ownerLabel.localeCompare(b.ownerLabel)
  );

  const isGroupCollapsed = (groupKey: string) => collapsedGroups.has(groupKey);

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const isGroupFullySelected = (group: OwnerGroup): boolean => {
    if (!group.items.length) return false;
    return group.items.every(({ rec, globalIndex }) =>
      selectedKeys.has(makeRecordKey(rec, globalIndex))
    );
  };

  const toggleGroupSelection = (group: OwnerGroup, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const { rec, globalIndex } of group.items) {
        const key = makeRecordKey(rec, globalIndex);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="app-title">Zoom Recording Explorer</h1>
          <p className="app-subtitle">
            Source: {source === "phone" ? "Phone" : "Meetings"} ·{" "}
            {data?.from ?? from} → {data?.to ?? to}
            {meetingIdentity && source === "meetings" && (
              <>
                {" "}
                · Meetings user: {meetingIdentity.userId}
                {meetingIdentity.source === "default_me" && " (me)"}
              </>
            )}
            {demoMode && (
              <>
                {" "}
                · <strong>DEMO MODE</strong> (fake data)
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
                      source === "phone" ? "btn-toggle active" : "btn-toggle"
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
                      source === "meetings" ? "btn-toggle active" : "btn-toggle"
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
                            (deleteProgress.done /
                              Math.max(deleteProgress.total, 1)) *
                            100
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
                    {ownerGroups.map((group) => {
                      const groupSelected = isGroupFullySelected(group);
                      const collapsed = isGroupCollapsed(group.key);

                      const dateRangeLabel =
                        group.firstDate && group.lastDate
                          ? `${group.firstDate.toLocaleDateString()} → ${group.lastDate.toLocaleDateString()}`
                          : "—";

                      return (
                        <React.Fragment key={group.key}>
                          {/* Group header row */}
                          <tr className="rec-row group-row">
                            <td>
                              <input
                                type="checkbox"
                                checked={groupSelected}
                                onChange={(e) =>
                                  toggleGroupSelection(
                                    group,
                                    e.target.checked
                                  )
                                }
                              />
                            </td>
                            <td colSpan={9}>
                              <button
                                type="button"
                                className="group-toggle"
                                onClick={() => toggleGroupCollapse(group.key)}
                                style={{
                                  marginRight: 8,
                                  cursor: "pointer",
                                  border: "none",
                                  background: "transparent",
                                }}
                              >
                                {collapsed ? "▶" : "▼"}
                              </button>
                              <strong>{group.ownerLabel}</strong>{" "}
                              <span style={{ opacity: 0.8 }}>
                                · {group.sourceLabel} · {group.count} recording
                                {group.count !== 1 ? "s" : ""} · Total{" "}
                                {group.totalDuration}s · {dateRangeLabel}
                              </span>
                            </td>
                          </tr>

                          {/* Child rows */}
                          {!collapsed &&
                            group.items.map(({ rec, globalIndex }) => {
                              const key = makeRecordKey(rec, globalIndex);
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
                                : rec.owner?.name &&
                                  rec.owner?.extension_number
                                ? `${rec.owner.name} (${rec.owner.extension_number})`
                                : rec.owner?.name || "—";

                              const siteName = isMeeting
                                ? "—"
                                : rec.site?.name || "—";

                              const sourceLabel = isMeeting
                                ? "Meeting"
                                : "Phone";

                              return (
                                <tr key={key} className="rec-row">
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedKeys.has(key)}
                                      onChange={() =>
                                        toggleRowSelection(rec, globalIndex)
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
                                    {rec.download_url && !demoMode && (
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
                        </React.Fragment>
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
