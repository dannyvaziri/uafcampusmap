# UAF Campus Map

WCAG 2.2 AA-oriented public-pilot web app for the University of Alaska Fairbanks campus map.

## Hostinger GitHub deployment

Connect this repository directly to a new Hostinger Node.js Web App.

- Repository: `dannyvaziri/uafcampusmap`
- Branch: `main`
- Framework preset: **Vite / React** — do not select Next.js
- Node version: **20.x** or newer supported version
- Root directory: `./`
- Package manager: `npm`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: none required

The `public/.htaccess` file provides SPA fallback for direct visits to `/accessible`, `/print`, and `/admin` when Hostinger serves the Vite output through Apache-compatible hosting.

## Routes

- `/` — interactive campus map
- `/accessible` — searchable text-only alternative
- `/print` — multi-template print center
- `/admin` — read-only data-health dashboard

## Included data

- 67 public UAF building records
- 62 official parking rows/codes
- current parking rates and visitor guidance
- current accessibility resource links
- BusWhere/UAF shuttle links and stop names
- North Campus trail inventory
- 2026 public construction schedule information
- future authoritative GIS layer scaffold

## Accessibility

The app is built toward WCAG 2.2 Level AA with skip navigation, semantic landmarks, labeled controls, keyboard-operable tabs and map markers, live status announcements, accessible dialog focus management, large pointer targets, non-drag map pan controls, reduced-motion support, contrast support, mobile reflow, and a text-only alternative.

Formal conformance should still be verified with human keyboard, zoom/reflow, VoiceOver/NVDA and mobile assistive-technology testing before an institutional certification claim.

## Pilot limitations

The public pilot does not claim authoritative parking/enforcement boundaries, exact entrance geometry, live construction detours, or turn-by-turn accessible routing until UAF Facilities/GIS or operational source data is connected.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```
