(function(){
  'use strict';
  if ((document.body.dataset.page || '') !== 'map' || !window.L || !L.geoJSON) return;

  const originalGeoJSON = L.geoJSON;

  function publicSurfaceStyle(feature, base){
    const kind = feature && feature.properties ? String(feature.properties.kind || '') : '';
    if (kind === 'parking-area') {
      return Object.assign({}, base, {
        color:'#7d8a92',
        weight:1.25,
        opacity:.86,
        fillColor:'#aeb8bd',
        fillOpacity:.48,
        dashArray:undefined
      });
    }
    if (kind === 'building-footprint') {
      return Object.assign({}, base, {
        color:'#657b88',
        weight:1.35,
        opacity:.96,
        fillColor:'#e8eef1',
        fillOpacity:.84,
        dashArray:undefined
      });
    }
    return base;
  }

  L.geoJSON = function(data, options){
    const next = Object.assign({}, options || {});
    const features = data && data.type === 'FeatureCollection' && Array.isArray(data.features) ? data.features : [];
    const isPublicSurfaceCollection = !next.pane && features.some(function(feature){
      const kind = feature && feature.properties ? feature.properties.kind : '';
      return kind === 'building-footprint' || kind === 'parking-area';
    });

    if (isPublicSurfaceCollection) {
      const originalStyle = next.style;
      next.style = function(feature){
        const base = typeof originalStyle === 'function' ? (originalStyle(feature) || {}) : Object.assign({}, originalStyle || {});
        return publicSurfaceStyle(feature, base);
      };
    }

    return originalGeoJSON.call(L, data, next);
  };

  Object.keys(originalGeoJSON).forEach(function(key){
    try { L.geoJSON[key] = originalGeoJSON[key]; } catch (error) {}
  });
})();
