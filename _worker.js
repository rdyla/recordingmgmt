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

async function handleGetMeetingRecordings(req, env) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "";
    const to   = url.searchParams.get("to")   || "";

    const token = await getZoomAccessToken(env);

    // 1) Get ALL active users (handle pagination)
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

    if (!users.length) {
      return new Response(
        JSON.stringify({
          from,
          to,
          page_size: 0,
          next_page_token: "",
          meetings: [],
          total_users: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2) Helper for each user's recordings URL
    const buildRecordingsUrl = (userId) => {
      const u = new URL(`${ZOOM_API_BASE}/users/${encodeURIComponent(userId)}/recordings`);
      u.searchParams.set("page_size", "50");
      if (from) u.searchParams.set("from", from);
      if (to)   u.searchParams.set("to", to);
      return u.toString();
    };

    const meetings = [];
    const errors = [];

    // 3) Throttled concurrency so we don’t slam the API
    const concurrency = 5;
    let idx = 0;

    async function worker() {
      while (idx < users.length) {
        const i = idx++;
        const user = users[i];

        try {
          const res = await fetch(buildRecordingsUrl(user.id), {
            headers: {
              Authorization: `Bearer ${token}`,
            },
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

          if (Array.isArray(data.meetings)) {
            for (const m of data.meetings) {
              meetings.push({
                ...m,
                owner_id: user.id,
                owner_email: user.email,
              });
            }
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

    // 4) Response shaped *similar* to Zoom’s account recordings endpoint
    const respBody = {
      from,
      to,
      page_size: meetings.length,       // not "real" paging anymore, just count
      next_page_token: "",             // no cross-user paging; everything in one shot
      meetings,
      total_users: users.length,
      errors: errors.length ? errors : undefined,
    };

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
