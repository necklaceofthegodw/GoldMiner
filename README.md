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

## Decision CSV Log

- Full decision detail is stored locally on device and can be exported from the game UI as CSV.
- Cloud logging stores only aggregated run summaries (one write per finished run).

### Vercel (phone app) log access

1. In Vercel project settings, add environment variable `BLOB_READ_WRITE_TOKEN`.
2. Add `DECISION_LOG_ADMIN_KEY` to protect admin endpoints.
3. Deploy the project.
4. Open `https://<your-domain>/api/decision-log-view?key=<DECISION_LOG_ADMIN_KEY>`:
   - users summary (runs, wins/fails, aggregated decisions)
   - click a nick to view this player's run summaries
   - delete one user's summaries or all summaries
5. Optional endpoints:
   - `https://<your-domain>/api/decision-log-csv?key=<key>` (cloud CSV of run summaries)
   - `https://<your-domain>/api/decision-users?page=1&limit=200&key=<key>` (JSON user summary)
   - `https://<your-domain>/api/decision-user-log?nick=<nick>&key=<key>` (single user run-summary CSV)

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
