import { useCallback, useEffect, useState } from "react";
import type {
  ApiResponse,
  MeetingApiResponse,
  ContactCenterApiResponse,   // NEW
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

const MAX_PHONE_PAGES = 20; // safety cap in case of huge date ranges

const useRecordings = (
  from: string,
  to: string,
  pageSize: number,
  source: SourceFilter,
  demoMode: boolean
) => {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // we still respect pageSize for Zoom, but we’ll chain pages
  const zoomPageSize = Math.min(pageSize || 100, 300);

  const fetchAllPhoneRecordings = useCallback(
    async () => {
      const allRecs: Recording[] = [];
      let nextToken: string | null = null;
      let loops = 0;
      let apiFrom: string | undefined;
      let apiTo: string | undefined;

      do {
        const params = new URLSearchParams();
        params.set("from", from);
        params.set("to", to);
        params.set("page_size", String(zoomPageSize));
        params.set("query_date_type", "start_time");
        if (nextToken) {
          params.set("next_page_token", nextToken);
        }

        const apiPage = await fetchJson<ApiResponse>(
          `/api/phone/recordings?${params.toString()}`
        );

        const recs: Recording[] = (apiPage.recordings ?? []).map((r) => ({
          ...r,
          source: "phone" as const,
        }));

        apiFrom = apiFrom ?? apiPage.from ?? from;
        apiTo = apiPage.to ?? apiTo ?? to;

        allRecs.push(...recs);
        nextToken = apiPage.next_page_token ?? null;
        loops += 1;
      } while (nextToken && loops < MAX_PHONE_PAGES);

      return {
        from: apiFrom ?? from,
        to: apiTo ?? to,
        recordings: allRecs,
      };
    },
    [from, to, zoomPageSize]
  );

  


  const fetchAllMeetingRecordings = useCallback(
    async () => {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      // page_size is mostly ignored by backend aggregation, but harmless
      params.set("page_size", String(zoomPageSize));

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
          // auto-delete info (if your worker passes it through)
          autoDelete: (mm as any).autoDelete ?? (mm as any).auto_delete,
          autoDeleteDate:
            (mm as any).autoDeleteDate ?? (mm as any).auto_delete_date,
        } as Recording & {
          autoDelete?: boolean | null;
          autoDeleteDate?: string | null;
        });
      }

      return {
        from: api.from ?? from,
        to: api.to ?? to,
        recordings: recs,
      };
    },
    [from, to, zoomPageSize]
  );

const MAX_CC_PAGES = 50; // safety cap (adjust if you want)

const useRecordings = (from: string, to: string, pageSize: number, source: SourceFilter, demoMode: boolean) => {
  // ...

  const fetchAllContactCenterRecordings = useCallback(async () => {
    const allRecs: Recording[] = [];
    let nextToken: string | null = null;
    let loops = 0;

    let apiFrom: string | undefined;
    let apiTo: string | undefined;

    do {
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      params.set("page_size", String(zoomPageSize));
      if (nextToken) params.set("next_page_token", nextToken);

      const apiPage = await fetchJson<ContactCenterApiResponse>(
        `/api/contact_center/recordings?${params.toString()}`
      );

      apiFrom = apiFrom ?? apiPage.from ?? from;
      apiTo = apiPage.to ?? apiTo ?? to;

      const recs: Recording[] = (apiPage.recordings ?? []).map((r) => {
        const firstConsumer = (r.consumers && r.consumers[0]) || undefined;

        // caller = consumers[0]
        const callerName = firstConsumer?.consumer_name || "";
        const callerNum = firstConsumer?.consumer_number || "";

        // agent = display_name / user_email
        const agentName = r.display_name || "";
        const agentEmail = r.user_email || "";

        const start = r.recording_start_time || "";
        const end = r.recording_end_time || "";

        return {
          id: r.recording_id, // app-wide unique id
          source: "cc",

          // use existing columns in your table UX:
          date_time: start || end || new Date().toISOString(),
          end_time: end || undefined,
          duration: r.recording_duration ?? 0,

          // show caller in Primary, agent in Owner/Host (like you requested)
          caller_name: callerName || undefined,
          caller_number: callerNum || undefined,
          callee_name: agentName || agentEmail || undefined,

          direction: r.direction || "cc",
          recording_type: r.recording_type || "Contact Center",

          owner: {
            type: r.owner_type || "queue",
            id: r.owner_id || r.cc_queue_id || "",
            name: agentName || agentEmail || "Agent",
          },

          site: { id: r.cc_queue_id || "", name: r.queue_name || "CC" },

          // CC-specific convenience fields
          cc_recording_id: r.recording_id,
          cc_download_url: r.download_url,
          cc_transcript_url: r.transcript_url,
          cc_playback_url: r.playback_url,
          cc_queue_name: r.queue_name,
          cc_flow_name: r.flow_name,
          cc_channel: r.channel,
          cc_direction: r.direction,
          cc_consumer_name: callerName || undefined,
          cc_consumer_number: callerNum || undefined,
          cc_agent_name: agentName || undefined,
          cc_agent_email: agentEmail || undefined,
        } as Recording;
      });

      allRecs.push(...recs);
      nextToken = apiPage.next_page_token ?? null;
      loops += 1;
    } while (nextToken && loops < MAX_CC_PAGES);

    return { from: apiFrom ?? from, to: apiTo ?? to, recordings: allRecs };
  }, [from, to, zoomPageSize]);

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (demoMode) {
        const recs = generateDemoRecordings(from, to);
        setData({ from, to, total_records: recs.length, next_page_token: null, recordings: recs });
        return;
      }

      if (source === "phone") {
        const { from: apiFrom, to: apiTo, recordings } = await fetchAllPhoneRecordings();
        setData({ from: apiFrom, to: apiTo, total_records: recordings.length, next_page_token: null, recordings });
      } else if (source === "meetings") {
        const { from: apiFrom, to: apiTo, recordings } = await fetchAllMeetingRecordings();
        setData({ from: apiFrom, to: apiTo, total_records: recordings.length, next_page_token: null, recordings });
      } else {
        // NEW: Contact Center
        const { from: apiFrom, to: apiTo, recordings } = await fetchAllContactCenterRecordings();
        setData({ from: apiFrom, to: apiTo, total_records: recordings.length, next_page_token: null, recordings });
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [
    demoMode,
    from,
    to,
    source,
    fetchAllPhoneRecordings,
    fetchAllMeetingRecordings,
    fetchAllContactCenterRecordings,
  ]);

  // ...
};



  const fetchRecordings = useCallback(
    async () => {
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
          return;
        }

        if (source === "phone") {
          const { from: apiFrom, to: apiTo, recordings } =
            await fetchAllPhoneRecordings();

          setData({
            from: apiFrom,
            to: apiTo,
            total_records: recordings.length,
            next_page_token: null,
            recordings,
          });
        } else {
          const { from: apiFrom, to: apiTo, recordings } =
            await fetchAllMeetingRecordings();

          setData({
            from: apiFrom,
            to: apiTo,
            total_records: recordings.length,
            next_page_token: null,
            recordings,
          });
        }
      } catch (e: any) {
        console.error(e);
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    [demoMode, fetchAllMeetingRecordings, fetchAllPhoneRecordings, from, source, to]
  );

  const handleSearch = useCallback(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  useEffect(() => {
    fetchRecordings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data,
    recordings: data?.recordings ?? [],
    loading,
    error,
    setError,
    fetchRecordings,
    handleSearch,
    setData,
  };
};

export default useRecordings;
