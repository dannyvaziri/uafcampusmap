(function () {
  'use strict';

  if ((document.body.dataset.page || '') !== 'overlays') return;

  const SOURCE = 'https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Building_Outlines_2023_Pictometry/FeatureServer/22/query';
  const BBOX = {west:-147.8565,south:64.8485,east:-147.8095,north:64.8635};
  const api = window.UAFGeometryImport = {running:false,lastResult:null,ranAutomatically:false,runManual:null};
  let manager = null;
  let sourceCache = null;
  let sourceMode = '';
  let runSequence = 0;
  const activeControllers = new Set();

  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const exact = row => finite(row?.latitude) && finite(row?.longitude);

  function polygonArea(coords) {
    if (!Array.isArray(coords) || coords.length < 4) return 0;
    let area = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      area += Number(coords[j][0]) * Number(coords[i][1]) - Number(coords[i][0]) * Number(coords[j][1]);
    }
    return Math.abs(area / 2);
  }

  function bestRing(rings) {
    if (!Array.isArray(rings)) return null;
    let best = null;
    let area = 0;
    for (const candidate of rings) {
      if (!Array.isArray(candidate) || candidate.length < 4) continue;
      const next = polygonArea(candidate);
      if (next > area) {best = candidate;area = next;}
    }
    return best;
  }

  function ring(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    if (Array.isArray(geometry.rings)) return bestRing(geometry.rings);
    if (geometry.type === 'Polygon') return bestRing(geometry.coordinates || []);
    if (geometry.type === 'MultiPolygon') {
      const rows = [];
      for (const polygon of geometry.coordinates || []) if (Array.isArray(polygon?.[0])) rows.push(polygon[0]);
      return bestRing(rows);
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
    return [lng * 111320 * Math.cos(originLat * Math.PI / 180), lat * 111320];
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

  function promoteImporter() {
    const slot = document.getElementById('overlay-importer-slot');
    const summary = document.getElementById('overlay-summary');
    if (slot && summary && slot.previousElementSibling !== summary) summary.insertAdjacentElement('afterend', slot);
  }

  function renderPanel(statusText, result) {
    promoteImporter();
    const slot = document.getElementById('overlay-importer-slot');
    if (!slot) return;
    const r = result || api.lastResult;
    const stats = r ? '<dl class="overlay-import-stats">' +
      '<div><dt>UAF buildings</dt><dd>' + r.totalBuildings + '</dd></div>' +
      '<div><dt>Already outlined</dt><dd>' + r.alreadyOutlined + '</dd></div>' +
      '<div><dt>Source footprints</dt><dd>' + r.sourceFeatures + '</dd></div>' +
      '<div><dt>Matched</dt><dd>' + r.matches + '</dd></div>' +
      '<div><dt>Added to draft</dt><dd>' + r.added + '</dd></div>' +
      '<div><dt>Unmatched</dt><dd>' + r.unmatched + '</dd></div>' +
      '<div><dt>Needs review</dt><dd>' + r.needsReview + '</dd></div>' +
      '<div><dt>Still missing</dt><dd>' + r.remaining + '</dd></div>' +
      '</dl>' : '';
    const source = r?.sourceMode || sourceMode;
    const sourceText = source ? '<span class="overlay-import-source">Source path: ' + (source === 'hostinger-proxy' ? 'Hostinger proxy' : 'direct ArcGIS fallback') + '</span>' : '';
    const buttonLabel = api.running ? 'Working… tap to restart' : 'Auto-generate missing building outlines';
    slot.innerHTML = '<section class="overlay-import-card"><div><strong>Automatic building outlines</strong><p id="overlay-import-status">' + (statusText || 'Ready to check the current FNSB building-footprint source.') + '</p>' + sourceText + '</div><button type="button" id="auto-generate-building-outlines" class="primary-admin" aria-busy="' + (api.running ? 'true' : 'false') + '">' + buttonLabel + '</button>' + stats + '<small>Generated polygons are saved only to the browser draft and marked <strong>Needs review</strong>. Existing UAF outlines are never replaced automatically.</small></section>';
  }

  function cancelActive() {
    for (const controller of activeControllers) {
      try {controller.abort();} catch (error) {}
    }
    activeControllers.clear();
  }

  async function fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    activeControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {...(options || {}), signal:controller.signal, cache:'no-store'});
      let data = null;
      try {data = await response.json();} catch (error) {}
      if (!response.ok) throw new Error((data && data.error) || ('Request failed (' + response.status + ').'));
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Request timed out or was restarted.');
      throw error;
    } finally {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  }

  function normalizeFeatures(data) {
    if (!Array.isArray(data?.features)) return [];
    return data.features.filter(feature => {
      const r = ring(feature);
      return Array.isArray(r) && r.length >= 4 && polygonArea(r) > 0;
    });
  }

  async function fetchViaProxy() {
    const data = await fetchJson('/admin/footprints.php?ts=' + Date.now(), {credentials:'same-origin', headers:{Accept:'application/json'}}, 9000);
    if (!data?.ok) throw new Error(data?.error || 'Hostinger footprint proxy returned an invalid response.');
    const features = normalizeFeatures(data);
    if (!features.length) throw new Error('Hostinger footprint proxy returned no usable campus polygons.');
    sourceMode = 'hostinger-proxy';
    return features;
  }

  async function fetchDirect() {
    const params = new URLSearchParams({
      where:'1=1',
      geometry:[BBOX.west,BBOX.south,BBOX.east,BBOX.north].join(','),
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
    const data = await fetchJson(SOURCE + '?' + params.toString(), {credentials:'omit', mode:'cors', headers:{Accept:'application/json'}}, 12000);
    if (data?.error) throw new Error(data.error.message || 'ArcGIS returned an error.');
    const features = normalizeFeatures(data);
    if (!features.length) throw new Error('ArcGIS returned no usable campus polygons.');
    sourceMode = 'direct-arcgis';
    return features;
  }

  async function fetchSource(forceFresh) {
    if (sourceCache && !forceFresh) return sourceCache;
    if (forceFresh) sourceCache = null;
    let proxyError = null;
    try {
      sourceCache = await fetchViaProxy();
      return sourceCache;
    } catch (error) {
      proxyError = error;
      renderPanel('Hostinger footprint lookup was unavailable. Trying the ArcGIS source directly…');
    }
    try {
      sourceCache = await fetchDirect();
      return sourceCache;
    } catch (directError) {
      throw new Error('Both footprint sources failed. Hostinger: ' + (proxyError?.message || 'unknown error') + ' Direct ArcGIS: ' + (directError?.message || 'unknown error'));
    }
  }

  function candidateRows(features) {
    return features.map((feature,index) => ({feature,index,ring:ring(feature),area:polygonArea(ring(feature)),sourceObjectId:String(feature?.attributes?.OBJECTID || feature?.properties?.OBJECTID || '')})).filter(row => row.ring);
  }

  function reserveExisting(candidates, rows) {
    const used = new Set();
    const existing = rows.filter(row => exact(row) && manager.hasBuildingShape(row.id));
    for (const row of existing) {
      const lng = Number(row.longitude), lat = Number(row.latitude);
      const containing = candidates.filter(candidate => !used.has(candidate.index) && pointInPolygon(lng,lat,candidate.ring)).sort((a,b) => a.area-b.area)[0];
      if (containing) {used.add(containing.index);continue;}
      const nearby = candidates.filter(candidate => !used.has(candidate.index)).map(candidate => ({...candidate,distance:distanceToRing(lng,lat,candidate.ring)})).filter(candidate => candidate.distance <= 15).sort((a,b) => a.distance-b.distance)[0];
      if (nearby) used.add(nearby.index);
    }
    return used;
  }

  function matchBuildings(features) {
    const rows = manager.getBuildings().filter(exact);
    const candidates = candidateRows(features);
    const used = reserveExisting(candidates, rows);
    const matches = [];
    const missing = rows.filter(row => !manager.hasBuildingShape(row.id));

    for (const row of missing) {
      const lng = Number(row.longitude), lat = Number(row.latitude);
      const containing = candidates.filter(candidate => !used.has(candidate.index) && pointInPolygon(lng,lat,candidate.ring)).sort((a,b) => a.area-b.area);
      const best = containing[0];
      if (!best) continue;
      used.add(best.index);
      matches.push({record:row,feature:best.feature,ring:best.ring,sourceObjectId:best.sourceObjectId,distance:0,confidence:'inside'});
    }

    const matchedIds = new Set(matches.map(item => item.record.id));
    for (const row of missing.filter(item => !matchedIds.has(item.id))) {
      const lng = Number(row.longitude), lat = Number(row.latitude);
      const ranked = candidates.filter(candidate => !used.has(candidate.index)).map(candidate => ({...candidate,distance:distanceToRing(lng,lat,candidate.ring)})).filter(candidate => candidate.distance <= 45).sort((a,b) => a.distance-b.distance || a.area-b.area);
      const best = ranked[0], second = ranked[1];
      if (!best) continue;
      const separated = !second || second.distance - best.distance >= 8;
      if (best.distance > 12 && !separated) continue;
      used.add(best.index);
      matches.push({record:row,feature:best.feature,ring:best.ring,sourceObjectId:best.sourceObjectId,distance:best.distance,confidence:best.distance <= 12 ? 'nearby-high' : 'nearby'});
    }
    return matches;
  }

  async function run(automatic, forceRestart) {
    if (!manager) {
      renderPanel('Importer is still initializing. Try again in a moment.');
      return;
    }
    if (api.running && !forceRestart) return;
    if (forceRestart) {
      cancelActive();
      sourceCache = null;
      sourceMode = '';
    }
    const myRun = ++runSequence;
    api.running = true;
    renderPanel(forceRestart ? 'Restarting building outline import now…' : 'Loading current FNSB vector building footprints…');
    manager.setStatus('Building auto-generation is running. You can keep using the editor while it works.');
    try {
      const before = manager.getSummary();
      const features = await fetchSource(forceRestart);
      if (myRun !== runSequence) return;
      renderPanel('Matching ' + features.length + ' source footprints to UAF building records…');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (myRun !== runSequence) return;
      const matches = matchBuildings(features);
      const imported = manager.bulkImportBuildingMatches(matches);
      const after = imported.summary || manager.getSummary();
      api.lastResult = {
        totalBuildings:after.buildingsTotal,
        alreadyOutlined:before.buildingsOutlined,
        sourceFeatures:features.length,
        matches:matches.length,
        added:imported.added,
        skipped:imported.skipped,
        invalid:imported.invalid,
        unmatched:Math.max(0,before.buildingsMissing-matches.length),
        needsReview:after.buildingsReview,
        remaining:after.buildingsMissing,
        sourceMode
      };
      const prefix = automatic ? 'Automatic check complete. ' : 'Auto-generation complete. ';
      renderPanel(prefix + imported.added + ' missing building outline' + (imported.added === 1 ? ' was' : 's were') + ' added to the browser draft. Review generated polygons before publishing.', api.lastResult);
      manager.setStatus(prefix + imported.added + ' building outline' + (imported.added === 1 ? '' : 's') + ' added to the browser draft; ' + after.buildingsMissing + ' building record' + (after.buildingsMissing === 1 ? '' : 's') + ' still need geometry.');
    } catch (error) {
      if (myRun !== runSequence) return;
      api.lastResult = null;
      sourceCache = null;
      sourceMode = '';
      renderPanel('Importer error: ' + (error.message || 'Unknown error') + ' Tap the button to retry.');
      manager.setStatus('Automatic building import could not complete. The exact error is shown in the importer panel.');
    } finally {
      if (myRun === runSequence) {
        api.running = false;
        const status = document.getElementById('overlay-import-status')?.textContent || 'Ready to retry.';
        renderPanel(status, api.lastResult);
      }
    }
  }

  api.runManual = function () {
    run(false, true);
  };

  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#auto-generate-building-outlines');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    button.textContent = 'Starting…';
    button.setAttribute('aria-busy', 'true');
    api.runManual();
  }, true);

  function connect(nextManager) {
    if (manager) return;
    manager = nextManager || window.UAFOverlayManager;
    if (!manager) return;
    promoteImporter();
    renderPanel('Checking the building-footprint source in the background. Existing geometry will not be changed until matches are ready.');
    if (!api.ranAutomatically) {
      api.ranAutomatically = true;
      setTimeout(() => run(true, false), 700);
    }
  }

  window.addEventListener('uaf:overlaymanagerready', event => connect(event.detail?.manager));
  if (window.UAFOverlayManager) connect(window.UAFOverlayManager);
})();
