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

async function handleGetMeetingRecordings(req, env) {
  try {
    const url = new URL(req.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const pageSize = url.searchParams.get("page_size") || "30";
    const nextToken = url.searchParams.get("next_page_token") || "";

    const accountId = env.ZOOM_ACCOUNT_ID;
    if (!accountId) {
      return new Response(
        JSON.stringify({
          error: true,
          status: 500,
          message: "Missing ZOOM_ACCOUNT_ID in environment for account recordings",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build query params for Zoom
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page_size", pageSize);
    if (nextToken) params.set("next_page_token", nextToken);
    params.set("trash", "false");
    params.set("mc", "false");

    // GET /accounts/{accountId}/recordings
    const zoomUrl = `${ZOOM_API_BASE}/accounts/${encodeURIComponent(
      accountId
    )}/recordings?${params.toString()}`;

    // Use your existing S2S token helper
    const token = await getZoomAccessToken(env);

    const zoomRes = await fetch(zoomUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await zoomRes.text();

    if (!zoomRes.ok) {
      return new Response(
        JSON.stringify({
          error: true,
          status: zoomRes.status,
          message: text,
        }),
        {
          status: zoomRes.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({
          error: true,
          status: 500,
          message: "Zoom returned non-JSON response",
          raw: text,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Zoom account recordings response already has:
    // { from, to, page_size, next_page_token, meetings: [...] }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
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
