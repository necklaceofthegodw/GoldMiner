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

### Portal experiment slot

The portal opens the game using query parameters (GET navigation to the game page):

```text
https://game.example/?ChoiceArm=alice&ChoicePlayerId=participant-123&ChoiceStartAt=2026-11-12T12%3A00%3A00Z&ChoiceEndAt=2026-11-12T12%3A10%3A00Z
```

`ChoiceUrl` can replace `ChoiceArm` as documented below. `ChoiceStartAt` and
`ChoiceEndAt` are ISO 8601 timestamps with an explicit timezone; UTC `Z` is
recommended. Encode parameter values with `URLSearchParams`. Aliases `startAt`
and `endAt` are also accepted. Both times are required if either is provided.
Invalid/missing-half/reversed intervals show an error and block gameplay.

Before the start the waiting room counts down and blocks PLAY, keyboard and touch.
The game starts automatically at the start time, once a unique nickname is ready;
opening an already active slot starts immediately. At the end, including when the
page was opened after expiry, gameplay stops and a thank-you screen replaces it.
Controls, upgrades and restarts cannot generate new decisions after expiry.
Boundary checks run in the game loop and input handlers as well as the UI timer,
so returning from a background tab cannot resume an expired slot.

Timing uses the participant computer's clock; keep participant clocks synchronized.
This is a browser-side scheduling mechanism, not server-side enforcement against
modified clients. Already generated decisions in the durable outbox may still be
delivered/retried after slot end; no new decisions are generated then.

When neither time is supplied, the game keeps the standalone five-second start.

The start screen counts down five seconds and starts automatically. PLAY (or
Enter/Space) can start earlier. The game assigns a new `Miner1`, `Miner2`, ... name
to every run using `POST /api/miner-nick`; no nickname input is shown.

Names are reserved globally in a private Vercel Blob store using conditional
writes (ETag compare-and-swap), including concurrent requests from different
computers. Configure server-only `BLOB_READ_WRITE_TOKEN` on Vercel, or in
`.env.local` for Vite development/preview. All deployments sharing the name
sequence must use the same store. Do not delete/reset
`miner-identity/global-counter-v1.json`, which preserves already allocated numbers.
An abandoned page or a lost response can leave gaps, but numbers are not reused.
This is normally one read and one write per reserved name, not per decision.
Existing decision-log deletion endpoints do not delete the identity counter.

Reservation starts during the countdown. If it takes longer, the game waits for
the server; on failure it shows a retry message. It never falls back to a local
counter. Automatic start uses the normal viewport; fullscreen requires a user
gesture. The generated nickname is local log metadata; `X-Player-ID` still comes
from the experiment portal.

Every decision starts a separate POST immediately when its event is consumed by
the game loop. There is no batching or waiting for a level/run to finish. One
request is in flight at a time, as in Batyskaf. The configured URL is the complete
endpoint: its path and trailing slash are preserved, without an appended suffix
(the two known POLSL addresses use the server relay below).
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
| Complete endpoint | `ChoiceUrl` | `VITE_GOLDMINER_CHOICE_URL` |
| POLSL arm: `alice` or `bob` | `ChoiceArm` | `VITE_GOLDMINER_ARM` |
| Game identifier | `ChoiceGameId` | `VITE_GOLDMINER_GAME_ID` (default `goldminer`) |
| Participant identifier | `ChoicePlayerId` | `VITE_GOLDMINER_PLAYER_ID` |

The portal player ID is separate from the automatically assigned nickname and the run
UUID. Neither the nickname nor a generated UUID substitutes for the portal ID.
URL parameters override `window.GOLDMINER_CHOICE_CONFIG`, which overrides Vite
defaults. `.env.example` contains the public defaults; use `.env.local` locally.
Use one endpoint per launch, pointing to the arm assigned by the portal.

For Alice/Bob, use server-side `.env` credentials as described below; no browser
API key is required. The following runtime-credential options apply to custom
direct HTTPS endpoints.

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

For direct custom endpoints, if the endpoint, portal player ID or key is missing/invalid, HTTP is disabled with
a browser-console error on run start; decisions remain in the local detail log.
Custom production endpoints must use HTTPS. HTTP is also accepted for loopback
testing from a non-HTTPS page, and for the two fixed POLSL destinations below.

### POLSL Alice / Bob

| Arm | Decision POST | Health GET |
| --- | --- | --- |
| Alice | `http://157.158.83.183:8001/api/v1/data` | `http://157.158.83.183:8001/api/v1/health` |
| Bob | `http://157.158.83.183:8002/api/v1/data` | `http://157.158.83.183:8002/api/v1/health` |

Portal launch examples (replace the player ID with its portal value):

```text
https://game.example/?ChoiceArm=alice&ChoicePlayerId=participant-123
https://game.example/?ChoiceArm=bob&ChoicePlayerId=participant-456
```

There is no default arm: the portal must select one, or set `VITE_GOLDMINER_ARM`
to `alice` or `bob` in `.env.local` / Vercel environment settings. An explicit
`ChoiceUrl` or configured endpoint takes precedence over the arm profile.
`X-Game-ID` defaults to `goldminer`; `X-Player-ID` is supplied by the portal.
The email's `very-secret-api-key` is a placeholder, not a configured credential.

Configure `.env` in the project root using the same backend variables as BatyskafWeb:

```dotenv
ARM_ALICE_URL=http://157.158.83.183:8001/api/v1/data
ARM_ALICE_API_KEY=
ARM_BOB_URL=http://157.158.83.183:8002/api/v1/data
ARM_BOB_API_KEY=
```

The current Alice/Bob endpoints do not require API keys. Leave both `_API_KEY`
values empty. If a key is configured later, the backend includes `X-API-Key`;
otherwise that header is omitted. Restart Vite after changing `.env`.
The local `.env` is ignored by Git; `.env.example` is the shareable template.
For Vercel, set these same variables in the deployment environment settings.
Changing one project's `.env` does not automatically update the other project.

Both HTTP and HTTPS launches use `POST /api/arm?arm=alice` (or `bob`) on the
game server. The backend reads the selected URL and API key from its environment,
and adds `X-API-Key` only when configured; the portal needs only the arm and participant ID.
Arm credentials are never included in the frontend bundle or launch URL.
The relay forwards one decision at a time without storage, batching or retries.
This adds a network hop and avoids browser mixed-content and arm CORS limitations.
Vercel functions and Vite dev/preview provide the relay; static-only hosting does not.
The server must be allowed to reach POLSL. If POLSL blocks Vercel, host the relay
on a reachable server or arrange network access.

Relay health checks: `GET /api/arm?arm=alice&resource=health` (or `bob`).
They forward the upstream HTTP status and `ok` text. Health is checked manually;
it does not delay each decision. Do not test by posting fabricated experiment bits.

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
The frontend does not call those historical logging endpoints. Only the global
nickname counter uses Blob; decision events go to the arm API through the relay
for Alice/Bob, or directly for custom HTTPS endpoints.

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
