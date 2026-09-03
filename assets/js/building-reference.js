(function(){
  'use strict';
  if ((document.body.dataset.page || '') !== 'map' || !window.L) return;

  const SOURCE='https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Building_Outlines_2023_Pictometry/FeatureServer/22/query';
  const BBOX={west:-147.8565,south:64.8505,east:-147.8095,north:64.8635};
  const buildings=read('uaf-buildings',[]);
  const config=read('uaf-config',{});
  const points=buildings.map(row=>{
    const override=config?.buildingOverrides?.[row.id]||{};
    const lat=Number(override.latitude ?? row.latitude);
    const lng=Number(override.longitude ?? row.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lng)?[lat,lng]:null;
  }).filter(Boolean);

  function read(id,fallback){try{const n=document.getElementById(id);return n?JSON.parse(n.textContent||''):fallback;}catch(error){return fallback;}}
  function meters(a,b){
    const R=6371000;
    const p1=a[0]*Math.PI/180,p2=b[0]*Math.PI/180;
    const dp=(b[0]-a[0])*Math.PI/180,dl=(b[1]-a[1])*Math.PI/180;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function center(feature){
    const rings=feature?.geometry?.coordinates;
    const ring=Array.isArray(rings?.[0])?rings[0]:null;
    if(!ring?.length)return null;
    let lat=0,lng=0,n=0;
    ring.forEach(pair=>{if(Array.isArray(pair)&&Number.isFinite(Number(pair[0]))&&Number.isFinite(Number(pair[1]))){lng+=Number(pair[0]);lat+=Number(pair[1]);n++;}});
    return n?[lat/n,lng/n]:null;
  }
  function nearCampus(feature){
    const c=center(feature);
    if(!c||!points.length)return true;
    let best=Infinity;
    for(const point of points){best=Math.min(best,meters(c,point));if(best<180)return true;}
    return false;
  }
  async function fetchFeatures(){
    const params=new URLSearchParams({
      where:'1=1',
      geometry:[BBOX.west,BBOX.south,BBOX.east,BBOX.north].join(','),
      geometryType:'esriGeometryEnvelope',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      outSR:'4326',
      returnGeometry:'true',
      outFields:'OBJECTID,NAME,GlobalID',
      resultRecordCount:'2000',
      geometryPrecision:'7',
      f:'geojson'
    });
    const response=await fetch(SOURCE+'?'+params.toString(),{headers:{Accept:'application/geo+json,application/json'}});
    if(!response.ok)throw new Error('Footprint service '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.features))throw new Error('No building features returned');
    return data.features.filter(feature=>feature?.geometry?.type==='Polygon'&&nearCampus(feature));
  }
  function draw(map,features){
    const pane=map.getPane('uaf-building-reference')||map.createPane('uaf-building-reference');
    pane.style.zIndex='382';
    pane.style.pointerEvents='none';
    L.geoJSON({type:'FeatureCollection',features},{
      pane:'uaf-building-reference',
      interactive:false,
      style:{color:'#7d8f9a',weight:1.15,opacity:.92,fillColor:'#e7edf0',fillOpacity:.82}
    }).addTo(map);
  }
  function attach(map){
    if(!map||map._uafBuildingReference)return;
    map._uafBuildingReference=true;
    fetchFeatures().then(features=>draw(map,features)).catch(()=>{});
  }
  window.addEventListener('uaf:mapready',event=>attach(event.detail?.map));
  if(window.UAFExperience?.map)attach(window.UAFExperience.map);
})();
