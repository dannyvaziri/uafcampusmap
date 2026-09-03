(function(){
  'use strict';
  if ((document.body.dataset.page || '') !== 'map' || !window.L) return;

  function neutralizeLegacy(layer){
    if (!layer) return;
    const props = layer.feature && layer.feature.properties ? layer.feature.properties : null;
    const pane = String(layer.options && layer.options.pane || '');
    const kind = props && String(props.kind || '');
    const legacyMappedShape = (kind === 'building-footprint' || kind === 'parking-area') && !pane.startsWith('uaf-');

    if (legacyMappedShape && typeof layer.setStyle === 'function') {
      layer.setStyle({opacity:0,fillOpacity:0,weight:0});
      if (layer._path) layer._path.style.pointerEvents = 'none';
    }
    if (typeof layer.eachLayer === 'function') layer.eachLayer(neutralizeLegacy);
  }

  function apply(){
    const map = window.UAFExperience && window.UAFExperience.map;
    if (!map) return false;
    map.eachLayer(neutralizeLegacy);
    if (!map._uafLegacyGuard) {
      map._uafLegacyGuard = true;
      map.on('layeradd', function(event){
        setTimeout(function(){ neutralizeLegacy(event.layer); }, 0);
      });
    }
    return true;
  }

  window.addEventListener('uaf:mapready', function(){ setTimeout(apply, 250); });
  let attempts = 0;
  const timer = setInterval(function(){
    attempts += 1;
    if (apply() || attempts > 20) clearInterval(timer);
  }, 150);
})();
