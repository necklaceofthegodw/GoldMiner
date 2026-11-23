# Gold Miner

Gold Miner is a React 19 + Vite canvas game packaged as a Progressive Web App and deployable on Vercel.

## Stack

- React 19
- JavaScript
- Canvas 2D
- Vite
- Manual PWA setup (manifest + service worker)
- Vercel SPA rewrite config

## Gameplay

- 12 levels, each 60 seconds
- Goal-based progression per level
- Classic swinging hook controls
- Resource groups:
  - `1`: Gold
  - `0`: Diamond + Mystery
- Balanced economy: Gold total is matched against Diamond + Mystery total every level
- Mystery outcomes:
  - Big payout
  - Small payout
  - Time bonus + payout
  - Empty crate
- Binary decisions are inferred and logged while playing
- Between-level upgrade shop with permanent upgrades and consumables
- Vault currency earned from successful level clears
- Built-in sound effects via Web Audio API
- Persistent save data in `localStorage` (progress, upgrades, vault, stats, settings)

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

## Offline Deployment (Windows laptops without internet)

The game runs fully offline from `vite preview`: all assets are bundled locally and
the local API routes (`/api/launch`, `/api/arm`, `/api/decision-log`) are served by
the preview server. Decisions sent to an unreachable arm stay queued in the browser's
localStorage outbox and are retried.

### 1. Prepare (on a machine with internet)

- Install Node.js (20.19+ or 22.12+, required by Vite 8) on the preparing machine.
- Double-click **`publish.bat`** (or run `scripts\publish.ps1`). It:
  - builds the app (`npm run build`),
  - downloads the portable Node.js 26 zip (`win-x64`) from nodejs.org, verifies its
    SHA256 and caches it in `.cache/node/`,
  - creates `publish/` with `dist/`, the API files needed by `vite preview`,
    `start.bat`, `portal_launch_test.html`, `.env.example`, the portable Node.js in
    `publish/node/` and all modules installed by `npm ci` with that Node.js.
  Existing `publish/logs/` are kept. Options: `-NodeMajor 26 -Arch win-x64 -OutDir publish`.
- `.env` is **not** copied. Without it the default arm URLs are used without API keys;
  create `publish/.env` from `.env.example` on the target if keys are needed.
- Copy the **whole `publish` folder** to each laptop. Nothing has to be installed there.

### 2. Run (on the offline laptop)

Double-click **`start.bat`** in the copied folder. It uses the bundled `node\node.exe`
(falling back to a system Node.js), checks that `node_modules` is present,
builds `dist` if missing, and starts the server at `http://localhost:4173`
(it does not open a browser). Close the window or press Ctrl+C to stop it.
Decision CSV logs are written to the `logs/` folder next to `start.bat`.

To let another computer in the local network connect, add `--host` at the end of the
`vite preview` line in `start.bat`, open `http://<server-IP>:4173` on the other
computer, and allow Node.js in Windows Firewall (private network) when prompted.

### 3. Test a portal launch

Open **`portal_launch_test.html`** in a browser (directly from disk). It is a minimal
form that POSTs the five launch fields to `<server>/api/launch`:

- `server` – game server address (default `http://localhost:4173`), not sent in the POST.
- `startAt` / `endAt` – prefilled to now +1 min / now +3 min (a 2-minute slot starting
  in 1 minute). Click **now +1 / +3 min** to recalculate before submitting.
- `playerId`, `armEndpoint`, `returnEndpoint` – editable test values.

Without a portal launch, opening the game URL directly starts standalone play
after a five-second countdown.

## Portal launch and decision API

The portal navigates the participant browser by **POST to `/api/launch`**.
The body contains only these five fields:

```json
{
  "playerId": "participant-123",
  "armEndpoint": "http://157.158.83.183:8001/api/v1/data",
  "returnEndpoint": "https://portal.example/",
  "startAt": "2026-11-13T12:00:00Z",
  "endAt": "2026-11-13T12:10:00Z"
}
```

Dates use ISO 8601 with a timezone (UTC `Z` recommended). The interval must exceed
10 seconds. JSON and `application/x-www-form-urlencoded` are accepted. For browser
navigation, submit an HTML form with `method="post"`, `action="https://GAME/api/launch"`
and five hidden inputs. A background server-to-server POST or fetch alone will
not open the participant's game: the returned HTML must run in their browser.
The response stores the launch in this tab's sessionStorage and navigates to `/`.
Invalid launches return HTTP 400. Old `Choice*` URL parameters are no longer read.

