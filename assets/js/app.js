(function () {
  'use strict';

  const app = document.getElementById('app');
  const page = document.body.dataset.page || 'map';
  const REPO = 'dannyvaziri/uafcampusmap';
  const CONFIG_PATH = 'data/map-config.json';
  const DEFAULT_CENTER = [64.857, -147.829];
  const DEFAULT_ZOOM = 16;
  const MAIN_CAMPUS_BOX = [[64.8485, -147.8565], [64.8635, -147.8095]];
  const MAX_PNG_BYTES = 2_000_000;

  function readJsonScript(id, fallback) {
    try {
      const node = document.getElementById(id);
      if (!node) return fallback;
      return JSON.parse(node.textContent || '');
    } catch (error) {
      return fallback;
    }
  }

  const baseBuildings = readJsonScript('uaf-buildings', []);
  const baseParking = readJsonScript('uaf-parking', []);
  const meta = readJsonScript('uaf-meta', {});
  const serverConfig = readJsonScript('uaf-config', {});
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const csv = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  const normalize = value => String(value == null ? '' : value).toLowerCase().trim();
  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const exact = item => finite(item?.latitude) && finite(item?.longitude);
  const isHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function recentPublishedConfig() {
    try {
      const raw = localStorage.getItem('uaf-map-live-config');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.config || !parsed?.time) return null;
      if (Date.now() - Number(parsed.time) > 10 * 60 * 1000) {
        localStorage.removeItem('uaf-map-live-config');
        return null;
      }
      return parsed.config;
    } catch (error) {
      return null;
    }
  }

  function normalizeConfig(input) {
    const cfg = clone(input || {});
    cfg.version = Number(cfg.version || 3);
    cfg.settings = cfg.settings || {};
    cfg.settings.colors = cfg.settings.colors || {};
    cfg.settings.map = cfg.settings.map || {};
    cfg.settings.labels = cfg.settings.labels || {};
    cfg.settings.tabs = cfg.settings.tabs || {};
    cfg.settings.popularIds = Array.isArray(cfg.settings.popularIds) ? cfg.settings.popularIds : [];
    cfg.settings.contacts = cfg.settings.contacts || {};
    cfg.buildingOverrides = cfg.buildingOverrides || {};
    cfg.parkingOverrides = cfg.parkingOverrides || {};
    cfg.customBuildings = Array.isArray(cfg.customBuildings) ? cfg.customBuildings : [];
    cfg.customParking = Array.isArray(cfg.customParking) ? cfg.customParking : [];
    cfg.contentOverrides = cfg.contentOverrides || {};
    cfg.shapes = Array.isArray(cfg.shapes) ? cfg.shapes : [];
    cfg.imageOverlays = Array.isArray(cfg.imageOverlays) ? cfg.imageOverlays : [];
    return cfg;
  }

  let activeConfig = normalizeConfig(recentPublishedConfig() || serverConfig);

  function mergeRecords(base, overrides, custom, includeHidden) {
    const rows = base.map(item => ({...item, ...(overrides?.[item.id] || {})}));
    const seen = new Set(rows.map(item => item.id));
    for (const item of custom || []) {
      if (!item?.id) continue;
      const next = {...item, ...(overrides?.[item.id] || {})};
      if (seen.has(next.id)) {
        const index = rows.findIndex(row => row.id === next.id);
        rows[index] = {...rows[index], ...next};
      } else {
        rows.push(next);
        seen.add(next.id);
      }
    }
    return includeHidden ? rows : rows.filter(item => item.visible !== false);
  }

  const getBuildings = (cfg = activeConfig, includeHidden = false) => mergeRecords(baseBuildings, cfg.buildingOverrides, cfg.customBuildings, includeHidden);
  const getParking = (cfg = activeConfig, includeHidden = false) => mergeRecords(baseParking, cfg.parkingOverrides, cfg.customParking, includeHidden);
  const getSettings = (cfg = activeConfig) => cfg.settings || {};
  const colors = () => ({
    blue: getSettings().colors?.blue || '#236192',
    gold: getSettings().colors?.gold || '#FFCD00',
    marker: getSettings().colors?.marker || '#236192',
    parking: getSettings().colors?.parking || '#71984A',
    access: getSettings().colors?.access || '#111C4E',
    trail: getSettings().colors?.trail || '#71984A',
    closure: getSettings().colors?.closure || '#DF6A2E'
  });

  document.documentElement.style.setProperty('--blue', colors().blue);
  document.documentElement.style.setProperty('--gold', colors().gold);

  function safeExternal(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, location.origin);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
      return '';
    }
  }

  function encode64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function mainCampusBounds(cfg = activeConfig) {
    const points = getBuildings(cfg).filter(exact).filter(item => {
      const lat = Number(item.latitude), lng = Number(item.longitude);
      return lat >= MAIN_CAMPUS_BOX[0][0] && lat <= MAIN_CAMPUS_BOX[1][0] && lng >= MAIN_CAMPUS_BOX[0][1] && lng <= MAIN_CAMPUS_BOX[1][1];
    }).map(item => [Number(item.latitude), Number(item.longitude)]);
    return points.length >= 2 ? L.latLngBounds(points) : L.latLngBounds(MAIN_CAMPUS_BOX);
  }

  function mapCenter(cfg = activeConfig) {
    const center = cfg.settings?.map?.center;
    return Array.isArray(center) && center.length === 2 && finite(center[0]) && finite(center[1]) ? [Number(center[0]), Number(center[1])] : DEFAULT_CENTER;
  }

  function addBasemap(map, options = {}) {
    const cfg = options.config || activeConfig;
    const key = cfg.settings?.map?.arcgisApiKey;
    if (key) {
      L.tileLayer('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(key), {
        maxZoom: 20,
        crossOrigin: true,
        attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }).addTo(map);
      if (options.labels !== false) {
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 20,
          crossOrigin: true,
          opacity: 0.9,
          attribution: 'Transportation reference © Esri'
        }).addTo(map);
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 20,
          crossOrigin: true,
          opacity: 0.95,
          attribution: 'Places reference © Esri'
        }).addTo(map);
      }
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        crossOrigin: true,
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
    }
  }

  function validCoordinate(pair) {
    return Array.isArray(pair) && pair.length >= 2 && finite(pair[0]) && finite(pair[1]) && Number(pair[0]) >= -180 && Number(pair[0]) <= 180 && Number(pair[1]) >= -90 && Number(pair[1]) <= 90;
  }

  function validGeometry(feature) {
    const geometry = feature?.geometry;
    if (!geometry || !geometry.type) return false;
    if (geometry.type === 'Point') return validCoordinate(geometry.coordinates);
    if (geometry.type === 'LineString') {
      const coords = geometry.coordinates || [];
      return coords.length >= 2 && coords.every(validCoordinate) && new Set(coords.map(pair => pair.join(','))).size >= 2;
    }
    if (geometry.type === 'Polygon') {
      const ring = geometry.coordinates?.[0] || [];
      return ring.length >= 4 && ring.every(validCoordinate) && new Set(ring.map(pair => pair.join(','))).size >= 3;
    }
    return false;
  }

  function validImageOverlay(item) {
    if (!item || !/^data:image\/png;base64,/i.test(String(item.dataUrl || ''))) return false;
    if (!Array.isArray(item.bounds) || item.bounds.length !== 2) return false;
    const a = item.bounds[0], b = item.bounds[1];
    if (!Array.isArray(a) || !Array.isArray(b) || !finite(a[0]) || !finite(a[1]) || !finite(b[0]) || !finite(b[1])) return false;
    return Number(a[0]) !== Number(b[0]) && Number(a[1]) !== Number(b[1]);
  }

  function shapeStyle(feature, cfg = activeConfig, emphasis = false) {
    const props = feature?.properties || {};
    const palette = cfg.settings?.colors || {};
    const stroke = isHex(props.stroke) ? props.stroke : (palette.blue || '#236192');
    const fill = isHex(props.fill) ? props.fill : stroke;
    return {
      color: stroke,
      weight: Math.max(1, Number(props.weight || 3)) + (emphasis ? 2 : 0),
      opacity: Number.isFinite(Number(props.opacity)) ? Number(props.opacity) : 0.9,
      fillColor: fill,
      fillOpacity: Number.isFinite(Number(props.fillOpacity)) ? Number(props.fillOpacity) : 0.18,
      dashArray: props.dashArray || undefined
    };
  }

  function activeShapes(cfg = activeConfig) {
    return (cfg.shapes || []).filter(feature => feature?.properties?.visible !== false && validGeometry(feature));
  }

  function activeImages(cfg = activeConfig) {
    return (cfg.imageOverlays || []).filter(item => item?.visible !== false && validImageOverlay(item));
  }

  function markerIcon(building, selected) {
    const label = String(building.marker_label || building.abbreviation || building.common_name || building.official_name || 'UAF').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '•';
    const color = isHex(building.marker_color) ? building.marker_color : colors().marker;
    return L.divIcon({
      className: 'uaf-marker-wrap',
      html: '<span class="uaf-marker' + (selected ? ' selected' : '') + '" style="--pin:' + esc(color) + '">' + esc(label) + '</span>',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }

  function parkingIcon(parking) {
    const label = String(parking.code || 'P').slice(0, 4).toUpperCase();
    return L.divIcon({
      className: 'uaf-parking-wrap',
      html: '<span class="uaf-parking-pin">' + esc(label) + '</span>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function renderConfiguredOverlays(map, cfg, callbacks = {}, options = {}) {
    const group = L.layerGroup().addTo(map);
    if (options.images !== false) {
      for (const image of activeImages(cfg)) {
        try {
          L.imageOverlay(image.dataUrl, image.bounds, {
            opacity: Number.isFinite(Number(image.opacity)) ? Number(image.opacity) : 0.85,
            interactive: false,
            zIndex: 420,
            className: 'uaf-image-overlay'
          }).addTo(group);
        } catch (error) {}
      }
    }
    const shapes = activeShapes(cfg);
    if (shapes.length) {
      L.geoJSON({type:'FeatureCollection', features:shapes}, {
        style: feature => shapeStyle(feature, cfg),
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {radius:7, ...shapeStyle(feature, cfg), fillOpacity:0.75}),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          if (props.name) layer.bindTooltip(esc(props.name));
          if (props.building_id && callbacks.onBuilding) {
            layer.on('click', event => callbacks.onBuilding(props.building_id, event.originalEvent || event));
          } else if (props.parking_id && callbacks.onParking) {
            layer.on('click', event => callbacks.onParking(props.parking_id, event.originalEvent || event));
          }
        }
      }).addTo(group);
    }
    return group;
  }

  function externalLink(url, label, className) {
    const href = safeExternal(url);
    if (!href) return '';
    return '<a' + (className ? ' class="' + esc(className) + '"' : '') + ' href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
  }

  function updateUrlParam(key, value, removeKeys = []) {
    const url = new URL(location.href);
    for (const remove of removeKeys) url.searchParams.delete(remove);
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  function shell(title, body, extraClass = '') {
    app.innerHTML = '<main id="main" class="page ' + esc(extraClass) + '"><p class="eyebrow">UAF CAMPUS MAP</p><h1>' + esc(title) + '</h1>' + body + '</main>';
  }

  function publicCard(item, kind) {
    if (kind === 'building') {
      const title = item.common_name || item.official_name || 'Building';
      const services = Array.isArray(item.services) && item.services.length ? item.services.slice(0, 3).join(' · ') : (item.category || 'Campus building').replaceAll('_', ' ');
      return '<button type="button" class="card result-card" data-kind="building" data-id="' + esc(item.id) + '"><span><strong>' + esc(title) + '</strong><small>' + esc(item.address || 'Address pending') + '</small><small>' + esc(services) + '</small></span><span class="card-arrow" aria-hidden="true">›</span></button>';
    }
    return '<button type="button" class="card result-card" data-kind="parking" data-id="' + esc(item.id || item.code) + '"><span><strong>' + esc((item.code || 'P') + ' — ' + (item.name || 'Parking')) + '</strong><small>' + esc(item.restrictions || 'Follow posted parking signs.') + '</small></span><span class="card-arrow" aria-hidden="true">›</span></button>';
  }

  function renderMap() {
    const cfg = activeConfig;
    const settings = getSettings(cfg);
    const labels = settings.labels || {};
    const tabFlags = settings.tabs || {};
    const tabs = [
      ['search','Search'], ['parking','Parking'], ['access','Access'], ['shuttle','Shuttle'], ['trails','Trails'], ['updates','Updates']
    ].filter(([id]) => tabFlags[id] !== false);
    const pilotTitle = settings.pilotTitle || 'Public pilot.';
    const pilotNotice = settings.pilotNotice || 'Use posted campus signage and current UAF resources for verified route information.';
    const tabHtml = tabs.map(([id,label], index) => '<button type="button" role="tab" id="tab-' + id + '" aria-controls="panel-content" aria-selected="' + (index === 0 ? 'true' : 'false') + '" tabindex="' + (index === 0 ? '0' : '-1') + '" data-tab="' + id + '" class="' + (index === 0 ? 'active' : '') + '">' + esc(label) + '</button>').join('');
    app.innerHTML = '<main id="main" class="map-page">' +
      '<div class="notice"><strong>' + esc(pilotTitle) + '</strong> ' + esc(pilotNotice) + '</div>' +
      '<section class="workspace" aria-label="Interactive campus map workspace">' +
      '<aside class="panel"><div class="intro"><p class="eyebrow">UAF CAMPUS MAP</p><h1>This way to UAF.</h1><p>Find buildings, parking, services, shuttles and trails across Troth Yeddha\' Campus.</p></div>' +
      '<form id="search-form" class="search-form" role="search"><label for="q">' + esc(labels.searchLabel || 'Find a building, office, service, or parking lot') + '</label><div class="search-row"><input id="q" type="search" autocomplete="off" placeholder="' + esc(labels.searchPlaceholder || 'Try Wood Center, library, parking…') + '"><button type="submit">' + esc(labels.searchButton || 'Search') + '</button></div></form>' +
      '<div class="filter-row" aria-label="Search filters"><button type="button" class="chip active" data-filter="all" aria-pressed="true">All</button><button type="button" class="chip" data-filter="building" aria-pressed="false">Buildings</button><button type="button" class="chip" data-filter="parking" aria-pressed="false">Parking</button><button type="button" class="chip" data-filter="services" aria-pressed="false">Services</button></div>' +
      '<div class="tabs" role="tablist" aria-label="Campus map information">' + tabHtml + '</div><section id="panel-content" role="tabpanel" aria-live="polite"></section></aside>' +
      '<section class="map-column"><div class="map-toolbar" aria-label="Map controls"><button type="button" id="locate">Use my location</button><button type="button" id="fit">Show campus</button><a href="/print">Print map</a></div>' +
      '<div class="pan-controls" aria-label="Map pan controls"><span>Pan</span><button type="button" data-pan="north" aria-label="Pan map north">↑</button><button type="button" data-pan="west" aria-label="Pan map west">←</button><button type="button" data-pan="east" aria-label="Pan map east">→</button><button type="button" data-pan="south" aria-label="Pan map south">↓</button></div>' +
      '<div id="map" class="map" tabindex="0" aria-label="Interactive UAF campus map. Use the search results or text map for a nonvisual alternative."></div><p class="map-help">The map can be panned by keyboard arrow keys, the pan buttons, or dragging.</p><div id="map-status" class="status" role="status" aria-live="polite"></div></section></section></main>';

    const map = L.map('map', {center:mapCenter(cfg), zoom:Number(settings.map?.zoom || DEFAULT_ZOOM), keyboard:true, zoomControl:true}).setView(mapCenter(cfg), Number(settings.map?.zoom || DEFAULT_ZOOM));
    addBasemap(map, {config:cfg, labels:true});
    const buildingMarkers = new Map();
    const parkingMarkers = new Map();
    let selectedBuilding = '';
    const buildings = getBuildings(cfg);
    const parking = getParking(cfg);

    function openBuilding(id, trigger) {
      const building = buildings.find(item => item.id === id);
      if (!building) return;
      selectedBuilding = id;
      buildingMarkers.forEach((marker, markerId) => marker.setIcon(markerIcon(buildings.find(item => item.id === markerId), markerId === selectedBuilding)));
      if (exact(building)) map.flyTo([Number(building.latitude), Number(building.longitude)], 18, {duration:0.35});
      updateUrlParam('place', building.id, ['parking']);
      const source = safeExternal(building.source_url);
      const services = Array.isArray(building.services) && building.services.length ? '<section><h3>Services and destinations</h3><p>' + esc(building.services.join(' · ')) + '</p></section>' : '';
      const recommended = (building.recommended_parking || []).map(code => parking.find(item => item.code === code || item.id === code)).filter(Boolean);
      const recHtml = recommended.length ? '<section><h3>Suggested visitor parking starting points</h3>' + recommended.map(item => '<p><strong>' + esc((item.code || 'P') + ' — ' + (item.name || 'Parking')) + '</strong><br>' + esc(item.restrictions || '') + '</p>').join('') + '</section>' : '';
      const address = building.address || 'University of Alaska Fairbanks, Fairbanks, AK';
      const google = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);
      const apple = 'https://maps.apple.com/?daddr=' + encodeURIComponent(address);
      const dialog = document.createElement('dialog');
      dialog.className = 'details';
      dialog.innerHTML = '<div class="dialog-head"><div><p class="eyebrow">CAMPUS DESTINATION</p><h2 tabindex="-1">' + esc(building.common_name || building.official_name || 'Building') + '</h2><p>' + esc(building.address || 'Address pending') + '</p></div><button type="button" class="dialog-close" data-close aria-label="Close place details">×</button></div>' +
        '<div class="dialog-body"><dl class="detail-grid"><div><dt>Category</dt><dd>' + esc(String(building.category || 'building').replaceAll('_',' ')) + '</dd></div><div><dt>Map location</dt><dd>' + (exact(building) ? 'Mapped' : 'Address only') + '</dd></div></dl>' + services + recHtml + '<section><h3>Accessibility</h3><p>Use current UAF accessibility resources and posted campus signage for verified accessible-route information.</p>' + externalLink(meta.accessibility?.facilities_url, 'UAF accessibility facilities') + '</section>' + (source ? '<section><h3>Source</h3><p><a href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">Open UAF building profile</a></p></section>' : '') + '</div>' +
        '<div class="dialog-actions"><a class="primary-action" href="' + esc(google) + '" target="_blank" rel="noopener noreferrer">Google directions</a><a href="' + esc(apple) + '" target="_blank" rel="noopener noreferrer">Apple directions</a><a href="/print?mode=selected&place=' + encodeURIComponent(building.id) + '">Print this area</a><button type="button" data-share>Share</button></div>';
      document.body.append(dialog);
      const returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
      const close = () => dialog.open ? dialog.close() : null;
      dialog.querySelector('[data-close]').addEventListener('click', close);
      dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
      dialog.addEventListener('close', () => {dialog.remove(); if (returnFocus?.focus) returnFocus.focus();});
      dialog.querySelector('[data-share]').addEventListener('click', async () => {
        const url = new URL(location.href); url.searchParams.set('place', building.id); url.searchParams.delete('parking');
        try {
          if (navigator.share) await navigator.share({title:building.common_name || building.official_name || 'UAF Campus Map', url:url.href});
          else {await navigator.clipboard.writeText(url.href); setStatus('Share link copied.');}
        } catch (error) {}
      });
      dialog.showModal();
      setTimeout(() => dialog.querySelector('h2')?.focus(), 0);
    }

    function openParking(id, trigger) {
      const item = parking.find(row => row.id === id || row.code === id);
      if (!item) return;
      if (exact(item)) map.flyTo([Number(item.latitude), Number(item.longitude)], 18, {duration:0.35});
      updateUrlParam('parking', item.id || item.code, ['place']);
      const destination = item.address || ('UAF ' + (item.name || item.code || 'parking') + ', Fairbanks, AK');
      const google = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination);
      const dialog = document.createElement('dialog');
      dialog.className = 'details';
      dialog.innerHTML = '<div class="dialog-head"><div><p class="eyebrow">PARKING</p><h2 tabindex="-1">' + esc((item.code || 'P') + ' — ' + (item.name || 'Parking')) + '</h2><p>' + esc(item.restrictions || 'Follow posted parking signs and current UAF Parking Services guidance.') + '</p></div><button type="button" class="dialog-close" data-close aria-label="Close parking details">×</button></div>' +
        '<div class="dialog-body"><section><h3>Visitor guidance</h3><p>' + esc(meta.parking_policy?.visitor_note || 'Check current UAF parking guidance before parking.') + '</p></section><section><h3>Boundary status</h3><p>Use posted signs for enforcement boundaries unless a verified map polygon is shown.</p></section></div>' +
        '<div class="dialog-actions"><a class="primary-action" href="' + esc(google) + '" target="_blank" rel="noopener noreferrer">Google directions</a>' + externalLink(meta.parking_policy?.source_url, 'Parking Services') + '<button type="button" data-share>Share</button></div>';
      document.body.append(dialog);
      const returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
      const close = () => dialog.open ? dialog.close() : null;
      dialog.querySelector('[data-close]').addEventListener('click', close);
      dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
      dialog.addEventListener('close', () => {dialog.remove(); if (returnFocus?.focus) returnFocus.focus();});
      dialog.querySelector('[data-share]').addEventListener('click', async () => {
        const url = new URL(location.href); url.searchParams.set('parking', item.id || item.code); url.searchParams.delete('place');
        try {
          if (navigator.share) await navigator.share({title:(item.code || 'P') + ' — ' + (item.name || 'Parking'), url:url.href});
          else {await navigator.clipboard.writeText(url.href); setStatus('Share link copied.');}
        } catch (error) {}
      });
      dialog.showModal();
      setTimeout(() => dialog.querySelector('h2')?.focus(), 0);
    }

    function setStatus(message) {document.getElementById('map-status').textContent = message || '';}

    renderConfiguredOverlays(map, cfg, {onBuilding:(id,event)=>openBuilding(id,event?.target), onParking:(id,event)=>openParking(id,event?.target)});
    buildings.filter(exact).forEach(building => {
      const marker = L.marker([Number(building.latitude), Number(building.longitude)], {keyboard:true, title:building.common_name || building.official_name || 'Building', alt:(building.common_name || building.official_name || 'Building') + ' map marker', icon:markerIcon(building, false)}).addTo(map);
      marker.on('click', event => openBuilding(building.id, event.originalEvent?.target));
      buildingMarkers.set(building.id, marker);
    });
    parking.filter(exact).forEach(item => {
      const marker = L.marker([Number(item.latitude), Number(item.longitude)], {keyboard:true, title:(item.code || 'P') + ' — ' + (item.name || 'Parking'), alt:(item.name || 'Parking') + ' map marker', icon:parkingIcon(item)}).addTo(map);
      marker.on('click', event => openParking(item.id || item.code, event.originalEvent?.target));
      parkingMarkers.set(item.id || item.code, marker);
    });

    let activeTab = tabs[0]?.[0] || 'search';
    let filter = 'all';
    const content = document.getElementById('panel-content');

    function bindCards() {
      content.querySelectorAll('[data-kind][data-id]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.kind === 'building') openBuilding(button.dataset.id, button); else openParking(button.dataset.id, button);
      }));
      content.querySelectorAll('[data-construction]').forEach(button => button.addEventListener('click', () => {
        const project = meta.construction?.projects?.find(row => row.id === button.dataset.construction);
        if (project?.location_id && buildings.some(building => building.id === project.location_id)) openBuilding(project.location_id, button);
        else if (safeExternal(meta.construction?.source_url)) window.open(meta.construction.source_url, '_blank', 'noopener');
      }));
    }

    function searchItems(query) {
      const q = normalize(query);
      const buildingRows = buildings.filter(item => {
        if (filter === 'parking') return false;
        if (filter === 'services' && !(item.services || []).length) return false;
        if (!q) return true;
        return normalize([item.common_name,item.official_name,item.abbreviation,item.address,item.category,(item.services||[]).join(' '),(item.search_terms||[]).join(' ')].join(' ')).includes(q);
      }).map(item => ({kind:'building', item}));
      const parkingRows = parking.filter(item => {
        if (filter === 'building' || filter === 'services') return false;
        if (!q) return true;
        return normalize([item.code,item.name,item.type,item.restrictions].join(' ')).includes(q);
      }).map(item => ({kind:'parking', item}));
      return [...buildingRows, ...parkingRows];
    }

    function showTab(tab, query) {
      activeTab = tab;
      document.querySelectorAll('.tabs [role="tab"]').forEach(button => {
        const selected = button.dataset.tab === tab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
      });
      if (tab === 'search') {
        const rows = searchItems(query == null ? document.getElementById('q').value : query);
        const popularIds = settings.popularIds || [];
        const popular = !normalize(document.getElementById('q').value) && filter === 'all' ? popularIds.map(id => buildings.find(item => item.id === id)).filter(Boolean) : [];
        content.innerHTML = (popular.length ? '<h2>' + esc(labels.popularHeading || 'Popular destinations') + '</h2><div class="cards">' + popular.map(item => publicCard(item,'building')).join('') + '</div>' : '') + '<h2>' + (normalize(document.getElementById('q').value) ? 'Search results' : esc(labels.allPlacesHeading || 'All places')) + '</h2><p class="result-count">' + rows.length + ' result' + (rows.length === 1 ? '' : 's') + '</p><div class="cards">' + (rows.slice(0,100).map(row => publicCard(row.item,row.kind)).join('') || '<p>No matches. Try a broader search.</p>') + '</div>';
      } else if (tab === 'parking') {
        const policy = meta.parking_policy || {};
        content.innerHTML = '<h2>Parking</h2><p class="callout">Follow posted signs and current UAF Parking Services guidance for enforcement and payment requirements.</p>' + (policy.rates?.length ? '<div class="metric-grid">' + policy.rates.map(rate => '<div class="metric"><strong>Zone ' + esc(rate.zone) + '</strong><span>' + esc(rate.description) + '</span><b>' + esc(rate.rate) + '</b><small>' + esc(rate.limit || '') + '</small></div>').join('') + '</div>' : '') + '<p>' + esc(policy.visitor_note || '') + '</p><p><strong>Accessible parking:</strong> ' + esc(policy.accessible_note || '') + '</p><p>' + externalLink(policy.source_url, 'UAF Parking Services') + '</p><h3>Parking inventory</h3><div class="cards">' + parking.map(item => publicCard(item,'parking')).join('') + '</div>';
      } else if (tab === 'access') {
        const a = meta.accessibility || {};
        content.innerHTML = '<h2>Accessibility</h2><p class="callout">' + esc(a.routing_status || 'Use current UAF accessibility resources for verified accessible-route information.') + '</p><div class="link-stack">' + externalLink(a.facilities_url,'UAF accessibility facilities','primary-action') + externalLink(a.current_restroom_map_url,'ADA / restroom map') + externalLink(a.current_lactation_map_url,'Lactation / changing map') + externalLink(a.parking_policy_url,'Accessible parking policy') + externalLink(a.orca_url,'ADA / Section 504 information') + '</div>';
      } else if (tab === 'shuttle') {
        const shuttle = meta.shuttle || {};
        content.innerHTML = '<h2>Shuttle</h2><p class="callout">' + esc(shuttle.note || 'Use current UAF shuttle sources for schedules and ETAs.') + '</p><div class="link-stack">' + externalLink(shuttle.tracker_url,'Open live BusWhere tracker','primary-action') + externalLink(shuttle.service_url,'Current shuttle schedules') + '</div><h3>Stops / areas</h3><ul class="simple-list">' + (shuttle.stops || []).map(stop => '<li>' + esc(stop) + '</li>').join('') + '</ul>';
      } else if (tab === 'trails') {
        const trails = meta.trails || {}, s = trails.summary || {};
        content.innerHTML = '<h2>North Campus trails</h2><div class="metric-grid"><div class="metric"><strong>' + esc(s.total_miles || '') + '</strong><span>total miles listed</span></div><div class="metric"><strong>' + esc(s.groomed_ski_miles || '') + '</strong><span>groomed ski miles</span></div><div class="metric"><strong>' + esc(s.winter_walking_miles || '') + '</strong><span>winter walking miles</span></div></div><div class="link-stack">' + externalLink(trails.source_url,'Current trails & grooming','primary-action') + externalLink(trails.winter_map_url,'Winter trail map PDF') + '</div><div class="trail-list">' + (trails.items || []).map(item => '<div class="trail-row"><strong>' + esc(item.name) + '</strong><span>' + esc(item.type) + (item.distance_km ? ' · ' + esc(item.distance_km) + ' km' : '') + '</span></div>').join('') + '</div>';
      } else if (tab === 'updates') {
        const construction = meta.construction || {};
        content.innerHTML = '<h2>Construction & updates</h2><p class="callout">' + esc(construction.note || 'This is not a live closure feed.') + '</p><div class="cards">' + (construction.projects || []).map(project => '<button type="button" class="card construction-card" data-construction="' + esc(project.id) + '"><strong>' + esc(project.name) + '</strong><small>' + esc(project.status) + ' · ' + esc(project.scheduled_start) + ' to ' + esc(project.scheduled_end) + '</small><small>' + esc(project.description) + '</small></button>').join('') + '</div><p>' + externalLink(construction.source_url,'Open official construction map') + '</p>';
      }
      bindCards();
    }

    document.querySelectorAll('.tabs [role="tab"]').forEach((button, index, nodes) => {
      button.addEventListener('click', () => showTab(button.dataset.tab));
      button.addEventListener('keydown', event => {
        if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % nodes.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + nodes.length) % nodes.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = nodes.length - 1;
        nodes[next].focus();
        showTab(nodes[next].dataset.tab);
      });
    });
    document.getElementById('search-form').addEventListener('submit', event => {event.preventDefault(); showTab('search', document.getElementById('q').value);});
    document.getElementById('q').addEventListener('input', () => {if (activeTab === 'search') showTab('search');});
    document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
      filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(item => {const on = item === button; item.classList.toggle('active', on); item.setAttribute('aria-pressed', on ? 'true' : 'false');});
      showTab('search');
    }));
    document.getElementById('fit').addEventListener('click', () => map.fitBounds(mainCampusBounds(cfg), {padding:[28,28], maxZoom:16}));
    document.getElementById('locate').addEventListener('click', () => {
      if (!navigator.geolocation) {setStatus('Location services are not supported in this browser.'); return;}
      setStatus('Finding your location…');
      navigator.geolocation.getCurrentPosition(position => {
        const point = [position.coords.latitude, position.coords.longitude];
        L.circleMarker(point,{radius:9,color:'#fff',weight:4,fillColor:colors().blue,fillOpacity:1}).addTo(map).bindTooltip('You are here').openTooltip();
        map.setView(point, 17); setStatus('Location found.');
      }, () => setStatus('Location permission was unavailable. You can still search by building or address.'), {enableHighAccuracy:true,timeout:9000});
    });
    document.querySelectorAll('[data-pan]').forEach(button => button.addEventListener('click', () => {
      const move = {north:[0,-160],south:[0,160],west:[-160,0],east:[160,0]}[button.dataset.pan];
      if (move) map.panBy(move,{animate:false});
    }));
    showTab(activeTab);
    const params = new URLSearchParams(location.search);
    const place = params.get('place'), parkingId = params.get('parking');
    if (place) setTimeout(() => openBuilding(place, null), 80); else if (parkingId) setTimeout(() => openParking(parkingId, null), 80);
  }

  const admin = {
    config: normalizeConfig(activeConfig),
    step: 1,
    kind: '',
    buildingId: '',
    parkingId: '',
    shapeId: '',
    map: null,
    context: null,
    editable: null,
    layers: new Map(),
    marker: null,
    drawing: false,
    editing: false
  };

  function adminBuildings() {return getBuildings(admin.config, true);}
  function adminParking() {return getParking(admin.config, true);}
  function adminBuilding() {return adminBuildings().find(item => item.id === admin.buildingId);}
  function adminParkingItem() {return adminParking().find(item => item.id === admin.parkingId || item.code === admin.parkingId);}
  function adminShape() {return (admin.config.shapes || []).find(feature => feature.properties?.id === admin.shapeId);}

  function updateBuilding(id, patch) {
    const index = admin.config.customBuildings.findIndex(item => item.id === id);
    if (index >= 0) admin.config.customBuildings[index] = {...admin.config.customBuildings[index], ...patch};
    else admin.config.buildingOverrides[id] = {...(admin.config.buildingOverrides[id] || {}), ...patch};
  }

  function updateParking(id, patch) {
    const index = admin.config.customParking.findIndex(item => item.id === id);
    if (index >= 0) admin.config.customParking[index] = {...admin.config.customParking[index], ...patch};
    else admin.config.parkingOverrides[id] = {...(admin.config.parkingOverrides[id] || {}), ...patch};
  }

  function updateShape(id, patch) {
    admin.config.shapes = (admin.config.shapes || []).map(feature => feature.properties?.id === id ? {...feature, properties:{...(feature.properties || {}), ...patch}} : feature);
  }

  function adminStatus(message, tone) {
    const node = document.getElementById('admin-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
  }

  function saveAdminDraft() {
    localStorage.setItem('uaf-map-config-draft', JSON.stringify({time:Date.now(), config:admin.config}));
    adminStatus('Draft saved in this browser. It is not public yet.', 'success');
  }

  function loadAdminDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem('uaf-map-config-draft') || 'null');
      if (!parsed?.config) throw new Error('No saved draft');
      admin.config = normalizeConfig(parsed.config);
      adminStatus('Saved browser draft loaded.', 'success');
      renderAdminStep();
    } catch (error) {
      adminStatus('No valid browser draft was found.', 'error');
    }
  }

  function destroyAdminMap() {
    if (admin.map) admin.map.remove();
    admin.map = null; admin.context = null; admin.editable = null; admin.layers = new Map(); admin.marker = null; admin.drawing = false; admin.editing = false;
  }

  function wizardMarkup() {
    return '<div class="wizard-steps" aria-label="Editing progress">' +
      '<button type="button" data-wizard-step="1" class="' + (admin.step === 1 ? 'current' : admin.step > 1 ? 'done' : '') + '"><span>1</span><strong>Choose</strong><small>Pick what to edit</small></button>' +
      '<button type="button" data-wizard-step="2" ' + (!admin.kind ? 'disabled' : '') + ' class="' + (admin.step === 2 ? 'current' : admin.step > 2 ? 'done' : '') + '"><span>2</span><strong>Edit</strong><small>Make the change</small></button>' +
      '<button type="button" data-wizard-step="3" ' + (!admin.kind ? 'disabled' : '') + ' class="' + (admin.step === 3 ? 'current' : '') + '"><span>3</span><strong>Publish</strong><small>Save to GitHub</small></button></div>';
  }

  function renderAdmin() {
    admin.buildingId = admin.buildingId || adminBuildings()[0]?.id || '';
    admin.parkingId = admin.parkingId || adminParking()[0]?.id || adminParking()[0]?.code || '';
    app.innerHTML = '<main id="main" class="page admin-page"><div class="admin-title"><div><p class="eyebrow">UAF CAMPUS MAP ADMIN</p><h1>Map editor</h1><p>Choose it. Change it. Publish it.</p></div><div class="admin-top-actions"><a href="/" target="_blank" rel="noopener">Open public map</a><a href="/admin/images">PNG overlays</a></div></div>' + wizardMarkup() + '<div id="admin-status" class="admin-status" role="status" aria-live="polite">Choose what you want to edit.</div><section id="admin-panel" class="wizard-panel"></section></main>';
    document.querySelectorAll('[data-wizard-step]').forEach(button => button.addEventListener('click', () => {if (button.disabled) return; admin.step = Number(button.dataset.wizardStep); renderAdminStep();}));
    renderAdminStep();
  }

  function renderAdminStep() {
    destroyAdminMap();
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    document.querySelectorAll('[data-wizard-step]').forEach(button => {
      const step = Number(button.dataset.wizardStep);
      button.disabled = step > 1 && !admin.kind;
      button.className = step === admin.step ? 'current' : step < admin.step ? 'done' : '';
    });
    if (admin.step === 1) renderAdminChoose(panel);
    if (admin.step === 2) renderAdminEdit(panel);
    if (admin.step === 3) renderAdminPublish(panel);
  }

  function renderAdminChoose(panel) {
    const choices = [
      ['building','Building','Edit names, address, services, marker and footprint.'],
      ['parking','Parking','Edit parking information and draw its map area.'],
      ['shape','Shape / area','Draw or edit a custom map polygon, line or point.'],
      ['content','Words','Change public headings, search text and notices.'],
      ['appearance','Appearance','Change colors and the starting map view.'],
      ['layers','Layers','Turn public information tabs on or off.'],
      ['advanced','Advanced','Edit the complete configuration JSON.']
    ];
    panel.innerHTML = '<div class="wizard-heading"><p class="eyebrow">STEP 1</p><h2>What do you want to edit?</h2><p>Building footprints and parking areas can be changed directly on the map.</p></div><div class="edit-choice-grid">' + choices.map(([id,label,description]) => '<button type="button" data-choice="' + id + '"><span class="choice-arrow" aria-hidden="true">→</span><strong>' + esc(label) + '</strong><small>' + esc(description) + '</small></button>').join('') + '</div><div class="draft-row"><button type="button" id="load-draft">Load saved draft</button><button type="button" id="save-draft">Save current draft</button><a href="https://github.com/' + REPO + '" target="_blank" rel="noopener noreferrer">Open GitHub</a></div>';
    panel.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {admin.kind = button.dataset.choice; admin.step = 2; adminStatus('Step 2: make your changes.', ''); renderAdminStep();}));
    document.getElementById('load-draft').addEventListener('click', loadAdminDraft);
    document.getElementById('save-draft').addEventListener('click', saveAdminDraft);
  }

  function field(label, id, value, type = 'text', extra = '') {
    return '<label class="admin-field"><span>' + esc(label) + '</span><input id="' + esc(id) + '" type="' + esc(type) + '" value="' + esc(value == null ? '' : value) + '" ' + extra + '></label>';
  }

  function renderAdminEdit(panel) {
    panel.innerHTML = '<div class="wizard-heading"><p class="eyebrow">STEP 2</p><h2>Edit ' + esc(admin.kind === 'shape' ? 'shape / area' : admin.kind) + '</h2></div><div id="admin-editor"></div><div class="wizard-footer"><button type="button" id="choose-again">← Choose something else</button><button type="button" id="review-publish" class="primary-admin">Review & publish →</button></div>';
    document.getElementById('choose-again').addEventListener('click', () => {admin.step = 1; admin.kind = ''; renderAdminStep();});
    document.getElementById('review-publish').addEventListener('click', () => {admin.step = 3; renderAdminStep();});
    if (admin.kind === 'building') renderBuildingEditor();
    if (admin.kind === 'parking') renderParkingEditor();
    if (admin.kind === 'shape') renderShapeEditor();
    if (admin.kind === 'content') renderContentEditor();
    if (admin.kind === 'appearance') renderAppearanceEditor();
    if (admin.kind === 'layers') renderLayerEditor();
    if (admin.kind === 'advanced') renderAdvancedEditor();
  }

  function renderBuildingEditor() {
    const editor = document.getElementById('admin-editor');
    const buildings = adminBuildings();
    const selected = buildings.find(item => item.id === admin.buildingId) || buildings[0];
    if (!selected) {editor.innerHTML = '<p>No buildings are available.</p>'; return;}
    admin.buildingId = selected.id;
    const associated = (admin.config.shapes || []).find(feature => feature.properties?.kind === 'building-footprint' && feature.properties?.building_id === selected.id);
    admin.shapeId = associated?.properties?.id || '';
    editor.innerHTML = '<div class="editor-picker"><label class="admin-field"><span>Find a building</span><input id="building-search" type="search" placeholder="Search buildings…"></label><label class="admin-field"><span>Building</span><select id="building-select">' + buildings.map(item => '<option value="' + esc(item.id) + '" ' + (item.id === selected.id ? 'selected' : '') + '>' + esc(item.common_name || item.official_name || item.id) + '</option>').join('') + '</select></label><button type="button" id="new-building">+ New building</button></div>' +
      '<div class="visual-editor"><section class="editor-fields"><h3>1. Building information</h3><div class="admin-grid two">' +
      field('Public name','b-name',selected.common_name || '') + field('Official name','b-official',selected.official_name || '') + field('Abbreviation / label','b-abbr',selected.abbreviation || selected.marker_label || '') + field('Category','b-category',selected.category || '') + field('Address','b-address',selected.address || '') + field('Latitude','b-lat',selected.latitude ?? '', 'number','step="0.0000001"') + field('Longitude','b-lng',selected.longitude ?? '', 'number','step="0.0000001"') + field('Services (comma separated)','b-services',(selected.services || []).join(', ')) + field('Recommended parking codes / IDs','b-parking',(selected.recommended_parking || []).join(', ')) + field('Marker color','b-color',selected.marker_color || colors().marker,'color') + '</div><label class="admin-switch"><input id="b-visible" type="checkbox" ' + (selected.visible !== false ? 'checked' : '') + '><span>Show this building publicly</span></label>' +
      '<div class="geometry-card"><h3>2. Building footprint</h3><p>Drag the building marker or click the map to move it. Draw a polygon or rectangle for the building footprint.</p><div class="geometry-actions"><button type="button" id="draw-footprint">Draw footprint</button><button type="button" id="draw-rectangle">Draw rectangle</button><button type="button" id="edit-shape" ' + (!associated ? 'disabled' : '') + '>Edit corners</button><button type="button" id="save-shape" hidden>Save shape changes</button><button type="button" id="cancel-shape" hidden>Cancel</button><button type="button" id="delete-shape" class="danger" ' + (!associated ? 'disabled' : '') + '>Delete footprint</button></div><div id="shape-fields"></div></div></section><section class="editor-map-wrap"><div class="editor-map-head"><div><strong>Visual building editor</strong><small>Drag the marker, click to move it, or draw its footprint.</small></div><button type="button" id="fit-admin">Show selected</button></div><div id="admin-map" class="editor-map" aria-label="Visual building map editor"></div></section></div>';

    const bind = (id, event, fn) => document.getElementById(id).addEventListener(event, fn);
    bind('building-select','change', event => {admin.buildingId = event.target.value; renderAdminStep();});
    bind('building-search','input', event => {
      const query = normalize(event.target.value); const select = document.getElementById('building-select');
      select.innerHTML = buildings.filter(item => normalize([item.common_name,item.official_name,item.address,item.abbreviation].join(' ')).includes(query)).map(item => '<option value="' + esc(item.id) + '" ' + (item.id === admin.buildingId ? 'selected' : '') + '>' + esc(item.common_name || item.official_name || item.id) + '</option>').join('');
    });
    bind('new-building','click', () => {
      const center = admin.map?.getCenter() || L.latLng(mapCenter(admin.config));
      const id = 'custom-building-' + Date.now();
      admin.config.customBuildings.push({id,official_name:'New building',common_name:'New building',abbreviation:'',category:'service',address:'',latitude:Number(center.lat.toFixed(7)),longitude:Number(center.lng.toFixed(7)),geometry_status:'admin custom — verify UAF GIS',source_url:'',services:[],search_terms:[],recommended_parking:[],marker_label:'',marker_color:admin.config.settings.colors?.marker || '#236192',visible:true});
      admin.buildingId = id; renderAdminStep(); adminStatus('New building added to the draft.', 'success');
    });
    bind('b-name','input', event => updateBuilding(selected.id,{common_name:event.target.value}));
    bind('b-official','input', event => updateBuilding(selected.id,{official_name:event.target.value}));
    bind('b-abbr','input', event => updateBuilding(selected.id,{abbreviation:event.target.value,marker_label:event.target.value}));
    bind('b-category','input', event => updateBuilding(selected.id,{category:event.target.value}));
    bind('b-address','input', event => updateBuilding(selected.id,{address:event.target.value}));
    bind('b-lat','input', event => {updateBuilding(selected.id,{latitude:event.target.value === '' ? null : Number(event.target.value)}); updateAdminMarker();});
    bind('b-lng','input', event => {updateBuilding(selected.id,{longitude:event.target.value === '' ? null : Number(event.target.value)}); updateAdminMarker();});
    bind('b-services','input', event => updateBuilding(selected.id,{services:csv(event.target.value)}));
    bind('b-parking','input', event => updateBuilding(selected.id,{recommended_parking:csv(event.target.value)}));
    bind('b-color','input', event => updateBuilding(selected.id,{marker_color:event.target.value}));
    bind('b-visible','change', event => updateBuilding(selected.id,{visible:event.target.checked}));
    initAdminMap('building');
    bindSpatialButtons('building');
    renderAdminShapeFields();
  }

  function renderParkingEditor() {
    const editor = document.getElementById('admin-editor');
    const rows = adminParking();
    const selected = rows.find(item => item.id === admin.parkingId || item.code === admin.parkingId) || rows[0];
    if (!selected) {editor.innerHTML = '<p>No parking records are available.</p>'; return;}
    admin.parkingId = selected.id || selected.code;
    const associated = (admin.config.shapes || []).find(feature => feature.properties?.kind === 'parking-area' && (feature.properties?.parking_id === selected.id || feature.properties?.parking_id === selected.code));
    admin.shapeId = associated?.properties?.id || '';
    editor.innerHTML = '<div class="editor-picker"><label class="admin-field"><span>Find parking</span><input id="parking-search" type="search" placeholder="Search code or name…"></label><label class="admin-field"><span>Parking</span><select id="parking-select">' + rows.map(item => '<option value="' + esc(item.id || item.code) + '" ' + ((item.id || item.code) === admin.parkingId ? 'selected' : '') + '>' + esc((item.code || 'P') + ' — ' + (item.name || 'Parking')) + '</option>').join('') + '</select></label><button type="button" id="new-parking">+ New parking</button></div>' +
      '<div class="visual-editor"><section class="editor-fields"><h3>1. Parking information</h3><div class="admin-grid two">' + field('Code','p-code',selected.code || '') + field('Name','p-name',selected.name || '') + field('Type','p-type',selected.type || '') + '</div><label class="admin-field"><span>Restrictions / visitor guidance</span><textarea id="p-restrictions" rows="5">' + esc(selected.restrictions || '') + '</textarea></label><label class="admin-switch"><input id="p-visible" type="checkbox" ' + (selected.visible !== false ? 'checked' : '') + '><span>Show this parking record publicly</span></label>' +
      '<div class="geometry-card"><h3>2. Parking boundary</h3><p>Draw the parking area as a polygon or rectangle.</p><div class="geometry-actions"><button type="button" id="draw-footprint">Draw parking area</button><button type="button" id="draw-rectangle">Draw rectangle</button><button type="button" id="edit-shape" ' + (!associated ? 'disabled' : '') + '>Edit corners</button><button type="button" id="save-shape" hidden>Save shape changes</button><button type="button" id="cancel-shape" hidden>Cancel</button><button type="button" id="delete-shape" class="danger" ' + (!associated ? 'disabled' : '') + '>Delete boundary</button></div><div id="shape-fields"></div></div></section><section class="editor-map-wrap"><div class="editor-map-head"><div><strong>Visual parking editor</strong><small>Draw or reshape the selected parking boundary.</small></div><button type="button" id="fit-admin">Show selected</button></div><div id="admin-map" class="editor-map" aria-label="Visual parking map editor"></div></section></div>';
    const bind = (id,event,fn) => document.getElementById(id).addEventListener(event,fn);
    bind('parking-select','change', event => {admin.parkingId = event.target.value; renderAdminStep();});
    bind('parking-search','input', event => {const q=normalize(event.target.value), select=document.getElementById('parking-select');select.innerHTML=rows.filter(item=>normalize([item.code,item.name,item.restrictions].join(' ')).includes(q)).map(item=>'<option value="'+esc(item.id||item.code)+'" '+((item.id||item.code)===admin.parkingId?'selected':'')+'>'+esc((item.code||'P')+' — '+(item.name||'Parking'))+'</option>').join('');});
    bind('new-parking','click', () => {const id='custom-parking-'+Date.now();admin.config.customParking.push({id,code:'NEW',name:'New parking area',type:'permit_pay_by_plate',restrictions:'',visible:true});admin.parkingId=id;renderAdminStep();adminStatus('New parking record added to the draft.','success');});
    bind('p-code','input', event => updateParking(selected.id,{code:event.target.value}));
    bind('p-name','input', event => updateParking(selected.id,{name:event.target.value}));
    bind('p-type','input', event => updateParking(selected.id,{type:event.target.value}));
    bind('p-restrictions','input', event => updateParking(selected.id,{restrictions:event.target.value}));
    bind('p-visible','change', event => updateParking(selected.id,{visible:event.target.checked}));
    initAdminMap('parking'); bindSpatialButtons('parking'); renderAdminShapeFields();
  }

  function renderShapeEditor() {
    const editor = document.getElementById('admin-editor');
    const shapes = admin.config.shapes || [];
    if (!admin.shapeId && shapes[0]) admin.shapeId = shapes[0].properties?.id || '';
    editor.innerHTML = '<div class="visual-editor"><section class="editor-fields"><h3>1. Custom shapes</h3><label class="admin-field"><span>Select shape</span><select id="shape-select"><option value="">Select a shape…</option>' + shapes.map(feature => '<option value="' + esc(feature.properties?.id || '') + '" ' + (feature.properties?.id === admin.shapeId ? 'selected' : '') + '>' + esc(feature.properties?.name || feature.properties?.id || 'Shape') + '</option>').join('') + '</select></label><div class="geometry-actions"><button type="button" id="draw-footprint">Draw polygon</button><button type="button" id="draw-rectangle">Draw rectangle</button><button type="button" id="draw-line">Draw line</button><button type="button" id="draw-point">Add point</button><button type="button" id="edit-shape" ' + (!admin.shapeId ? 'disabled' : '') + '>Edit selected</button><button type="button" id="save-shape" hidden>Save shape changes</button><button type="button" id="cancel-shape" hidden>Cancel</button><button type="button" id="delete-shape" class="danger" ' + (!admin.shapeId ? 'disabled' : '') + '>Delete</button></div><div id="shape-fields"></div></section><section class="editor-map-wrap"><div class="editor-map-head"><div><strong>Visual shape editor</strong><small>Draw, select and reshape custom map objects.</small></div><button type="button" id="fit-admin">Show campus</button></div><div id="admin-map" class="editor-map" aria-label="Visual custom shape editor"></div></section></div>';
    document.getElementById('shape-select').addEventListener('change', event => {admin.shapeId = event.target.value; renderAdminStep();});
    initAdminMap('shape'); bindSpatialButtons('shape'); renderAdminShapeFields();
  }

  function renderContentEditor() {
    const cfg = admin.config, s = cfg.settings, labels = s.labels || {};
    document.getElementById('admin-editor').innerHTML = '<div class="admin-grid two">' + field('Site title','c-site',s.siteTitle || '') + field('Map title','c-subtitle',s.siteSubtitle || '') + field('Pilot heading','c-pilot',s.pilotTitle || '') + field('Search label','c-search-label',labels.searchLabel || '') + field('Search placeholder','c-search-placeholder',labels.searchPlaceholder || '') + field('Popular destinations heading','c-popular',labels.popularHeading || '') + '</div><label class="admin-field"><span>Public pilot / map notice</span><textarea id="c-notice" rows="7">' + esc(s.pilotNotice || '') + '</textarea></label>';
    const map = [['c-site','siteTitle'],['c-subtitle','siteSubtitle'],['c-pilot','pilotTitle']];
    map.forEach(([id,key]) => document.getElementById(id).addEventListener('input', event => admin.config.settings[key]=event.target.value));
    [['c-search-label','searchLabel'],['c-search-placeholder','searchPlaceholder'],['c-popular','popularHeading']].forEach(([id,key])=>document.getElementById(id).addEventListener('input',event=>admin.config.settings.labels[key]=event.target.value));
    document.getElementById('c-notice').addEventListener('input', event => admin.config.settings.pilotNotice=event.target.value);
  }

  function renderAppearanceEditor() {
    const c = admin.config.settings.colors || {}, map = admin.config.settings.map || {};
    document.getElementById('admin-editor').innerHTML = '<div class="admin-grid three">' + field('UAF blue','a-blue',c.blue || '#236192','color') + field('UAF gold','a-gold',c.gold || '#FFCD00','color') + field('Building marker','a-marker',c.marker || '#236192','color') + field('Parking','a-parking',c.parking || '#71984A','color') + field('Accessibility','a-access',c.access || '#111C4E','color') + field('Trails','a-trail',c.trail || '#71984A','color') + field('Closures','a-closure',c.closure || '#DF6A2E','color') + field('Start latitude','a-lat',map.center?.[0] ?? DEFAULT_CENTER[0],'number','step="0.000001"') + field('Start longitude','a-lng',map.center?.[1] ?? DEFAULT_CENTER[1],'number','step="0.000001"') + field('Start zoom','a-zoom',map.zoom ?? DEFAULT_ZOOM,'number','min="10" max="20" step="1"') + '</div><p class="callout">The ArcGIS imagery configuration is preserved separately and is not displayed or editable here.</p>';
    const colorMap = [['a-blue','blue'],['a-gold','gold'],['a-marker','marker'],['a-parking','parking'],['a-access','access'],['a-trail','trail'],['a-closure','closure']];
    colorMap.forEach(([id,key])=>document.getElementById(id).addEventListener('input',event=>admin.config.settings.colors[key]=event.target.value));
    const updateCenter=()=>admin.config.settings.map.center=[Number(document.getElementById('a-lat').value),Number(document.getElementById('a-lng').value)];
    document.getElementById('a-lat').addEventListener('input',updateCenter);document.getElementById('a-lng').addEventListener('input',updateCenter);document.getElementById('a-zoom').addEventListener('input',event=>admin.config.settings.map.zoom=Number(event.target.value));
  }

  function renderLayerEditor() {
    const tabs = admin.config.settings.tabs || {};
    document.getElementById('admin-editor').innerHTML = '<div class="switch-grid">' + ['search','parking','access','shuttle','trails','updates'].map(key => '<label class="admin-switch"><input type="checkbox" data-layer="' + key + '" ' + (tabs[key] !== false ? 'checked' : '') + '><span>Show ' + esc(key) + '</span></label>').join('') + '</div>';
    document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>admin.config.settings.tabs[input.dataset.layer]=input.checked));
  }

  function renderAdvancedEditor() {
    document.getElementById('admin-editor').innerHTML = '<label class="admin-field"><span>Complete map configuration JSON</span><textarea id="advanced-json" class="json-editor" spellcheck="false">' + esc(JSON.stringify(admin.config,null,2)) + '</textarea></label><button type="button" id="apply-json">Apply JSON to draft</button><p class="inline-status" id="json-status" role="status"></p>';
    document.getElementById('apply-json').addEventListener('click',()=>{try{admin.config=normalizeConfig(JSON.parse(document.getElementById('advanced-json').value));document.getElementById('json-status').textContent='JSON applied to the draft.';}catch(error){document.getElementById('json-status').textContent='JSON error: '+error.message;}});
  }

  function initAdminMap(kind) {
    const node = document.getElementById('admin-map');
    if (!node || typeof L === 'undefined') return;
    const focusItem = kind === 'building' ? adminBuilding() : kind === 'parking' ? adminParkingItem() : null;
    const center = focusItem && exact(focusItem) ? [Number(focusItem.latitude),Number(focusItem.longitude)] : mapCenter(admin.config);
    admin.map = L.map(node,{center,zoom:focusItem&&exact(focusItem)?18:Number(admin.config.settings.map?.zoom||DEFAULT_ZOOM),keyboard:true});
    addBasemap(admin.map,{config:admin.config,labels:true});
    admin.context = L.featureGroup().addTo(admin.map); admin.editable = L.featureGroup().addTo(admin.map);
    admin.map.on(L.Draw.Event.CREATED, event => {
      admin.drawing = false;
      const feature = event.layer.toGeoJSON();
      const id = 'shape-' + Date.now();
      let props = {id,name:'New ' + event.layerType,kind:'custom-shape',visible:true,stroke:admin.config.settings.colors?.blue||'#236192',fill:admin.config.settings.colors?.blue||'#236192',weight:3,opacity:0.9,fillOpacity:0.18};
      if (kind === 'building') {
        admin.config.shapes = admin.config.shapes.filter(item => !(item.properties?.kind==='building-footprint' && item.properties?.building_id===admin.buildingId));
        props = {...props,name:(adminBuilding()?.common_name||'Building')+' footprint',kind:'building-footprint',building_id:admin.buildingId};
      } else if (kind === 'parking') {
        admin.config.shapes = admin.config.shapes.filter(item => !(item.properties?.kind==='parking-area' && item.properties?.parking_id===admin.parkingId));
        props = {...props,name:(adminParkingItem()?.name||'Parking')+' area',kind:'parking-area',parking_id:admin.parkingId,stroke:admin.config.settings.colors?.parking||'#71984A',fill:admin.config.settings.colors?.parking||'#71984A'};
      }
      feature.properties = props; admin.config.shapes.push(feature); admin.shapeId=id; adminStatus(props.name+' added to the draft.','success'); renderAdminStep();
    });
    admin.map.on('draw:drawstop',()=>admin.drawing=false);
    admin.map.on('click',event=>{if(kind!=='building'||admin.drawing||admin.editing)return;updateBuilding(admin.buildingId,{latitude:Number(event.latlng.lat.toFixed(7)),longitude:Number(event.latlng.lng.toFixed(7))});const lat=document.getElementById('b-lat'),lng=document.getElementById('b-lng');if(lat)lat.value=event.latlng.lat.toFixed(7);if(lng)lng.value=event.latlng.lng.toFixed(7);updateAdminMarker();adminStatus('Building marker moved in the draft.','success');});
    rebuildAdminShapes(); updateAdminMarker();
    document.getElementById('fit-admin')?.addEventListener('click',()=>fitAdminMap());
    setTimeout(()=>admin.map?.invalidateSize(),80);
  }

  function rebuildAdminShapes() {
    if (!admin.map || !admin.context || !admin.editable) return;
    admin.context.clearLayers(); admin.editable.clearLayers(); admin.layers.clear();
    const all = admin.config.shapes || [];
    for (const feature of all) {
      if (!validGeometry(feature)) continue;
      const props = feature.properties || {};
      const relevant = admin.kind === 'shape' || (admin.kind === 'building' && props.kind==='building-footprint' && props.building_id===admin.buildingId) || (admin.kind === 'parking' && props.kind==='parking-area' && props.parking_id===admin.parkingId);
      const target = relevant ? admin.editable : admin.context;
      const holder = L.geoJSON(feature,{style:f=>({...shapeStyle(f,admin.config,f.properties?.id===admin.shapeId),opacity:relevant?0.95:0.28,fillOpacity:relevant?shapeStyle(f,admin.config).fillOpacity:0.05}),pointToLayer:(f,ll)=>L.marker(ll,{draggable:false,title:f.properties?.name||'Map point'}),onEachFeature:(f,layer)=>{if(f.properties?.name)layer.bindTooltip(f.properties.name);if(relevant)layer.on('click',()=>{admin.shapeId=f.properties?.id||'';renderAdminShapeFields();rebuildAdminShapes();});}});
      holder.eachLayer(layer=>{target.addLayer(layer);if(relevant&&props.id)admin.layers.set(props.id,layer);});
    }
  }

  function updateAdminMarker() {
    if (!admin.map || admin.kind !== 'building') return;
    if (admin.marker) {admin.map.removeLayer(admin.marker);admin.marker=null;}
    const building = adminBuilding(); if (!building || !exact(building)) return;
    admin.marker=L.marker([Number(building.latitude),Number(building.longitude)],{draggable:true,title:'Move '+(building.common_name||'building')}).addTo(admin.map).bindTooltip('Drag to move building');
    admin.marker.on('dragend',()=>{const p=admin.marker.getLatLng();updateBuilding(building.id,{latitude:Number(p.lat.toFixed(7)),longitude:Number(p.lng.toFixed(7))});const lat=document.getElementById('b-lat'),lng=document.getElementById('b-lng');if(lat)lat.value=p.lat.toFixed(7);if(lng)lng.value=p.lng.toFixed(7);adminStatus('Building marker updated in the draft.','success');});
  }

  function fitAdminMap() {
    if (!admin.map) return;
    const shape = adminShape();
    if (shape && validGeometry(shape)) {
      const holder=L.geoJSON(shape); const bounds=holder.getBounds(); if(bounds.isValid()){admin.map.fitBounds(bounds.pad(0.7),{maxZoom:19});return;}
    }
    const item = admin.kind==='building'?adminBuilding():admin.kind==='parking'?adminParkingItem():null;
    if(item&&exact(item)){admin.map.setView([Number(item.latitude),Number(item.longitude)],18);return;}
    admin.map.fitBounds(mainCampusBounds(admin.config),{padding:[20,20],maxZoom:16});
  }

  function startAdminDraw(type) {
    if (!admin.map || typeof L.Draw === 'undefined') {adminStatus('Drawing tools did not load. Reload the page and try again.','error');return;}
    admin.drawing=true;admin.editing=false;
    const color = admin.kind==='parking'?(admin.config.settings.colors?.parking||'#71984A'):(admin.config.settings.colors?.blue||'#236192');
    const options={shapeOptions:{color,weight:3,fillOpacity:0.18}};
    let tool=null;
    if(type==='polygon')tool=new L.Draw.Polygon(admin.map,options);
    if(type==='rectangle')tool=new L.Draw.Rectangle(admin.map,options);
    if(type==='polyline')tool=new L.Draw.Polyline(admin.map,options);
    if(type==='marker')tool=new L.Draw.Marker(admin.map);
    tool?.enable(); adminStatus(type==='marker'?'Click the map to place the point.':'Click the map to draw the shape. Finish the shape to save it to the draft.','');
  }

  function bindSpatialButtons(kind) {
    document.getElementById('draw-footprint')?.addEventListener('click',()=>startAdminDraw('polygon'));
    document.getElementById('draw-rectangle')?.addEventListener('click',()=>startAdminDraw('rectangle'));
    document.getElementById('draw-line')?.addEventListener('click',()=>startAdminDraw('polyline'));
    document.getElementById('draw-point')?.addEventListener('click',()=>startAdminDraw('marker'));
    document.getElementById('edit-shape')?.addEventListener('click',beginAdminShapeEdit);
    document.getElementById('save-shape')?.addEventListener('click',saveAdminShapeEdit);
    document.getElementById('cancel-shape')?.addEventListener('click',cancelAdminShapeEdit);
    document.getElementById('delete-shape')?.addEventListener('click',()=>{if(!admin.shapeId)return;admin.config.shapes=admin.config.shapes.filter(feature=>feature.properties?.id!==admin.shapeId);admin.shapeId='';admin.editing=false;renderAdminStep();adminStatus('Shape removed from the draft.','success');});
  }

  function beginAdminShapeEdit() {
    const layer = admin.layers.get(admin.shapeId);
    if (!layer) {adminStatus('Select or draw a shape first.','error');return;}
    if (layer instanceof L.Marker) layer.dragging?.enable(); else layer.editing?.enable();
    admin.editing=true; document.getElementById('save-shape').hidden=false;document.getElementById('cancel-shape').hidden=false;document.getElementById('edit-shape').disabled=true;adminStatus('Drag the point or corner handles, then save the shape changes.','');
  }

  function saveAdminShapeEdit() {
    const layer=admin.layers.get(admin.shapeId), original=adminShape(); if(!layer||!original)return;
    layer.dragging?.disable();layer.editing?.disable();const next=layer.toGeoJSON();next.properties={...(original.properties||{})};admin.config.shapes=admin.config.shapes.map(feature=>feature.properties?.id===admin.shapeId?next:feature);admin.editing=false;renderAdminStep();adminStatus('Shape geometry saved in the draft.','success');
  }

  function cancelAdminShapeEdit() {admin.editing=false;renderAdminStep();adminStatus('Shape edit cancelled.','');}

  function renderAdminShapeFields() {
    const holder=document.getElementById('shape-fields');if(!holder)return;const shape=adminShape();if(!shape){holder.innerHTML='<p class="muted">No shape is selected yet.</p>';return;}const p=shape.properties||{};
    holder.innerHTML='<div class="shape-properties"><label class="admin-field"><span>Shape name</span><input id="s-name" value="'+esc(p.name||'')+'"></label><div class="admin-grid two">'+field('Outline','s-stroke',p.stroke||'#236192','color')+field('Fill','s-fill',p.fill||p.stroke||'#236192','color')+field('Line width','s-weight',p.weight||3,'number','min="1" max="10"')+field('Fill opacity','s-opacity',p.fillOpacity??0.18,'number','min="0" max="1" step="0.05"')+'</div>'+ (admin.kind==='shape'?'<label class="admin-field"><span>Link to building</span><select id="s-building"><option value="">None</option>'+adminBuildings().map(item=>'<option value="'+esc(item.id)+'" '+(p.building_id===item.id?'selected':'')+'>'+esc(item.common_name||item.official_name||item.id)+'</option>').join('')+'</select></label><label class="admin-field"><span>Link to parking</span><select id="s-parking"><option value="">None</option>'+adminParking().map(item=>'<option value="'+esc(item.id||item.code)+'" '+(p.parking_id===(item.id||item.code)?'selected':'')+'>'+esc((item.code||'P')+' — '+(item.name||'Parking'))+'</option>').join('')+'</select></label>':'')+'<label class="admin-switch"><input id="s-visible" type="checkbox" '+(p.visible!==false?'checked':'')+'><span>Show this shape publicly</span></label></div>';
    const change=(id,key,transform=value=>value)=>document.getElementById(id)?.addEventListener('input',event=>{updateShape(admin.shapeId,{[key]:transform(event.target.value)});rebuildAdminShapes();});
    change('s-name','name');change('s-stroke','stroke');change('s-fill','fill');change('s-weight','weight',Number);change('s-opacity','fillOpacity',Number);document.getElementById('s-visible')?.addEventListener('change',event=>updateShape(admin.shapeId,{visible:event.target.checked}));
    document.getElementById('s-building')?.addEventListener('change',event=>{updateShape(admin.shapeId,{building_id:event.target.value,parking_id:event.target.value?'':(adminShape()?.properties?.parking_id||'')});renderAdminShapeFields();});
    document.getElementById('s-parking')?.addEventListener('change',event=>{updateShape(admin.shapeId,{parking_id:event.target.value,building_id:event.target.value?'':(adminShape()?.properties?.building_id||'')});renderAdminShapeFields();});
  }

  function validateConfig(cfg) {
    const errors=[],warnings=[];
    const c=cfg.settings?.colors||{};
    for(const [key,value] of Object.entries(c))if(!isHex(value))errors.push('Color '+key+' must be a six-digit hex color.');
    const center=cfg.settings?.map?.center;if(!Array.isArray(center)||center.length!==2||!finite(center[0])||!finite(center[1]))errors.push('The starting map center is invalid.');
    const buildings=getBuildings(cfg,true),parking=getParking(cfg,true);const ids=buildings.map(item=>item.id);if(new Set(ids).size!==ids.length)errors.push('Building IDs must be unique.');const pids=parking.map(item=>item.id||item.code);if(new Set(pids).size!==pids.length)errors.push('Parking IDs/codes must be unique.');
    for(const building of buildings){if(!building.id)errors.push('A building is missing an ID.');if(!building.common_name&&!building.official_name)errors.push('Building '+(building.id||'unknown')+' needs a name.');if((finite(building.latitude)&&!finite(building.longitude))||(!finite(building.latitude)&&finite(building.longitude)))errors.push((building.common_name||building.id)+' must have both latitude and longitude or neither.');}
    for(const feature of cfg.shapes||[]){if(!feature.properties?.id)errors.push('A map shape is missing its ID.');if(!validGeometry(feature))errors.push('Shape '+(feature.properties?.name||feature.properties?.id||'unnamed')+' has invalid or collapsed geometry.');if(feature.properties?.building_id&&feature.properties?.parking_id)warnings.push('Shape '+(feature.properties?.name||feature.properties?.id)+' links to both a building and parking; choose one.');}
    for(const image of cfg.imageOverlays||[]){if(!validImageOverlay(image))errors.push('PNG overlay '+(image.name||image.id||'unnamed')+' has invalid image data or bounds.');}
    return {errors,warnings};
  }

  async function testGitHubToken(token) {
    const response=await fetch('https://api.github.com/repos/'+REPO,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok)throw new Error('GitHub connection failed ('+response.status+').');
    return true;
  }

  async function publishConfig(cfg, token, message) {
    const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
    const current=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+CONFIG_PATH+'?ref=main',{headers});
    if(!current.ok)throw new Error('Could not read the current map configuration ('+current.status+').');
    const currentJson=await current.json();
    const body=JSON.stringify(cfg,null,2)+'\n';
    const response=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+CONFIG_PATH,{method:'PUT',headers,body:JSON.stringify({message:message||'Update UAF campus map',content:encode64(body),sha:currentJson.sha,branch:'main'})});
    if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.message||('GitHub publish failed ('+response.status+').'));}
    const result=await response.json();
    const sha=result.commit?.sha||'';
    localStorage.setItem('uaf-map-live-config',JSON.stringify({time:Date.now(),config:cfg,sha}));
    localStorage.setItem('uaf-map-live-refresh',String(Date.now()));
    if('BroadcastChannel' in window){const channel=new BroadcastChannel('uaf-map-live');channel.postMessage({type:'published',sha});channel.close();}
    return sha;
  }

  function renderAdminPublish(panel) {
    const report=validateConfig(admin.config);const token=sessionStorage.getItem('uaf-github-token')||'';
    panel.innerHTML='<div class="wizard-heading"><p class="eyebrow">STEP 3</p><h2>Review and publish</h2><p>Publishing updates <code>'+esc(CONFIG_PATH)+'</code> on GitHub <code>main</code>. Hostinger can then deploy the same PHP site.</p></div><div class="validation-box '+(report.errors.length?'has-errors':'ok')+'"><h3>Validation</h3>'+(report.errors.length?'<strong>'+report.errors.length+' error(s) must be fixed before publishing.</strong><ul>'+report.errors.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'<strong>No blocking validation errors.</strong>')+(report.warnings.length?'<h4>Warnings</h4><ul>'+report.warnings.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'')+'</div><div class="publish-summary"><span>'+adminBuildings().length+' buildings</span><span>'+adminParking().length+' parking records</span><span>'+(admin.config.shapes||[]).length+' map shapes</span><span>'+(admin.config.imageOverlays||[]).length+' PNG overlays</span></div><section class="github-connect"><h3>GitHub connection</h3><p>Use a fine-grained token limited to this repository with <strong>Contents: Read and write</strong>. The token stays only in this browser session.</p><label class="admin-field"><span>GitHub token</span><input id="github-token" type="password" autocomplete="off" value="'+esc(token)+'" placeholder="github_pat_…"></label><div class="geometry-actions"><button type="button" id="test-github">Test connection</button><button type="button" id="save-publish-draft">Save draft</button><button type="button" id="publish-live" class="primary-admin" '+(report.errors.length?'disabled':'')+'>Publish to GitHub & live map</button></div><p id="publish-status" class="inline-status" role="status" aria-live="polite"></p></section><div class="wizard-footer"><button type="button" id="back-edit">← Back to edit</button><a href="/" target="_blank" rel="noopener">Open public map</a></div>';
    const tokenInput=document.getElementById('github-token');tokenInput.addEventListener('input',()=>{if(tokenInput.value.trim())sessionStorage.setItem('uaf-github-token',tokenInput.value.trim());else sessionStorage.removeItem('uaf-github-token');});
    document.getElementById('save-publish-draft').addEventListener('click',saveAdminDraft);document.getElementById('back-edit').addEventListener('click',()=>{admin.step=2;renderAdminStep();});
    document.getElementById('test-github').addEventListener('click',async()=>{const status=document.getElementById('publish-status'),tokenValue=tokenInput.value.trim();if(!tokenValue){status.textContent='Enter your GitHub token first.';return;}status.textContent='Testing GitHub connection…';try{await testGitHubToken(tokenValue);status.textContent='GitHub connection succeeded.';}catch(error){status.textContent=error.message;}});
    document.getElementById('publish-live').addEventListener('click',async()=>{const status=document.getElementById('publish-status'),tokenValue=tokenInput.value.trim();if(!tokenValue){status.textContent='Enter your GitHub token first.';return;}const button=document.getElementById('publish-live');button.disabled=true;status.textContent='Publishing to GitHub…';try{const sha=await publishConfig(admin.config,tokenValue,'Update UAF campus map from admin');activeConfig=normalizeConfig(admin.config);localStorage.removeItem('uaf-map-config-draft');status.textContent='Published to GitHub'+(sha?' ('+sha.slice(0,7)+')':'')+'. Hostinger deployment should now start from main. Public map tabs in this browser will refresh to the new configuration.';}catch(error){status.textContent=error.message;}finally{button.disabled=report.errors.length>0;}});
  }

  function renderImages() {
    const state={config:normalizeConfig(activeConfig),selectedId:'',map:null,layerGroup:null,handleGroup:null};
    const overlays=()=>state.config.imageOverlays||[];
    app.innerHTML='<main id="main" class="page image-admin-page"><div class="admin-title"><div><p class="eyebrow">UAF CAMPUS MAP ADMIN</p><h1>PNG image overlays</h1><p>1. Upload → 2. place & resize → 3. save or publish.</p></div><div class="admin-top-actions"><a href="/admin">Back to admin</a><a href="/" target="_blank" rel="noopener">Public map</a></div></div><div class="overlay-admin-layout"><section class="overlay-controls"><div class="overlay-step"><span class="step-number">1</span><div><strong>Upload PNG</strong><label class="file-button">Choose PNG<input id="png-file" type="file" accept="image/png,.png"></label><small>Transparent PNGs work best. Maximum 2 MB.</small></div></div><div class="overlay-step"><span class="step-number">2</span><div><strong>Place & resize</strong><label class="admin-field"><span>Overlay</span><select id="overlay-select"><option value="">Select an overlay…</option></select></label><div id="overlay-fields"></div></div></div><div class="overlay-step"><span class="step-number">3</span><div><strong>Save / publish</strong><div class="geometry-actions"><button type="button" id="save-overlay-draft">Save draft</button><button type="button" id="publish-overlays" class="primary-admin">Publish PNG overlays</button></div><label class="admin-field"><span>GitHub token</span><input id="overlay-token" type="password" autocomplete="off" value="'+esc(sessionStorage.getItem('uaf-github-token')||'')+'" placeholder="github_pat_…"></label></div></div><p id="image-status" class="admin-status" role="status" aria-live="polite">Upload a PNG or select an existing overlay.</p></section><section class="overlay-map-card"><div class="builder-tip"><strong>Move:</strong> drag the round center handle. <strong>Resize:</strong> drag either square corner handle.</div><div id="overlay-map" class="overlay-map" aria-label="PNG overlay placement map"></div></section></div></main>';
    state.map=L.map('overlay-map',{center:mapCenter(state.config),zoom:Number(state.config.settings.map?.zoom||DEFAULT_ZOOM),keyboard:true});addBasemap(state.map,{config:state.config,labels:true});state.layerGroup=L.layerGroup().addTo(state.map);state.handleGroup=L.layerGroup().addTo(state.map);
    const status=message=>document.getElementById('image-status').textContent=message;
    const fillSelect=()=>{const select=document.getElementById('overlay-select');select.innerHTML='<option value="">Select an overlay…</option>'+overlays().map(item=>'<option value="'+esc(item.id)+'" '+(item.id===state.selectedId?'selected':'')+'>'+esc(item.name||item.id)+'</option>').join('');};
    const selected=()=>overlays().find(item=>item.id===state.selectedId);
    function updateSelected(patch){state.config.imageOverlays=overlays().map(item=>item.id===state.selectedId?{...item,...patch}:item);renderOverlayMap();renderOverlayFields();fillSelect();}
    function renderOverlayFields(){const holder=document.getElementById('overlay-fields'),item=selected();if(!item){holder.innerHTML='<p class="muted">Select an overlay to edit it.</p>';return;}holder.innerHTML='<label class="admin-field"><span>Name</span><input id="overlay-name" value="'+esc(item.name||'')+'"></label><label class="admin-field"><span>Opacity <output id="opacity-value">'+Math.round(Number(item.opacity??0.85)*100)+'%</output></span><input id="overlay-opacity" type="range" min="0.05" max="1" step="0.05" value="'+esc(item.opacity??0.85)+'"></label><label class="admin-switch"><input id="overlay-visible" type="checkbox" '+(item.visible!==false?'checked':'')+'><span>Show on public map and print map</span></label><button type="button" id="delete-overlay" class="danger">Delete overlay</button>';
      document.getElementById('overlay-name').addEventListener('input',event=>updateSelected({name:event.target.value}));document.getElementById('overlay-opacity').addEventListener('input',event=>{document.getElementById('opacity-value').textContent=Math.round(Number(event.target.value)*100)+'%';state.config.imageOverlays=overlays().map(row=>row.id===state.selectedId?{...row,opacity:Number(event.target.value)}:row);renderOverlayMap();});document.getElementById('overlay-visible').addEventListener('change',event=>updateSelected({visible:event.target.checked}));document.getElementById('delete-overlay').addEventListener('click',()=>{state.config.imageOverlays=overlays().filter(row=>row.id!==state.selectedId);state.selectedId='';fillSelect();renderOverlayFields();renderOverlayMap();status('Overlay removed from the draft.');});
    }
    function renderOverlayMap(){state.layerGroup.clearLayers();state.handleGroup.clearLayers();for(const item of overlays()){if(!validImageOverlay(item))continue;if(item.visible!==false||item.id===state.selectedId){try{L.imageOverlay(item.dataUrl,item.bounds,{opacity:Number(item.opacity??0.85),interactive:false,zIndex:item.id===state.selectedId?500:420}).addTo(state.layerGroup);}catch(error){}}}const item=selected();if(!item||!validImageOverlay(item))return;const bounds=L.latLngBounds(item.bounds),sw=bounds.getSouthWest(),ne=bounds.getNorthEast(),center=bounds.getCenter();const cornerIcon=L.divIcon({className:'overlay-corner-handle',html:'',iconSize:[18,18],iconAnchor:[9,9]});const moveIcon=L.divIcon({className:'overlay-move-handle',html:'↕',iconSize:[32,32],iconAnchor:[16,16]});const swMarker=L.marker(sw,{draggable:true,icon:cornerIcon,title:'Resize southwest corner'}).addTo(state.handleGroup),neMarker=L.marker(ne,{draggable:true,icon:cornerIcon,title:'Resize northeast corner'}).addTo(state.handleGroup),move=L.marker(center,{draggable:true,icon:moveIcon,title:'Move image'}).addTo(state.handleGroup);const resize=()=>{const a=swMarker.getLatLng(),b=neMarker.getLatLng();updateSelected({bounds:[[Math.min(a.lat,b.lat),Math.min(a.lng,b.lng)],[Math.max(a.lat,b.lat),Math.max(a.lng,b.lng)]]});status('Overlay resized in the draft.');};swMarker.on('dragend',resize);neMarker.on('dragend',resize);move.on('dragstart',()=>{move._uafStart=move.getLatLng();});move.on('dragend',()=>{const end=move.getLatLng(),start=move._uafStart||center,dLat=end.lat-start.lat,dLng=end.lng-start.lng;updateSelected({bounds:[[sw.lat+dLat,sw.lng+dLng],[ne.lat+dLat,ne.lng+dLng]]});status('Overlay moved in the draft.');});}
    document.getElementById('overlay-select').addEventListener('change',event=>{state.selectedId=event.target.value;renderOverlayFields();renderOverlayMap();const item=selected();if(item&&validImageOverlay(item))state.map.fitBounds(L.latLngBounds(item.bounds).pad(0.8),{maxZoom:19});});
    document.getElementById('png-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.type!=='image/png'){status('Please choose a PNG file.');return;}if(file.size>MAX_PNG_BYTES){status('PNG is larger than 2 MB. Reduce the file size before uploading.');return;}const reader=new FileReader();reader.onload=()=>{const image=new Image();image.onload=()=>{const center=state.map.getCenter(),id='png-'+Date.now(),halfLat=0.00045,aspect=Math.max(0.25,Math.min(4,image.naturalWidth/Math.max(1,image.naturalHeight))),halfLng=0.0008*aspect;state.config.imageOverlays.push({id,name:file.name.replace(/\.png$/i,''),dataUrl:reader.result,bounds:[[center.lat-halfLat,center.lng-halfLng],[center.lat+halfLat,center.lng+halfLng]],opacity:0.85,visible:true});state.selectedId=id;fillSelect();renderOverlayFields();renderOverlayMap();state.map.fitBounds(L.latLngBounds(selected().bounds).pad(0.8),{maxZoom:19});status('PNG uploaded. Move and resize it on the map, then save or publish.');};image.onerror=()=>status('The PNG could not be read.');image.src=reader.result;};reader.readAsDataURL(file);});
    document.getElementById('save-overlay-draft').addEventListener('click',()=>{localStorage.setItem('uaf-map-config-draft',JSON.stringify({time:Date.now(),config:state.config}));status('PNG overlay draft saved in this browser.');});
    const token=document.getElementById('overlay-token');token.addEventListener('input',()=>{if(token.value.trim())sessionStorage.setItem('uaf-github-token',token.value.trim());else sessionStorage.removeItem('uaf-github-token');});document.getElementById('publish-overlays').addEventListener('click',async()=>{const report=validateConfig(state.config);if(report.errors.length){status('Cannot publish: '+report.errors[0]);return;}if(!token.value.trim()){status('Enter your GitHub token first.');return;}const button=document.getElementById('publish-overlays');button.disabled=true;status('Publishing PNG overlays to GitHub…');try{const sha=await publishConfig(state.config,token.value.trim(),'Update UAF map PNG overlays');activeConfig=normalizeConfig(state.config);status('Published'+(sha?' ('+sha.slice(0,7)+')':'')+'. Hostinger deployment should now start from main.');}catch(error){status(error.message);}finally{button.disabled=false;}});
    fillSelect();renderOverlayFields();renderOverlayMap();setTimeout(()=>state.map.invalidateSize(),80);
  }

  function renderAccessible() {
    const buildings=getBuildings(),parking=getParking();
    shell('Text-only campus map','<p>Search the same campus inventory without using the visual map.</p><div class="accessible-actions"><a href="/">Interactive map</a><a href="/print">Print center</a>'+externalLink(meta.accessibility?.facilities_url,'Accessibility resources')+externalLink(meta.shuttle?.service_url,'Shuttle service')+'</div><label class="admin-field"><span>Search buildings, services or parking</span><input id="text-q" type="search" placeholder="Building, office, service, address or parking"></label><p id="text-count" aria-live="polite"></p><div id="text-results" class="text-results"></div>');
    const draw=()=>{const q=normalize(document.getElementById('text-q').value);const bRows=buildings.filter(item=>!q||normalize([item.common_name,item.official_name,item.address,item.category,(item.services||[]).join(' ')].join(' ')).includes(q));const pRows=parking.filter(item=>!q||normalize([item.code,item.name,item.restrictions].join(' ')).includes(q));document.getElementById('text-count').textContent=(bRows.length+pRows.length)+' results';document.getElementById('text-results').innerHTML=bRows.map(item=>'<article><h2>'+esc(item.common_name||item.official_name||'Building')+'</h2><p>'+esc(item.address||'Address pending')+'</p>'+(item.services?.length?'<p>'+esc(item.services.join(' · '))+'</p>':'')+'<p><a href="/?place='+encodeURIComponent(item.id)+'">Open on map</a> · <a href="/print?mode=selected&place='+encodeURIComponent(item.id)+'">Print this area</a>'+(safeExternal(item.source_url)?' · <a href="'+esc(safeExternal(item.source_url))+'" target="_blank" rel="noopener noreferrer">UAF profile</a>':'')+'</p></article>').join('')+(pRows.length?'<h2 class="text-section-heading">Parking</h2>':'')+pRows.map(item=>'<article><h3>'+esc((item.code||'P')+' — '+(item.name||'Parking'))+'</h3><p>'+esc(item.restrictions||'Follow posted signs.')+'</p><p><a href="/?parking='+encodeURIComponent(item.id||item.code)+'">Open on map</a></p></article>').join('');};
    document.getElementById('text-q').addEventListener('input',draw);draw();
  }

  function printLegend() {
    const items=[['building','Building / destination'],['parking','Parking'],['road','Road / drive'],['shape','Mapped area / feature'],['trail','Trail / path'],['closure','Construction / closure'],['png','PNG overlay'],['ada','Accessibility reference']];
    return items.map(([kind,label])=>'<div class="key-row"><i class="key-swatch '+kind+'"></i><span>'+esc(label)+'</span></div>').join('');
  }

  function renderPrint() {
    const cfg=activeConfig,params=new URLSearchParams(location.search),paper=params.get('paper')==='letter'?'letter':'ledger',mode=params.get('mode')==='selected'?'selected':'full',place=params.get('place')||'';
    const selectedBuilding=getBuildings(cfg).find(item=>item.id===place);
    shell('Print map','<div class="print-controls"><a href="/">Back to map</a><label>Area<select id="print-area"><option value="full">Full campus</option><option value="selected">Selected / current map area</option></select></label><label>Paper<select id="print-paper"><option value="ledger">11×17 landscape</option><option value="letter">8.5×11 landscape</option></select></label><label><input id="print-names" type="checkbox" checked> Building names</label><label><input id="print-parking" type="checkbox" checked> Parking</label><label><input id="print-shapes" type="checkbox" checked> Shapes & PNGs</label><button type="button" id="print-fit">Show full campus</button><button type="button" id="do-print" class="primary-print">Print</button><button type="button" id="save-pdf">Save PDF</button><span id="print-status" role="status" aria-live="polite"></span></div><section id="print-sheet" class="print-sheet '+paper+'"><header class="print-header"><div class="print-lockup"><img src="/assets/images/uaf-logo.svg" alt="University of Alaska Fairbanks"><div><span>CAMPUS MAP</span><h2 id="print-title">'+esc(mode==='selected'&&selectedBuilding?(selectedBuilding.common_name||selectedBuilding.official_name||'Selected campus area'):mode==='selected'?'Selected campus area':'Troth Yeddha\' Campus')+'</h2></div></div><div class="print-meta"><strong id="paper-label">'+(paper==='letter'?'8.5×11':'11×17')+'</strong><span>Fairbanks, Alaska</span></div></header><div class="print-layout"><div class="print-map-frame"><div class="coord-top">'+Array.from({length:12},(_,index)=>'<span>'+(index+1)+'</span>').join('')+'</div><div class="coord-left">'+'ABCDEFGHI'.split('').map(letter=>'<span>'+letter+'</span>').join('')+'</div><div id="print-map" class="print-map" aria-label="Printable UAF campus map"></div><img id="print-snapshot" class="print-snapshot" alt="" hidden><div class="coord-lines" aria-hidden="true"></div><div class="north-arrow" aria-label="North"><span>N</span><b>↑</b></div></div><aside class="print-key"><h3>Map key</h3>'+printLegend()+'<p class="key-note">Road names and reference labels are supplied by the basemap. Follow posted signs for current access, parking and construction conditions.</p></aside></div><footer class="print-footer"><div><strong>University of Alaska Fairbanks</strong><span>www.uaf.edu · General information 907-474-7034 · Emergency 911</span></div><div>Map corrections: uaf-web@alaska.edu</div></footer></section>','print-page');
    const area=document.getElementById('print-area'),paperSelect=document.getElementById('print-paper'),sheet=document.getElementById('print-sheet'),status=document.getElementById('print-status'),snapshot=document.getElementById('print-snapshot');area.value=mode;paperSelect.value=paper;
    const map=L.map('print-map',{center:mapCenter(cfg),zoom:Number(cfg.settings.map?.zoom||DEFAULT_ZOOM),zoomControl:true,keyboard:true,preferCanvas:false});addBasemap(map,{config:cfg,labels:true});L.control.scale({imperial:true,metric:false,position:'bottomleft',maxWidth:120}).addTo(map);
    const buildingGroup=L.layerGroup().addTo(map),parkingGroup=L.layerGroup().addTo(map),shapeGroup=L.layerGroup().addTo(map),imageGroup=L.layerGroup().addTo(map);
    function clearSnapshot(){snapshot.hidden=true;snapshot.removeAttribute('src');}
    map.on('movestart zoomstart',clearSnapshot);
    function buildLayers(){buildingGroup.clearLayers();parkingGroup.clearLayers();shapeGroup.clearLayers();imageGroup.clearLayers();const showNames=document.getElementById('print-names').checked,showParking=document.getElementById('print-parking').checked,showShapes=document.getElementById('print-shapes').checked;for(const building of getBuildings(cfg).filter(exact)){const marker=L.circleMarker([Number(building.latitude),Number(building.longitude)],{radius:4,color:'#fff',weight:2,fillColor:isHex(building.marker_color)?building.marker_color:colors().marker,fillOpacity:1}).addTo(buildingGroup);if(showNames)marker.bindTooltip(esc(building.common_name||building.official_name||'Building'),{permanent:true,direction:'right',offset:[5,0],className:'print-building-label',opacity:1});}if(showParking){for(const item of getParking(cfg).filter(exact)){const marker=L.circleMarker([Number(item.latitude),Number(item.longitude)],{radius:4,color:'#fff',weight:1,fillColor:colors().parking,fillOpacity:0.85}).addTo(parkingGroup);marker.bindTooltip(esc(item.code||'P'),{permanent:true,direction:'center',className:'print-parking-label',opacity:1});}}for(const feature of activeShapes(cfg)){const kind=feature.properties?.kind||'';if(kind==='parking-area'&&!showParking)continue;if(kind!=='parking-area'&&!showShapes)continue;L.geoJSON(feature,{style:f=>shapeStyle(f,cfg),pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,...shapeStyle(f,cfg)})}).addTo(kind==='parking-area'?parkingGroup:shapeGroup);}if(showShapes){for(const image of activeImages(cfg)){try{L.imageOverlay(image.dataUrl,image.bounds,{opacity:Number(image.opacity??0.85),interactive:false,zIndex:450}).addTo(imageGroup);}catch(error){}}}}
    function fitFull(){map.fitBounds(mainCampusBounds(cfg),{padding:[18,18],maxZoom:16});}
    function applyArea(){if(area.value==='full'){document.getElementById('print-title').textContent="Troth Yeddha' Campus";fitFull();}else if(selectedBuilding&&exact(selectedBuilding)){document.getElementById('print-title').textContent=selectedBuilding.common_name||selectedBuilding.official_name||'Selected campus area';map.setView([Number(selectedBuilding.latitude),Number(selectedBuilding.longitude)],18);}else{document.getElementById('print-title').textContent='Selected campus area';}}
    function setPaper(value){sheet.classList.toggle('letter',value==='letter');sheet.classList.toggle('ledger',value!=='letter');document.getElementById('paper-label').textContent=value==='letter'?'8.5×11':'11×17';let style=document.getElementById('uaf-page-size');if(!style){style=document.createElement('style');style.id='uaf-page-size';document.head.appendChild(style);}style.textContent='@page{size:'+(value==='letter'?'11in 8.5in':'17in 11in')+';margin:.2in}';clearSnapshot();setTimeout(()=>map.invalidateSize(),100);}
    async function waitForTiles(){const root=document.getElementById('print-map'),tiles=[...root.querySelectorAll('.leaflet-tile')],pending=tiles.filter(image=>!image.complete);if(pending.length)await Promise.race([Promise.all(pending.map(image=>new Promise(resolve=>{const done=()=>resolve();image.addEventListener('load',done,{once:true});image.addEventListener('error',done,{once:true});}))),sleep(3500)]);await sleep(120);}
    async function freezeMap(){map.invalidateSize();await document.fonts?.ready;await waitForTiles();sheet.classList.add('capturing');try{const canvas=await html2canvas(document.getElementById('print-map'),{useCORS:true,allowTaint:false,backgroundColor:'#dce8ee',scale:Math.min(2,window.devicePixelRatio||1.5),logging:false,imageTimeout:6000});snapshot.src=canvas.toDataURL('image/png');snapshot.hidden=false;}finally{sheet.classList.remove('capturing');}}
    document.getElementById('print-names').addEventListener('change',()=>{clearSnapshot();buildLayers();});document.getElementById('print-parking').addEventListener('change',()=>{clearSnapshot();buildLayers();});document.getElementById('print-shapes').addEventListener('change',()=>{clearSnapshot();buildLayers();});document.getElementById('print-fit').addEventListener('click',()=>{area.value='full';applyArea();});area.addEventListener('change',()=>{clearSnapshot();applyArea();});paperSelect.addEventListener('change',()=>setPaper(paperSelect.value));
    document.getElementById('do-print').addEventListener('click',async()=>{const button=document.getElementById('do-print');button.disabled=true;status.textContent='Preparing the map for printing…';try{await freezeMap();status.textContent='Opening print dialog…';await sleep(80);window.print();}catch(error){console.error(error);status.textContent='The static map preview could not be created; opening the browser print dialog with the live map.';window.print();}finally{button.disabled=false;}});
    document.getElementById('save-pdf').addEventListener('click',async()=>{const button=document.getElementById('save-pdf');button.disabled=true;status.textContent='Creating PDF…';try{await freezeMap();const canvas=await html2canvas(sheet,{useCORS:true,allowTaint:false,backgroundColor:'#fff',scale:2,logging:false,imageTimeout:6000});const letter=paperSelect.value==='letter',pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'in',format:letter?[11,8.5]:[17,11]});pdf.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',0,0,letter?11:17,letter?8.5:11);pdf.save(letter?'UAF-map-letter.pdf':'UAF-map-11x17.pdf');status.textContent='PDF downloaded.';}catch(error){console.error(error);status.textContent='Could not create the PDF. Reload the page and try again.';}finally{button.disabled=false;}});
    window.addEventListener('afterprint',()=>{status.textContent='';clearSnapshot();});buildLayers();setPaper(paper);applyArea();setTimeout(()=>map.invalidateSize(),100);
  }

  window.addEventListener('storage', event => {if (event.key === 'uaf-map-live-refresh' && page === 'map') location.reload();});
  if ('BroadcastChannel' in window && page === 'map') {const channel=new BroadcastChannel('uaf-map-live');channel.onmessage=event=>{if(event.data?.type==='published')location.reload();};}

  if (page === 'admin') renderAdmin();
  else if (page === 'images') renderImages();
  else if (page === 'print') renderPrint();
  else if (page === 'accessible') renderAccessible();
  else renderMap();
}());
