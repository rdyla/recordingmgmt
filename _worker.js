// _worker.js – Zoom Phone Recording Explorer backend (no user OAuth, supports phone + meeting recordings)

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_TOKEN_URL = "https://zoom.us/oauth/token";

/**
 * Simple in-memory access token cache
 */
let cachedToken = null;
let cachedTokenExp = 0;

/* ---- Helpers ---- */
// --- Host cache + helper lookups -----------------------------------------
const hostCache = new Map();

/**
 * Fetch basic info for a Zoom user by host_id and cache it.
 * Returns { name, email }.
 */
async function getHostInfo(hostId, accessToken) {
  if (!hostId) {
    return { name: "Unknown", email: "" };
  }

  // Cache hit
  if (hostCache.has(hostId)) {
    return hostCache.get(hostId);
  }

  try {
    const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      // For example, missing user:read scopes, deleted users, etc.
      // Don't throw – just fallback to Unknown.
      const text = await res.text().catch(() => "");
      console.log("getHostInfo non-OK", res.status, text);
      const fallback = { name: "Unknown", email: "" };
      hostCache.set(hostId, fallback);
      return fallback;
    }

    const data = await res.json();

    const name = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Unknown";
    const email = data.email || "";

    const host = { name, email };
    hostCache.set(hostId, host);
    return host;
  } catch (e) {
    console.log("getHostInfo error", e && e.message ? e.message : e);
    const fallback = { name: "Unknown", email: "" };
    hostCache.set(hostId, fallback);
    return fallback;
  }
}

/**
 * Attach hostName + hostEmail to each meeting record in the API response.
 * Expects an array of `meeting` objects from Zoom's cloud recording list.
 */
async function attachHostsToRecordings(meetings, accessToken) {
  if (!Array.isArray(meetings) || meetings.length === 0) return [];

  // Collect unique host_ids to avoid N+1 spam
  const uniqueHostIds = [...new Set(meetings.map(m => m.host_id).filter(Boolean))];

  // Pre-warm cache (parallel fetch)
  await Promise.all(
    uniqueHostIds.map(id => getHostInfo(id, accessToken))
  );

  // Attach host info
  return Promise.all(
    meetings.map(async (m) => {
      const host = await getHostInfo(m.host_id, accessToken);
      return {
        ...m,
        hostName: host.name,
        hostEmail: host.email,
      };
    })
  );
}

async function getZoomAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExp - 30_000) {
    return cachedToken;
  }

  const basicAuth = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);

  const url = new URL(ZOOM_OAUTH_TOKEN_URL);
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", env.ZOOM_ACCOUNT_ID);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to get Zoom token (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExp = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/* -------------------- PHONE RECORDINGS -------------------- */

