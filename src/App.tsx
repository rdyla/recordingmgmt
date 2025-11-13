// src/App.tsx
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
};

type ApiResponse = {
  next_page_token?: string;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);

 const fetchRecordings = async (tokenOverride: string | null = null) => {
  setLoading(true);
  setError(null);

  try {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("page_size", String(pageSize));

    if (recordingType !== "All") {
      params.set("recording_type", recordingType);
    }

    params.set("query_date_type", queryDateType);

    // ✅ use tokenOverride for pagination
    if (tokenOverride && tokenOverride.length > 0) {
      params.set("next_page_token", tokenOverride);
    }

    const res = await fetch(`/api/phone/recordings?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const json: ApiResponse = await res.json();
    setData(json);
    setNextToken(json.next_page_token || "");

    console.debug("Recordings payload", json);
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

  const recordings: Recording[] = data?.recordings ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Zoom Phone Recording Explorer</h1>
        <span className="text-xs text-slate-400">
          {data?.from} → {data?.to}
        </span>
      </header>

      <main className="flex-1 px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-4">
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg shadow-slate-950/40">
            {/* filters */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">From</label>
              <input
                type="date"
                className="bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"

                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">To</label>
              <input
                type="date"
                className="bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"

                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Recording type</label>
              <select
                className="bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"

                value={recordingType}
                onChange={(e) =>
                  setRecordingType(e.target.value as typeof recordingType)
                }
              >
                <option value="All">All</option>
                <option value="Automatic">Automatic</option>
                <option value="OnDemand">OnDemand</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Query date type</label>
              <select
               className="bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"

                value={queryDateType}
                onChange={(e) =>
                  setQueryDateType(e.target.value as typeof queryDateType)
                }
              >
                <option value="start_time">Start time</option>
                <option value="created_time">Created time</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Page size</label>
              <input
                type="number"
                min={1}
                max={300}
                className="bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"

                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 30)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              {loading ? "Loading…" : "Search"}
            </button>

            <div className="text-xs text-slate-400 flex items-center gap-3">
              <span>
                Records:{" "}
                {typeof data?.total_records === "number"
                  ? data.total_records
                  : recordings.length}
              </span>
              {currentToken && <span>Page token: {currentToken}</span>}
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">
              Error: {error}
            </div>
          )}
        </section>

        {/* Table */}
    <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40">
      {/* table */}
          {loading && !recordings.length ? (
            <div className="text-sm text-slate-400">Loading recordings…</div>
          ) : !recordings.length ? (
            <div className="text-sm text-slate-400">
              No recordings found for this range.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900">
                  <tr className="text-xs text-slate-400 text-left">
                    <th className="px-3 py-2">Date / Time</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Caller</th>
                    <th className="px-3 py-2">Callee</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Site</th>
                    <th className="px-3 py-2">Duration (s)</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recordings.map((rec, idx) => {
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

                    const callerDisplay =
                      rec.caller_name && rec.caller_number
                        ? `${rec.caller_name} (${rec.caller_number})`
                        : rec.caller_name || rec.caller_number || "—";

                    const calleeDisplay =
                      rec.callee_name && rec.callee_number
                        ? `${rec.callee_name} (${rec.callee_number})`
                        : rec.callee_name || rec.callee_number || "—";

                    const ownerDisplay =
                      rec.owner?.name && rec.owner?.extension_number
                        ? `${rec.owner.name} (${rec.owner.extension_number})`
                        : rec.owner?.name || "—";

                    return (
                      <tr
                        key={rec.id || rec.call_id || idx}
                        className="border-t border-slate-800/80 hover:bg-slate-800/40"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {dateDisplay}
                        </td>
                        <td className="px-3 py-2 capitalize">
                          {rec.direction || "—"}
                        </td>
                        <td className="px-3 py-2">{callerDisplay}</td>
                        <td className="px-3 py-2">{calleeDisplay}</td>
                        <td className="px-3 py-2">{ownerDisplay}</td>
                        <td className="px-3 py-2">{rec.site?.name || "—"}</td>
                        <td className="px-3 py-2">
                          {rec.duration ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {rec.recording_type || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {rec.download_url && (
                            <a
                              href={rec.download_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:underline mr-2"
                            >
                              Download
                            </a>
                          )}

                          {rec.call_history_id && (
                            <button
                              className="text-xs text-slate-300 border border-slate-600 rounded px-1 py-0.5 hover:bg-slate-800"
                              onClick={() => {
                                console.debug(
                                  "View call history",
                                  rec.call_history_id
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

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={!prevTokens.length || loading}
                className="px-2 py-1 border border-slate-700 rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={!nextToken || !nextToken.length || loading}
                className="px-2 py-1 border border-slate-700 rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
            <div>
              Next token:{" "}
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
