(function () {
  'use strict';

  if ((document.body.dataset.page || '') !== 'overlays') return;

  const app = document.getElementById('app');
  const REPO = 'dannyvaziri/uafcampusmap';
  const CONFIG_PATH = 'data/map-config.json';
  const DEFAULT_CENTER = [64.857, -147.829];
  const DEFAULT_ZOOM = 16;

  function read(id, fallback) {
    try {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent || '') : fallback;
    } catch (error) {
      return fallback;
    }
  }

  const baseBuildings = read('uaf-buildings', []);
  const baseParking = read('uaf-parking', []);
  const serverConfig = read('uaf-config', {});
  const legend = read('uaf-legend', {items:[]});
  const legendItems = Array.isArray(legend.items) ? legend.items : [];
  const legendById = new Map(legendItems.map(item => [item.id, item]));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalize = value => String(value == null ? '' : value).toLowerCase().trim();
  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const exact = item => finite(item?.latitude) && finite(item?.longitude);
  const clone = value => JSON.parse(JSON.stringify(value));

  function encode64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function normalizeConfig(input) {
    const cfg = clone(input || {});
    cfg.settings = cfg.settings || {};
    cfg.settings.map = cfg.settings.map || {};
    cfg.buildingOverrides = cfg.buildingOverrides || {};
    cfg.parkingOverrides = cfg.parkingOverrides || {};
    cfg.customBuildings = Array.isArray(cfg.customBuildings) ? cfg.customBuildings : [];
    cfg.customParking = Array.isArray(cfg.customParking) ? cfg.customParking : [];
    cfg.shapes = Array.isArray(cfg.shapes) ? cfg.shapes : [];
    cfg.imageOverlays = Array.isArray(cfg.imageOverlays) ? cfg.imageOverlays : [];
    return cfg;
  }

  function recentConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem('uaf-map-live-config') || 'null');
      if (parsed?.config && parsed?.time && Date.now() - Number(parsed.time) < 10 * 60 * 1000) return parsed.config;
    } catch (error) {}
    return null;
  }

  function merge(base, overrides, custom) {
    const rows = base.map(item => ({...item, ...(overrides?.[item.id] || {})}));
    const seen = new Set(rows.map(item => item.id));
    for (const item of custom || []) {
      if (!item?.id) continue;
      if (seen.has(item.id)) {
        const index = rows.findIndex(row => row.id === item.id);
        rows[index] = {...rows[index], ...item, ...(overrides?.[item.id] || {})};
      } else {
        rows.push({...item, ...(overrides?.[item.id] || {})});
        seen.add(item.id);
      }
    }
    return rows;
  }

  function validCoordinate(pair) {
    return Array.isArray(pair) && pair.length >= 2 && finite(pair[0]) && finite(pair[1]) && Number(pair[0]) >= -180 && Number(pair[0]) <= 180 && Number(pair[1]) >= -90 && Number(pair[1]) <= 90;
  }

  function validGeometry(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return false;
    if (geometry.type === 'Point') return validCoordinate(geometry.coordinates);
    if (geometry.type === 'LineString') {
      const points = geometry.coordinates || [];
      return points.length >= 2 && points.every(validCoordinate) && new Set(points.map(pair => pair.join(','))).size >= 2;
    }
    if (geometry.type === 'Polygon') {
      const ring = geometry.coordinates?.[0] || [];
      return ring.length >= 4 && ring.every(validCoordinate) && new Set(ring.map(pair => pair.join(','))).size >= 3;
    }
    return false;
  }

  function parkingKey(row) {
    const text = normalize(row?.restrictions);
    if (text.includes('no parking unless otherwise posted')) return 'parking_no_parking';
    if (text.includes('visitors only') && text.includes('metered')) return 'parking_visitor_only';
    if (text.includes('visitors and uaf-affiliated') && text.includes('metered')) return 'parking_visitor_metered';
    if (text.includes('pay-by-plate short-term')) return 'parking_short_term';
    if (text.includes('gold decal')) return 'parking_gold';
    if (text.includes('restricted parking') || text.includes('no parking')) return 'parking_restricted';
    if (row?.type === 'visitor_short_term') return 'parking_short_term';
    if (row?.type === 'gold') return 'parking_gold';
    if (row?.type === 'restricted') return 'parking_restricted';
    return 'parking_permit';
  }

  function styleFor(key) {
    return legendById.get(key) || legendById.get('custom_area') || {id:'custom_area',stroke:'#236192',fill:'#236192',weight:2,opacity:1,fillOpacity:0.2,geometry:'polygon'};
  }

  function applyLegend(feature, key) {
    const entry = styleFor(key);
    const next = clone(feature);
    next.properties = {...(next.properties || {}), legend_key:entry.id};
    for (const property of ['stroke','fill','weight','opacity','fillOpacity']) {
      if (entry[property] !== undefined) next.properties[property] = entry[property];
    }
    if (entry.dashArray) next.properties.dashArray = entry.dashArray;
    else delete next.properties.dashArray;
    return next;
  }

  function swatch(entry) {
    return '<i class="overlay-key-swatch ' + esc(entry.geometry || 'polygon') + (entry.dashArray ? ' dashed' : '') + '" style="--key-stroke:' + esc(entry.stroke || '#236192') + ';--key-fill:' + esc(entry.fill || entry.stroke || '#236192') + '"></i>';
  }

  const state = {
    config: normalizeConfig(recentConfig() || serverConfig),
    scope: 'building',
    selectedId: '',
    shapeId: '',
    query: '',
    statusFilter: 'all',
    legendKey: 'building',
    pendingName: '',
    map: null,
    context: null,
    selectedGroup: null,
    locatorGroup: null,
    selectedLayer: null,
    editing: false
  };

  function buildings() {return merge(baseBuildings, state.config.buildingOverrides, state.config.customBuildings);}
  function parking() {return merge(baseParking, state.config.parkingOverrides, state.config.customParking);}
  function validShapes() {return state.config.shapes.filter(validGeometry);}
  function shapeById(id) {return state.config.shapes.find(feature => feature.properties?.id === id);}
  function buildingShape(id) {return state.config.shapes.find(feature => feature.properties?.kind === 'building-footprint' && feature.properties?.building_id === id && validGeometry(feature));}
  function parkingShape(id, code) {return state.config.shapes.find(feature => feature.properties?.kind === 'parking-area' && (feature.properties?.parking_id === id || feature.properties?.parking_id === code) && validGeometry(feature));}
  function otherShapes() {return validShapes().filter(feature => !feature.properties?.building_id && !feature.properties?.parking_id && feature.properties?.kind !== 'building-footprint' && feature.properties?.kind !== 'parking-area');}

  function inferredShapeKey(feature) {
    const props = feature?.properties || {};
    if (props.kind === 'building-footprint' || props.building_id) return 'building';
    if (props.kind === 'parking-area' || props.parking_id) {
      if (typeof props.legend_key === 'string' && props.legend_key.startsWith('parking_') && legendById.has(props.legend_key)) return props.legend_key;
      const row = parking().find(item => item.id === props.parking_id || item.code === props.parking_id);
      return parkingKey(row);
    }
    if (props.legend_key && legendById.has(props.legend_key)) return props.legend_key;
    const map = {
      trail:'trail', construction:'construction', closure:'construction', stairs:'stairs', bridge:'bridge',
      'shuttle-stop':'shuttle_stop', 'macs-stop':'macs_stop', 'accessible-parking':'accessible_parking',
      'parking-kiosk':'parking_kiosk', 'one-way-road':'road_one_way'
    };
    return map[props.kind] || 'custom_area';
  }

  function currentRecord() {
    if (state.scope === 'building') return buildings().find(item => item.id === state.selectedId) || null;
    if (state.scope === 'parking') return parking().find(item => item.id === state.selectedId || item.code === state.selectedId) || null;
    return null;
  }

  function currentShape() {
    if (state.scope === 'building') return buildingShape(state.selectedId) || null;
    if (state.scope === 'parking') {
      const row = currentRecord();
      return row ? parkingShape(row.id, row.code) || null : null;
    }
    return state.shapeId ? shapeById(state.shapeId) || null : null;
  }

  function defaultKey() {
    if (state.scope === 'building') return 'building';
    if (state.scope === 'parking') {
      const shape = currentShape();
      if (shape) return inferredShapeKey(shape);
      return parkingKey(currentRecord());
    }
    return currentShape() ? inferredShapeKey(currentShape()) : (state.legendKey || 'custom_area');
  }

  function addBasemap(map) {
    const key = state.config.settings?.map?.arcgisApiKey;
    if (key) {
      L.tileLayer('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(key), {
        maxZoom:20,
        crossOrigin:true,
        attribution:'© Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }).addTo(map);
      L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {maxZoom:20,crossOrigin:true,opacity:0.85,attribution:'Transportation reference © Esri'}).addTo(map);
      L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom:20,crossOrigin:true,opacity:0.92,attribution:'Places reference © Esri'}).addTo(map);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:20,crossOrigin:true,attribution:'© OpenStreetMap contributors'}).addTo(map);
    }
  }

  function leafletStyle(feature, faded) {
    const entry = styleFor(inferredShapeKey(feature));
    return {
      color:entry.stroke || '#236192',
      fillColor:entry.fill || entry.stroke || '#236192',
      weight:Number(entry.weight || 2),
      opacity:faded ? 0.45 : Number(entry.opacity ?? 1),
      fillOpacity:faded ? Math.min(0.1, Number(entry.fillOpacity ?? 0.2)) : Number(entry.fillOpacity ?? 0.2),
      dashArray:entry.dashArray || undefined
    };
  }

  function renderPage() {
    app.innerHTML = '<main id="main" class="page overlay-manager-page">' +
      '<div class="admin-title"><div><p class="eyebrow">UAF CAMPUS MAP ADMIN</p><h1>Map overlays & key</h1><p>Every building and parking record is listed here. Draw or reshape its overlay, and the overlay automatically uses the same style as the map key.</p></div><div class="admin-top-actions"><a href="/admin">Back to admin</a><a href="/admin/images">PNG overlays</a><a href="/" target="_blank" rel="noopener">Public map</a><a href="/print" target="_blank" rel="noopener">Print map</a></div></div>' +
      '<div id="overlay-summary" class="overlay-summary"></div>' +
      '<div class="overlay-manager-grid"><section class="overlay-inventory" aria-label="Overlay inventory"><div class="overlay-scope-tabs" role="tablist" aria-label="Overlay type"><button type="button" data-scope="building" class="active">Buildings</button><button type="button" data-scope="parking">Parking</button><button type="button" data-scope="other">Other</button></div><label class="admin-field"><span>Find overlay</span><input id="overlay-search" type="search" placeholder="Building, parking code, feature…"></label><label class="admin-field"><span>Status</span><select id="overlay-status-filter"><option value="all">All</option><option value="needs">Needs outline</option><option value="ready">Outlined / mapped</option></select></label><div id="overlay-list" class="overlay-list"></div></section>' +
      '<section class="overlay-map-panel"><div class="overlay-map-toolbar"><div><strong id="overlay-map-title">Select an overlay</strong><small id="overlay-map-help">Choose a building, parking lot or other feature from the inventory.</small></div><div><button type="button" id="show-campus">Show campus</button><button type="button" id="next-needs">Next needing outline</button></div></div><div id="overlay-editor-map" class="overlay-editor-map" tabindex="0" aria-label="Editable map overlay canvas"></div><div id="overlay-action-bar" class="overlay-action-bar"></div><p id="overlay-status" class="admin-status" role="status" aria-live="polite">Select an overlay to edit.</p></section>' +
      '<aside class="overlay-key-panel"><h2>Map key</h2><p>These styles are shared by the public map, print map and overlay editor.</p><div id="overlay-key-list"></div><hr><div id="overlay-properties"></div><section class="overlay-publish"><h3>Save / publish</h3><button type="button" id="save-overlay-draft">Save browser draft</button><label class="admin-field"><span>GitHub token</span><input id="overlay-github-token" type="password" autocomplete="off" placeholder="github_pat_…"></label><button type="button" id="publish-overlay-config" class="primary-admin">Publish overlays to GitHub & live map</button><p class="muted">The token stays only in this browser session.</p></section></aside></div></main>';

    state.map = L.map('overlay-editor-map', {center:state.config.settings?.map?.center || DEFAULT_CENTER,zoom:Number(state.config.settings?.map?.zoom || DEFAULT_ZOOM),keyboard:true,zoomControl:true});
    addBasemap(state.map);
    state.context = L.layerGroup().addTo(state.map);
    state.selectedGroup = L.featureGroup().addTo(state.map);
    state.locatorGroup = L.layerGroup().addTo(state.map);
    state.map.on(L.Draw.Event.CREATED, onDrawCreated);

    document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
      state.scope = button.dataset.scope;
      state.selectedId = '';
      state.shapeId = '';
      state.pendingName = '';
      state.query = '';
      state.statusFilter = 'all';
      document.getElementById('overlay-search').value = '';
      document.getElementById('overlay-status-filter').value = 'all';
      document.querySelectorAll('[data-scope]').forEach(row => row.classList.toggle('active', row.dataset.scope === state.scope));
      renderInventory();
      renderSelection();
    }));
    document.getElementById('overlay-search').addEventListener('input', event => {state.query = event.target.value;renderInventory();});
    document.getElementById('overlay-status-filter').addEventListener('change', event => {state.statusFilter = event.target.value;renderInventory();});
    document.getElementById('show-campus').addEventListener('click', showCampus);
    document.getElementById('next-needs').addEventListener('click', selectNextNeeds);
    document.getElementById('save-overlay-draft').addEventListener('click', saveDraft);
    const token = document.getElementById('overlay-github-token');
    token.value = sessionStorage.getItem('uaf-github-token') || '';
    token.addEventListener('input', () => {if (token.value.trim()) sessionStorage.setItem('uaf-github-token', token.value.trim()); else sessionStorage.removeItem('uaf-github-token');});
    document.getElementById('publish-overlay-config').addEventListener('click', publish);

    renderKey();
    renderSummary();
    renderInventory();
    renderSelection();
    setTimeout(() => state.map.invalidateSize(), 50);
  }

  function renderSummary() {
    const b = buildings();
    const p = parking();
    const bReady = b.filter(item => buildingShape(item.id)).length;
    const pReady = p.filter(item => parkingShape(item.id, item.code)).length;
    const other = otherShapes().length;
    document.getElementById('overlay-summary').innerHTML = '<span><strong>' + bReady + '/' + b.length + '</strong> buildings outlined</span><span><strong>' + pReady + '/' + p.length + '</strong> parking areas outlined</span><span><strong>' + other + '</strong> other mapped overlays</span><span><strong>' + legendItems.length + '</strong> key styles</span>';
  }

  function inventoryRows() {
    const q = normalize(state.query);
    if (state.scope === 'building') {
      return buildings().map(item => ({kind:'building',id:item.id,title:item.common_name || item.official_name || item.id,subtitle:item.address || 'Address pending',record:item,shape:buildingShape(item.id),key:'building'})).filter(row => !q || normalize([row.title,row.subtitle,row.record.abbreviation,(row.record.services || []).join(' ')].join(' ')).includes(q));
    }
    if (state.scope === 'parking') {
      return parking().map(item => {
        const shape = parkingShape(item.id,item.code);
        return {kind:'parking',id:item.id || item.code,title:(item.code || 'P') + ' — ' + (item.name || 'Parking'),subtitle:item.restrictions || 'Parking information',record:item,shape,key:shape ? inferredShapeKey(shape) : parkingKey(item)};
      }).filter(row => !q || normalize([row.title,row.subtitle,row.record.type].join(' ')).includes(q));
    }
    return otherShapes().map(feature => ({kind:'other',id:feature.properties?.id,title:feature.properties?.name || feature.properties?.id || 'Map overlay',subtitle:styleFor(inferredShapeKey(feature)).label,record:null,shape:feature,key:inferredShapeKey(feature)})).filter(row => !q || normalize([row.title,row.subtitle].join(' ')).includes(q));
  }

  function renderInventory() {
    let rows = inventoryRows();
    if (state.statusFilter === 'needs') rows = rows.filter(row => !row.shape);
    if (state.statusFilter === 'ready') rows = rows.filter(row => !!row.shape);
    const list = document.getElementById('overlay-list');
    const add = state.scope === 'other' ? '<button type="button" id="new-other-overlay" class="overlay-new">+ New map overlay</button>' : '';
    list.innerHTML = add + (rows.length ? rows.map(row => '<button type="button" class="overlay-row ' + (row.id === (state.scope === 'other' ? state.shapeId : state.selectedId) ? 'selected' : '') + '" data-overlay-id="' + esc(row.id) + '">' + swatch(styleFor(row.key)) + '<span><strong>' + esc(row.title) + '</strong><small>' + esc(row.subtitle) + '</small></span><em class="overlay-state ' + (row.shape ? 'ready' : 'needs') + '">' + (row.shape ? 'Outlined' : 'Needs outline') + '</em></button>').join('') : '<p class="muted">No overlays match this filter.</p>');
    list.querySelectorAll('[data-overlay-id]').forEach(button => button.addEventListener('click', () => {
      if (state.scope === 'other') {state.shapeId = button.dataset.overlayId;state.selectedId = '';} else {state.selectedId = button.dataset.overlayId;state.shapeId = '';}
      state.pendingName = '';
      renderInventory();
      renderSelection(true);
    }));
    document.getElementById('new-other-overlay')?.addEventListener('click', () => {
      state.shapeId = '';
      state.selectedId = '';
      state.pendingName = 'New map overlay';
      state.legendKey = 'custom_area';
      renderInventory();
      renderSelection();
      setStatus('Choose a key type, then draw the new overlay on the map.');
    });
  }

  function renderKey() {
    const container = document.getElementById('overlay-key-list');
    const groups = new Map();
    for (const item of legendItems) {
      const group = item.group || 'Map';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    container.innerHTML = [...groups.entries()].map(([group, rows]) => '<section class="overlay-key-group"><h3>' + esc(group) + '</h3>' + rows.map(item => '<div class="overlay-key-row">' + swatch(item) + '<span>' + esc(item.label) + '</span></div>').join('') + '</section>').join('');
  }

  function renderSelection(fit) {
    state.context.clearLayers();
    state.selectedGroup.clearLayers();
    state.locatorGroup.clearLayers();
    state.selectedLayer = null;
    state.editing = false;

    for (const feature of validShapes()) {
      const current = currentShape();
      if (current && feature.properties?.id === current.properties?.id) continue;
      L.geoJSON(applyLegend(feature, inferredShapeKey(feature)), {
        style:f => leafletStyle(f, true),
        pointToLayer:(f,ll) => L.circleMarker(ll,{radius:5,...leafletStyle(f,true),fillOpacity:0.2})
      }).addTo(state.context);
    }

    const record = currentRecord();
    const shape = currentShape();
    if (shape) {
      const styled = applyLegend(shape, inferredShapeKey(shape));
      const layerGroup = L.geoJSON(styled, {
        style:f => leafletStyle(f, false),
        pointToLayer:(f,ll) => L.circleMarker(ll,{radius:8,...leafletStyle(f,false),fillOpacity:0.9})
      });
      layerGroup.eachLayer(layer => {state.selectedLayer = layer;state.selectedGroup.addLayer(layer);});
      state.legendKey = styled.properties?.legend_key || defaultKey();
    } else {
      state.legendKey = defaultKey();
    }

    if (record && exact(record)) {
      const color = styleFor(defaultKey()).stroke || '#236192';
      L.circleMarker([Number(record.latitude),Number(record.longitude)],{radius:9,color:'#fff',weight:3,fillColor:color,fillOpacity:0.95}).bindTooltip(record.common_name || record.name || record.code || 'Selected record',{permanent:false}).addTo(state.locatorGroup);
      L.circle([Number(record.latitude),Number(record.longitude)],{radius:24,color:color,weight:2,dashArray:'5 5',fill:false,opacity:0.8}).addTo(state.locatorGroup);
    }

    const title = document.getElementById('overlay-map-title');
    const help = document.getElementById('overlay-map-help');
    if (state.scope === 'building') {
      title.textContent = record ? (record.common_name || record.official_name || 'Building') : 'Select a building';
      help.textContent = shape ? 'This building has an editable footprint.' : record ? (exact(record) ? 'The dashed locator is not a footprint. Draw the actual building outline from the imagery.' : 'This building has no map coordinate. Pan to it, then draw its actual outline.') : 'Choose a building from the inventory.';
    } else if (state.scope === 'parking') {
      title.textContent = record ? ((record.code || 'P') + ' — ' + (record.name || 'Parking')) : 'Select parking';
      help.textContent = shape ? 'This parking area has an editable boundary.' : record ? (exact(record) ? 'The dashed locator is not a parking boundary. Draw the actual lot from the imagery.' : 'No parking coordinate is stored. Pan to the lot in the imagery and draw its boundary.') : 'Choose a parking record from the inventory.';
    } else {
      const feature = shape;
      title.textContent = feature ? (feature.properties?.name || 'Map overlay') : state.pendingName || 'Select or create an overlay';
      help.textContent = feature ? 'Edit this mapped feature or change its key type.' : state.pendingName ? 'Choose its key type and draw it on the imagery.' : 'Select an existing overlay or add a new one.';
    }

    renderActionBar();
    renderProperties();
    if (fit) fitSelection();
  }

  function renderActionBar() {
    const bar = document.getElementById('overlay-action-bar');
    const record = currentRecord();
    const shape = currentShape();
    const canDraw = !!record || state.scope === 'other' && !!state.pendingName;
    const key = styleFor(state.legendKey || defaultKey());
    const geometry = state.scope === 'building' || state.scope === 'parking' ? 'polygon' : (key.geometry || 'polygon');
    const drawButtons = canDraw && !shape ? (geometry === 'point' ? '<button type="button" data-draw="marker">Place point</button>' : geometry === 'line' ? '<button type="button" data-draw="polyline">Draw line</button>' : '<button type="button" data-draw="polygon">Draw polygon</button><button type="button" data-draw="rectangle">Draw rectangle</button>') : '';
    bar.innerHTML = drawButtons + (shape ? '<button type="button" id="edit-current-overlay">Edit geometry</button><button type="button" id="save-current-overlay" hidden>Save geometry</button><button type="button" id="cancel-current-overlay" hidden>Cancel edit</button><button type="button" id="replace-current-overlay">Replace geometry</button><button type="button" id="delete-current-overlay" class="danger">Delete overlay</button>' : '') + (!record && state.scope !== 'other' ? '<span class="muted">Select a record first.</span>' : '');
    bar.querySelectorAll('[data-draw]').forEach(button => button.addEventListener('click', () => startDraw(button.dataset.draw)));
    document.getElementById('edit-current-overlay')?.addEventListener('click', beginEdit);
    document.getElementById('save-current-overlay')?.addEventListener('click', saveEdit);
    document.getElementById('cancel-current-overlay')?.addEventListener('click', () => {renderSelection();setStatus('Geometry edit cancelled.');});
    document.getElementById('replace-current-overlay')?.addEventListener('click', () => {
      if (!shape) return;
      state.config.shapes = state.config.shapes.filter(feature => feature.properties?.id !== shape.properties?.id);
      if (state.scope === 'other') {state.pendingName = shape.properties?.name || 'Map overlay';state.legendKey = inferredShapeKey(shape);state.shapeId = '';}
      renderSummary();renderInventory();renderSelection();setStatus('Old geometry removed from the draft. Draw the replacement.');
    });
    document.getElementById('delete-current-overlay')?.addEventListener('click', () => {
      if (!shape) return;
      state.config.shapes = state.config.shapes.filter(feature => feature.properties?.id !== shape.properties?.id);
      state.shapeId = '';
      if (state.scope === 'other') state.pendingName = '';
      renderSummary();renderInventory();renderSelection();setStatus('Overlay removed from the draft.');
    });
  }

  function keyOptions(selected) {
    let rows = legendItems.filter(item => item.geometry !== 'image');
    if (state.scope === 'building') rows = rows.filter(item => item.id === 'building');
    if (state.scope === 'parking') rows = rows.filter(item => item.id.startsWith('parking_'));
    return rows.map(item => '<option value="' + esc(item.id) + '" ' + (item.id === selected ? 'selected' : '') + '>' + esc((item.group || 'Map') + ' — ' + item.label) + '</option>').join('');
  }

  function renderProperties() {
    const holder = document.getElementById('overlay-properties');
    const record = currentRecord();
    const shape = currentShape();
    if (!record && !shape && !(state.scope === 'other' && state.pendingName)) {
      holder.innerHTML = '<h3>Selected overlay</h3><p class="muted">Select an item to see its key type and geometry status.</p>';
      return;
    }
    const key = state.scope === 'building' ? 'building' : (shape?.properties?.legend_key || state.legendKey || defaultKey());
    const entry = styleFor(key);
    const name = shape?.properties?.name || (state.scope === 'building' ? (record?.common_name || record?.official_name || '') + ' footprint' : state.scope === 'parking' ? ((record?.code || 'P') + ' — ' + (record?.name || 'Parking')) : state.pendingName || 'Map overlay');
    const lockedBuilding = state.scope === 'building';
    const warning = state.scope === 'parking' && normalize(record?.restrictions).includes(';') ? '<p class="overlay-warning">This parking record contains more than one rule. Choose the key style for this boundary, then create additional custom overlay segments if the lot needs to be split by rule.</p>' : '';
    holder.innerHTML = '<h3>Selected overlay</h3><div class="selected-key-preview">' + swatch(entry) + '<strong>' + esc(entry.label) + '</strong></div><label class="admin-field"><span>Overlay name</span><input id="selected-overlay-name" value="' + esc(name) + '"></label><label class="admin-field"><span>Key type</span><select id="selected-overlay-key" ' + (lockedBuilding ? 'disabled' : '') + '>' + keyOptions(key) + '</select></label>' + (lockedBuilding ? '<p class="muted">Building footprints always use the Building key style.</p>' : state.scope === 'parking' ? '<p class="muted">Parking boundaries can only use parking key styles.</p>' : '') + warning + '<label class="admin-switch"><input id="selected-overlay-visible" type="checkbox" ' + (shape?.properties?.visible !== false ? 'checked' : '') + ' ' + (!shape ? 'disabled' : '') + '><span>Show this overlay publicly</span></label><dl class="overlay-meta"><div><dt>Geometry</dt><dd>' + (shape ? esc(shape.geometry?.type || 'Mapped') : 'Needs outline') + '</dd></div><div><dt>Record</dt><dd>' + esc(state.scope === 'building' ? 'Building' : state.scope === 'parking' ? 'Parking' : 'Other feature') + '</dd></div></dl>';
    document.getElementById('selected-overlay-name').addEventListener('input', event => {
      if (shape) updateShape(shape.properties?.id,{name:event.target.value});
      else state.pendingName = event.target.value;
      document.getElementById('overlay-map-title').textContent = event.target.value || 'Map overlay';
    });
    document.getElementById('selected-overlay-key').addEventListener('change', event => {
      state.legendKey = event.target.value;
      if (shape) {
        const updated = applyLegend(shape,state.legendKey);
        state.config.shapes = state.config.shapes.map(feature => feature.properties?.id === shape.properties?.id ? updated : feature);
      }
      renderInventory();renderSelection();setStatus('Overlay style synced to the selected map key.');
    });
    document.getElementById('selected-overlay-visible')?.addEventListener('change', event => {
      if (!shape) return;
      updateShape(shape.properties?.id,{visible:event.target.checked});renderSelection();
    });
  }

  function updateShape(id, patch) {
    state.config.shapes = state.config.shapes.map(feature => feature.properties?.id === id ? {...feature,properties:{...(feature.properties || {}),...patch}} : feature);
  }

  function startDraw(type) {
    const entry = styleFor(state.legendKey || defaultKey());
    const options = {shapeOptions:{color:entry.stroke,fillColor:entry.fill,weight:Number(entry.weight || 2),opacity:Number(entry.opacity ?? 1),fillOpacity:Number(entry.fillOpacity ?? 0.2),dashArray:entry.dashArray || undefined}};
    let tool = null;
    if (type === 'polygon') tool = new L.Draw.Polygon(state.map, options);
    if (type === 'rectangle') tool = new L.Draw.Rectangle(state.map, options);
    if (type === 'polyline') tool = new L.Draw.Polyline(state.map, options);
    if (type === 'marker') tool = new L.Draw.Marker(state.map);
    if (!tool) return;
    tool.enable();
    setStatus(type === 'marker' ? 'Click the map to place the overlay point.' : 'Click the map to draw the overlay. Finish the shape to save it to the draft.');
  }

  function featureProperties() {
    const record = currentRecord();
    const existing = currentShape();
    const key = state.scope === 'building' ? 'building' : (state.legendKey || defaultKey());
    const props = {
      id:existing?.properties?.id || ('shape-' + Date.now()),
      name:existing?.properties?.name || state.pendingName || (state.scope === 'building' ? (record?.common_name || record?.official_name || 'Building') + ' footprint' : state.scope === 'parking' ? ((record?.code || 'P') + ' — ' + (record?.name || 'Parking')) : 'Map overlay'),
      visible:existing?.properties?.visible !== false,
      legend_key:key
    };
    if (state.scope === 'building') {props.kind='building-footprint';props.building_id=record?.id || state.selectedId;}
    else if (state.scope === 'parking') {props.kind='parking-area';props.parking_id=record?.id || record?.code || state.selectedId;}
    else props.kind=existing?.properties?.kind || 'map-overlay';
    return props;
  }

  function onDrawCreated(event) {
    const geo = event.layer.toGeoJSON();
    geo.properties = featureProperties();
    const styled = applyLegend(geo, geo.properties.legend_key || defaultKey());
    const existing = currentShape();
    if (existing) state.config.shapes = state.config.shapes.map(feature => feature.properties?.id === existing.properties?.id ? styled : feature);
    else state.config.shapes.push(styled);
    if (state.scope === 'other') {state.shapeId=styled.properties.id;state.pendingName='';}
    renderSummary();renderInventory();renderSelection(true);setStatus('Overlay geometry saved in the draft and synced to the map key.');
  }

  function beginEdit() {
    if (!state.selectedLayer) return;
    if (state.selectedLayer instanceof L.Marker) state.selectedLayer.dragging?.enable();
    else state.selectedLayer.editing?.enable();
    state.editing = true;
    const save = document.getElementById('save-current-overlay'), cancel = document.getElementById('cancel-current-overlay'), edit = document.getElementById('edit-current-overlay');
    if (save) save.hidden=false;if(cancel)cancel.hidden=false;if(edit)edit.disabled=true;
    setStatus('Drag the overlay point or corner handles, then click Save geometry.');
  }

  function saveEdit() {
    const shape = currentShape();
    if (!shape || !state.selectedLayer) return;
    state.selectedLayer.dragging?.disable();
    state.selectedLayer.editing?.disable();
    const geo = state.selectedLayer.toGeoJSON();
    geo.properties = {...shape.properties};
    const styled = applyLegend(geo, inferredShapeKey(shape));
    if (!validGeometry(styled)) {setStatus('The edited geometry is invalid. Add enough distinct points to form the shape.');return;}
    state.config.shapes = state.config.shapes.map(feature => feature.properties?.id === shape.properties?.id ? styled : feature);
    state.editing=false;renderSummary();renderInventory();renderSelection();setStatus('Geometry saved in the draft.');
  }

  function fitSelection() {
    if (state.selectedLayer) {
      if (typeof state.selectedLayer.getBounds === 'function') {
        const bounds = state.selectedLayer.getBounds();
        if (bounds?.isValid?.()) {state.map.fitBounds(bounds.pad(0.8),{maxZoom:19});return;}
      }
      if (typeof state.selectedLayer.getLatLng === 'function') {state.map.setView(state.selectedLayer.getLatLng(),19);return;}
    }
    const record = currentRecord();
    if (record && exact(record)) state.map.setView([Number(record.latitude),Number(record.longitude)],18);
  }

  function showCampus() {
    const points = buildings().filter(exact).map(item => [Number(item.latitude),Number(item.longitude)]);
    if (points.length > 1) state.map.fitBounds(L.latLngBounds(points),{padding:[20,20],maxZoom:16});
    else state.map.setView(DEFAULT_CENTER,DEFAULT_ZOOM);
  }

  function selectNextNeeds() {
    if (state.scope === 'other') {setStatus('Next-needing-outline applies to the building and parking inventories.');return;}
    const rows = inventoryRows().filter(row => !row.shape);
    if (!rows.length) {setStatus('Every item in this inventory has mapped geometry.');return;}
    const currentIndex = rows.findIndex(row => row.id === state.selectedId);
    const next = rows[(currentIndex + 1) % rows.length];
    state.selectedId = next.id;state.shapeId='';renderInventory();renderSelection(true);setStatus('Selected the next item that needs an outline.');
  }

  function setStatus(message) {document.getElementById('overlay-status').textContent = message || '';}

  function canonicalConfig() {
    const cfg = clone(state.config);
    cfg.shapes = cfg.shapes.filter(validGeometry).map(feature => applyLegend(feature,inferredShapeKey(feature)));
    return cfg;
  }

  function saveDraft() {
    const cleaned = canonicalConfig();
    localStorage.setItem('uaf-map-config-draft',JSON.stringify({time:Date.now(),config:cleaned}));
    setStatus('Overlay draft saved in this browser. It is not public yet.');
  }

  async function publish() {
    const token = document.getElementById('overlay-github-token').value.trim();
    if (!token) {setStatus('Enter your GitHub token first.');return;}
    const cfg = canonicalConfig();
    const button = document.getElementById('publish-overlay-config');
    button.disabled=true;setStatus('Publishing overlay configuration to GitHub…');
    const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
    try {
      const current = await fetch('https://api.github.com/repos/'+REPO+'/contents/'+CONFIG_PATH+'?ref=main',{headers});
      if(!current.ok) throw new Error('Could not read the current map configuration ('+current.status+').');
      const currentJson = await current.json();
      const content = JSON.stringify(cfg,null,2)+'\n';
      const response = await fetch('https://api.github.com/repos/'+REPO+'/contents/'+CONFIG_PATH,{method:'PUT',headers,body:JSON.stringify({message:'Update UAF map overlays and key-linked geometry',content:encode64(content),sha:currentJson.sha,branch:'main'})});
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.message || ('GitHub publish failed ('+response.status+').'));}
      const result=await response.json();
      const sha=result.commit?.sha || '';
      state.config=cfg;
      localStorage.setItem('uaf-map-live-config',JSON.stringify({time:Date.now(),config:cfg,sha}));
      localStorage.setItem('uaf-map-live-refresh',String(Date.now()));
      localStorage.removeItem('uaf-map-config-draft');
      if('BroadcastChannel' in window){const channel=new BroadcastChannel('uaf-map-live');channel.postMessage({type:'published',sha});channel.close();}
      setStatus('Published'+(sha?' ('+sha.slice(0,7)+')':'')+'. Hostinger can now deploy the updated overlay geometry from main.');
    } catch (error) {
      setStatus(error.message || 'Publishing failed.');
    } finally {
      button.disabled=false;
    }
  }

  renderPage();
}());
