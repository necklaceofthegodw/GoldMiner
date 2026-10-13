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

## Decision HTTP API (Batyskaf arm protocol)

Every decision starts a separate POST immediately when its event is consumed by
the game loop. There is no batching or waiting for a level/run to finish. One
request is in flight at a time, as in Batyskaf. The configured URL is the complete
endpoint: its path and trailing slash are preserved, without an appended suffix.
The frontend no longer sends decisions or run summaries to Vercel Blob.

```http
POST /configured/path/ HTTP/1.1
Content-Type: application/json
X-Game-ID: goldminer
X-Player-ID: participant-id-from-portal
X-API-Key: runtime-credential

{
  "bit": 1,
  "timestamp_generation": "2026-10-13T10:20:15.123Z",
  "metadata": {
    "session_id": "37b948a6-607f-4260-8333-46577275e847",
    "sequence": "1",
    "game_time": 42.5
  }
}
```

`bit` is the number 0 or 1. `timestamp_generation` is captured in UTC by the
engine when the decision occurs. `metadata.sequence` is a **string**, starting
from `"1"` for each new run; `metadata.game_time` is elapsed time since the run
started, in **seconds**, including time in the shop. Retries and recovery preserve
the original timestamp, session, sequence and body. There is no Bearer header or
ACK JSON requirement: every HTTP 2xx, including an empty 202/204, confirms receipt.

The existing decision rules are unchanged: collecting gold, diamond or mystery
produces 1; rock or a missed hook produces 0. Leaving the shop produces one bit:
1 if anything was bought, otherwise 0. A decision is recorded on the outcome,
not on the initial hook-launch button press.

### Portal launch configuration

The browser equivalent of Batyskaf's launch arguments is:

| Setting | URL query parameter | Public build default |
| --- | --- | --- |
| Complete HTTPS endpoint | `ChoiceUrl` | `VITE_GOLDMINER_CHOICE_URL` |
| Game identifier | `ChoiceGameId` | `VITE_GOLDMINER_GAME_ID` (default `goldminer`) |
| Participant identifier | `ChoicePlayerId` | `VITE_GOLDMINER_PLAYER_ID` |

The portal player ID is separate from the locally entered nickname and the run
UUID. Neither the nickname nor a generated UUID substitutes for the portal ID.
URL parameters override `window.GOLDMINER_CHOICE_CONFIG`, which overrides Vite
defaults. `.env.example` contains the public defaults; use `.env.local` locally.
Use one endpoint per launch, pointing to the arm assigned by the portal.

Credentials are runtime-only. Do not put the API key in `VITE_*` variables, source
code or query parameters. The portal integration may supply an API-supported
credential in a URL fragment named `ChoiceApiKey` (URL-encode every value):

```text
https://game.example/?ChoiceUrl=https%3A%2F%2Farm.example%2F&ChoicePlayerId=participant-123&ChoiceGameId=goldminer#ChoiceApiKey=runtime-credential
```

This is a prepared launch interface, not an assumption that the portal already
implements it. The game consumes and removes `ChoiceApiKey` from the current URL
and retains it only in memory. A reload must obtain a credential again (e.g. a
fresh launch from the portal) to resume pending transmissions. Fragments are not
sent as part of the HTTP page request, but are still accessible to the browser
user and scripts on the page. A credential sent by browser JavaScript is visible
to the participant; use a scoped credential if the API supports one. A shared
secret that must remain confidential requires a trusted server-side relay instead
of direct browser-to-arm requests.

Alternatively, the host serving the game can set the following runtime object
**before the app module loads** (the key must not be committed into static HTML):

```js
window.GOLDMINER_CHOICE_CONFIG = {
  endpoint: "https://arm.example/configured/path/",
  gameId: "goldminer",
  playerId: "participant-id-from-portal",
  apiKey: "runtime-credential",
};
```

If the endpoint, portal player ID or key is missing/invalid, HTTP is disabled with
a browser-console error on run start; decisions remain in the local detail log.
Production endpoints must use HTTPS. HTTP is accepted only for loopback testing
from a non-HTTPS page (`localhost`, `127.0.0.1`, `::1`).

### Receiver requirements and retries

For cross-origin requests, the arm API must support unauthenticated CORS
preflight `OPTIONS` and include CORS headers on success **and error** responses:

```http
Access-Control-Allow-Origin: https://your-game-domain.example
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Game-ID, X-Player-ID, X-API-Key
Vary: Origin
```

The allowed origin is the **game's** origin after portal navigation. The receiver
must accept POST at the configured URL without redirecting to a different path.
Batyskaf's native test receiver does not provide browser CORS configuration;
enable it on your actual API before testing from a browser.

- Before transmission, each decision is stored under its own `localStorage` key
  prefixed `goldminer:choice-http:outbox:v1:`. Credentials are not persisted.
- Recovery sends only records matching the configured endpoint, game and portal
  player. Records belonging to other launches and the old detail log are retained
  without reassignment or automatic upload.
- Timeout (5 seconds), network errors, HTTP 408, 429 and 5xx retry after 0.5, 1, 2,
  4, 8, then at most 10 seconds. New bits may pass an older bit awaiting retry,
  matching Batyskaf. Other 4xx block the record until configuration/server repair
  and a new page load; the record stays in the outbox.
- Successful receipt removes the outbox record. Cleanup failure retries only
  local cleanup, not the already acknowledged POST, while the page stays open.
- If storage is unavailable/full, transmission waits for successful persistence;
  memory-only records can be lost when the page closes. Retry timers run while
  the page is active; this is not a background-delivery guarantee after closing.
- As in Batyskaf, delivery is **at least once**, without a deduplication guarantee.
  Losing a response or restarting before local cleanup can produce a duplicate.
  The receiver can identify duplicates by `metadata.session_id` and `sequence`.
- The separate local detail log retains up to 12,000 entries; its CSV export
  helper remains available in `decisionLogClient.js`, without a UI export button.

The existing `api/decision-*` handlers remain for access to historical Vercel Blob
logs (admin access still requires `DECISION_LOG_ADMIN_KEY` and the Blob token).
The new frontend does not call them and generates no Blob writes.

### Verification

```bash
npm test
npm run lint
npm run build
```

Tests cover the Batyskaf payload/headers, immediate one-bit requests, ACKs, timeout
and backoff, durable recovery, identity separation, storage errors and launch
configuration. Tests use isolated storage and do not contact the production arm.

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

The gameplay/shop icons use these external assets (Flaticon free use with attribution):

- Gold Nugget: https://www.flaticon.com/free-icon/gold-nugget_7969089
- Stone: https://www.flaticon.com/free-icon/stone_4746599
- Diamond: https://www.flaticon.com/free-icon/diamond_408472
- Mystery Item: https://www.flaticon.com/free-icon/money_15614073
- Time Boost (Clock): https://www.flaticon.com/free-icon/clock_17742561
- Turbo Winch (Strength): https://www.flaticon.com/free-icon/arm-muscle_4721089

Additional local assets used:

- Hook icon: `public/assets/icons/claw-machine.png` (provided in-project)
- Mystery Scanner shop icon: `public/assets/icons/mystery-crate.svg` (project-created)
