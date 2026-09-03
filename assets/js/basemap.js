(function () {
  'use strict';

  if (!window.L || !L.tileLayer || !L.Layer) return;

  const originalTileLayer = L.tileLayer;
  const originalWms = originalTileLayer.wms;
  const states = new WeakMap();
  const imageryPattern = /ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile/i;
  const referencePattern = /services\.arcgisonline\.com\/ArcGIS\/rest\/services\/Reference\/(World_Transportation|World_Boundaries_and_Places)\/MapServer\/tile/i;
  const normalBaseUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const normalRoadUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
  const normalPlaceUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';

  function createNormalLayers() {
    return [
      originalTileLayer(normalBaseUrl, {
        maxZoom: 19,
        crossOrigin: true,
        attribution: 'Basemap © Esri, HERE, Garmin, FAO, NOAA, USGS'
      }),
      originalTileLayer(normalRoadUrl, {
        maxZoom: 20,
        crossOrigin: true,
        opacity: 0.62,
        attribution: 'Transportation reference © Esri'
      }),
      originalTileLayer(normalPlaceUrl, {
        maxZoom: 20,
        crossOrigin: true,
        opacity: 0.48,
        attribution: 'Reference labels © Esri'
      })
    ];
  }

  function updateControl(state) {
    if (!state?.controlNode) return;
    state.controlNode.querySelectorAll('[data-basemap]').forEach(button => {
      const active = button.dataset.basemap === state.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function emit(map, mode) {
    window.dispatchEvent(new CustomEvent('uaf:basemapchange', {detail:{map,mode}}));
  }

  function setMode(map, mode) {
    const state = states.get(map);
    if (!state) return;
    const previous = state.mode;
    state.mode = mode === 'satellite' && state.imagery ? 'satellite' : 'map';

    if (state.mode === 'satellite') {
      state.normal.forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
      if (!map.hasLayer(state.imagery)) state.imagery.addTo(map);
      state.references.forEach(layer => { if (!map.hasLayer(layer)) layer.addTo(map); });
    } else {
      if (state.imagery && map.hasLayer(state.imagery)) map.removeLayer(state.imagery);
      state.references.forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
      state.normal.forEach(layer => { if (!map.hasLayer(layer)) layer.addTo(map); });
    }

    updateControl(state);
    if (previous !== state.mode) emit(map, state.mode);
  }

  function ensureState(map) {
    let state = states.get(map);
    if (state) return state;

    state = {
      mode: 'map',
      normal: createNormalLayers(),
      imagery: null,
      references: [],
      controlNode: null
    };
    states.set(map, state);
    state.normal.forEach(layer => layer.addTo(map));

    const control = L.control({position: 'topright'});
    control.onAdd = function () {
      const wrap = L.DomUtil.create('div', 'leaflet-bar uaf-basemap-control');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Map background');
      wrap.setAttribute('data-html2canvas-ignore', 'true');
      wrap.innerHTML = '<button type="button" data-basemap="map" class="active" aria-pressed="true">Map</button><button type="button" data-basemap="satellite" aria-pressed="false">Satellite</button>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      wrap.querySelectorAll('[data-basemap]').forEach(button => {
        L.DomEvent.on(button, 'click', event => {
          L.DomEvent.preventDefault(event);
          setMode(map, button.dataset.basemap);
        });
      });
      state.controlNode = wrap;
      updateControl(state);
      return wrap;
    };
    control.addTo(map);
    return state;
  }

  const ImageryProxy = L.Layer.extend({
    initialize: function (url, options) {
      this._realLayer = originalTileLayer(url, options || {});
      this._mapRef = null;
    },
    onAdd: function (map) {
      this._mapRef = map;
      const state = ensureState(map);
      state.imagery = this._realLayer;
      setMode(map, 'map');
    },
    onRemove: function (map) {
      const state = states.get(map);
      if (!state) return;
      if (map.hasLayer(this._realLayer)) map.removeLayer(this._realLayer);
      if (state.imagery === this._realLayer) state.imagery = null;
      state.mode = 'map';
      updateControl(state);
    },
    getAttribution: function () {
      return this._realLayer.getAttribution ? this._realLayer.getAttribution() : '';
    }
  });

  const ReferenceProxy = L.Layer.extend({
    initialize: function (url, options) {
      this._realLayer = originalTileLayer(url, options || {});
    },
    onAdd: function (map) {
      const state = ensureState(map);
      if (!state.references.includes(this._realLayer)) state.references.push(this._realLayer);
      if (state.mode === 'satellite' && !map.hasLayer(this._realLayer)) this._realLayer.addTo(map);
    },
    onRemove: function (map) {
      const state = states.get(map);
      if (map.hasLayer(this._realLayer)) map.removeLayer(this._realLayer);
      if (state) state.references = state.references.filter(layer => layer !== this._realLayer);
    },
    getAttribution: function () {
      return this._realLayer.getAttribution ? this._realLayer.getAttribution() : '';
    }
  });

  L.tileLayer = function (url, options) {
    const text = String(url || '');
    if (imageryPattern.test(text)) return new ImageryProxy(url, options);
    if (referencePattern.test(text)) return new ReferenceProxy(url, options);
    return originalTileLayer(url, options);
  };
  if (originalWms) L.tileLayer.wms = originalWms;

  window.UAFBasemap = {
    setMode,
    getMode: map => states.get(map)?.mode || 'map'
  };
})();
