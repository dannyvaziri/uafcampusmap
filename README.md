# UAF Campus Map

University of Alaska Fairbanks campus-map implementation built for a standard PHP/Apache host and future ModernCampus OMNI integration.

## Production architecture

The production runtime is intentionally simple:

- PHP 8.5
- Apache / `.htaccess`
- HTML and CSS
- Vanilla JavaScript
- Leaflet and Leaflet Draw loaded from CDN
- ArcGIS imagery configuration already stored in the map configuration
- JSON content/data files
- No React runtime
- No Vite runtime
- No npm install or Node.js production build

The old development artifacts that may still exist in repository history are not part of the PHP runtime. Do not reconnect Hostinger as a Node/Vite application.

## Hostinger deployment

Deploy the repository as a PHP website using:

- Repository: `dannyvaziri/uafcampusmap`
- Branch: `main`
- Deployment directory: `public_html`
- PHP version: `8.5`
- Build command: none
- Output/build directory: none

Hostinger should pull the repository files directly into the PHP document root. The root `.htaccess` supplies the clean public routes.

## Public routes

- `/` — interactive campus map
- `/accessible` — searchable text-only alternative
- `/print` — print and direct-PDF page
- `/admin` — numbered map editor
- `/admin/images` — PNG overlay editor

Equivalent PHP entry files are retained for OMNI portability:

- `/index.php`
- `/accessible.php`
- `/print.php`
- `/admin/index.php`
- `/admin/images.php`

## OMNI-friendly layout

The current runtime is organized so shared pieces can later become ModernCampus OMNI includes/content blocks:

- `/includes/bootstrap.php` — data loading, route/page setup, cache versioning
- `/includes/header.php` — shared UAF header/navigation
- `/includes/footer.php` — shared footer and page-specific script loading
- `/assets/css/omni.css` — all application and print styling
- `/assets/js/app.js` — all browser behavior
- `/assets/images/` — UAF assets
- `/data/` — building, parking, metadata and map configuration JSON

No compiled asset directory is required.

## Map data and ArcGIS

`data/map-config.json` is the published editable map configuration. It contains the existing ArcGIS imagery configuration used by the site. Treat that configuration as sensitive operational configuration: preserve it, do not copy it into documentation, issues, screenshots or public support messages, and do not replace it during routine editor work.

The public map merges the base building and parking JSON files with overrides/custom records from `data/map-config.json`.

## Admin workflow

`/admin` follows a simple three-step model:

1. **Choose** — Building, Parking, Shape/Area, Words, Appearance, Layers or Advanced.
2. **Edit** — Update fields and, where applicable, edit markers/geometry directly with Leaflet.
3. **Publish** — Validate the draft, save locally, test GitHub access, and publish the JSON configuration.

Building editing includes names, official name, abbreviation/marker label, category, address, latitude/longitude, services, recommended parking, marker color, visibility and building footprint.

Parking editing includes code, name, type, restrictions, visibility and boundary geometry.

The visual shape editor supports polygons, rectangles, lines and points. Invalid/collapsed geometry is not rendered publicly.

### Browser drafts

Drafts are stored only in the current browser using `localStorage`. Saving a draft does not alter the public map.

### GitHub publishing

Publishing from the admin uses GitHub's Contents API to update only:

`data/map-config.json`

on branch `main`.

Use a fine-grained GitHub personal access token restricted to this repository with:

- Repository access: **Only select repositories → uafcampusmap**
- Repository permission: **Contents → Read and write**

The token is stored only in `sessionStorage` for the browser session. It is not written into the map configuration, repository, browser draft or generated output.

After GitHub accepts the change, a Hostinger Git deployment connected to `main` should redeploy the PHP site automatically.

## PNG overlay editor

`/admin/images` supports:

1. Upload a PNG (maximum 2 MB).
2. Position it with the center drag handle and resize it with corner handles.
3. Set name, opacity and visibility, then save a browser draft or publish the configuration to GitHub.

PNG image data and geographic bounds are stored in the JSON configuration. Transparent PNGs are recommended.

## Print and PDF

`/print` keeps **Print** and **Save PDF** as separate actions.

- **Print** prepares a static map snapshot and opens the browser's native print dialog.
- **Save PDF** creates and downloads a PDF directly in the browser.

Supported paper sizes:

- 11×17 landscape
- 8.5×11 landscape

The page supports the full main campus or a selected/current map area and includes building names, parking, map shapes/PNGs, road/reference labels, scale, coordinate grid, north arrow, map key and UAF branding. The layout is based on the established UAF campus-map print convention while using the current live map data.

Downloaded filenames are intentionally short:

- `UAF-map-11x17.pdf`
- `UAF-map-letter.pdf`

## Data currently included

- 67 base UAF building records
- 62 base parking records
- current parking guidance and rates in the metadata file
- accessibility resource links
- shuttle and BusWhere links
- North Campus trail inventory
- published 2026 construction schedule information
- configurable building/parking overrides, custom shapes and PNG overlays

Authoritative GIS should replace provisional geometry as verified UAF Facilities/GIS data becomes available.

## Accessibility

The interface is built toward WCAG 2.2 Level AA, including keyboard-operable tabs, visible focus, labeled form controls, live status messages, keyboard-enabled Leaflet maps, non-drag pan controls, dialog focus handling, reduced-motion support and a text-only route.

Formal institutional conformance still requires human keyboard, zoom/reflow, screen-reader, touch/mobile and final PDF testing.

## Repository checks

GitHub Actions performs PHP syntax checks, JSON validation and runtime-structure checks. There is no npm install and no production build step.
