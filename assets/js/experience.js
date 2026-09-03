(function () {
  'use strict';

  if ((document.body.dataset.page || '') !== 'map' || !window.L) return;

  const APP = window.UAFExperience = {
    map: null,
    maps: [],
    visual: null,
    activeLayers: new Set(),
    drawer: null,
    drawerMode: '',
    selectedId: '',
    data: null,
    content: {locations:{}},
    modes: {modes:{}},
    labels: []
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value == null ? '' : value).toLowerCase().trim();
  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
  const read = (id, fallback) => {
    try {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent || '') : fallback;
    } catch (error) { return fallback; }
  };
  const clone = value => JSON.parse(JSON.stringify(value));

  const originalMap = L.map;
  L.map = function () {
    const map = originalMap.apply(L, arguments);
    APP.map = map;
    APP.maps.push(map);
    window.dispatchEvent(new CustomEvent('uaf:mapready', {detail:{map}}));
    setTimeout(() => decorateMap(map), 120);
    return map;
  };
  Object.keys(originalMap).forEach(key => { try { L.map[key] = originalMap[key]; } catch (error) {} });

  function canonicalUrl(input) {
    try {
      const url = new URL(input || location.href, location.href);
      const place = url.searchParams.get('place');
      const locationId = url.searchParams.get('location');
      if (place && !locationId) url.searchParams.set('location', place);
      if (!place && locationId) url.searchParams.set('place', locationId);
      return url.pathname + (url.search ? url.search : '') + url.hash;
    } catch (error) { return input; }
  }

  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);
  history.pushState = function (state, title, url) {
    nativePush(state, title, url == null ? url : canonicalUrl(url));
    window.dispatchEvent(new Event('uaf:urlchange'));
  };
  history.replaceState = function (state, title, url) {
    const before = new URL(location.href);
    const next = new URL(url == null ? location.href : canonicalUrl(url), location.href);
    const selectionChanged = (before.searchParams.get('place') || before.searchParams.get('parking')) !== (next.searchParams.get('place') || next.searchParams.get('parking'));
    if (selectionChanged && !APP._historyGuard) nativePush(state, title, next.pathname + next.search + next.hash);
    else nativeReplace(state, title, next.pathname + next.search + next.hash);
    window.dispatchEvent(new Event('uaf:urlchange'));
  };

  const initial = new URL(location.href);
  if (initial.searchParams.get('location') && !initial.searchParams.get('place')) {
    APP._historyGuard = true;
    initial.searchParams.set('place', initial.searchParams.get('location'));
    nativeReplace(history.state, '', initial.pathname + initial.search + initial.hash);
    APP._historyGuard = false;
  }

  function icon(name) {
    const paths = {
      search:'<circle cx="11" cy="11" r="6.4"></circle><path d="m16 16 4.5 4.5"></path>',
      locations:'<path d="M12 21s6-5.4 6-11A6 6 0 0 0 6 10c0 5.6 6 11 6 11Z"></path><circle cx="12" cy="10" r="2"></circle>',
      layers:'<path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 16 9 5 9-5"></path>',
      share:'<circle cx="18" cy="5" r="2.2"></circle><circle cx="6" cy="12" r="2.2"></circle><circle cx="18" cy="19" r="2.2"></circle><path d="m8 11 8-5M8 13l8 5"></path>',
      close:'<path d="m6 6 12 12M18 6 6 18"></path>',
      chevron:'<path d="m9 6 6 6-6 6"></path>',
      building:'<path d="M4 21V8l8-5 8 5v13M8 21v-5h8v5M8 10h2M14 10h2M8 13h2M14 13h2"></path>',
      parking:'<path d="M7 21V3h6.2a5.3 5.3 0 0 1 0 10.6H7"></path><path d="M7 6h6a2.3 2.3 0 0 1 0 4.6H7"></path>'
    };
    return '<svg class="uaf-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.chevron) + '</svg>';
  }

  function getData() {
    if (APP.data) return APP.data;
    APP.data = {
      buildings: read('uaf-buildings', []),
      parking: read('uaf-parking', []),
      config: read('uaf-config', {}),
      legend: read('uaf-legend', {items:[]})
    };
    return APP.data;
  }

  function fetchExtraData() {
    return Promise.all([
      fetch('/data/location-content.json', {cache:'no-store'}).then(r => r.ok ? r.json() : {locations:{}}).catch(() => ({locations:{}})),
      fetch('/data/modes.json', {cache:'no-store'}).then(r => r.ok ? r.json() : {modes:{}}).catch(() => ({modes:{}}))
    ]).then(([content, modes]) => {
      APP.content = content || {locations:{}};
      APP.modes = modes || {modes:{}};
      mergeLocationContent();
      applyModeFromUrl();
      return APP.data;
    });
  }

  function mergeLocationContent() {
    const data = getData();
    const additions = APP.content?.locations || {};
    data.buildings = data.buildings.map(row => {
      const extra = additions[row.id] || {};
      const terms = new Set([...(row.search_terms || []), ...(extra.aliases || []), ...(extra.departments || []), ...(extra.services || [])]);
      const services = new Set([...(row.services || []), ...(extra.services || []), ...(extra.departments || [])]);
      return {...row, ...extra, search_terms:[...terms], services:[...services]};
    });
  }

  function configBuilding(id) {
    const data = getData();
    const base = data.buildings.find(item => item.id === id);
    if (!base) return null;
    return {...base, ...(data.config?.buildingOverrides?.[id] || {})};
  }

  function configParking(id) {
    const data = getData();
    const base = data.parking.find(item => item.id === id || item.code === id);
    if (!base) return null;
    return {...base, ...(data.config?.parkingOverrides?.[base.id] || {})};
  }

  function validCoordinate(pair) {
    return Array.isArray(pair) && pair.length >= 2 && finite(pair[0]) && finite(pair[1]);
  }
  function validFeature(feature) {
    const g = feature?.geometry;
    if (!g) return false;
    if (g.type === 'Point') return validCoordinate(g.coordinates);
    if (g.type === 'LineString') return Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(validCoordinate);
    if (g.type === 'Polygon') return Array.isArray(g.coordinates?.[0]) && g.coordinates[0].length >= 4 && g.coordinates[0].every(validCoordinate);
    return false;
  }
  function shapes() { return (getData().config?.shapes || []).filter(validFeature); }
  function shapeByBuilding(id) { return shapes().find(f => f.properties?.building_id === id && (f.properties?.kind === 'building-footprint' || f.properties?.legend_key === 'building')); }
  function shapeByParking(id, code) { return shapes().find(f => f.properties?.parking_id === id || f.properties?.parking_id === code); }

  function parkingLegendKey(row) {
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

  function legendItem(id) {
    return getData().legend?.items?.find(item => item.id === id) || null;
  }

  const buildingLayerDefs = [
    ['building_academic','Academic','academic'],
    ['building_administration','Administrative','administration'],
    ['building_service','Student Services','service'],
    ['building_housing','Housing','housing'],
    ['building_dining','Dining','dining'],
    ['building_recreation','Athletics & Recreation','recreation'],
    ['building_research','Research','research'],
    ['building_visitor','Visitor Destinations','visitor']
  ];

  function layerDefinitions() {
    const defs = buildingLayerDefs.map(([id,label,category]) => ({id,label,group:'Buildings & Places',geometry:'polygon',recordType:'building',category,stroke:'#236192',fill:'#87D1E6',fillOpacity:.3,weight:3}));
    for (const item of getData().legend?.items || []) {
      if (item.id === 'building' || item.id === 'png' || item.id === 'custom_area') continue;
      const groupMap = {Parking:'Parking',Transportation:'Transportation',Accessibility:'Accessibility',Updates:'Campus Conditions',Campus:'Campus'};
      defs.push({...item, group:groupMap[item.group] || item.group || 'Map'});
    }
    return defs;
  }

  function majorPriority(row) {
    const major = new Set(['wood','library','museum','signers','bunnell','gruening','patty','src','fine-arts','usibelli']);
    return Number(row?.label_priority || (major.has(row?.id) ? 10 : 5));
  }

  function shiftFeature(feature, lngDelta, latDelta) {
    const next = clone(feature);
    const shift = pair => [Number(pair[0]) + lngDelta, Number(pair[1]) + latDelta];
    if (next.geometry.type === 'Polygon') next.geometry.coordinates = next.geometry.coordinates.map(ring => ring.map(shift));
    else if (next.geometry.type === 'LineString') next.geometry.coordinates = next.geometry.coordinates.map(shift);
    else if (next.geometry.type === 'Point') next.geometry.coordinates = shift(next.geometry.coordinates);
    return next;
  }

  function featureCenter(feature) {
    if (!feature) return null;
    if (feature.geometry?.type === 'Point') return [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
    const coords = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates?.[0] : feature.geometry?.coordinates;
    if (!Array.isArray(coords) || !coords.length) return null;
    const valid = coords.filter(validCoordinate);
    if (!valid.length) return null;
    return [valid.reduce((sum,p) => sum + Number(p[1]),0)/valid.length, valid.reduce((sum,p) => sum + Number(p[0]),0)/valid.length];
  }

  function ensurePanes(map) {
    const panes = [
      ['uaf-parking-surface',330],
      ['uaf-building-shadow',390],
      ['uaf-building-roof',405],
      ['uaf-layer-highlight',430],
      ['uaf-fallback-points',440],
      ['uaf-labels',650]
    ];
    panes.forEach(([name,z]) => {
      const pane = map.getPane(name) || map.createPane(name);
      pane.style.zIndex = String(z);
      if (name === 'uaf-building-shadow' || name === 'uaf-labels') pane.style.pointerEvents = 'none';
    });
  }

  function decorateMap(map) {
    if (!map || map._uafDecorated) return;
    map._uafDecorated = true;
    ensurePanes(map);
    const data = getData();
    const visual = APP.visual = {
      parking:L.layerGroup().addTo(map),
      shadows:L.layerGroup().addTo(map),
      roofs:L.layerGroup().addTo(map),
      fallbacks:L.layerGroup().addTo(map),
      highlights:L.layerGroup().addTo(map),
      labels:L.layerGroup().addTo(map),
      roofLayers:new Map()
    };

    const buildingShapeIds = new Set();
    for (const feature of shapes()) {
      const buildingId = feature.properties?.building_id;
      const parkingId = feature.properties?.parking_id;
      if (buildingId) {
        buildingShapeIds.add(buildingId);
        const row = configBuilding(buildingId) || {id:buildingId};
        const priority = majorPriority(row);
        L.geoJSON(shiftFeature(feature, .000045, -.000035), {
          pane:'uaf-building-shadow',
          interactive:false,
          style:{color:'#5c6e78',weight:1,opacity:.2,fillColor:'#53646e',fillOpacity:.3}
        }).addTo(visual.shadows);
        const roofFill = priority >= 9 ? '#f4f0dc' : '#e6ecef';
        const roof = L.geoJSON(feature, {
          pane:'uaf-building-roof',
          style:{color:'#5b7180',weight:1.6,opacity:1,fillColor:roofFill,fillOpacity:.94},
          onEachFeature:(f, layer) => {
            const label = row.common_name || row.official_name || feature.properties?.name || 'Campus building';
            layer.on('mouseover', () => layer.setStyle({color:'#236192',weight:3,fillOpacity:1}));
            layer.on('mouseout', () => styleSelection());
            layer.on('click', () => openLocation(buildingId,'building'));
            layer.on('add', () => {
              const element = layer.getElement?.();
              if (!element) return;
              element.setAttribute('role','button');
              element.setAttribute('tabindex','0');
              element.setAttribute('aria-label',label + ' outline');
              element.style.cursor='pointer';
              element.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
              });
            });
            layer.bindTooltip(esc(label), {sticky:true,className:'uaf-map-hover'});
            visual.roofLayers.set(buildingId, layer);
          }
        }).addTo(visual.roofs);
      } else if (parkingId) {
        L.geoJSON(feature, {
          pane:'uaf-parking-surface',
          interactive:true,
          style:{color:'#7e8d96',weight:1.2,opacity:.8,fillColor:'#aeb8bd',fillOpacity:.55},
          onEachFeature:(f, layer) => {
            const row = configParking(parkingId);
            layer.bindTooltip(esc(row ? ((row.code || 'P') + ' — ' + (row.name || 'Parking')) : (feature.properties?.name || 'Parking')), {sticky:true,className:'uaf-map-hover'});
            layer.on('click', () => openLocation(parkingId,'parking'));
          }
        }).addTo(visual.parking);
      }
    }

    for (const raw of data.buildings) {
      const row = configBuilding(raw.id) || raw;
      if (buildingShapeIds.has(row.id) || !finite(row.latitude) || !finite(row.longitude)) continue;
      L.circleMarker([Number(row.latitude),Number(row.longitude)], {
        pane:'uaf-fallback-points',radius:5,color:'#fff',weight:2,fillColor:'#236192',fillOpacity:.95
      }).bindTooltip(esc(row.common_name || row.official_name || 'Campus building'), {direction:'top',className:'uaf-map-hover'})
        .on('click', () => openLocation(row.id,'building')).addTo(visual.fallbacks);
    }

    map.on('zoomend moveend', renderLabels);
    window.addEventListener('uaf:urlchange', styleSelection);
    window.addEventListener('popstate', restoreFromHistory);
    setTimeout(() => { renderLabels(); styleSelection(); renderLayerHighlights(); restoreBasemapFromUrl(); }, 180);
  }

  function styleSelection() {
    if (!APP.visual) return;
    const params = new URL(location.href).searchParams;
    const selected = params.get('place') || params.get('location') || '';
    APP.selectedId = selected;
    APP.visual.roofLayers.forEach((layer,id) => {
      const row = configBuilding(id) || {};
      const priority = majorPriority(row);
      const chosen = id === selected;
      layer.setStyle(chosen ? {color:'#FFCD00',weight:5,opacity:1,fillColor:'#fff8d1',fillOpacity:1} : {color:'#5b7180',weight:1.6,opacity:1,fillColor:priority>=9?'#f4f0dc':'#e6ecef',fillOpacity:.94});
      if (chosen && layer.bringToFront) layer.bringToFront();
    });
  }

  function renderLabels() {
    const map = APP.map, visual = APP.visual;
    if (!map || !visual) return;
    visual.labels.clearLayers();
    const zoom = map.getZoom();
    const threshold = zoom <= 15 ? 10 : 0;
    const candidates = [];
    for (const rowRaw of getData().buildings) {
      const row = configBuilding(rowRaw.id) || rowRaw;
      const priority = majorPriority(row);
      if (priority < threshold) continue;
      const feature = shapeByBuilding(row.id);
      let latlng = null;
      const anchor = row.label_anchor || row.labelAnchor;
      if (Array.isArray(anchor) && finite(anchor[0]) && finite(anchor[1])) latlng = [Number(anchor[0]),Number(anchor[1])];
      else if (feature) latlng = featureCenter(feature);
      else if (finite(row.latitude) && finite(row.longitude)) latlng = [Number(row.latitude),Number(row.longitude)];
      if (!latlng) continue;
      candidates.push({row,priority,latlng});
    }
    candidates.sort((a,b) => b.priority-a.priority);
    const occupied = [];
    for (const item of candidates) {
      const point = map.latLngToContainerPoint(item.latlng);
      const width = item.priority >= 9 ? 160 : 125, height = 34;
      const box = {x1:point.x-width/2,x2:point.x+width/2,y1:point.y-height/2,y2:point.y+height/2};
      // Every mapped building receives a visible tag at campus detail zoom.
      // Do not suppress lower-priority labels; users need the complete inventory.
      occupied.push(box);
      const label = item.row.short_name || item.row.common_name || item.row.official_name;
      const marker = L.marker(item.latlng, {pane:'uaf-labels',interactive:false,icon:L.divIcon({className:'uaf-building-label-wrap',html:'<span class="uaf-building-label priority-'+item.priority+'">'+esc(label)+'</span>',iconSize:[width,30],iconAnchor:[width/2,15]})});
      marker.addTo(visual.labels);
    }
  }

  function enhanceShell() {
    const workspace = document.querySelector('.workspace');
    if (!workspace || workspace.dataset.uafEnhanced) return false;
    workspace.dataset.uafEnhanced = 'true';
    const panel = workspace.querySelector('.panel');
    const searchForm = document.getElementById('search-form');
    const q = document.getElementById('q');
    if (!panel || !searchForm || !q) return false;

    const header = document.querySelector('.site-header');
    const setHeaderHeight = () => document.documentElement.style.setProperty('--uaf-header-height', Math.ceil(header?.getBoundingClientRect().height || 64) + 'px');
    setHeaderHeight();
    if (window.ResizeObserver && header) new ResizeObserver(setHeaderHeight).observe(header);

    q.placeholder = 'Search buildings, offices, parking, dining...';
    searchForm.querySelector('label')?.classList.add('sr-only');
    const searchButton = searchForm.querySelector('button[type="submit"]');
    if (searchButton) searchButton.innerHTML = icon('search') + '<span class="sr-only">Search</span>';

    const switcher = document.createElement('div');
    switcher.className = 'uaf-browse-switch';
    switcher.setAttribute('aria-label','Browse campus map');
    switcher.innerHTML = '<button type="button" data-uaf-browser="locations">'+icon('locations')+'<span>Locations</span></button><button type="button" data-uaf-browser="layers">'+icon('layers')+'<span>Layers</span></button>';
    searchForm.insertAdjacentElement('afterend', switcher);

    const drawer = APP.drawer = document.createElement('aside');
    drawer.id = 'uaf-browser-drawer';
    drawer.className = 'uaf-browser-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-live','polite');
    workspace.appendChild(drawer);

    switcher.addEventListener('click', event => {
      const button = event.target.closest('[data-uaf-browser]');
      if (button) openDrawer(button.dataset.uafBrowser);
    });

    let timer = 0;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      const value = q.value.trim();
      panel.classList.toggle('uaf-search-active', !!value);
      if (!value) return;
      timer = setTimeout(() => searchForm.requestSubmit(), 120);
    });
    q.addEventListener('keydown', event => {
      if (event.key === 'Escape') { q.value=''; panel.classList.remove('uaf-search-active'); q.focus(); }
    });

    document.querySelectorAll('[data-map-command]').forEach(button => button.addEventListener('click', handleHeaderCommand));

    const notice = document.querySelector('.map-page > .notice');
    if (notice) notice.setAttribute('role','status');
    makeDialogNonModal();
    applyModeFromUrl();
    restoreDrawerFromUrl();
    return true;
  }

  function handleHeaderCommand(event) {
    const command = event.currentTarget.dataset.mapCommand;
    if (command === 'locations' || command === 'layers') openDrawer(command);
    else if (command === 'search') { document.getElementById('q')?.focus(); }
    else if (command === 'share') shareCurrentState();
    else if (command?.startsWith('layer:')) openDrawer('layers', command.slice(6));
  }

  function openDrawer(mode, focusGroup) {
    const drawer = APP.drawer;
    if (!drawer) return;
    APP.drawerMode = mode;
    drawer.hidden = false;
    drawer.classList.add('open');
    drawer.innerHTML = '<div class="uaf-drawer-head"><div><p class="eyebrow">UAF CAMPUS MAP</p><h2>'+(mode==='layers'?'Layers':'Locations')+'</h2></div><button type="button" class="uaf-drawer-close" aria-label="Close '+(mode==='layers'?'layers':'locations')+'">'+icon('close')+'</button></div><div class="uaf-drawer-body" id="uaf-drawer-body"><p class="uaf-loading">Loading…</p></div>';
    drawer.querySelector('.uaf-drawer-close').addEventListener('click', closeDrawer);
    updatePanelUrl(mode, focusGroup);
    fetchExtraData().finally(() => mode === 'layers' ? renderLayersDrawer(focusGroup) : renderLocationsDrawer());
    setTimeout(() => drawer.querySelector('h2')?.setAttribute('tabindex','-1'),0);
  }

  function closeDrawer() {
    if (!APP.drawer) return;
    APP.drawer.classList.remove('open');
    APP.drawer.hidden = true;
    APP.drawerMode = '';
    updatePanelUrl('');
  }

  function updatePanelUrl(mode, group) {
    const url = new URL(location.href);
    if (mode) url.searchParams.set('panel',mode); else url.searchParams.delete('panel');
    if (group) url.searchParams.set('group',group); else if (!mode) url.searchParams.delete('group');
    APP._historyGuard = true;
    nativeReplace(history.state,'',url.pathname+url.search+url.hash);
    APP._historyGuard = false;
  }

  function restoreDrawerFromUrl() {
    const url = new URL(location.href);
    const panel = url.searchParams.get('panel');
    if (panel === 'locations' || panel === 'layers') setTimeout(() => openDrawer(panel,url.searchParams.get('group')||''),180);
  }

  function buildingCategoryLabel(category) {
    return ({academic:'Academic',administration:'Administrative',service:'Student Services',housing:'Housing',dining:'Dining',recreation:'Athletics & Recreation',research:'Research',visitor:'Visitor Destinations'})[category] || 'Other Campus Locations';
  }

  function renderLocationsDrawer() {
    const body = document.getElementById('uaf-drawer-body');
    if (!body) return;
    const rows = getData().buildings.map(raw => configBuilding(raw.id) || raw).filter(row => row.visible !== false);
    const groups = new Map();
    rows.forEach(row => { const label=buildingCategoryLabel(row.category); if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row); });
    body.innerHTML = '<label class="uaf-drawer-search"><span class="sr-only">Filter locations</span>'+icon('search')+'<input type="search" id="uaf-location-filter" placeholder="Filter locations"></label><div id="uaf-location-groups">'+[...groups.entries()].map(([group,items]) => '<section class="uaf-location-group"><h3>'+esc(group)+' <span>'+items.length+'</span></h3>'+items.sort((a,b)=>(a.common_name||a.official_name).localeCompare(b.common_name||b.official_name)).map(row => '<button type="button" class="uaf-location-row" data-kind="building" data-id="'+esc(row.id)+'">'+icon('building')+'<span><strong>'+esc(row.short_name||row.common_name||row.official_name)+'</strong><small>'+esc(row.services?.[0]||row.address||buildingCategoryLabel(row.category))+'</small></span>'+icon('chevron')+'</button>').join('')+'</section>').join('')+'</div>';
    body.querySelectorAll('[data-kind][data-id]').forEach(button => button.addEventListener('click',()=>{openLocation(button.dataset.id,button.dataset.kind);closeDrawer();}));
    const filter = document.getElementById('uaf-location-filter');
    filter.addEventListener('input',()=>{
      const q=normalize(filter.value);
      body.querySelectorAll('.uaf-location-row').forEach(button=>{button.hidden=q && !normalize(button.textContent).includes(q);});
      body.querySelectorAll('.uaf-location-group').forEach(section=>{section.hidden=![...section.querySelectorAll('.uaf-location-row')].some(row=>!row.hidden);});
    });
  }

  function layerFeatureRows(def) {
    const data = getData();
    if (def.recordType === 'building') return data.buildings.map(raw => configBuilding(raw.id)||raw).filter(row => {
      if (def.id === 'building_visitor') return (row.layers||[]).includes('visitor-destinations');
      return row.category === def.category;
    }).map(row => ({id:row.id,kind:'building',name:row.short_name||row.common_name||row.official_name}));
    if (def.id.startsWith('parking_')) return data.parking.map(raw=>configParking(raw.id)||raw).filter(row=>parkingLegendKey(row)===def.id).map(row=>({id:row.id||row.code,kind:'parking',name:(row.code||'P')+' — '+(row.name||'Parking')}));
    return shapes().filter(f => (f.properties?.legend_key || '') === def.id).map(f=>({id:f.properties?.id,kind:'shape',name:f.properties?.name||def.label}));
  }

  function renderLayersDrawer(focusGroup) {
    const body = document.getElementById('uaf-drawer-body');
    if (!body) return;
    const defs = layerDefinitions();
    const groups = new Map();
    defs.forEach(def=>{if(!groups.has(def.group))groups.set(def.group,[]);groups.get(def.group).push(def);});
    body.innerHTML = '<p class="uaf-drawer-intro">Turn map topics on or off. Each active layer also provides a text list of its mapped locations.</p>'+[...groups.entries()].map(([group,items]) => '<section class="uaf-layer-group" data-layer-group="'+esc(group)+'"><div class="uaf-layer-group-head"><label><input type="checkbox" data-group-toggle="'+esc(group)+'"><strong>'+esc(group)+'</strong></label><button type="button" class="uaf-layer-group-toggle" aria-expanded="'+(focusGroup && normalize(group).includes(normalize(focusGroup))?'true':'false')+'">'+icon('chevron')+'<span class="sr-only">Expand '+esc(group)+'</span></button></div><div class="uaf-layer-items" '+(focusGroup && normalize(group).includes(normalize(focusGroup))?'':'hidden')+'>'+items.map(def=>{const count=layerFeatureRows(def).length;return '<div class="uaf-layer-item"><label><input type="checkbox" data-layer-id="'+esc(def.id)+'" '+(APP.activeLayers.has(def.id)?'checked':'')+'><i class="uaf-layer-swatch" style="--swatch:'+(def.fill||def.stroke||'#236192')+';--swatch-stroke:'+(def.stroke||'#236192')+'"></i><span><strong>'+esc(def.label)+'</strong><small>'+count+' location'+(count===1?'':'s')+'</small></span></label><button type="button" class="uaf-layer-list-toggle" data-layer-list="'+esc(def.id)+'" aria-expanded="false">View locations</button><div class="uaf-layer-text-list" data-layer-text="'+esc(def.id)+'" hidden></div></div>';}).join('')+'</div></section>').join('');

    body.querySelectorAll('.uaf-layer-group-toggle').forEach(button=>button.addEventListener('click',()=>{const items=button.closest('.uaf-layer-group').querySelector('.uaf-layer-items');const open=items.hidden;items.hidden=!open;button.setAttribute('aria-expanded',open?'true':'false');}));
    body.querySelectorAll('[data-layer-id]').forEach(input=>input.addEventListener('change',()=>{toggleLayer(input.dataset.layerId,input.checked);updateGroupCheckboxes();}));
    body.querySelectorAll('[data-group-toggle]').forEach(input=>input.addEventListener('change',()=>{const group=input.dataset.groupToggle;body.querySelectorAll('.uaf-layer-group[data-layer-group="'+CSS.escape(group)+'"] [data-layer-id]').forEach(child=>{child.checked=input.checked;toggleLayer(child.dataset.layerId,input.checked,false);});syncLayersToUrl();renderLayerHighlights();updateGroupCheckboxes();}));
    body.querySelectorAll('[data-layer-list]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.layerList;const def=defs.find(row=>row.id===id);const list=body.querySelector('[data-layer-text="'+CSS.escape(id)+'"]');const open=list.hidden;if(open){const rows=layerFeatureRows(def);list.innerHTML=rows.length?'<ul>'+rows.map(row=>'<li>'+(row.kind==='building'||row.kind==='parking'?'<button type="button" data-open-kind="'+row.kind+'" data-open-id="'+esc(row.id)+'">'+esc(row.name)+'</button>':esc(row.name))+'</li>').join('')+'</ul>':'<p>No mapped locations yet.</p>';list.querySelectorAll('[data-open-id]').forEach(item=>item.addEventListener('click',()=>openLocation(item.dataset.openId,item.dataset.openKind)));}list.hidden=!open;button.setAttribute('aria-expanded',open?'true':'false');button.textContent=open?'Hide locations':'View locations';}));
    updateGroupCheckboxes();
  }

  function updateGroupCheckboxes() {
    const body = document.getElementById('uaf-drawer-body');
    if (!body) return;
    body.querySelectorAll('.uaf-layer-group').forEach(group=>{const parent=group.querySelector('[data-group-toggle]');const children=[...group.querySelectorAll('[data-layer-id]')];const checked=children.filter(i=>i.checked).length;parent.checked=checked===children.length&&children.length>0;parent.indeterminate=checked>0&&checked<children.length;});
  }

  function toggleLayer(id,on,update=true) {
    if(on) APP.activeLayers.add(id); else APP.activeLayers.delete(id);
    if(update){syncLayersToUrl();renderLayerHighlights();}
  }

  function syncLayersToUrl() {
    const url = new URL(location.href);
    if(APP.activeLayers.size)url.searchParams.set('layers',[...APP.activeLayers].join(','));else url.searchParams.delete('layers');
    APP._historyGuard=true;nativeReplace(history.state,'',url.pathname+url.search+url.hash);APP._historyGuard=false;
  }

  function restoreLayersFromUrl() {
    const raw = new URL(location.href).searchParams.get('layers') || '';
    APP.activeLayers = new Set(raw.split(',').map(x=>x.trim()).filter(Boolean));
  }

  function applyModeFromUrl() {
    restoreLayersFromUrl();
    const url = new URL(location.href);
    const mode = url.searchParams.get('mode');
    const preset = APP.modes?.modes?.[mode];
    if(preset && !url.searchParams.get('layers')){
      (preset.layers||[]).forEach(id=>APP.activeLayers.add(id));
      syncLayersToUrl();
    }
    renderLayerHighlights();
  }

  function renderLayerHighlights() {
    const map=APP.map,visual=APP.visual;if(!map||!visual)return;
    visual.highlights.clearLayers();
    const defs=layerDefinitions();
    for(const id of APP.activeLayers){const def=defs.find(row=>row.id===id);if(!def)continue;const style={pane:'uaf-layer-highlight',color:def.stroke||'#236192',weight:Number(def.weight||3),opacity:.95,fillColor:def.fill||def.stroke||'#236192',fillOpacity:Math.min(.42,Number(def.fillOpacity??.3)),dashArray:def.dashArray||undefined};
      if(def.recordType==='building'){
        for(const row of getData().buildings){const merged=configBuilding(row.id)||row;const match=id==='building_visitor'?(merged.layers||[]).includes('visitor-destinations'):merged.category===def.category;if(!match)continue;const feature=shapeByBuilding(merged.id);if(feature)L.geoJSON(feature,{pane:'uaf-layer-highlight',style,onEachFeature:(f,l)=>l.on('click',()=>openLocation(merged.id,'building'))}).addTo(visual.highlights);}
      } else if(id.startsWith('parking_')){
        for(const row0 of getData().parking){const row=configParking(row0.id)||row0;if(parkingLegendKey(row)!==id)continue;const feature=shapeByParking(row.id,row.code);if(feature)L.geoJSON(feature,{pane:'uaf-layer-highlight',style,onEachFeature:(f,l)=>l.on('click',()=>openLocation(row.id||row.code,'parking'))}).addTo(visual.highlights);}
      } else {
        shapes().filter(f=>(f.properties?.legend_key||'')===id).forEach(feature=>L.geoJSON(feature,{pane:'uaf-layer-highlight',style}).addTo(visual.highlights));
      }
    }
    styleSelection();
  }

  function openLocation(id, kind) {
    const q=document.getElementById('q'),form=document.getElementById('search-form');
    const row=kind==='parking'?configParking(id):configBuilding(id);
    if(q&&form&&row){q.value=kind==='parking'?(row.code||row.name||id):(row.common_name||row.official_name||id);q.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();const tryClick=()=>{const button=document.querySelector('.result-card[data-kind="'+kind+'"][data-id="'+CSS.escape(String(id))+'"]')||document.querySelector('.result-card[data-kind="'+kind+'"]');if(button)button.click();};setTimeout(tryClick,80);setTimeout(tryClick,220);}
  }

  function makeDialogNonModal() {
    const observer = new MutationObserver(()=>{
      document.querySelectorAll('dialog.details[open]').forEach(dialog=>{
        try{if(dialog.matches(':modal')){dialog.close();dialog.show();}}catch(error){}
      });
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  }

  function restoreFromHistory() {
    restoreLayersFromUrl();renderLayerHighlights();styleSelection();
    const url=new URL(location.href);const id=url.searchParams.get('place')||url.searchParams.get('location');const parking=url.searchParams.get('parking');
    if(id)setTimeout(()=>openLocation(id,'building'),60);else if(parking)setTimeout(()=>openLocation(parking,'parking'),60);else document.querySelector('dialog.details[open] .dialog-close')?.click();
  }

  function restoreBasemapFromUrl() {
    if(!APP.map||!window.UAFBasemap)return;
    const mode=new URL(location.href).searchParams.get('basemap');
    if(mode==='satellite')window.UAFBasemap.setMode(APP.map,'satellite');
    window.addEventListener('uaf:basemapchange',event=>{const url=new URL(location.href);if(event.detail?.mode==='satellite')url.searchParams.set('basemap','satellite');else url.searchParams.delete('basemap');APP._historyGuard=true;nativeReplace(history.state,'',url.pathname+url.search+url.hash);APP._historyGuard=false;});
  }

  async function shareCurrentState() {
    const url=location.href;
    try{
      if(navigator.share){await navigator.share({title:'UAF Campus Map',url});return;}
      await navigator.clipboard.writeText(url);announce('Map link copied.');
    }catch(error){if(error?.name!=='AbortError')announce('Copy this address from your browser to share the current map.');}
  }

  function announce(message){let node=document.getElementById('uaf-live-announcer');if(!node){node=document.createElement('div');node.id='uaf-live-announcer';node.className='sr-only';node.setAttribute('aria-live','polite');document.body.appendChild(node);}node.textContent='';setTimeout(()=>node.textContent=message,10);}

  const appNode=document.getElementById('app');
  if(appNode){const observer=new MutationObserver(()=>enhanceShell());observer.observe(appNode,{childList:true,subtree:true});}
  document.addEventListener('DOMContentLoaded',enhanceShell);
  window.addEventListener('uaf:urlchange',()=>{restoreLayersFromUrl();renderLayerHighlights();styleSelection();});
  fetchExtraData();
})();
