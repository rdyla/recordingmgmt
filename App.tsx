// src/App.tsx

import React, { useEffect, useState } from "react";

type Recording = any; // you can refine once you see real payload

type ApiResponse = {
  next_page_token?: string;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
  // Some tenants return "recordings", some may use "phone_recordings" — log and adapt.
  [key: string]: any;
};

const todayStr = new Date().toISOString().slice(0, 10);

const App: React.FC = () => {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [ownerType, setOwnerType] = useState<"all" | "extension" | "queue" | "auto_receptionist">("all");
  const [recordingType, setRecordingType] = useState<"Automatic" | "OnDemand" | "All">("OnDemand");
  const [queryDateType, setQueryDateType] = useState<"start_time" | "created_time">("start_time");
  const [pageSize, setPageSize] = useState(30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);

  const [currentToken, setCurrentToken] = useState<string | null>(null);

  const fetchRecordings = async (tokenOverride?: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      params.set("page_size", String(pageSize));
      params.set("owner_type", ownerType);
      if (recordingType !== "All") {
        params.set("recording_type", recordingType);
      }
      params.set("query_date_type", queryDateType);
      if (tokenOverride) {
        params.set("next_page_token", tokenOverride);
      }

      const res = await fetch(`/api/phone/recordings?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json: ApiResponse = await res.json();
      setData(json);

      // Zoom response usually has "next_page_token" + some recordings collection
      setNextToken(json.next_page_token || "");

      // For debugging the payload shape:
      console.debug("Raw recordings payload", json);

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

  // Auto-load once with today’s range
  useEffect(() => {
    fetchRecordings(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attempt to normalize recordings array from whatever key Zoom uses
  const recordings: Recording[] =
    (data?.recordings as Recording[]) ||
    (data?.phone_recordings as Recording[]) ||
    [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Zoom Phone Recording Explorer
        </h1>
        <span className="text-xs text-slate-400">
          Powered by /v2/phone/recordings
        </span>
      </header>

      <main className="flex-1 px-6 py-4 space-y-4">
        {/* Filters */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">From</label>
              <input
                type="date"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">To</label>
              <input
                type="date"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Recording type</label>
              <select
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
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
              <label className="text-xs text-slate-400">Owner type</label>
              <select
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
                value={ownerType}
                onChange={(e) =>
                  setOwnerType(e.target.value as typeof ownerType)
                }
              >
                <option value="all">All</option>
                <option value="extension">Extension</option>
                <option value="queue">Queue</option>
                <option value="auto_receptionist">Auto Receptionist</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Query date type</label>
              <select
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
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
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm"
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
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
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
                    <th className="px-3 py-2">Start time</th>
                    <th className="px-3 py-2">Caller</th>
                    <th className="px-3 py-2">Callee</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Duration (s)</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recordings.map((rec: any, idx: number) => (
                    <tr
                      key={rec.id || rec.recording_id || idx}
                      className="border-t border-slate-800/80 hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {rec.start_time ||
                          rec.recording_start_time ||
                          "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.caller_name || rec.caller_number || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.callee_name || rec.callee_number || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.owner_name ||
                          rec.owner_id ||
                          rec.extension_name ||
                          "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.recording_type || rec.type || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.duration ??
                          rec.recording_duration ??
                          "—"}
                      </td>
                      <td className="px-3 py-2">
                        {rec.download_url ? (
                          <a
                            href={rec.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:underline mr-2"
                          >
                            Download
                          </a>
                        ) : null}
                        {rec.playback_url ? (
                          <a
                            href={rec.playback_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:underline"
                          >
                            Play
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pager */}
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
      </main>
    </div>
  );
};

export default App;
