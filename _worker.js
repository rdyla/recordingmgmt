// _worker.js – Zoom Phone Recording Explorer backend (multi-tenant; CF Access at edge)

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_TOKEN_URL = "https://zoom.us/oauth/token";

/* -------------------- TENANT RESOLUTION --------------------
 *
 * Tenancy model:
 *   - Cloudflare Access is in front of the Worker. Every authenticated
 *     request carries the user's email in `Cf-Access-Authenticated-User-Email`.
 *   - `env.TENANTS_JSON` is a JSON string array of tenant configs:
 *       [{slug, displayName, accountId, clientId, domains:[], isProduction}]
 *   - The per-tenant Zoom client secret lives in a wrangler secret named
 *     `ZOOM_CLIENT_SECRET_<SLUG_UPPER>` (looked up dynamically by slug).
 *   - `env.SUPER_ADMINS` is a comma-separated list of emails that can switch
 *     into any tenant via an `active_tenant` cookie / `?as=<slug>` query.
 */

const tokenCacheByTenant = new Map();        // slug -> { token, exp }
const hostCacheByTenant = new Map();         // slug -> Map<hostId, { name, email }>

/* -------------------- CF ACCESS JWT VERIFICATION --------------------
 *
 * When env.CF_ACCESS_TEAM_DOMAIN and env.CF_ACCESS_AUD are both set, every
 * request must carry a valid `Cf-Access-Jwt-Assertion` header signed by
 * Cloudflare Access. We cryptographically verify the JWT and pull the email
 * from the verified claims instead of trusting the email header.
 *
 * If either env is missing we fall back to trusting the email header — useful
 * for local dev or before strict mode is rolled on.
 */

const jwksCache = { keys: null, exp: 0 };

async function getJwks(teamDomain) {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.exp) return jwksCache.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Failed to fetch Access JWKS: ${res.status}`);

  const data = await res.json();
  jwksCache.keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.exp = now + 60 * 60 * 1000; // 1 hour
  return jwksCache.keys;
}

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function verifyAccessJwt(req, env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const expectedAud = env.CF_ACCESS_AUD;

  if (!teamDomain || !expectedAud) {
    return { configured: false };
  }

  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return { configured: true, error: "Missing CF Access JWT" };

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { configured: true, error: "Malformed JWT" };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(headerB64));
    payload = JSON.parse(b64urlToString(payloadB64));
  } catch {
    return { configured: true, error: "Invalid JWT encoding" };
  }

  if (header.alg !== "RS256") {
    return { configured: true, error: `Unsupported JWT alg ${header.alg}` };
  }

  let jwks;
  try {
    jwks = await getJwks(teamDomain);
  } catch (e) {
    return { configured: true, error: `JWKS fetch failed: ${e?.message || e}` };
  }

  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) return { configured: true, error: "JWT kid not found in JWKS" };

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch (e) {
    return { configured: true, error: `Key import failed: ${e?.message || e}` };
  }

  const sig = b64urlToBytes(sigB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    sig,
    data
  );
  if (!ok) return { configured: true, error: "Invalid JWT signature" };

  // Verify audience
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(expectedAud)) {
    return { configured: true, error: "JWT aud mismatch" };
  }

  // Verify expiration
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return { configured: true, error: "JWT expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 30) {
    return { configured: true, error: "JWT not yet valid" };
  }

  // Verify issuer matches the team domain (defence in depth)
  const expectedIssuer = `https://${teamDomain}`;
  if (payload.iss && payload.iss !== expectedIssuer) {
    return { configured: true, error: "JWT iss mismatch" };
  }

  const email = String(payload.email || "").toLowerCase();
  if (!email) return { configured: true, error: "JWT missing email claim" };

  return { configured: true, email };
}

