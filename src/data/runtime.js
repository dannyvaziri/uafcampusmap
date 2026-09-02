import {campus,gis} from './index.js'

export const CONFIG_PATH='/map-config.json'
export const RAW_CONFIG_URL='https://raw.githubusercontent.com/dannyvaziri/uafcampusmap/main/public/map-config.json'

export const defaultConfig={
  version:1,
  settings:{
    siteTitle:'University of Alaska Fairbanks',
    siteSubtitle:'Campus Map — Public Pilot',
    pilotTitle:'Public pilot.',
    pilotNotice:'Campus walking and accessible routes are not yet turn-by-turn. Use posted campus signage and current UAF accessibility resources for verified accessible-route information. Parking enforcement boundaries and construction detours are not authoritative until UAF GIS or operational feeds are added.',
    colors:{blue:'#236192',gold:'#FFCD00',marker:'#236192',parking:'#16734b',access:'#6750a4',trail:'#4f6f52',closure:'#b42318'},
    map:{center:[64.857,-147.829],zoom:16},
    labels:{searchLabel:'Find a building, office, service, or parking lot',searchPlaceholder:'Try Wood Center, library, parking…',searchButton:'Search',popularHeading:'Popular destinations',allPlacesHeading:'All places'},
    tabs:{search:true,parking:true,access:true,shuttle:true,trails:true,updates:true},
    popularIds:['signers','wood','library','patty','museum','fine-arts','health-safety','src'],
    contacts:{general:'907-474-7034',admissions:'1-800-478-1823',emergency:'911',corrections:'uaf-web@alaska.edu'}
  },
  buildingOverrides:{},customBuildings:[],parkingOverrides:{},customParking:[],shapes:[]
}

function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
export function mergeConfig(base=defaultConfig,incoming={}){
  return {
    ...base,...incoming,
    settings:{...base.settings,...obj(incoming.settings),colors:{...base.settings.colors,...obj(incoming.settings?.colors)},map:{...base.settings.map,...obj(incoming.settings?.map)},labels:{...base.settings.labels,...obj(incoming.settings?.labels)},tabs:{...base.settings.tabs,...obj(incoming.settings?.tabs)},contacts:{...base.settings.contacts,...obj(incoming.settings?.contacts)}},
    buildingOverrides:{...base.buildingOverrides,...obj(incoming.buildingOverrides)},
    parkingOverrides:{...base.parkingOverrides,...obj(incoming.parkingOverrides)},
    customBuildings:Array.isArray(incoming.customBuildings)?incoming.customBuildings:base.customBuildings,
    customParking:Array.isArray(incoming.customParking)?incoming.customParking:base.customParking,
    shapes:Array.isArray(incoming.shapes)?incoming.shapes:base.shapes
  }
}

async function readJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Config request failed: ${r.status}`);return r.json()}
export async function loadPublishedConfig(){
  try{return mergeConfig(defaultConfig,await readJson(`${RAW_CONFIG_URL}?v=${Date.now()}`))}
  catch(e){try{return mergeConfig(defaultConfig,await readJson(`${CONFIG_PATH}?v=${Date.now()}`))}catch(e2){return mergeConfig(defaultConfig,{})}}
}

function mergeRecords(base,overrides,custom){
  const merged=base.map(x=>({...x,...obj(overrides?.[x.id])})).filter(x=>x.visible!==false)
  const seen=new Set(merged.map(x=>x.id))
  for(const x of custom||[]){if(!x?.id||x.visible===false)continue;const item={...x,...obj(overrides?.[x.id])};if(seen.has(item.id)){const i=merged.findIndex(v=>v.id===item.id);merged[i]={...merged[i],...item}}else{merged.push(item);seen.add(item.id)}}
  return merged
}

export function applyMapConfig(input){
  const cfg=mergeConfig(defaultConfig,input)
  campus.ui=cfg.settings
  campus.map_config=cfg
  campus.buildings=mergeRecords(campus.buildings,cfg.buildingOverrides,cfg.customBuildings)
  campus.parking=mergeRecords(campus.parking,cfg.parkingOverrides,cfg.customParking)
  campus.custom_shapes=cfg.shapes.filter(s=>s?.properties?.visible!==false)
  const c=cfg.settings.colors
  const root=document.documentElement
  root.style.setProperty('--blue',c.blue)
  root.style.setProperty('--gold',c.gold)
  root.style.setProperty('--uaf-blue',c.blue)
  root.style.setProperty('--uaf-gold',c.gold)
  root.style.setProperty('--map-marker',c.marker)
  root.style.setProperty('--map-parking',c.parking)
  root.style.setProperty('--map-access',c.access)
  root.style.setProperty('--map-trail',c.trail)
  root.style.setProperty('--map-closure',c.closure)
  document.title=`${cfg.settings.siteSubtitle} | ${cfg.settings.siteTitle}`
  return cfg
}

export function shapeStyle(feature){
  const p=feature?.properties||{},c=campus.ui?.colors||defaultConfig.settings.colors
  return {color:p.stroke||p.color||c.blue,weight:Number(p.weight||3),opacity:Number(p.opacity??.9),fillColor:p.fill||p.fillColor||p.stroke||c.blue,fillOpacity:Number(p.fillOpacity??.14),dashArray:p.dashArray||undefined}
}

export {campus,gis}