async function handleGetRecordings(req, env) {
  const url = new URL(req.url);
  const upstreamUrl = new URL(`${ZOOM_API_BASE}/phone/recordings`);

  for (const [key, value] of url.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  const token = await getZoomAccessToken(env);

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await upstreamRes.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return new Response(JSON.stringify(body), {
    status: upstreamRes.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

/* -------------------- DELETE PHONE RECORDINGS -------------------- */

async function handleDeletePhoneRecording(req, env) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const recordingId = body?.recordingId;
  if (!recordingId) {
    return json(400, { error: "Missing recordingId" });
  }

  const token = await getZoomAccessToken(env);

  const zoomUrl = `${ZOOM_API_BASE}/phone/recordings/${encodeURIComponent(recordingId)}`;

  const zoomRes = await fetch(zoomUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const status = zoomRes.status;
  const text = await zoomRes.text();

  console.log("PHONE DELETE", {
    zoomUrl,
    status,
    body: text.slice(0, 500),
  });

  if (text) {
    try {
      const z = JSON.parse(text);
      if (z.code || z.message) {
        return json(status === 200 ? 400 : status, {
          error: true,
          zoomStatus: status,
          zoomCode: z.code,
          zoomMessage: z.message,
          raw: text,
        });
      }
    } catch {
      // non-JSON body
    }
  }

  if (!zoomRes.ok && status !== 204) {
    return json(status, {
      error: true,
      zoomStatus: status,
      raw: text,
    });
  }

  // Zoom often returns 204 on success
  return json(200, {
    ok: true,
    zoomStatus: status,
    raw: text || null,
  });
}

/* -------------------- MEETING RECORDING ANALYTICS SUMMARY -------------------- */

async function handleGetMeetingRecordingAnalyticsSummary(req, env) {
  const url = new URL(req.url);

  const meetingId = url.searchParams.get("meetingId") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  if (!meetingId || !from || !to) {
    return json(400, { error: "Missing meetingId/from/to" });
  }

  const token = await getZoomAccessToken(env);

  // Zoom UUID encoding can be weird. Match your delete logic (double-encode when needed).
  const rawMeetingId = String(meetingId);
  let meetingPathId = rawMeetingId;
  if (meetingPathId.startsWith("/") || meetingPathId.includes("//")) {
    meetingPathId = encodeURIComponent(meetingPathId); // first encode
  }
  meetingPathId = encodeURIComponent(meetingPathId); // always encode for URL

  const zoomUrl = new URL(
    `${ZOOM_API_BASE}/meetings/${meetingPathId}/recordings/analytics_summary`
  );
  zoomUrl.searchParams.set("from", from);
  zoomUrl.searchParams.set("to", to);

  const zoomRes = await fetch(zoomUrl.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await zoomRes.text();

  // Pass through JSON as-is (or raw text wrapper)
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return new Response(JSON.stringify(body), {
    status: zoomRes.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/* -------------------- DELETE MEETING RECORDINGS -------------------- */

async function handleDeleteMeetingRecording(req, env) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const meetingId = body?.meetingId; // UUID string
  const recordingId = body?.recordingId; // optional: if omitted, delete all
  const action = body?.action || "trash"; // or "delete"

  if (!meetingId) {
    return json(400, {
      error: "Missing meetingId",
    });
  }

  const token = await getZoomAccessToken(env);

  // Zoom double-encoding rules for UUID
  const rawMeetingId = String(meetingId);
  let meetingPathId = rawMeetingId;
  if (meetingPathId.startsWith("/") || meetingPathId.includes("//")) {
    meetingPathId = encodeURIComponent(meetingPathId); // first encode
  }
  meetingPathId = encodeURIComponent(meetingPathId); // always encode for URL

  let zoomUrl;
  if (recordingId) {
    // Delete a single recording file
    const recordingPathId = encodeURIComponent(String(recordingId));
    zoomUrl = `${ZOOM_API_BASE}/meetings/${meetingPathId}/recordings/${recordingPathId}`;
  } else {
    // Delete ALL recordings for this meeting
    zoomUrl = `${ZOOM_API_BASE}/meetings/${meetingPathId}/recordings`;
  }

  const params = new URLSearchParams();
  params.set("action", action);
  zoomUrl += `?${params.toString()}`;

  const zoomRes = await fetch(zoomUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const status = zoomRes.status;
  const text = await zoomRes.text();

  console.log("MEETING DELETE", {
    zoomUrl,
    status,
    body: text.slice(0, 500),
  });

  if (text) {
    try {
      const z = JSON.parse(text);
      if (z.code || z.message) {
        return json(status === 200 ? 400 : status, {
          error: true,
          zoomStatus: status,
          zoomCode: z.code,
          zoomMessage: z.message,
          raw: text,
        });
      }
    } catch {
      // non-JSON
    }
  }

  if (!zoomRes.ok && status !== 204) {
    return json(status, {
      error: true,
      zoomStatus: status,
      raw: text,
    });
  }

  return json(200, {
    ok: true,
    zoomStatus: status,
    raw: text || null,
  });
}

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED, SEARCHABLE) -------------------- */

async function handleGetMeetingRecordings(req, env) {
  try {
    const url = new URL(req.url);

    // Base filters
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const debug = url.searchParams.get("debug") || ""; // "users" | "user-recordings" | ""

    // Search filters (currently used on backend, but UI mostly filters client-side)
    const ownerFilter = (url.searchParams.get("owner_email") || "").toLowerCase();
    const topicFilter = (url.searchParams.get("topic") || "").toLowerCase();
    const q = (url.searchParams.get("q") || "").toLowerCase();

    const token = await getZoomAccessToken(env);

    // 1) Get all active users with pagination
    const users = [];
    let nextPageToken = "";

    do {
      const usersUrl = new URL(`${ZOOM_API_BASE}/users`);
      usersUrl.searchParams.set("status", "active");
      usersUrl.searchParams.set("page_size", "300");
      if (nextPageToken) {
        usersUrl.searchParams.set("next_page_token", nextPageToken);
      }

      const usersRes = await fetch(usersUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!usersRes.ok) {
        const body = await usersRes.text();
        return new Response(
          JSON.stringify({
            error: true,
            status: usersRes.status,
            message: `Failed to list users: ${body}`,
          }),
          { status: usersRes.status, headers: { "Content-Type": "application/json" } }
        );
      }

      const usersData = await usersRes.json();
      if (Array.isArray(usersData.users)) {
        users.push(...usersData.users);
      }

      nextPageToken = usersData.next_page_token || "";
    } while (nextPageToken);

    if (debug === "users") {
      return new Response(
        JSON.stringify(
          {
            from,
            to,
            total_users: users.length,
            users: users.map((u) => ({
              id: u.id,
              email: u.email,
              first_name: u.first_name,
              last_name: u.last_name,
              type: u.type,
              status: u.status,
            })),
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    if (!users.length) {
      return new Response(
        JSON.stringify({
          from,
          to,
          next_page_token: "",
          page_count: 0,
          page_size: 0,
          total_records: 0,
          meetings: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2) Helper for per-user recordings URL
    const buildRecordingsUrl = (userId) => {
      const u = new URL(`${ZOOM_API_BASE}/users/${encodeURIComponent(userId)}/recordings`);
      u.searchParams.set("page_size", "50");
      if (from) u.searchParams.set("from", from);
      if (to) u.searchParams.set("to", to);
      return u.toString();
    };

    const meetings = [];
    const errors = [];
    const perUserSummary = [];

    // 3) Throttled concurrency
    const concurrency = 5;
    let idx = 0;

    async function worker() {
      while (idx < users.length) {
        const i = idx++;
        const user = users[i];

        try {
          const res = await fetch(buildRecordingsUrl(user.id), {
            headers: { Authorization: `Bearer ${token}` },
          });

          const text = await res.text();

          if (!res.ok) {
            errors.push({
              userId: user.id,
              userEmail: user.email,
              status: res.status,
              message: text,
            });
            continue;
          }

          let data;
          try {
            data = JSON.parse(text);
          } catch {
            errors.push({
              userId: user.id,
              userEmail: user.email,
              status: res.status,
              message: "Non-JSON response from recordings endpoint",
              raw: text,
            });
            continue;
          }

          const userMeetings = Array.isArray(data.meetings) ? data.meetings : [];

          const ownerName =
            `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email || "Unknown";

          perUserSummary.push({
            userId: user.id,
            userEmail: user.email,
            meetingCount: userMeetings.length,
          });

          for (const m of userMeetings) {
            const files = Array.isArray(m.recording_files) ? m.recording_files : [];
            const primary = files[0] || null;

            meetings.push({
              account_id: m.account_id,
              duration: m.duration,
              host_id: m.host_id,
              id: m.id,
              uuid: m.uuid,
              topic: m.topic,
              start_time: m.start_time,
              recording_count: m.recording_count,
              total_size: m.total_size,
              type: m.type,

              // Zoom-provided auto-delete flags
              auto_delete: m.auto_delete,
              auto_delete_date: m.auto_delete_date,

              // Friendly camelCase fields for frontend
              autoDelete: m.auto_delete,
              autoDeleteDate: m.auto_delete_date,

              recording_play_passcode: m.recording_play_passcode,

              // OWNER (from /users list)
              owner_email: user.email,
              owner_name: ownerName,

              // Primary file info
              primary_file_type: primary?.file_type || null,
              primary_file_extension: primary?.file_extension || null,

              recording_files: files.map((f) => ({
                id: f.id,
                file_type: f.file_type,
                file_extension: f.file_extension,
                file_size: f.file_size,
                recording_type: f.recording_type,
                recording_start: f.recording_start,
                recording_end: f.recording_end,
                play_url: f.play_url,
                download_url: f.download_url,
                status: f.status,
              })),
            });
          }
        } catch (e) {
          errors.push({
            userId: user.id,
            userEmail: user.email,
            error: e.message || String(e),
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, users.length) }, () => worker())
    );

    if (debug === "user-recordings") {
      return new Response(
        JSON.stringify(
          {
            from,
            to,
            total_users: users.length,
            per_user: perUserSummary,
            errors: errors.length ? errors : undefined,
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // 3.5) Enrich with hostName + hostEmail based on host_id
    const meetingsWithHosts = await attachHostsToRecordings(meetings, token);

    // 4) Apply backend filters if needed (UI also filters)
    let filtered = meetingsWithHosts;

    if (ownerFilter) {
      filtered = filtered.filter((m) =>
        (m.owner_email || "").toLowerCase().includes(ownerFilter)
      );
    }

    if (topicFilter) {
      filtered = filtered.filter((m) =>
        (m.topic || "").toLowerCase().includes(topicFilter)
      );
    }

    if (q) {
      filtered = filtered.filter((m) => {
        const bag = [
          m.topic || "",
          m.owner_email || "",
          m.owner_name || "",
          m.host_id || "",
          m.hostName || "",
          m.hostEmail || "",
        ].join(" ");
        return bag.toLowerCase().includes(q);
      });
    }

    const totalRecords = filtered.length;

    const respBody = {
      from,
      to,
      next_page_token: "",
      page_count: totalRecords ? 1 : 0,
      page_size: totalRecords,
      total_records: totalRecords,
      meetings: filtered,
    };

    if (errors.length) {
      respBody._errors = errors;
    }

    return new Response(JSON.stringify(respBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: true,
        status: 500,
        message: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/* -------------------- MEETING IDENTITY -------------------- */

async function handleGetMeetingIdentity(req, env) {
  const accountId = env.ZOOM_ACCOUNT_ID || "unknown";

  return new Response(
    JSON.stringify({
      userId: `account:${accountId}`,
      source: "account_recordings",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function encodeZoomMeetingIdForPath(meetingId) {
  // Match your delete logic: some UUIDs contain / and require double-encoding
  const raw = String(meetingId || "");
  let pathId = raw;

  if (pathId.startsWith("/") || pathId.includes("//")) {
    pathId = encodeURIComponent(pathId); // first encode
  }
  pathId = encodeURIComponent(pathId); // always encode for URL
  return pathId;
}

function summarizeAnalyticsSummary(apiJson) {
  const arr = Array.isArray(apiJson?.analytics_summary)
    ? apiJson.analytics_summary
    : [];

  let plays = 0;
  let downloads = 0;
  let lastAccessDate = ""; // YYYY-MM-DD max

  for (const row of arr) {
    const v = Number(row?.views_total_count ?? 0);
    const d = Number(row?.downloads_total_count ?? 0);
    if (!Number.isNaN(v)) plays += v;
    if (!Number.isNaN(d)) downloads += d;

    const date = typeof row?.date === "string" ? row.date : "";
    if (date && (!lastAccessDate || date > lastAccessDate)) {
      lastAccessDate = date; // ISO date compare works lexicographically
    }
  }

  return { plays, downloads, lastAccessDate };
}

/* -------------------- DOWNLOAD PROXY (PHONE) -------------------- */

async function handleDownloadRecording(req, env) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");

  if (!target) {
    return json(400, { error: "Missing 'url' query parameter" });
  }

  let zoomUrl;
  try {
    zoomUrl = new URL(target);
  } catch {
    return json(400, { error: "Invalid URL" });
  }

  if (
    zoomUrl.hostname !== "zoom.us" ||
    !zoomUrl.pathname.startsWith("/v2/phone/recording/download")
  ) {
    return json(400, { error: "Blocked URL" });
  }

  const token = await getZoomAccessToken(env);

  const zoomRes = await fetch(zoomUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const headers = new Headers();
  if (zoomRes.headers.get("content-type"))
    headers.set("Content-Type", zoomRes.headers.get("content-type"));
  if (zoomRes.headers.get("content-disposition"))
    headers.set("Content-Disposition", zoomRes.headers.get("content-disposition"));

  return new Response(zoomRes.body, { status: zoomRes.status, headers });
}

/* -------------------- DOWNLOAD PROXY (MEETING) -------------------- */

async function handleDownloadMeetingRecording(req, env) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const filename = url.searchParams.get("filename") || "";

  if (!target) {
    return json(400, { error: "Missing 'url' query parameter" });
  }

  let zoomUrl;
  try {
    zoomUrl = new URL(target);
  } catch {
    return json(400, { error: "Invalid URL" });
  }

  // Safety: only allow Zoom domains
  if (!zoomUrl.hostname.endsWith("zoom.us")) {
    return json(400, { error: "Blocked URL" });
  }

  // Optional: restrict to recording endpoints
  if (!zoomUrl.pathname.startsWith("/rec/")) {
    return json(400, { error: "Blocked path" });
  }

  const token = await getZoomAccessToken(env);
  if (!token) {
    return json(500, { error: "Unable to acquire Zoom access token" });
  }

  const zoomRes = await fetch(zoomUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const ct = zoomRes.headers.get("content-type");
  const cd = zoomRes.headers.get("content-disposition");

  const headers = new Headers();
  if (ct) headers.set("Content-Type", ct);

  // Prefer Zoom's filename if they ever start sending one
  if (cd && /filename=/i.test(cd)) {
    headers.set("Content-Disposition", cd);
  } else if (filename) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
  } else {
    headers.set("Content-Disposition", "attachment");
  }

  headers.set("Cache-Control", "private, max-age=0, no-store");

  return new Response(zoomRes.body, {
    status: zoomRes.status,
    headers,
  });
}

/* -------------------- JSON HELPER -------------------- */

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGetMeetingRecordingAnalyticsSummary(req, env) {
  try {
    const url = new URL(req.url);
    const meetingId = url.searchParams.get("meetingId") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    if (!meetingId) return json(400, { error: "Missing meetingId" });
    if (!from || !to) return json(400, { error: "Missing from/to" });

    const token = await getZoomAccessToken(env);

    const meetingPathId = encodeZoomMeetingIdForPath(meetingId);

    const zoomUrl = new URL(
      `${ZOOM_API_BASE}/meetings/${meetingPathId}/recordings/analytics_summary`
    );
    zoomUrl.searchParams.set("from", from);
    zoomUrl.searchParams.set("to", to);

    const zoomRes = await fetch(zoomUrl.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await zoomRes.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!zoomRes.ok) {
      console.log("ANALYTICS SUMMARY non-OK", {
        status: zoomRes.status,
        zoomUrl: zoomUrl.toString(),
        body: (text || "").slice(0, 500),
      });

      return json(zoomRes.status, {
        error: true,
        zoomStatus: zoomRes.status,
        raw: body,
      });
    }

    const summary = summarizeAnalyticsSummary(body);

    return json(200, {
      ok: true,
      meetingId,
      from: body?.from ?? from,
      to: body?.to ?? to,
      ...summary,
    });
  } catch (e) {
    return json(500, { error: true, message: e?.message || String(e) });
  }
}

/* -------------------- ROUTER -------------------- */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Phone recordings
    if (url.pathname === "/api/phone/recordings" && req.method === "GET") {
      return handleGetRecordings(req, env);
    }

    // Phone download proxy
    if (url.pathname === "/api/phone/recordings/download" && req.method === "GET") {
      return handleDownloadRecording(req, env);
    }

    // Delete a single phone recording
    if (url.pathname === "/api/phone/recordings/delete" && req.method === "POST") {
      return handleDeletePhoneRecording(req, env);
    }

    // Meeting recording analytics summary
    if (url.pathname === "/api/meeting/recordings/analytics_summary" && req.method === "GET") {
      return handleGetMeetingRecordingAnalyticsSummary(req, env);
    }

    // Meeting recordings (aggregated)
    if (url.pathname === "/api/meeting/recordings" && req.method === "GET") {
      return handleGetMeetingRecordings(req, env);
    }

    // Delete a single meeting recording file
    if (url.pathname === "/api/meeting/recordings/delete" && req.method === "POST") {
      return handleDeleteMeetingRecording(req, env);
    }

    // Meeting identity
    if (url.pathname === "/api/meeting/identity" && req.method === "GET") {
      return handleGetMeetingIdentity(req, env);
    }

    // Meeting recordings download proxy
    if (url.pathname === "/api/meeting/recordings/download" && req.method === "GET") {
      return handleDownloadMeetingRecording(req, env);
    }

    // Asset serving (React UI)
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    return new Response("Recording Explorer backend", { status: 200 });
  },
};
