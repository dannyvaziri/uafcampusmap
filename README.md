# UAF Campus Map

WCAG 2.2 AA-oriented public-pilot web app for the University of Alaska Fairbanks campus map.

## Hostinger GitHub deployment

Connect this repository directly to a Hostinger Node.js Web App.

- Repository: `dannyvaziri/uafcampusmap`
- Branch: `main`
- Framework preset: **Vite / React** — do not select Next.js
- Node version: **20.x** or newer supported version
- Root directory: `./`
- Package manager: `npm`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: none required for the current admin model

The `public/.htaccess` file provides SPA fallback for direct visits to `/accessible`, `/print`, and `/admin` when Hostinger serves the Vite output through Apache-compatible hosting.

## Routes

- `/` — interactive campus map
- `/accessible` — searchable text-only alternative
- `/print` — multi-template print center
- `/admin` — map management console

## Admin map management console

The admin console is intentionally not linked in the public header. Open `/admin` directly.

It can manage:

- existing building public name, official name, abbreviation, category and address
- marker latitude/longitude, draggable map position, marker label and marker color
- building visibility, search words, services and recommended parking
- custom map-only buildings
- custom GeoJSON polygons, rectangles, lines and points using a visual Leaflet drawing editor
- shape name, building association, stroke/fill colors, line width, fill opacity and visibility
- public site title/subtitle and pilot/accessibility notice
- search wording and public contact details
- UAF/public map colors
- default map center and zoom
- public information-tab visibility
- popular destination shortcuts
- full advanced configuration JSON
- local browser draft save/load
- JSON import/export and backups

### Publishing from the admin console

The current architecture is deliberately backendless. Published map settings are stored in `public/map-config.json` in this GitHub repository. The public app loads that file at runtime and Hostinger also receives the normal GitHub deployment update.

To publish from `/admin`, create a **fine-grained GitHub personal access token** with:

- Repository access: **Only select repositories → uafcampusmap**
- Repository permission: **Contents → Read and write**

Paste the token into the Publish section only when needed. The token is held only in React memory for that browser session. It is **not** written to localStorage, `.env`, the repository, map configuration, or generated site files.

Publishing commits only `public/map-config.json` to `main`, providing a GitHub audit/revision history for public-map configuration changes.

This is not the same as enterprise user authentication. If UAF later requires SSO, role-based editors, multi-user approvals, or non-GitHub administrators, add an authenticated backend/CMS and keep the same public configuration schema.

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

The admin console uses native form controls, visible labels/focus states and keyboard-accessible editing wherever possible. The Leaflet visual shape editor is an enhancement; the full GeoJSON can also be edited/imported through the Advanced JSON section without relying on pointer drawing.

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
