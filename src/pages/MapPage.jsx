import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import L from 'leaflet'
import {campus,gis,shapeStyle} from '../data/runtime.js'
import {MAP_CENTER,exactPoint,normalize,popularIds} from '../lib.js'
import {BuildingCard,FilterChips,ParkingCard} from '../components/Cards.jsx'
import {AccessPanel,ParkingPanel,ShuttlePanel,TrailsPanel,UpdatesPanel} from '../components/InfoPanels.jsx'
import PlaceDialog from '../components/PlaceDialog.jsx'
import PilotNotice from '../components/PilotNotice.jsx'

const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
const safeColor=v=>/^#[0-9a-f]{3,8}$/i.test(String(v||''))?String(v):'#236192'

function useSearchModel(){
 const [query,setQuery]=useState('');const [filter,setFilter]=useState('all')
 const items=useMemo(()=>[...campus.buildings.map(b=>({...b,_kind:'building',display:b.common_name||b.official_name})),...campus.parking.map(p=>({...p,_kind:'parking',display:`${p.code} — ${p.name}`}))],[])
 const results=useMemo(()=>items.filter(i=>{const f=filter==='all'||(filter==='buildings'&&i._kind==='building')||(filter==='visitor'&&i._kind==='parking'&&['visitor_short_term','permit_pay_by_plate'].includes(i.type))||(filter==='housing'&&i._kind==='building'&&i.category==='housing')||(filter==='services'&&i._kind==='building'&&['student_services','service','dining','athletics'].includes(i.category));if(!f)return false;if(!query.trim())return true;const hay=normalize([i.display,i.official_name,i.abbreviation,i.address,i.category,i.restrictions,...(i.search_terms||[]),...(i.services||[])].join(' '));return hay.includes(normalize(query))}),[items,query,filter])
 return {query,setQuery,filter,setFilter,results}
}

function Tabs({active,setActive,tabs}){
 const refs=useRef([])
 function key(e,i){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let n=i;if(e.key==='ArrowRight')n=(i+1)%tabs.length;if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=tabs.length-1;setActive(tabs[n][0]);refs.current[n]?.focus()}
 return <div className="tablist" role="tablist" aria-label="Campus map information">{tabs.map(([id,label],i)=><button key={id} ref={el=>refs.current[i]=el} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={active===id} tabIndex={active===id?0:-1} onClick={()=>setActive(id)} onKeyDown={e=>key(e,i)}>{label}</button>)}</div>
}

function buildingIcon(b){
 const color=safeColor(b.marker_color||campus.ui?.colors?.marker),label=escapeHtml((b.marker_label||b.abbreviation||'').trim().slice(0,4))
 return L.divIcon({className:'uaf-building-icon',html:`<span style="--pin:${color}">${label||'•'}</span>`,iconSize:[40,40],iconAnchor:[20,20]})
}

function renderGIS(map,onBuilding){
 const add=(fc,opts={})=>{if(fc?.features?.length)L.geoJSON(fc,opts).addTo(map)}
 const colors=campus.ui?.colors||{}
 add(gis.buildings,{style:()=>({color:safeColor(colors.blue),weight:2,fillOpacity:.1})})
 add(gis.parking,{style:()=>({color:safeColor(colors.parking||'#71984A'),weight:2,fillOpacity:.12})})
 add(gis.pedestrian,{style:()=>({color:safeColor(colors.blue),weight:4})})
 add(gis.accessibility,{style:()=>({color:safeColor(colors.access||'#111C4E'),weight:5})})
 add(gis.closures,{style:()=>({color:safeColor(colors.closure||'#DF6A2E'),weight:3,dashArray:'8 6',fillOpacity:.12})})
 add(gis.trails,{style:()=>({color:safeColor(colors.trail||'#71984A'),weight:4})})
 const shapes={type:'FeatureCollection',features:campus.custom_shapes||[]}
 add(shapes,{style:shapeStyle,pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:Number(f.properties?.radius||7),...shapeStyle(f),fillOpacity:Number(f.properties?.fillOpacity??.7)}),onEachFeature:(f,l)=>{if(f.properties?.name)l.bindTooltip(escapeHtml(f.properties.name));const id=f.properties?.building_id;if(id){const b=campus.buildings.find(x=>x.id===id);if(b)l.on('click',e=>onBuilding(b,e.originalEvent))}}})
}

