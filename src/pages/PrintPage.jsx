import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import L from 'leaflet'
import {QRCodeSVG} from 'qrcode.react'
import {campus,shapeStyle} from '../data/runtime.js'
import {exactPoint} from '../lib.js'

const PAPER={ledger:{label:'11×17',page:'17in 11in'},letter:{label:'8.5×11',page:'11in 8.5in'}}
const boundsForCampus=()=>{const pts=campus.buildings.filter(exactPoint).map(b=>[Number(b.latitude),Number(b.longitude)]);return pts.length?L.latLngBounds(pts):L.latLngBounds([[64.849,-147.855],[64.862,-147.812]])}
const safeColor=v=>/^#[0-9a-f]{3,8}$/i.test(String(v||''))?String(v):'#236192'

function buildingLabel(b){return `<span class="print-building-dot" style="--pin:${safeColor(b.marker_color||campus.ui?.colors?.marker)}"></span><span>${String(b.common_name||b.official_name||'Building').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}</span>`}

export default function PrintPage(){
 const [params,setParams]=useSearchParams()
 const [mode,setMode]=useState(params.get('mode')==='selected'?'selected':'full')
 const [paper,setPaper]=useState(params.get('paper')==='letter'?'letter':'ledger')
 const [showBuildings,setShowBuildings]=useState(true),[showParking,setShowParking]=useState(true),[showShapes,setShowShapes]=useState(true)
 const mapNode=useRef(null),mapRef=useRef(null),overlayRef=useRef(null)
 const liveUrl=typeof window!=='undefined'?window.location.origin:'https://www.uaf.edu/campusmap/'
 const locatedBuildings=useMemo(()=>campus.buildings.filter(exactPoint),[])

 useEffect(()=>{
  const id='uaf-print-page-style';let style=document.getElementById(id);if(!style){style=document.createElement('style');style.id=id;document.head.appendChild(style)}
  style.textContent=`@page{size:${PAPER[paper].page};margin:.25in}`
  document.body.dataset.printPaper=paper
  return()=>{delete document.body.dataset.printPaper}
 },[paper])

 useEffect(()=>{
  if(!mapNode.current||mapRef.current)return
  const map=L.map(mapNode.current,{center:campus.ui?.map?.center||[64.857,-147.829],zoom:Number(campus.ui?.map?.zoom||16),zoomControl:true,attributionControl:true,keyboard:true,preferCanvas:true})
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors',crossOrigin:true}).addTo(map)
  overlayRef.current=L.layerGroup().addTo(map);mapRef.current=map
  map.fitBounds(boundsForCampus(),{padding:[28,28],maxZoom:16})
  setTimeout(()=>map.invalidateSize(),0)
  return()=>{map.remove();mapRef.current=null;overlayRef.current=null}
 },[])

 useEffect(()=>{
  const map=mapRef.current,group=overlayRef.current;if(!map||!group)return;group.clearLayers()
  if(showShapes){
   const shapes=(campus.custom_shapes||[]).filter(s=>s?.properties?.visible!==false)
   if(shapes.length)L.geoJSON({type:'FeatureCollection',features:shapes},{style:f=>({...shapeStyle(f),weight:Math.max(2,Number(f.properties?.weight||3))}),pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:6,...shapeStyle(f)}),onEachFeature:(f,l)=>{if(f.properties?.name)l.bindTooltip(f.properties.name,{permanent:false})}}).addTo(group)
  }
  if(showBuildings){locatedBuildings.forEach(b=>{const m=L.circleMarker([b.latitude,b.longitude],{radius:5,color:'#fff',weight:2,fillColor:safeColor(b.marker_color||campus.ui?.colors?.marker),fillOpacity:1}).addTo(group);m.bindTooltip(buildingLabel(b),{permanent:true,direction:'right',offset:[7,0],className:'print-building-label',opacity:1})})}
  if(showParking){
   const parkingShapes=(campus.custom_shapes||[]).filter(s=>s?.properties?.kind==='parking-area'&&s.properties?.visible!==false)
   parkingShapes.forEach(f=>L.geoJSON(f,{style:()=>({color:safeColor(campus.ui?.colors?.parking||'#71984A'),weight:2,fillColor:safeColor(campus.ui?.colors?.parking||'#71984A'),fillOpacity:.16})}).addTo(group))
  }
 },[showBuildings,showParking,showShapes,locatedBuildings])

 useEffect(()=>{if(mode==='full'&&mapRef.current)mapRef.current.fitBounds(boundsForCampus(),{padding:[28,28],maxZoom:16})},[mode])

 function updateParam(key,value){const n=new URLSearchParams(params);n.set(key,value);setParams(n,{replace:true})}
 function changeMode(v){setMode(v);updateParam('mode',v);setTimeout(()=>mapRef.current?.invalidateSize(),0)}
 function changePaper(v){setPaper(v);updateParam('paper',v);setTimeout(()=>mapRef.current?.invalidateSize(),0)}
 function resetFull(){setMode('full');updateParam('mode','full');mapRef.current?.fitBounds(boundsForCampus(),{padding:[28,28],maxZoom:16})}
 function printNow(){setTimeout(()=>window.print(),80)}

 return <main id="main-content" className={`print-page true-print ${paper} ${mode}`}>
  <div className="print-tools" aria-label="Print map controls">
   <Link to="/">Back to map</Link>
   <label>Area<select value={mode} onChange={e=>changeMode(e.target.value)}><option value="full">Full campus</option><option value="selected">Selected area / current view</option></select></label>
   <label>Paper<select value={paper} onChange={e=>changePaper(e.target.value)}><option value="ledger">11×17</option><option value="letter">8.5×11</option></select></label>
   <label className="print-toggle"><input type="checkbox" checked={showBuildings} onChange={e=>setShowBuildings(e.target.checked)}/> Building names</label>
   <label className="print-toggle"><input type="checkbox" checked={showParking} onChange={e=>setShowParking(e.target.checked)}/> Parking</label>
   <label className="print-toggle"><input type="checkbox" checked={showShapes} onChange={e=>setShowShapes(e.target.checked)}/> Map shapes</label>
   <button type="button" onClick={resetFull}>Show full campus</button>
   <button type="button" className="print-button" onClick={printNow}>Print / Save</button>
  </div>
  <section className="print-live-shell">
   <header className="print-live-header"><div className="print-brand"><img src="/uaf-logo.svg" alt="University of Alaska Fairbanks"/><div><span>CAMPUS MAP</span><h1>{mode==='full'?'Full campus map':'Selected campus area'}</h1></div></div><div className="print-meta"><strong>{PAPER[paper].label}</strong><span>{new URL(liveUrl).host}</span></div></header>
   <div className="print-selection-note">{mode==='selected'?<><strong>Selected area:</strong> Pan and zoom the map until it shows exactly what you want, then click <strong>Print / Save</strong>.</>:<><strong>Full campus:</strong> The map automatically fits the main campus. Switch to Selected area to print a smaller section.</>}</div>
   <div ref={mapNode} className="print-live-map" aria-label="Detailed printable UAF campus map with OpenStreetMap road names, building labels and map overlays"/>
   <footer className="print-live-footer"><div><strong>University of Alaska Fairbanks</strong><br/>General information 907-474-7034 · Admissions 1-800-478-1823 · Emergency 911<br/>Map corrections: uaf-web@alaska.edu</div><div className="print-legend"><span><i className="legend-building"/>Building</span><span><i className="legend-parking"/>Parking / mapped area</span></div><div className="north">↑<br/>North</div><QRCodeSVG value={`${liveUrl}/`} size={72} title="QR code to the live UAF campus map"/></footer>
  </section>
 </main>
}
