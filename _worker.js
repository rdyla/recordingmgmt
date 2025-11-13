// _worker.js – Zoom Phone Recording Explorer backend - nearly ready for deployment. 

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_TOKEN_URL = "https://zoom.us/oauth/token";

/**
 * Simple in-memory cache (per running isolate) so we’re not
 * calling OAuth every single request. CF will spin new isolates,
 * but this still reduces churn.
 */
let cachedToken = null;
let cachedTokenExp = 0; // epoch ms

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
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Zoom token (${res.status}): ${text}`);
  }

  const data = await res.json();
  // Response has access_token + expires_in (seconds)
  cachedToken = data.access_token;
  cachedTokenExp = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function handleGetRecordings(req, env) {
  const url = new URL(req.url);
  const upstreamUrl = new URL(`${ZOOM_API_BASE}/phone/recordings`);

  // Pass through supported query params (safe default: just forward everything)
  for (const [key, value] of url.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  const token = await getZoomAccessToken(env);

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
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
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*" // tweak if you want stricter
    }
  });
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // API route for recordings
    if (url.pathname === "/api/phone/recordings" && req.method === "GET") {
      try {
        return await handleGetRecordings(req, env);
      } catch (e) {
        return json(500, { ok: false, error: String(e?.message || e) });
      }
    }

    // CORS preflight if you need it
    if (url.pathname === "/api/phone/recordings" && req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // Default: serve static assets (Vite build) if you’re using Pages+Workers
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    return new Response("Recording Explorer backend", { status: 200 });
  }
};
