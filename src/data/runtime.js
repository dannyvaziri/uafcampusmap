import {campus,gis} from './index.js'

export const CONFIG_PATH='/map-config.json'
export const RAW_CONFIG_URL='https://raw.githubusercontent.com/dannyvaziri/uafcampusmap/main/public/map-config.json'

export const defaultConfig={
  version:3,
  settings:{
    siteTitle:'University of Alaska Fairbanks',siteSubtitle:'Campus Map',pilotTitle:'Public pilot.',pilotNotice:'Campus walking and accessible routes are not yet turn-by-turn. Use posted campus signage and current UAF accessibility resources for verified accessible-route information. Parking enforcement boundaries and construction detours are not authoritative until UAF GIS or operational feeds are added.',
    colors:{blue:'#236192',gold:'#FFCD00',marker:'#236192',parking:'#71984A',access:'#111C4E',trail:'#71984A',closure:'#DF6A2E'},map:{center:[64.857,-147.829],zoom:16},labels:{searchLabel:'Find a building, office, service, or parking lot',searchPlaceholder:'Try Wood Center, library, parking…',searchButton:'Search',popularHeading:'Popular destinations',allPlacesHeading:'All places'},tabs:{search:true,parking:true,access:true,shuttle:true,trails:true,updates:true},popularIds:['signers','wood','library','patty','museum','fine-arts','health-safety','src'],contacts:{general:'907-474-7034',admissions:'1-800-478-1823',emergency:'911',corrections:'uaf-web@alaska.edu'}
  },
  buildingOverrides:{},customBuildings:[],parkingOverrides:{},customParking:[],contentOverrides:{},shapes:[],imageOverlays:[]
}
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
function clone(v){return JSON.parse(JSON.stringify(v))}
const finite=n=>Number.isFinite(Number(n))
const coord=p=>Array.isArray(p)&&p.length>=2&&finite(p[0])&&finite(p[1])&&Number(p[0])>=-180&&Number(p[0])<=180&&Number(p[1])>=-90&&Number(p[1])<=90
const uniqueCoords=points=>new Set((points||[]).filter(coord).map(p=>`${Number(p[0]).toFixed(7)},${Number(p[1]).toFixed(7)}`)).size
export function validFeature(feature){
 const g=feature?.geometry;if(!g||!g.type)return false
 if(g.type==='Point')return coord(g.coordinates)
 if(g.type==='LineString')return Array.isArray(g.coordinates)&&g.coordinates.length>=2&&uniqueCoords(g.coordinates)>=2
 if(g.type==='Polygon'){
  const ring=g.coordinates?.[0];if(!Array.isArray(ring)||ring.length<4||!ring.every(coord)||uniqueCoords(ring)<3)return false
  const a=ring[0],b=ring[ring.length-1];return Number(a[0])===Number(b[0])&&Number(a[1])===Number(b[1])
 }
 if(g.type==='MultiPolygon')return Array.isArray(g.coordinates)&&g.coordinates.length>0&&g.coordinates.every(poly=>validFeature({geometry:{type:'Polygon',coordinates:poly}}))
 return false
}
export function validImageOverlay(x){
 if(!x||x.visible===false||!x.dataUrl||!Array.isArray(x.bounds)||x.bounds.length!==2)return false
 const a=x.bounds[0],b=x.bounds[1];if(!Array.isArray(a)||!Array.isArray(b)||a.length<2||b.length<2)return false
 const south=Number(a[0]),west=Number(a[1]),north=Number(b[0]),east=Number(b[1])
 return [south,west,north,east].every(Number.isFinite)&&south>=-90&&north<=90&&west>=-180&&east<=180&&south<north&&west<east
}
export function mergeConfig(base=defaultConfig,incoming={}){return {...base,...incoming,version:Math.max(Number(base.version||0),Number(incoming.version||0)),settings:{...base.settings,...obj(incoming.settings),colors:{...base.settings.colors,...obj(incoming.settings?.colors)},map:{...base.settings.map,...obj(incoming.settings?.map)},labels:{...base.settings.labels,...obj(incoming.settings?.labels)},tabs:{...base.settings.tabs,...obj(incoming.settings?.tabs)},contacts:{...base.settings.contacts,...obj(incoming.settings?.contacts)}},buildingOverrides:{...base.buildingOverrides,...obj(incoming.buildingOverrides)},parkingOverrides:{...base.parkingOverrides,...obj(incoming.parkingOverrides)},customBuildings:Array.isArray(incoming.customBuildings)?incoming.customBuildings:base.customBuildings,customParking:Array.isArray(incoming.customParking)?incoming.customParking:base.customParking,contentOverrides:{...base.contentOverrides,...obj(incoming.contentOverrides)},shapes:Array.isArray(incoming.shapes)?incoming.shapes:base.shapes,imageOverlays:Array.isArray(incoming.imageOverlays)?incoming.imageOverlays:base.imageOverlays}}
async function readJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Config request failed: ${r.status}`);return r.json()}
function recentBrowserPublish(){try{const raw=localStorage.getItem('uaf-map-live-config');if(!raw)return null;const payload=JSON.parse(raw);if(!payload?.config||!payload?.time)return null;if(Date.now()-Number(payload.time)>10*60*1000){localStorage.removeItem('uaf-map-live-config');return null}return mergeConfig(defaultConfig,payload.config)}catch(e){return null}}
export async function loadPublishedConfig(){const local=recentBrowserPublish();if(local)return local;try{return mergeConfig(defaultConfig,await readJson(`${RAW_CONFIG_URL}?v=${Date.now()}`))}catch(e){try{return mergeConfig(defaultConfig,await readJson(`${CONFIG_PATH}?v=${Date.now()}`))}catch(e2){return mergeConfig(defaultConfig,{})}}}
function mergeRecords(base,overrides,custom){const merged=base.map(x=>({...x,...obj(overrides?.[x.id])})).filter(x=>x.visible!==false);const seen=new Set(merged.map(x=>x.id));for(const x of custom||[]){if(!x?.id||x.visible===false)continue;const item={...x,...obj(overrides?.[x.id])};if(seen.has(item.id)){const i=merged.findIndex(v=>v.id===item.id);merged[i]={...merged[i],...item}}else{merged.push(item);seen.add(item.id)}}return merged}
function mergeSection(base,override){if(Array.isArray(override))return override;if(!override||typeof override!=='object')return base;const out={...base,...override};for(const [k,v] of Object.entries(override)){if(v&&typeof v==='object'&&!Array.isArray(v)&&base?.[k]&&typeof base[k]==='object'&&!Array.isArray(base[k]))out[k]={...base[k],...v}}return out}
export function applyMapConfig(input){const cfg=mergeConfig(defaultConfig,input);if(!campus._base_buildings)campus._base_buildings=clone(campus.buildings);if(!campus._base_parking)campus._base_parking=clone(campus.parking);if(!campus._base_sections)campus._base_sections={parking_policy:clone(campus.parking_policy),shuttle:clone(campus.shuttle),accessibility:clone(campus.accessibility),construction:clone(campus.construction),trails:clone(campus.trails)};campus.ui=cfg.settings;campus.map_config=cfg;campus.buildings=mergeRecords(campus._base_buildings,cfg.buildingOverrides,cfg.customBuildings);campus.parking=mergeRecords(campus._base_parking,cfg.parkingOverrides,cfg.customParking);for(const key of ['parking_policy','shuttle','accessibility','construction','trails'])campus[key]=mergeSection(campus._base_sections[key],cfg.contentOverrides?.[key]);campus.custom_shapes=cfg.shapes.filter(s=>s?.properties?.visible!==false&&validFeature(s));campus.image_overlays=cfg.imageOverlays.filter(validImageOverlay);const c=cfg.settings.colors,root=document.documentElement;root.style.setProperty('--blue',c.blue);root.style.setProperty('--gold',c.gold);root.style.setProperty('--uaf-blue',c.blue);root.style.setProperty('--uaf-gold',c.gold);root.style.setProperty('--map-marker',c.marker);root.style.setProperty('--map-parking',c.parking);root.style.setProperty('--map-access',c.access);root.style.setProperty('--map-trail',c.trail);root.style.setProperty('--map-closure',c.closure);document.title=`${cfg.settings.siteSubtitle} | ${cfg.settings.siteTitle}`;return cfg}
export function shapeStyle(feature){const p=feature?.properties||{},c=campus.ui?.colors||defaultConfig.settings.colors;return {color:p.stroke||p.color||c.blue,weight:Math.max(1,Number(p.weight||3)),opacity:Math.max(0,Math.min(1,Number(p.opacity??.9))),fillColor:p.fill||p.fillColor||p.stroke||c.blue,fillOpacity:Math.max(0,Math.min(1,Number(p.fillOpacity??.14))),dashArray:p.dashArray||undefined}}
export {campus,gis}
