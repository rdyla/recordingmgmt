import React, { useState, useEffect } from "react";

type RecordingFile = {
  id: string;
  file_type: string | null;
  file_extension: string | null;
  file_size: number | null;
  recording_type: string | null;
  recording_start: string | null;
  recording_end: string | null;
  play_url: string | null;
  download_url: string | null;
  status: string | null;
};

type MeetingRecording = {
  account_id?: string;
  duration?: number;
  host_id?: string;
  id?: number;
  uuid?: string;
  topic?: string;
  start_time?: string;
  recording_count?: number;
  total_size?: number;
  type?: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
  recording_play_passcode?: string;

  owner_email?: string;

  primary_file_type?: string | null;
  primary_file_extension?: string | null;

  recording_files?: RecordingFile[];
};

type MeetingResponse = {
  from: string;
  to: string;
  next_page_token: string;
  page_count: number;
  page_size: number;
  total_records: number;
  meetings: MeetingRecording[];
  _errors?: any;
};

const MeetingRecordingsPage: React.FC = () => {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [q, setQ] = useState("");

  const [data, setData] = useState<MeetingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optional: load "last 7 days" on first mount
  useEffect(() => {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setFrom(fmt(sevenDaysAgo));
    setTo(fmt(now));

    // Auto-fetch on mount
    fetchRecordings(fmt(sevenDaysAgo), fmt(now), ownerEmail, topic, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRecordings = async (
    fromParam: string,
    toParam: string,
    ownerEmailParam: string,
    topicParam: string,
    qParam: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const url = new URL("/api/meeting/recordings", window.location.origin);

      if (fromParam) url.searchParams.set("from", fromParam);
      if (toParam) url.searchParams.set("to", toParam);
      if (ownerEmailParam) url.searchParams.set("owner_email", ownerEmailParam);
      if (topicParam) url.searchParams.set("topic", topicParam);
      if (qParam) url.searchParams.set("q", qParam);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const json: MeetingResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRecordings(from, to, ownerEmail, topic, q);
  };

  const handleReset = () => {
    setFrom("");
    setTo("");
    setOwnerEmail("");
    setTopic("");
    setQ("");
    fetchRecordings("", "", "", "", "");
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const meetings = data?.meetings ?? [];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold mb-2">
        Zoom Meeting Recordings
      </h1>

      {/* Search / filter bar */}
      <form
        onSubmit={handleSubmit}
        className="bg-white/80 rounded-xl border border-gray-200 shadow-sm p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {/* Date from */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              From date
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>

          {/* Date to */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              To date
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>

          {/* Owner email */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              Owner email (contains)
            </label>
            <input
              type="text"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="e.g. ryan@"
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>

          {/* Topic */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              Topic (contains)
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. onboarding"
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>

          {/* Generic search */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              Search (topic / owner / host)
            </label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="free text search"
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {/* Status / summary */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <div>
          {loading && <span>Loading recordings…</span>}
          {!loading && data && (
            <span>
              Showing <strong>{meetings.length}</strong> of{" "}
              <strong>{data.total_records}</strong> matching records
              {data.from && data.to && (
                <>
                  {" "}
                  between <strong>{data.from}</strong> and{" "}
                  <strong>{data.to}</strong>
                </>
              )}
            </span>
          )}
          {!loading && !data && !error && (
            <span>Run a search to see recordings.</span>
          )}
        </div>
        {error && (
          <div className="text-red-600 text-xs">
            Error: {error}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  Start time
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  Owner email
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  Topic
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  Host ID
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  File type
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                  Extension
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-700">
                  Duration (min)
                </th>
              </tr>
            </thead>
            <tbody>
              {meetings.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-400 text-sm"
                  >
                    No recordings found for the current filters.
                  </td>
                </tr>
              )}
              {meetings.map((m) => {
                const key = m.uuid || `${m.id}-${m.start_time}`;
                const durationMinutes =
                  typeof m.duration === "number"
                    ? Math.round(m.duration)
                    : null;

                return (
                  <tr
                    key={key}
                    className="border-b last:border-b-0 hover:bg-gray-50/70"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTime(m.start_time)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.owner_email || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {m.topic || <span className="text-gray-400">No topic</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.host_id || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.primary_file_type || (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.primary_file_extension || (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {durationMinutes != null ? (
                        <span>{durationMinutes}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Optional: dump raw errors if backend returned any */}
      {data?._errors && (
        <details className="mt-2 text-xs text-gray-500">
          <summary className="cursor-pointer">
            Backend warnings / errors (per-user)
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto bg-gray-50 p-2 rounded">
            {JSON.stringify(data._errors, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default MeetingRecordingsPage;
