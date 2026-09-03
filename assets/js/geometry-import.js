(function () {
  'use strict';

  if ((document.body.dataset.page || '') !== 'overlays' || !window.L) return;

  const BUILDING_SOURCE = 'https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Building_Outlines_2023_Pictometry/FeatureServer/22/query';
  const CAMPUS_BBOX = {west:-147.8565,south:64.8485,east:-147.8095,north:64.8635};
  const AUTO_SESSION_KEY = 'uaf-auto-footprints-run-v2';
  const originalMap = L.map;
  const api = window.UAFGeometryImport = {map:null,running:false,lastResult:null};

  L.map = function () {
    const map = originalMap.apply(L, arguments);
    const target = arguments[0];
    const id = typeof target === 'string' ? target : target?.id;
    if (id === 'overlay-editor-map') api.map = map;
    return map;
  };
  Object.keys(originalMap).forEach(key => {try {L.map[key] = originalMap[key];} catch (error) {}});

  function read(id, fallback) {
    try {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent || '') : fallback;
    } catch (error) {return fallback;}
  }

  function buildingRows() {
    const base = read('uaf-buildings', []);
    const cfg = read('uaf-config', {});
    const overrides = cfg.buildingOverrides || {};
    const custom = Array.isArray(cfg.customBuildings) ? cfg.customBuildings : [];
    const rows = base.map(row => ({...row,...(overrides[row.id] || {})}));
    const ids = new Set(rows.map(row => row.id));
    custom.forEach(row => {
      if (!row?.id) return;
      const merged = {...row,...(overrides[row.id] || {})};
      if (ids.has(row.id)) {
        const i = rows.findIndex(item => item.id === row.id);
        rows[i] = {...rows[i],...merged};
      } else {
        rows.push(merged);ids.add(row.id);
      }
    });
    return rows;
  }

  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const exact = row => finite(row?.latitude) && finite(row?.longitude);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function polygonArea(coords) {
    if (!Array.isArray(coords) || coords.length < 4) return 0;
    let area = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) area += Number(coords[j][0]) * Number(coords[i][1]) - Number(coords[i][0]) * Number(coords[j][1]);
    return Math.abs(area / 2);
  }

  function bestRing(rings) {
    if (!Array.isArray(rings)) return null;
    let best = null;
    let bestArea = 0;
    for (const candidate of rings) {
      if (!Array.isArray(candidate) || candidate.length < 4) continue;
      const area = polygonArea(candidate);
      if (area > bestArea) {best = candidate;bestArea = area;}
    }
    return best;
  }

  function ring(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;

    // Native ArcGIS FeatureServer JSON: { geometry: { rings: [[[x,y],...]] } }
    if (Array.isArray(geometry.rings)) return bestRing(geometry.rings);

    // GeoJSON support is retained so this importer can also accept future sources.
    if (geometry.type === 'Polygon') return bestRing(geometry.coordinates || []);
    if (geometry.type === 'MultiPolygon') {
      const candidates = [];
      for (const polygon of geometry.coordinates || []) {
        if (Array.isArray(polygon?.[0])) candidates.push(polygon[0]);
      }
      return bestRing(candidates);
    }
    return null;
  }

  function pointInPolygon(lng, lat, coords) {
    let inside = false;
    if (!Array.isArray(coords)) return false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = Number(coords[i][0]), yi = Number(coords[i][1]);
      const xj = Number(coords[j][0]), yj = Number(coords[j][1]);
      const hit = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function xy(lng, lat, originLat) {
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(originLat * Math.PI / 180);
    return [lng * metersPerDegLng, lat * metersPerDegLat];
  }

  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    if (!dx && !dy) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function distanceToRing(lng, lat, coords) {
    if (pointInPolygon(lng, lat, coords)) return 0;
    const [px, py] = xy(lng, lat, lat);
    let best = Infinity;
    for (let i = 1; i < coords.length; i++) {
      const [ax, ay] = xy(Number(coords[i - 1][0]), Number(coords[i - 1][1]), lat);
      const [bx, by] = xy(Number(coords[i][0]), Number(coords[i][1]), lat);
      best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
    }
    return best;
  }

  async function fetchBuildingFootprints() {
    const params = new URLSearchParams({
      where:'1=1',
      geometry:[CAMPUS_BBOX.west,CAMPUS_BBOX.south,CAMPUS_BBOX.east,CAMPUS_BBOX.north].join(','),
      geometryType:'esriGeometryEnvelope',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      outSR:'4326',
      returnGeometry:'true',
      outFields:'OBJECTID',
      resultRecordCount:'2000',
      geometryPrecision:'7',
      f:'json'
    });
    const response = await fetch(BUILDING_SOURCE + '?' + params.toString(), {headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Building footprint source returned ' + response.status + '.');
    const data = await response.json();
    if (data?.error) throw new Error(data.error.message || 'The Fairbanks building service returned an error.');
    if (!Array.isArray(data.features)) throw new Error('Building footprint source did not return polygon features.');
    return data.features.filter(feature => {
      const r = ring(feature);
      return Array.isArray(r) && r.length >= 4 && polygonArea(r) > 0;
    });
  }

  function matchBuildings(features) {
    const rows = buildingRows().filter(exact);
    const used = new Set();
    const matches = [];
    const candidates = features.map((feature, index) => ({feature,index,ring:ring(feature),area:polygonArea(ring(feature))})).filter(candidate => candidate.ring);

    // First pass: a UAF coordinate physically inside a building polygon is a strong match.
    rows.forEach(row => {
      const lng = Number(row.longitude), lat = Number(row.latitude);
      const containing = candidates.filter(candidate => !used.has(candidate.index) && pointInPolygon(lng,lat,candidate.ring)).sort((a,b) => a.area - b.area);
      const best = containing[0];
      if (!best) return;
      used.add(best.index);
      matches.push({record:row,feature:best.feature,ring:best.ring,distance:0,confidence:'inside'});
    });

    const matchedIds = new Set(matches.map(match => match.record.id));

    // Second pass: accept a nearby footprint when the stored point is slightly outside the roof.
    rows.filter(row => !matchedIds.has(row.id)).forEach(row => {
      const lng = Number(row.longitude), lat = Number(row.latitude);
      const ranked = candidates.filter(candidate => !used.has(candidate.index)).map(candidate => ({...candidate,distance:distanceToRing(lng,lat,candidate.ring)})).filter(candidate => candidate.distance <= 60).sort((a,b) => {
        if (a.distance === b.distance) return a.area - b.area;
        return a.distance - b.distance;
      });
      const best = ranked[0];
      if (!best) return;
      used.add(best.index);
      matches.push({record:row,feature:best.feature,ring:best.ring,distance:best.distance,confidence:'nearby'});
    });
    return matches;
  }

  function ensureImportUi() {
    if (document.getElementById('auto-generate-building-outlines')) return true;
    const toolbar = document.querySelector('.overlay-map-toolbar');
    if (!toolbar) return false;
    const holder = document.createElement('div');
    holder.className = 'overlay-auto-generate';
    holder.innerHTML = '<button type="button" id="auto-generate-building-outlines" class="primary-admin">Auto-generate missing building outlines</button><small>Uses Fairbanks North Star Borough 2023 vector building outlines as editable draft geometry. Existing UAF outlines are preserved. Review the matches before publishing.</small>';
    toolbar.insertAdjacentElement('afterend', holder);
    holder.querySelector('button').addEventListener('click', () => importBuildings(false));
    return true;
  }

  function status(message) {
    const node = document.getElementById('overlay-status');
    if (node) node.textContent = message;
  }

  function clickBuildingScope() {
    const button = document.querySelector('[data-scope="building"]');
    if (button && !button.classList.contains('active')) button.click();
    const filter = document.getElementById('overlay-status-filter');
    if (filter && filter.value !== 'all') {
      filter.value = 'all';
      filter.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const search = document.getElementById('overlay-search');
    if (search && search.value) {
      search.value = '';
      search.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }

  function isNeedsOutline(id) {
    const escaped = window.CSS?.escape ? CSS.escape(String(id)) : String(id).replace(/[^a-zA-Z0-9_-]/g,'\\$&');
    const row = document.querySelector('[data-overlay-id="' + escaped + '"]');
    return !!row?.querySelector('.overlay-state.needs');
  }

  async function addMatch(match) {
    const map = api.map;
    if (!map || !isNeedsOutline(match.record.id)) return false;
    const escaped = window.CSS?.escape ? CSS.escape(String(match.record.id)) : String(match.record.id).replace(/[^a-zA-Z0-9_-]/g,'\\$&');
    const row = document.querySelector('[data-overlay-id="' + escaped + '"]');
    if (!row) return false;
    row.click();
    await sleep(12);
    const latlngs = match.ring.map(pair => [Number(pair[1]),Number(pair[0])]);
    if (latlngs.length < 4) return false;
    const layer = L.polygon(latlngs);
    map.fire(L.Draw.Event.CREATED,{layer,layerType:'polygon'});
    await sleep(12);
    return true;
  }

  async function importBuildings(automatic) {
    if (api.running) return;
    if (!api.map) {status('The editor map is still loading. Try again in a moment.');return;}
    api.running = true;
    const button = document.getElementById('auto-generate-building-outlines');
    if (button) button.disabled = true;
    try {
      clickBuildingScope();
      status('Loading current Fairbanks vector building footprints…');
      const features = await fetchBuildingFootprints();
      const matches = matchBuildings(features);
      let added = 0, skipped = 0;
      status('Matched ' + matches.length + ' UAF building records. Creating editable draft outlines…');
      for (const match of matches) {
        if (await addMatch(match)) added += 1; else skipped += 1;
      }
      api.lastResult = {sourceFeatures:features.length,matches:matches.length,added,skipped};
      status((automatic ? 'Automatic footprint import complete. ' : '') + added + ' editable building outline' + (added === 1 ? '' : 's') + ' added to the draft from ' + features.length + ' source footprints. ' + skipped + ' already-mapped/unavailable records were left unchanged. Review the outlines, edit any vertices that need correction, then publish.');
      const draft = document.getElementById('save-overlay-draft');
      if (added && draft) draft.click();
    } catch (error) {
      status('Automatic building outline import failed: ' + (error.message || 'Unknown error') + ' Existing map data was not removed.');
    } finally {
      api.running = false;
      if (button) button.disabled = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!ensureImportUi()) return;
    if (api.map && !sessionStorage.getItem(AUTO_SESSION_KEY)) {
      sessionStorage.setItem(AUTO_SESSION_KEY,'1');
      setTimeout(() => importBuildings(true), 800);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  ensureImportUi();
})();
