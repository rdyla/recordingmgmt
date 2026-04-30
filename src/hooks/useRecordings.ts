import { useCallback, useEffect, useState } from "react";
import type {
  ApiResponse,
  MeetingApiResponse,
  ContactCenterApiResponse,
  Recording,
  SourceFilter,
  VoicemailApiResponse,
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

const MAX_PHONE_PAGES = 20; // safety cap
const MAX_CC_PAGES = 50; // safety cap
const MAX_VM_PAGES = 50; // safety cap

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

  // Zoom caps differ by endpoint; keep it bounded
  const zoomPageSize = Math.min(pageSize || 100, 300);

  // ---------------- PHONE (paged) ----------------
  const fetchAllPhoneRecordings = useCallback(async () => {
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
      if (nextToken) params.set("next_page_token", nextToken);

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

    return { from: apiFrom ?? from, to: apiTo ?? to, recordings: allRecs };
  }, [from, to, zoomPageSize]);

  // ---------------- MEETINGS (aggregated by worker) ----------------
  const fetchAllMeetingRecordings = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("page_size", String(zoomPageSize));

    const api = await fetchJson<MeetingApiResponse>(
      `/api/meeting/recordings?${params.toString()}`
    );

    const recs: Recording[] = [];

    for (const m of api.meetings ?? []) {
      const mm: any = m;

      const hostEmail: string = mm.hostEmail || mm.host_email || mm.owner_email || "";
      const hostName: string =
        mm.hostName || mm.owner_name || hostEmail || mm.topic || "Unknown";

      const files = Array.isArray(m.recording_files) ? m.recording_files : [];

      // Use earliest recording_start as the row’s date_time
      const starts: Date[] = [];
      for (const f of files) {
        if (f.recording_start) {
          const d = new Date(f.recording_start);
          if (!isNaN(d.getTime())) starts.push(d);
        }
      }
      starts.sort((a, b) => a.getTime() - b.getTime());
      const firstStartIso = starts.length ? starts[0].toISOString() : undefined;

      const totalSizeBytes = files.reduce((acc, f) => {
        const sz = typeof f.file_size === "number" && !isNaN(f.file_size) ? f.file_size : 0;
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
        autoDelete: (mm as any).autoDelete ?? (mm as any).auto_delete,
        autoDeleteDate: (mm as any).autoDeleteDate ?? (mm as any).auto_delete_date,
      } as any);
    }

    return { from: api.from ?? from, to: api.to ?? to, recordings: recs };
  }, [from, to, zoomPageSize]);

  // ---------------- CONTACT CENTER (paged) ----------------
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

        const callerName = firstConsumer?.consumer_name || "";
        const callerNum = firstConsumer?.consumer_number || "";

        const agentName = r.display_name || "";
        const agentEmail = r.user_email || "";

        const start = r.recording_start_time || "";
        const end = r.recording_end_time || "";

        return {
          id: r.recording_id,
          source: "cc" as const,

          date_time: start || end || new Date().toISOString(),
          end_time: end || undefined,
          duration: r.recording_duration ?? 0,

          // caller in Primary (caller_name/caller_number),
          // agent shown via cc_agent_* (your table uses these)
          caller_name: callerName || undefined,
          caller_number: callerNum || undefined,
          callee_name: agentName || agentEmail || undefined,

          direction: (r.direction as any) || "cc",
          recording_type: r.recording_type || "Contact Center",

          owner: {
            type: (r.owner_type as any) || "queue",
            id: r.owner_id || r.cc_queue_id || "",
            name: agentName || agentEmail || "Agent",
          },

          site: { id: r.cc_queue_id || "", name: r.queue_name || "CC" },

          // CC convenience fields used by your table menu builder
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
        } as any;
      });

      allRecs.push(...recs);
      nextToken = apiPage.next_page_token ?? null;
      loops += 1;
    } while (nextToken && loops < MAX_CC_PAGES);

    return { from: apiFrom ?? from, to: apiTo ?? to, recordings: allRecs };
  }, [from, to, zoomPageSize]);

  // ---------------- PHONE VOICEMAILS (paged) ----------------
  const fetchAllVoicemails = useCallback(async () => {
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

      const apiPage = await fetchJson<VoicemailApiResponse>(
        `/api/phone/voicemails?${params.toString()}`
      );

      apiFrom = apiFrom ?? apiPage.from ?? from;
      apiTo = apiPage.to ?? apiTo ?? to;

      const recs: Recording[] = (apiPage.voice_mails ?? []).map((v) => {
        const ownerName = v.owner?.name || "Unknown";
        return {
          id: v.id,
          source: "voicemail" as const,

          caller_name: v.caller_name,
          caller_number: v.caller_number || "",
          caller_number_type: v.caller_number_type ?? 0,
          callee_name: v.callee_name,
          callee_number: v.callee_number || "",
          callee_number_type: v.callee_number_type ?? 0,

          direction: "inbound",
          duration: v.duration ?? 0,
          download_url: v.download_url,
          date_time: v.date_time || new Date().toISOString(),

          recording_type: "Voicemail",

          call_id: v.call_id,
          call_log_id: v.call_log_id,
          call_history_id: v.call_history_id,
          call_element_id: v.call_element_id,

          owner: v.owner
            ? {
                type: v.owner.type || "user",
                id: v.owner.id || "",
                name: ownerName,
                extension_number: v.owner.extension_number,
              }
            : undefined,

          vm_status: v.status,
        } as Recording;
      });

      allRecs.push(...recs);
      nextToken = apiPage.next_page_token ?? null;
      loops += 1;
    } while (nextToken && loops < MAX_VM_PAGES);

    return { from: apiFrom ?? from, to: apiTo ?? to, recordings: allRecs };
  }, [from, to, zoomPageSize]);

  // ---------------- MAIN FETCH ----------------
  const fetchRecordings = useCallback(async () => {
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
        const { from: apiFrom, to: apiTo, recordings } = await fetchAllPhoneRecordings();
        setData({
          from: apiFrom,
          to: apiTo,
          total_records: recordings.length,
          next_page_token: null,
          recordings,
        });
        return;
      }

      if (source === "meetings") {
        const { from: apiFrom, to: apiTo, recordings } = await fetchAllMeetingRecordings();
        setData({
          from: apiFrom,
          to: apiTo,
          total_records: recordings.length,
          next_page_token: null,
          recordings,
        });
        return;
      }

      if (source === "cc") {
        const { from: apiFrom, to: apiTo, recordings } =
          await fetchAllContactCenterRecordings();
        setData({
          from: apiFrom,
          to: apiTo,
          total_records: recordings.length,
          next_page_token: null,
          recordings,
        });
        return;
      }

      // voicemail
      const { from: apiFrom, to: apiTo, recordings } = await fetchAllVoicemails();
      setData({
        from: apiFrom,
        to: apiTo,
        total_records: recordings.length,
        next_page_token: null,
        recordings,
      });
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
    fetchAllVoicemails,
  ]);

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
