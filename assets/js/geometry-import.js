(function () {
  'use strict';

  if ((document.body.dataset.page || '') !== 'overlays') return;

  const api = window.UAFGeometryImport = {running:false,lastResult:null,ranAutomatically:false};
  let manager = null;
  let sourceCache = null;

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
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const next = polygonArea(ring);
      if (next > area) {best = ring;area = next;}
    }
    return best;
  }

  function ring(feature) {
    return bestRing(feature?.geometry?.rings || []);
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

  function renderPanel(statusText, result) {
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
    slot.innerHTML = '<section class="overlay-import-card"><div><strong>Automatic building outlines</strong><p id="overlay-import-status">' + (statusText || 'Ready to check the current FNSB building-footprint source.') + '</p></div><button type="button" id="auto-generate-building-outlines" class="primary-admin" ' + (api.running ? 'disabled' : '') + '>Auto-generate missing building outlines</button>' + stats + '<small>Generated polygons are saved only to the browser draft and marked <strong>Needs review</strong>. Existing UAF outlines are never replaced automatically.</small></section>';
    slot.querySelector('#auto-generate-building-outlines')?.addEventListener('click', () => run(false));
  }

  async function fetchSource() {
    if (sourceCache) return sourceCache;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);
    try {
      const response = await fetch('/admin/footprints.php', {credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal,cache:'no-store'});
      let data = null;
      try {data = await response.json();} catch (error) {}
      if (!response.ok || !data?.ok || !Array.isArray(data.features)) {
        throw new Error(data?.error || ('Building-footprint lookup failed (' + response.status + ').'));
      }
      sourceCache = data.features.filter(feature => {
        const r = ring(feature);
        return Array.isArray(r) && r.length >= 4 && polygonArea(r) > 0;
      });
      if (!sourceCache.length) throw new Error('The footprint source returned no usable campus polygons.');
      return sourceCache;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The building-footprint lookup timed out after 11 seconds. The editor is still usable; retry when the source is available.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function candidateRows(features) {
    return features.map((feature,index) => ({feature,index,ring:ring(feature),area:polygonArea(ring(feature)),sourceObjectId:String(feature?.attributes?.OBJECTID || '')})).filter(row => row.ring);
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

  async function run(automatic) {
    if (!manager || api.running) return;
    api.running = true;
    renderPanel('Loading the current FNSB vector building footprints…');
    manager.setStatus('Building auto-generation is running in the background. The rest of the editor remains usable.');
    try {
      const before = manager.getSummary();
      const features = await fetchSource();
      renderPanel('Matching source footprints to UAF building records…');
      await new Promise(resolve => setTimeout(resolve, 0));
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
        remaining:after.buildingsMissing
      };
      const prefix = automatic ? 'Automatic check complete. ' : 'Auto-generation complete. ';
      renderPanel(prefix + imported.added + ' missing building outline' + (imported.added === 1 ? ' was' : 's were') + ' added to the browser draft. Review generated polygons before publishing.', api.lastResult);
      manager.setStatus(prefix + imported.added + ' building outline' + (imported.added === 1 ? '' : 's') + ' added to the browser draft; ' + after.buildingsMissing + ' building record' + (after.buildingsMissing === 1 ? '' : 's') + ' still need geometry.');
    } catch (error) {
      api.lastResult = null;
      renderPanel('Importer unavailable: ' + (error.message || 'Unknown error') + ' You can still select, draw, edit, save drafts, and publish existing geometry.');
      manager.setStatus('Automatic building import could not complete. The overlay editor remains usable.');
    } finally {
      api.running = false;
      renderPanel(document.getElementById('overlay-import-status')?.textContent || '', api.lastResult);
    }
  }

  function connect(nextManager) {
    if (manager) return;
    manager = nextManager || window.UAFOverlayManager;
    if (!manager) return;
    renderPanel('Checking the building-footprint source in the background. Existing geometry will not be changed until matches are ready.');
    if (!api.ranAutomatically) {
      api.ranAutomatically = true;
      setTimeout(() => run(true), 900);
    }
  }

  window.addEventListener('uaf:overlaymanagerready', event => connect(event.detail?.manager));
  if (window.UAFOverlayManager) connect(window.UAFOverlayManager);
})();
