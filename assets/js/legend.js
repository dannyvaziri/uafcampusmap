(function () {
  'use strict';

  function read(id, fallback) {
    try {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent || '') : fallback;
    } catch (error) {
      return fallback;
    }
  }

  const legend = read('uaf-legend', {items:[]});
  const parking = read('uaf-parking', []);
  const items = Array.isArray(legend.items) ? legend.items : [];
  const byId = new Map(items.map(item => [item.id, item]));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function parkingKey(row) {
    const text = String(row?.restrictions || '').toLowerCase();
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

  function linkedParking(props) {
    const id = props?.parking_id;
    if (!id) return null;
    return parking.find(row => row.id === id || row.code === id) || null;
  }

  function inferKey(feature) {
    const props = feature?.properties || {};
    if (props.legend_key && byId.has(props.legend_key)) return props.legend_key;
    if (props.kind === 'building-footprint' || props.building_id) return 'building';
    if (props.kind === 'parking-area' || props.parking_id) return parkingKey(linkedParking(props));
    if (props.kind === 'trail') return 'trail';
    if (props.kind === 'construction' || props.kind === 'closure') return 'construction';
    if (props.kind === 'stairs') return 'stairs';
    if (props.kind === 'bridge') return 'bridge';
    if (props.kind === 'shuttle-stop') return 'shuttle_stop';
    if (props.kind === 'macs-stop') return 'macs_stop';
    if (props.kind === 'accessible-parking') return 'accessible_parking';
    if (props.kind === 'parking-kiosk') return 'parking_kiosk';
    if (props.kind === 'one-way-road') return 'road_one_way';
    return 'custom_area';
  }

  function styleFeature(feature) {
    if (!feature || !feature.properties) return feature;
    const key = inferKey(feature);
    const entry = byId.get(key);
    if (!entry) return feature;
    const next = JSON.parse(JSON.stringify(feature));
    next.properties.legend_key = key;
    for (const prop of ['stroke','fill','weight','opacity','fillOpacity']) {
      if (entry[prop] !== undefined) next.properties[prop] = entry[prop];
    }
    if (entry.dashArray) next.properties.dashArray = entry.dashArray;
    else delete next.properties.dashArray;
    return next;
  }

  function patchStoredConfig(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const payload = JSON.parse(raw);
      const cfg = payload?.config;
      if (!cfg || !Array.isArray(cfg.shapes)) return;
      cfg.shapes = cfg.shapes.map(styleFeature);
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {}
  }

  patchStoredConfig('uaf-map-live-config');
  patchStoredConfig('uaf-map-config-draft');

  window.UAFMapLegend = {
    items,
    byId,
    parkingKey,
    inferKey,
    styleFeature
  };

  function swatch(entry) {
    const dash = entry.dashArray ? ' dashed' : '';
    const geometry = entry.geometry || 'polygon';
    return '<i class="shared-key-swatch ' + esc(geometry) + dash + '" style="--key-stroke:' + esc(entry.stroke || '#236192') + ';--key-fill:' + esc(entry.fill || entry.stroke || '#236192') + '"></i>';
  }

  function keyRows(compact) {
    const groups = new Map();
    for (const item of items) {
      const group = item.group || 'Map';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    return [...groups.entries()].map(([group, rows]) =>
      '<section class="shared-key-group"><h4>' + esc(group) + '</h4>' + rows.map(item => '<div class="shared-key-row">' + swatch(item) + '<span>' + esc(item.label) + '</span></div>').join('') + '</section>'
    ).join('');
  }

  function injectPublicKey() {
    const mapColumn = document.querySelector('.map-column');
    if (!mapColumn || mapColumn.querySelector('.shared-map-key')) return;
    const details = document.createElement('details');
    details.className = 'shared-map-key';
    details.innerHTML = '<summary>Map key</summary><div class="shared-key-body">' + keyRows(true) + '</div>';
    mapColumn.append(details);
  }

  function replacePrintKey() {
    const key = document.querySelector('.print-key');
    if (!key) return;
    key.innerHTML = '<h3>Map key</h3><div class="print-shared-key">' + keyRows(true) + '</div><p class="key-note">Overlay colors and symbols use the same editable key as the public and admin maps. Follow posted campus signs for current conditions.</p>';
  }

  function injectAdminLink() {
    const actions = document.querySelector('.admin-top-actions');
    if (actions && !actions.querySelector('[href="/admin/overlays"]')) {
      const link = document.createElement('a');
      link.href = '/admin/overlays';
      link.textContent = 'Overlays & key';
      actions.append(link);
    }
    const grid = document.querySelector('.edit-choice-grid');
    if (grid && !grid.querySelector('.overlay-key-card')) {
      const link = document.createElement('a');
      link.href = '/admin/overlays';
      link.className = 'overlay-key-card';
      link.innerHTML = '<span class="choice-arrow" aria-hidden="true">→</span><strong>All overlays & key</strong><small>Edit every building, parking lot and mapped feature from one layer inventory.</small>';
      grid.append(link);
    }
  }

  function injectImagesLink() {
    const actions = document.querySelector('.admin-top-actions');
    if (actions && !actions.querySelector('[href="/admin/overlays"]')) {
      const link = document.createElement('a');
      link.href = '/admin/overlays';
      link.textContent = 'Overlays & key';
      actions.append(link);
    }
  }

  setTimeout(() => {
    const page = document.body.dataset.page || 'map';
    if (page === 'map') injectPublicKey();
    if (page === 'print') replacePrintKey();
    if (page === 'admin') injectAdminLink();
    if (page === 'images') injectImagesLink();
  }, 0);
}());
