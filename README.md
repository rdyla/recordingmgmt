# Zoom Recording Explorer

A multi-tenant admin tool for browsing, downloading, and deleting recordings across a Zoom account. Runs entirely on Cloudflare (one Worker + static SPA), gated by Cloudflare Access.

Sources:

- **Phone recordings** — list, download, delete
- **Meeting recordings** — list (aggregated per-user across the account), download per-file, delete (trash), plus a plays/downloads/last-access analytics column
- **Voicemail** — list, download, delete, mark read/unread, filter by status
- **Contact Center** — list, download (audio + transcript)

Other UX: owner-grouped tables with collapsible groups, a unified download queue with retry/resume (persisted to `localStorage`), per-row download menus, bulk delete with a review modal.

## Architecture

- **Backend** — single file [`_worker.js`](./_worker.js), a Cloudflare Worker. Holds all Zoom API calls; the browser never sees a Zoom token. Uses [Server-to-Server OAuth](https://developers.zoom.us/docs/internal-apps/) (account credentials), not per-user OAuth.
- **Frontend** — React 19 + TypeScript + Vite + Tailwind, served as static assets by the same Worker via the `[assets]` binding in `wrangler.toml`.
- **Auth** — Cloudflare Access in front of the Worker hostname. The Worker cryptographically verifies the `Cf-Access-Jwt-Assertion` header on every request (when `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` are set) and pulls the user's email from the verified JWT claims.

## Tenancy model

Each tenant has its own Zoom S2S app and is isolated end-to-end:

- **Public config** is in `TENANTS_JSON` in [`wrangler.toml`](./wrangler.toml) — `slug`, `displayName`, `accountId`, `clientId`, allowed email `domains`, `isProduction`.
- **Per-tenant client secret** is a wrangler secret named `ZOOM_CLIENT_SECRET_<SLUG_UPPER>` (looked up dynamically by slug). Cloudflare encrypts these at rest.
- **Tenant resolution** — the Worker matches the authenticated user's email domain against `TENANTS_JSON[*].domains`. A `cui.edu` user lands in the `concordia` tenant; a `packetfusion.com` user lands in `packetfusion`.
- **Super-admins** (listed in `SUPER_ADMINS`, comma-separated emails) get a tenant-switcher dropdown in the header and can override via an `active_tenant` cookie. Non-super-admins get exactly one tenant; the override is rejected server-side.
- **Production tenant friction** — when `isProduction: true`, the delete modal requires typing the tenant slug to confirm. A red `PROD` badge in the header makes the active tenant obvious.

Per-tenant token caches (`tokenCacheByTenant`) and host-info caches (`hostCacheByTenant`) prevent cross-tenant leaks.

## Adding a tenant

1. The customer creates a Server-to-Server OAuth app in their Zoom marketplace with the scopes listed below.
2. Add a new entry to `TENANTS_JSON` in `wrangler.toml` with their `accountId`, `clientId`, email `domains`, and whether they're production.
3. Provision the secret:
   ```sh
   npx wrangler secret put ZOOM_CLIENT_SECRET_<SLUG_UPPER>
   # paste the customer's S2S client secret
   ```
4. Add the customer's email domain to the Cloudflare Access policy for the Worker hostname.
5. Deploy:
   ```sh
   npm run build && npx wrangler deploy
   ```

## Required Zoom S2S scopes

Tell the customer their app needs (admin-scoped where applicable):

- `user:read:admin` — listing users to aggregate meeting recordings
- `phone:read:admin` — phone recordings
- `phone:write:admin` (or `phone_recording:delete:admin`) — delete phone recordings
- `phone_voicemail:read:admin` — voicemails
- `phone_voicemail:write:admin` — delete voicemails, mark read/unread
- `recording:read:admin` — per-user meeting recordings
- `recording:write:admin` — delete meeting recordings
- `recording_analytics:read:admin` — meeting analytics
- `contact_center:read:admin` — contact center recordings

Any 401/403 from Zoom in the response body usually means a scope is missing.

## Configuration reference

In `wrangler.toml`:

| Var | Purpose |
| --- | --- |
| `TENANTS_JSON` | Array of tenant configs (see above) |
| `SUPER_ADMINS` | Comma-separated emails that can switch tenants |
| `CF_ACCESS_TEAM_DOMAIN` | e.g. `yourteam.cloudflareaccess.com` — when set, JWT verification is required |
| `CF_ACCESS_AUD` | The Access app's AUD tag from the Zero Trust dashboard |

Per-tenant secrets (one per tenant, set via `npx wrangler secret put`):

| Secret | Purpose |
| --- | --- |
| `ZOOM_CLIENT_SECRET_<SLUG>` | The tenant's Zoom S2S client secret |

## Local dev

```sh
npm install
npm run dev          # Vite dev server (no Worker; API calls will 404)
npm run build        # type-check + production build to dist/
npm run lint
```

For end-to-end local testing of the Worker, use `npx wrangler dev`. Note that without Cloudflare Access in front, the Worker will reject requests in strict mode (`CF_ACCESS_TEAM_DOMAIN` set). Either temporarily blank those vars in a local `.dev.vars` file, or test against the deployed URL.

## Deploy

```sh
npm run build && npx wrangler deploy
```

The build output goes to `dist/`, which `wrangler.toml`'s `[assets]` binding serves as the SPA. The `_worker.js` script handles all `/api/*` routes and falls through to the asset binding for everything else.