export default function MapPage(){
 const model=useSearchModel(),ui=campus.ui||{},tabFlags=ui.tabs||{},labels=ui.labels||{}
 const allTabs=[['search','Search'],['parking','Parking'],['access','Access'],['shuttle','Shuttle'],['trails','Trails'],['updates','Updates']]
 const visibleTabs=allTabs.filter(([id])=>tabFlags[id]!==false)
 const [active,setActive]=useState(visibleTabs[0]?.[0]||'search'),[selected,setSelected]=useState(null),[selectedParking,setSelectedParking]=useState(null),[status,setStatus]=useState(''),[params,setParams]=useSearchParams()
 const dialogRef=useRef(null),triggerRef=useRef(null),mapRef=useRef(null),mapNode=useRef(null),markers=useRef(null),userLayer=useRef(null)

 useEffect(()=>{if(mapRef.current||!mapNode.current)return;const center=Array.isArray(ui.map?.center)&&ui.map.center.length===2?ui.map.center:MAP_CENTER,zoom=Number(ui.map?.zoom||16);const map=L.map(mapNode.current,{center,zoom,keyboard:true,scrollWheelZoom:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);markers.current=L.layerGroup().addTo(map);mapRef.current=map;renderGIS(map,openBuilding);campus.buildings.filter(exactPoint).forEach(b=>L.marker([b.latitude,b.longitude],{keyboard:true,title:b.common_name,alt:`${b.common_name} map marker`,icon:buildingIcon(b)}).on('click',()=>openBuilding(b,null)).addTo(markers.current));return()=>{map.remove();mapRef.current=null}},[])
 useEffect(()=>{const p=params.get('place');if(p){const b=campus.buildings.find(x=>x.id===p);if(b)setTimeout(()=>openBuilding(b,null),100)}},[])
 useEffect(()=>{const d=dialogRef.current;if(selected||selectedParking){if(d&&!d.open)d.showModal();setTimeout(()=>d?.querySelector('[data-dialog-title]')?.focus(),0)}else if(d?.open)d.close()},[selected,selectedParking])

 function close(){setSelected(null);setSelectedParking(null);if(params.get('place')){const n=new URLSearchParams(params);n.delete('place');setParams(n,{replace:true})}setTimeout(()=>triggerRef.current?.focus(),0)}
 function openBuilding(b,e){triggerRef.current=e?.currentTarget||document.activeElement;setSelected(b);setSelectedParking(null);if(exactPoint(b))mapRef.current?.flyTo([b.latitude,b.longitude],17,{animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches,duration:.4});else setStatus('This building can be routed by address, but its map point is still pending UAF GIS verification.');const n=new URLSearchParams(params);n.set('place',b.id);setParams(n,{replace:true})}
 function openParking(p,e){triggerRef.current=e?.currentTarget||document.activeElement;setSelected(null);setSelectedParking(p)}
 function locate(){if(!navigator.geolocation){setStatus('Location services are not supported in this browser.');return}setStatus('Finding your location…');navigator.geolocation.getCurrentPosition(pos=>{const ll=[pos.coords.latitude,pos.coords.longitude];if(userLayer.current)mapRef.current.removeLayer(userLayer.current);userLayer.current=L.circleMarker(ll,{radius:9,color:'#fff',weight:4,fillColor:safeColor(ui.colors?.blue),fillOpacity:1}).addTo(mapRef.current).bindTooltip('You are here');mapRef.current.setView(ll,17);setStatus('Location found.')},()=>setStatus('Location permission was unavailable. You can still search by building or address.'),{enableHighAccuracy:true,timeout:9000})}
 function fit(){const pts=campus.buildings.filter(exactPoint).map(b=>[b.latitude,b.longitude]);if(pts.length)mapRef.current?.fitBounds(pts,{padding:[40,40],maxZoom:16})}

 const popIds=Array.isArray(ui.popularIds)?ui.popularIds:popularIds,popular=popIds.map(id=>campus.buildings.find(b=>b.id===id)).filter(Boolean)
 return <main id="main-content" className="map-page"><PilotNotice/><section className="map-workspace" aria-label="Interactive campus map workspace"><div className="control-panel"><div className="map-intro"><p className="eyebrow">UAF CAMPUS MAP</p><h1>This way to UAF.</h1><p>Find buildings, parking, services, shuttles and trails across Troth Yeddha' Campus.</p></div><form className="search-form" role="search" onSubmit={e=>{e.preventDefault();if(tabFlags.search!==false)setActive('search')}}><label htmlFor="map-search">{labels.searchLabel||'Find a building, office, service, or parking lot'}</label><div className="search-row"><input id="map-search" type="search" value={model.query} onChange={e=>{model.setQuery(e.target.value);if(tabFlags.search!==false)setActive('search')}} placeholder={labels.searchPlaceholder||'Try Wood Center, library, parking…'}/><button type="submit">{labels.searchButton||'Search'}</button></div><div className="sr-only" aria-live="polite">{model.results.length} results</div></form><Tabs active={active} setActive={setActive} tabs={visibleTabs}/><div className="tabpanel-wrap">{tabFlags.search!==false&&<section role="tabpanel" id="panel-search" aria-labelledby="tab-search" hidden={active!=='search'}><h2>Search campus</h2><FilterChips filter={model.filter} setFilter={model.setFilter}/>{!model.query&&<><h3>{labels.popularHeading||'Popular destinations'}</h3><div className="card-list">{popular.map(b=><BuildingCard key={b.id} b={b} onOpen={openBuilding}/>)}</div></>}<h3>{model.query?'Search results':labels.allPlacesHeading||'All places'}</h3><p className="result-count">{model.results.length} result{model.results.length===1?'':'s'}</p><div className="card-list">{model.results.slice(0,100).map(i=>i._kind==='building'?<BuildingCard key={`b-${i.id}`} b={i} onOpen={openBuilding}/>:<ParkingCard key={`p-${i.id}`} p={i} onOpen={openParking}/>)}</div></section>}{tabFlags.parking!==false&&<section role="tabpanel" id="panel-parking" aria-labelledby="tab-parking" hidden={active!=='parking'}><ParkingPanel onOpen={openParking}/></section>}{tabFlags.access!==false&&<section role="tabpanel" id="panel-access" aria-labelledby="tab-access" hidden={active!=='access'}><AccessPanel/></section>}{tabFlags.shuttle!==false&&<section role="tabpanel" id="panel-shuttle" aria-labelledby="tab-shuttle" hidden={active!=='shuttle'}><ShuttlePanel/></section>}{tabFlags.trails!==false&&<section role="tabpanel" id="panel-trails" aria-labelledby="tab-trails" hidden={active!=='trails'}><TrailsPanel/></section>}{tabFlags.updates!==false&&<section role="tabpanel" id="panel-updates" aria-labelledby="tab-updates" hidden={active!=='updates'}><UpdatesPanel onBuilding={openBuilding}/></section>}</div></div><div className="map-column"><div className="map-toolbar" aria-label="Map controls"><button type="button" onClick={locate}>Use my location</button><button type="button" onClick={fit}>Show campus</button><Link className="button-link" to="/print?template=visitor">Print map</Link></div><div className="pan-controls" aria-label="Map pan controls"><span>Pan map</span><div><button type="button" aria-label="Pan map north" onClick={()=>mapRef.current?.panBy([0,-160],{animate:false})}>↑</button></div><div><button type="button" aria-label="Pan map west" onClick={()=>mapRef.current?.panBy([-160,0],{animate:false})}>←</button><button type="button" aria-label="Pan map east" onClick={()=>mapRef.current?.panBy([160,0],{animate:false})}>→</button></div><div><button type="button" aria-label="Pan map south" onClick={()=>mapRef.current?.panBy([0,160],{animate:false})}>↓</button></div></div><div ref={mapNode} className="map-canvas" aria-label="Interactive map. Essential destination information is also available in the search panel and text map page."/><p className="map-help">Dragging is optional. Use the pan buttons, keyboard arrow keys while the map is focused, or the search list.</p><div className="status-banner" role="status" aria-live="polite">{status}</div></div></section><PlaceDialog ref={dialogRef} building={selected} parking={selectedParking} onClose={close}/></main>
}
