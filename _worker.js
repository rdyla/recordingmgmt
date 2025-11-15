// _worker.js – Zoom Phone Recording Explorer backend

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_TOKEN_URL = "https://zoom.us/oauth/token";

/**
 * Simple in-memory access token cache
 */
let cachedToken = null;
let cachedTokenExp = 0;

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

/* -------------------- MEETING RECORDINGS (STUB FOR NOW) -------------------- */

/* -------------------- MEETING RECORDINGS (REAL) -------------------- */

/* -------------------- MEETING RECORDINGS (ACCOUNT-LEVEL) -------------------- */

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED) -------------------- */

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED + DEBUG) -------------------- */

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED, TABLE-FRIENDLY) -------------------- */

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED, SEARCHABLE) -------------------- */

async function handleGetMeetingRecordings(req, env) {
  try {
    const url   = new URL(req.url);

    // Base filters
    const from  = url.searchParams.get("from")  || "";
    const to    = url.searchParams.get("to")    || "";
    const debug = url.searchParams.get("debug") || ""; // "users" | "user-recordings" | ""

    // Search filters
    const ownerFilter = (url.searchParams.get("owner_email") || "").toLowerCase();
    const topicFilter = (url.searchParams.get("topic")       || "").toLowerCase();
    const q           = (url.searchParams.get("q")           || "").toLowerCase();

    const token = await getZoomAccessToken(env);

    // 1) Get ALL active users (with pagination)
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

    // 🔍 DEBUG: show just user list
    if (debug === "users") {
      return new Response(
        JSON.stringify(
          {
            from,
            to,
            total_users: users.length,
            users: users.map(u => ({
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
      if (to)   u.searchParams.set("to", to);
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

          perUserSummary.push({
            userId: user.id,
            userEmail: user.email,
            meetingCount: userMeetings.length,
          });

          for (const m of userMeetings) {
            const files = Array.isArray(m.recording_files) ? m.recording_files : [];
            const primary = files[0] || null;

            meetings.push({
              // Core meeting fields from Zoom schema
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
              auto_delete: m.auto_delete,
              auto_delete_date: m.auto_delete_date,
              recording_play_passcode: m.recording_play_passcode,

              // Owner context (helps UI filter)
              owner_email: user.email,

              // “Table friendly” derived fields
              primary_file_type: primary?.file_type || null,
              primary_file_extension: primary?.file_extension || null,

              // Trimmed recording_files
              recording_files: files.map(f => ({
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

    // 🔍 DEBUG: per-user counts only
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

    // 4) Apply search filters (owner_email, topic, q)
    let filtered = meetings;

    if (ownerFilter) {
      filtered = filtered.filter(m =>
        (m.owner_email || "").toLowerCase().includes(ownerFilter)
      );
    }

    if (topicFilter) {
      filtered = filtered.filter(m =>
        (m.topic || "").toLowerCase().includes(topicFilter)
      );
    }

    if (q) {
      filtered = filtered.filter(m => {
        const bag = [
          m.topic || "",
          m.owner_email || "",
          m.host_id || "",
        ].join(" ");
        return bag.toLowerCase().includes(q);
      });
    }

    const totalRecords = filtered.length;

    const respBody = {
      from,
      to,
      next_page_token: "",          // everything in one shot for now
      page_count: totalRecords ? 1 : 0,
      page_size: totalRecords,
      total_records: totalRecords,
      meetings: filtered,
    };

    if (errors.length) {
      respBody._errors = errors;   // extra debug info, UI can ignore
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

/* -------------------- DOWNLOAD PROXY (OPTIONAL) -------------------- */

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

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

    // Meeting recordings (stub)
    if (url.pathname === "/api/meeting/recordings" && req.method === "GET") {
      return handleGetMeetingRecordings(req, env);
    }

    // Meeting identity
    if (url.pathname === "/api/meeting/identity" && req.method === "GET") {
      return handleGetMeetingIdentity(req, env);
    }

    // Asset serving (your React UI)
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    return new Response("Recording Explorer backend", { status: 200 });
  },
};
