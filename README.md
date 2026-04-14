# Binary Miner

Binary Miner is a React 19 + Vite canvas game packaged as a Progressive Web App and deployable on Vercel.

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