The waiting room blocks controls before `startAt`, then starts automatically.
Joining an active slot starts immediately.
At **`endAt - 10 seconds`**, gameplay and generation of new decisions stop and a
summary shows the maximum level reached and total money collected during this
slot, including unfinished levels and runs before a restart. Shop purchases do
not subtract from the amount earned. At **`endAt`**, the browser automatically
navigates to `returnEndpoint`; no results POST is sent to the portal.
Opening an expired slot immediately returns to the portal. Checks also run in
input handlers and the game loop to prevent play after a background tab resumes.
Timing uses the participant computer's clock; clocks must be synchronized.
Pending bits generated before the cutoff may still be delivered/retried afterward.
Without a portal launch, standalone play keeps its five-second automatic start.

### Backend `.env` (same names as BatyskafWeb)

```dotenv
ARM_ALICE_URL=http://157.158.83.183:8001/api/v1/data
ARM_ALICE_API_KEY=
ARM_BOB_URL=http://157.158.83.183:8002/api/v1/data
ARM_BOB_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

`.env` is ignored by Git. `.env.example` is the template. Restart Vite after edits;
on Vercel set these variables in project settings and deploy. Arm API keys stay
on the backend and are included as `X-API-Key` when set. The game ID is `goldminer`.
The browser forwards decisions through `/api/arm?armEndpoint=...`, using the exact
portal destination. To prevent an open proxy, that destination must match one
of `ARM_ALICE_URL` / `ARM_BOB_URL` (defaults above); unknown destinations are rejected.
There is no extra arm name, game ID or API key required from the portal.
The backend must have network access to POLSL. The relay is supported in Vite
dev/preview and Vercel functions, and adds one network hop without storing bits.

Each decision is a separate POST, with `X-Game-ID`, `X-Player-ID`, optional
`X-API-Key`, and `Content-Type: application/json`:

```json
{
  "bit": 1,
  "timestamp_generation": "2026-11-13T12:00:15.123Z",
  "metadata": {
    "session_id": "37b948a6-607f-4260-8333-46577275e847",
    "sequence": "1",
    "game_time": 15.1
  }
}
```

Every HTTP 2xx acknowledges receipt. The durable localStorage outbox sends one
request at a time; timeouts, network errors, 408, 429 and 5xx retry with backoff.
Retries can duplicate deliveries if an ACK was lost; receivers should deduplicate
by session_id + sequence. Nicknames are local log metadata, not portal player IDs.

### Nicknames

No nickname input is shown. Each run gets a random UUID nickname generated in the
browser (`src/game/minerIdentity.js`), with a `crypto.getRandomValues` fallback so it
also works over plain HTTP. It is only used in the local decision log. The
`/api/miner-nick` counter endpoint still exists but is no longer used by the client.

### Verification

`npm test`, `npm run lint`, `npm run build`.
Manual arm health checks (no experimental bits sent):
`GET /api/arm?arm=alice&resource=health` or `arm=bob`.
Tests use mocked receivers and never send bits to production arms.

## PWA Notes

- Manifest: `public/manifest.webmanifest`
- Service worker: `public/service-worker.js`
- Install prompt handled in `src/App.jsx`
- Service worker registration: `src/registerServiceWorker.js`

## Deploy To Vercel

This repo includes `vercel.json` with:

- SPA rewrites to `index.html`
- No-cache header for `service-worker.js`

On Vercel:

1. Import the repository.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Deploy.

## Icon Attribution

The gameplay/shop icons use these Flaticon assets (free use with attribution), bundled locally in `public/assets/icons/`:

- Gold Nugget: https://www.flaticon.com/free-icon/gold-nugget_7969089
- Stone: https://www.flaticon.com/free-icon/stone_4746599
- Diamond: https://www.flaticon.com/free-icon/diamond_408472
- Mystery Item: https://www.flaticon.com/free-icon/money_15614073
- Time Boost (Clock): https://www.flaticon.com/free-icon/clock_17742561
- Turbo Winch (Strength): https://www.flaticon.com/free-icon/arm-muscle_4721089

Additional local assets used:

- Hook icon: `public/assets/icons/claw-machine.png` (provided in-project)
- Mystery Scanner shop icon: `public/assets/icons/mystery-crate.svg` (project-created)
