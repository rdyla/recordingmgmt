import { useCallback, useEffect, useState } from "react";
import type {
  ApiResponse,
  MeetingApiResponse,
  Recording,
  SourceFilter,
} from "../types";
import { generateDemoRecordings } from "../utils/demoRecordings";

const fetchJson = async <T,>(url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

const useRecordings = (
  from: string,
  to: string,
  pageSize: number,
  source: SourceFilter,
  demoMode: boolean
) => {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zoomPageSize = Math.min(pageSize || 100, 300);

  const fetchPhonePage = useCallback(
    async (tokenOverride: string | null) => {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      params.set("page_size", String(zoomPageSize));
      params.set("query_date_type", "start_time");

      if (tokenOverride && tokenOverride.length > 0) {
        params.set("next_page_token", tokenOverride);
      }

      const api = await fetchJson<ApiResponse>(
        `/api/phone/recordings?${params.toString()}`
      );

      const recs: Recording[] = (api.recordings ?? []).map((r) => ({
        ...r,
        source: "phone" as const,
      }));

      return { api, recs };
    },
    [from, to, zoomPageSize]
  );

  const fetchMeetingPage = useCallback(
    async (tokenOverride: string | null) => {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      params.set("page_size", String(zoomPageSize));

      if (tokenOverride && tokenOverride.length > 0) {
        params.set("next_page_token", tokenOverride);
      }

      const api = await fetchJson<MeetingApiResponse>(
        `/api/meeting/recordings?${params.toString()}`
      );

      console.debug("Meeting API raw sample", {
        from: api.from,
        to: api.to,
        count: api.meetings?.length ?? 0,
        first: api.meetings?.[0],
      });

      const recs: Recording[] = [];

      for (const m of api.meetings ?? []) {
        const mm: any = m;

        const hostEmail: string =
          mm.hostEmail ||
          mm.host_email ||
          mm.owner_email ||
          "";

        const hostName: string =
          mm.hostName ||
          mm.owner_name ||
          hostEmail ||
          mm.topic ||
          "Unknown";

        const files = Array.isArray(m.recording_files)
          ? m.recording_files
          : [];

        let firstStartIso: string | undefined = undefined;
        const starts: Date[] = [];

        for (const f of files) {
          if (f.recording_start) {
            const d = new Date(f.recording_start);
            if (!isNaN(d.getTime())) {
              starts.push(d);
            }
          }
        }

        if (starts.length) {
          starts.sort((a, b) => a.getTime() - b.getTime());
          firstStartIso = starts[0].toISOString();
        }

        const totalSizeBytes = files.reduce((acc, f) => {
          const sz =
            typeof f.file_size === "number" && !isNaN(f.file_size)
              ? f.file_size
              : 0;
          return acc + sz;
        }, 0);

        const fileTypes = Array.from(
          new Set(
            files
              .map((f) => f.file_type || "")
              .filter((s) => typeof s === "string" && s.length > 0)
          )
        );

        recs.push({
          id: m.uuid || String(m.id),
          caller_number: "",
          caller_number_type: 0,
          callee_number: "",
          callee_number_type: 0,
          date_time: firstStartIso || m.start_time,
          end_time: undefined,
          duration: m.duration ?? 0,
          recording_type: "Meeting",
          download_url: undefined,
          caller_name: m.topic,
          callee_name: hostEmail || hostName,
          owner: {
            type: "user",
            id: m.host_id,
            name: hostName || hostEmail || "Unknown",
          },
          site: { id: "", name: "Meeting" },
          direction: "meeting",
          disclaimer_status: undefined,
          source: "meetings",
          topic: m.topic,
          host_name: hostName,
          host_email: hostEmail,
          meetingId: m.uuid,
          file_size: totalSizeBytes || undefined,
          recording_files: files,
          files_count: files.length,
          files_types: fileTypes,
        });
      }

      return { api, recs };
    },
    [from, to, zoomPageSize]
  );

  const fetchRecordings = useCallback(
    async (tokenOverride: string | null = null) => {
      setLoading(true);
      setError(null);

      try {
        if (demoMode) {
          const recs = generateDemoRecordings(from, to);

          setData({
            from,
            to,
            total_records: recs.length,
            next_page_token: null,
            recordings: recs,
          });
          setNextToken(null);
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
      } catch (e: any) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    [demoMode, fetchMeetingPage, fetchPhonePage, from, source, to]
  );

  const handleSearch = useCallback(() => {
    setPrevTokens([]);
    setCurrentToken(null);
    fetchRecordings(null);
  }, [fetchRecordings]);

  const handleNext = useCallback(() => {
    if (!nextToken) return;
    setPrevTokens((prev) => [...prev, currentToken || ""]);
    setCurrentToken(nextToken);
    fetchRecordings(nextToken);
  }, [currentToken, fetchRecordings, nextToken]);

  const handlePrev = useCallback(() => {
    if (!prevTokens.length) return;
    const newPrev = [...prevTokens];
    const last = newPrev.pop() || null;
    setPrevTokens(newPrev);
    setCurrentToken(last);
    fetchRecordings(last);
  }, [fetchRecordings, prevTokens]);

  useEffect(() => {
    fetchRecordings(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data,
    recordings: data?.recordings ?? [],
    loading,
    error,
    setError,
    nextToken,
    prevTokens,
    currentToken,
    handleSearch,
    handleNext,
    handlePrev,
    fetchRecordings,
    setData,
    setPrevTokens,
    setCurrentToken,
  };
};

export default useRecordings;