function parseTenants(env) {
  try {
    const arr = JSON.parse(env.TENANTS_JSON || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseSuperAdmins(env) {
  return String(env.SUPER_ADMINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function readCookie(req, name) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return "";
}

async function resolveTenant(req, env) {
  // Prefer cryptographically-verified JWT email when CF Access is configured
  // for strict mode; otherwise fall back to the header that CF Access also
  // injects (trusted only because Access is in front of the worker).
  const verified = await verifyAccessJwt(req, env);
  if (verified.configured && verified.error) {
    return { error: 401, message: `CF Access JWT: ${verified.error}` };
  }

  const email = (
    verified.email ||
    req.headers.get("cf-access-authenticated-user-email") ||
    ""
  ).toLowerCase();

  if (!email) {
    return { error: 401, message: "Missing CF Access email" };
  }

  const tenants = parseTenants(env);
  if (!tenants.length) {
    return { error: 500, message: "No tenants configured (TENANTS_JSON empty)" };
  }

  const superAdmins = parseSuperAdmins(env);
  const isSuperAdmin = superAdmins.includes(email);

  const url = new URL(req.url);

  // Super-admin override: ?as=<slug> or active_tenant cookie or x-tenant header
  if (isSuperAdmin) {
    const overrideSlug = (
      url.searchParams.get("as") ||
      req.headers.get("x-tenant") ||
      readCookie(req, "active_tenant") ||
      ""
    ).trim();

    if (overrideSlug) {
      const t = tenants.find((x) => x.slug === overrideSlug);
      if (t) return { tenant: t, email, isSuperAdmin, availableTenants: tenants };
    }
  }

  // Domain match
  const domain = email.split("@")[1] || "";
  const matches = tenants.filter((t) =>
    Array.isArray(t.domains) &&
    t.domains.map((d) => String(d).toLowerCase()).includes(domain)
  );

  if (matches.length) {
    return {
      tenant: matches[0],
      email,
      isSuperAdmin,
      availableTenants: isSuperAdmin ? tenants : matches,
    };
  }

  // Super-admin with no domain match: default to first tenant so the app loads
  if (isSuperAdmin) {
    return { tenant: tenants[0], email, isSuperAdmin, availableTenants: tenants };
  }

  return { error: 403, message: `No tenant for ${email}` };
}

function getTenantSecret(env, slug) {
  const key = `ZOOM_CLIENT_SECRET_${String(slug).toUpperCase()}`;
  return env[key];
}

async function withTenant(req, env, handler) {
  const r = await resolveTenant(req, env);
  if (r.error) return json(r.error, { error: r.message });
  return handler(req, env, r.tenant);
}

function getHostCacheForTenant(slug) {
  let m = hostCacheByTenant.get(slug);
  if (!m) {
    m = new Map();
    hostCacheByTenant.set(slug, m);
  }
  return m;
}

async function getHostInfo(hostId, accessToken, tenantSlug) {
  if (!hostId) {
    return { name: "Unknown", email: "" };
  }

  const cache = getHostCacheForTenant(tenantSlug);
  if (cache.has(hostId)) return cache.get(hostId);

  try {
    const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log("getHostInfo non-OK", res.status, text);
      const fallback = { name: "Unknown", email: "" };
      cache.set(hostId, fallback);
      return fallback;
    }

    const data = await res.json();

    const name = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Unknown";
    const email = data.email || "";

    const host = { name, email };
    cache.set(hostId, host);
    return host;
  } catch (e) {
    console.log("getHostInfo error", e && e.message ? e.message : e);
    const fallback = { name: "Unknown", email: "" };
    cache.set(hostId, fallback);
    return fallback;
  }
}

async function attachHostsToRecordings(meetings, accessToken, tenantSlug) {
  if (!Array.isArray(meetings) || meetings.length === 0) return [];

  const uniqueHostIds = [...new Set(meetings.map(m => m.host_id).filter(Boolean))];

  await Promise.all(
    uniqueHostIds.map(id => getHostInfo(id, accessToken, tenantSlug))
  );

  return Promise.all(
    meetings.map(async (m) => {
      const host = await getHostInfo(m.host_id, accessToken, tenantSlug);
      return {
        ...m,
        hostName: host.name,
        hostEmail: host.email,
      };
    })
  );
}

async function getZoomAccessToken(env, tenant) {
  if (!tenant || !tenant.slug) {
    throw new Error("getZoomAccessToken called without a tenant");
  }

  const now = Date.now();
  const cached = tokenCacheByTenant.get(tenant.slug);
  if (cached && now < cached.exp - 30_000) {
    return cached.token;
  }

  const clientId = tenant.clientId;
  const accountId = tenant.accountId;
  const clientSecret = getTenantSecret(env, tenant.slug);

  if (!clientId || !accountId || !clientSecret) {
    throw new Error(
      `Tenant ${tenant.slug} is missing Zoom credentials (clientId/accountId/secret)`
    );
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const url = new URL(ZOOM_OAUTH_TOKEN_URL);
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", accountId);

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
  const token = data.access_token;
  const exp = Date.now() + (data.expires_in || 3600) * 1000;
  tokenCacheByTenant.set(tenant.slug, { token, exp });
  return token;
}

/* -------------------- PHONE RECORDINGS -------------------- */

async function handleGetRecordings(req, env, tenant) {
  const url = new URL(req.url);
  const upstreamUrl = new URL(`${ZOOM_API_BASE}/phone/recordings`);

  for (const [key, value] of url.searchParams.entries()) {
    if (key === "as") continue; // strip super-admin tenant override
    upstreamUrl.searchParams.set(key, value);
  }

  const token = await getZoomAccessToken(env, tenant);

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

async function handleDeletePhoneRecording(req, env, tenant) {
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

  const token = await getZoomAccessToken(env, tenant);

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

async function handleGetMeetingRecordingAnalyticsSummary(req, env, tenant) {
  const url = new URL(req.url);
  const meetingId = url.searchParams.get("meetingId") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  if (!meetingId) return json(400, { ok: false, error: "Missing meetingId" });
  if (!from || !to) return json(400, { ok: false, error: "Missing from/to" });

  const token = await getZoomAccessToken(env, tenant);

  const meetingPathId = encodeZoomMeetingId(meetingId);

  const fetchDetails = async (type) => {
    const u = new URL(`${ZOOM_API_BASE}/meetings/${meetingPathId}/recordings/analytics_details`);
    u.searchParams.set("from", from);
    u.searchParams.set("to", to);
    u.searchParams.set("type", type); // REQUIRED: by_view | by_download
    u.searchParams.set("page_size", "300");

    const res = await fetch(u.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok) {
      return { ok: false, status: res.status, raw: text, data };
    }

    return { ok: true, data };
  };

  const byView = await fetchDetails("by_view");
  const byDownload = await fetchDetails("by_download");

  if (!byView.ok && !byDownload.ok) {
    return json(502, {
      ok: false,
      error: "Both analytics calls failed",
      by_view: byView,
      by_download: byDownload,
    });
  }

  const plays = byView.ok ? Number(byView.data?.total_records ?? 0) : 0;
  const downloads = byDownload.ok ? Number(byDownload.data?.total_records ?? 0) : 0;

  // lastAccessDate = max date_time across BOTH sets (if present)
  let last = "";
  const bump = (iso) => {
    const d = String(iso || "");
    if (!d) return;
    // ISO sorts lexicographically well for max comparisons
    if (!last || d > last) last = d;
  };

  const details1 = Array.isArray(byView.data?.analytics_details) ? byView.data.analytics_details : [];
  const details2 = Array.isArray(byDownload.data?.analytics_details) ? byDownload.data.analytics_details : [];

  for (const r of [...details1, ...details2]) bump(r?.date_time);

  const lastAccessDate = last ? String(last).slice(0, 10) : "";

  return json(200, {
    ok: true,
    meetingId,
    plays,
    downloads,
    lastAccessDate,
  });
}


/* -------------------- DELETE MEETING RECORDINGS -------------------- */

async function handleDeleteMeetingRecording(req, env, tenant) {
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

  const token = await getZoomAccessToken(env, tenant);

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

/* -------------------- PHONE VOICEMAILS -------------------- */

async function handleGetVoicemails(req, env, tenant) {
  const url = new URL(req.url);
  const upstreamUrl = new URL(`${ZOOM_API_BASE}/phone/voice_mails`);

  for (const [key, value] of url.searchParams.entries()) {
    if (key === "as") continue;
    upstreamUrl.searchParams.set(key, value);
  }

  // Default to non-trashed unless caller explicitly asks otherwise
  if (!upstreamUrl.searchParams.has("trashed")) {
    upstreamUrl.searchParams.set("trashed", "false");
  }

  const token = await getZoomAccessToken(env, tenant);

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

async function handleDownloadVoicemail(req, env, tenant) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const filename = url.searchParams.get("filename") || "";

  if (!target) return json(400, { error: "Missing 'url' query parameter" });

  let zoomUrl;
  try {
    zoomUrl = new URL(target);
  } catch {
    return json(400, { error: "Invalid URL" });
  }

  if (!zoomUrl.hostname.endsWith("zoom.us")) {
    return json(400, { error: "Blocked URL" });
  }

  const token = await getZoomAccessToken(env, tenant);

  const zoomRes = await fetch(zoomUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const ct = zoomRes.headers.get("content-type");
  const cd = zoomRes.headers.get("content-disposition");

  const headers = new Headers();
  if (ct) headers.set("Content-Type", ct);

  if (cd && /filename=/i.test(cd)) {
    headers.set("Content-Disposition", cd);
  } else if (filename) {
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    headers.set("Content-Disposition", "attachment");
  }

  headers.set("Cache-Control", "private, max-age=0, no-store");

  return new Response(zoomRes.body, {
    status: zoomRes.status,
    headers,
  });
}

async function handleDeleteVoicemail(req, env, tenant) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const voicemailId = body?.voicemailId;
  if (!voicemailId) {
    return json(400, { error: "Missing voicemailId" });
  }

  const token = await getZoomAccessToken(env, tenant);

  const zoomUrl = `${ZOOM_API_BASE}/phone/voice_mails/${encodeURIComponent(voicemailId)}`;

  const zoomRes = await fetch(zoomUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const status = zoomRes.status;
  const text = await zoomRes.text();

  console.log("VOICEMAIL DELETE", {
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

  return json(200, {
    ok: true,
    zoomStatus: status,
    raw: text || null,
  });
}

async function handleUpdateVoicemailStatus(req, env, tenant) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const voicemailId = body?.voicemailId;
  const next = String(body?.status || "").toLowerCase();

  if (!voicemailId) return json(400, { error: "Missing voicemailId" });
  if (next !== "read" && next !== "unread") {
    return json(400, { error: "status must be 'read' or 'unread'" });
  }

  // Zoom expects title-case on this PATCH param
  const readStatus = next === "read" ? "Read" : "Unread";

  const token = await getZoomAccessToken(env, tenant);

  const zoomUrl =
    `${ZOOM_API_BASE}/phone/voice_mails/${encodeURIComponent(voicemailId)}` +
    `?read_status=${readStatus}`;

  const zoomRes = await fetch(zoomUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });

  const status = zoomRes.status;
  const text = await zoomRes.text();

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
    voicemailId,
    status: next,
  });
}

/* --------------------- CONTACT CENTER RECORDINGS -------------------- */

async function handleGetContactCenterRecordings(req, env, tenant) {
  const url = new URL(req.url);
  const upstreamUrl = new URL(`${ZOOM_API_BASE}/contact_center/recordings`);

  for (const [key, value] of url.searchParams.entries()) {
    if (key === "as") continue;
    upstreamUrl.searchParams.set(key, value);
  }

  const token = await getZoomAccessToken(env, tenant);

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
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/* -------------------- DOWNLOAD PROXY FOR CONTACT CENTER RECORDINGS -------------------- */

async function handleDownloadContactCenterRecording(req, env, tenant) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const filename = url.searchParams.get("filename") || "";

  if (!target) return json(400, { error: "Missing 'url' query parameter" });

  let zoomUrl;
  try {
    zoomUrl = new URL(target);
  } catch {
    return json(400, { error: "Invalid URL" });
  }

  // Allow Zoom API host only
  if (!zoomUrl.hostname.endsWith("zoom.us")) {
    return json(400, { error: "Blocked URL" });
  }

  // Lock down allowed CC download paths
  const p = zoomUrl.pathname || "";
  const okPath =
    p.startsWith("/v2/contact_center/recording/download/") ||
    p.startsWith("/v2/contact_center/recording/transcripts/download/");

  if (!okPath) {
    return json(400, { error: "Blocked path" });
  }

  const token = await getZoomAccessToken(env, tenant);

  const zoomRes = await fetch(zoomUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const ct = zoomRes.headers.get("content-type");
  const cd = zoomRes.headers.get("content-disposition");

  const headers = new Headers();
  if (ct) headers.set("Content-Type", ct);

  if (cd && /filename=/i.test(cd)) {
    headers.set("Content-Disposition", cd);
  } else if (filename) {
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    headers.set("Content-Disposition", "attachment");
  }

  headers.set("Cache-Control", "private, max-age=0, no-store");

  return new Response(zoomRes.body, {
    status: zoomRes.status,
    headers,
  });
}

/* -------------------- MEETING RECORDINGS (USER-AGGREGATED, SEARCHABLE) -------------------- */

async function handleGetMeetingRecordings(req, env, tenant) {
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

    const token = await getZoomAccessToken(env, tenant);

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
    const meetingsWithHosts = await attachHostsToRecordings(meetings, token, tenant.slug);

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

async function handleGetMeetingIdentity(req, env, tenant) {
  const accountId = tenant?.accountId || "unknown";

  return new Response(
    JSON.stringify({
      userId: `account:${accountId}`,
      source: "account_recordings",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/* -------------------- DOWNLOAD PROXY (PHONE) -------------------- */

async function handleDownloadRecording(req, env, tenant) {
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

  const token = await getZoomAccessToken(env, tenant);

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

async function handleDownloadMeetingRecording(req, env, tenant) {
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

  const token = await getZoomAccessToken(env, tenant);
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

/* -------------------- Zoom Meeting ID ENCODING HELPERS -------------------- */

function encodeZoomMeetingId(meetingId) {
  // Zoom can be picky with meeting UUIDs that contain "/" etc.
  // Double-encode is the safest default.
  const raw = String(meetingId || "");
  return encodeURIComponent(encodeURIComponent(raw));
}

/* -------------------- /api/me + tenant switch -------------------- */

async function handleMe(req, env) {
  const r = await resolveTenant(req, env);
  if (r.error) return json(r.error, { error: r.message });

  const projectTenant = (t) =>
    t && {
      slug: t.slug,
      displayName: t.displayName || t.slug,
      isProduction: !!t.isProduction,
    };

  return json(200, {
    email: r.email,
    isSuperAdmin: !!r.isSuperAdmin,
    activeTenant: projectTenant(r.tenant),
    availableTenants: (r.availableTenants || []).map(projectTenant),
  });
}

async function handleSwitchTenant(req, env) {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const slug = String(body?.slug || "").trim();
  if (!slug) return json(400, { error: "Missing slug" });

  // Reuse resolution to check super-admin status
  const r = await resolveTenant(req, env);
  if (r.error) return json(r.error, { error: r.message });

  if (!r.isSuperAdmin) {
    return json(403, { error: "Only super-admins can switch tenants" });
  }

  const tenants = parseTenants(env);
  const t = tenants.find((x) => x.slug === slug);
  if (!t) return json(404, { error: `Unknown tenant: ${slug}` });

  // Set cookie. Path=/ so it applies to /api/* and assets. SameSite=Lax keeps it
  // on top-level navigations. Secure because the worker is HTTPS-only.
  const cookie =
    `active_tenant=${encodeURIComponent(slug)}; Path=/; SameSite=Lax; Secure; Max-Age=31536000`;

  return new Response(JSON.stringify({ ok: true, slug }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  });
}

/* -------------------- ROUTER -------------------- */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Identity / tenant switching (no withTenant wrapper — these manage tenant state themselves)
    if (url.pathname === "/api/me" && req.method === "GET") {
      return handleMe(req, env);
    }
    if (url.pathname === "/api/switch-tenant" && req.method === "POST") {
      return handleSwitchTenant(req, env);
    }

    // Phone recordings
    if (url.pathname === "/api/phone/recordings" && req.method === "GET") {
      return withTenant(req, env, handleGetRecordings);
    }
    if (url.pathname === "/api/phone/recordings/download" && req.method === "GET") {
      return withTenant(req, env, handleDownloadRecording);
    }
    if (url.pathname === "/api/phone/recordings/delete" && req.method === "POST") {
      return withTenant(req, env, handleDeletePhoneRecording);
    }

    // Phone voicemails
    if (url.pathname === "/api/phone/voicemails" && req.method === "GET") {
      return withTenant(req, env, handleGetVoicemails);
    }
    if (url.pathname === "/api/phone/voicemails/download" && req.method === "GET") {
      return withTenant(req, env, handleDownloadVoicemail);
    }
    if (url.pathname === "/api/phone/voicemails/delete" && req.method === "POST") {
      return withTenant(req, env, handleDeleteVoicemail);
    }
    if (url.pathname === "/api/phone/voicemails/status" && req.method === "POST") {
      return withTenant(req, env, handleUpdateVoicemailStatus);
    }

    // Meetings
    if (url.pathname === "/api/meeting/recordings/analytics_summary" && req.method === "GET") {
      return withTenant(req, env, handleGetMeetingRecordingAnalyticsSummary);
    }
    if (url.pathname === "/api/meeting/recordings" && req.method === "GET") {
      return withTenant(req, env, handleGetMeetingRecordings);
    }
    if (url.pathname === "/api/meeting/recordings/download" && req.method === "GET") {
      return withTenant(req, env, handleDownloadMeetingRecording);
    }
    if (url.pathname === "/api/meeting/recordings/delete" && req.method === "POST") {
      return withTenant(req, env, handleDeleteMeetingRecording);
    }
    if (url.pathname === "/api/meeting/identity" && req.method === "GET") {
      return withTenant(req, env, handleGetMeetingIdentity);
    }

    // Contact Center
    if (url.pathname === "/api/contact_center/recordings" && req.method === "GET") {
      return withTenant(req, env, handleGetContactCenterRecordings);
    }
    if (url.pathname === "/api/contact_center/recordings/download" && req.method === "GET") {
      return withTenant(req, env, handleDownloadContactCenterRecording);
    }

    // Assets
    if (env.ASSETS) return env.ASSETS.fetch(req);

    return new Response("Recording Explorer backend", { status: 200 });
  },
};

