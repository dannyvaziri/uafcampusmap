import React,{useMemo,useState} from 'react'
import {Link} from 'react-router-dom'
import {campus} from '../data/runtime.js'
import {normalize} from '../lib.js'
import PilotNotice from '../components/PilotNotice.jsx'

export default function AccessiblePage(){
 const[q,setQ]=useState('')
 const rows=useMemo(()=>campus.buildings.filter(b=>normalize(JSON.stringify(b)).includes(normalize(q))),[q])
 return <main id="main-content" className="page"><PilotNotice/><h1>Text-only campus map</h1><p>Search the same building inventory without using the visual map.</p><div className="page-actions"><Link to="/">Interactive map</Link><Link to="/print">Print center</Link><a href={campus.accessibility.facilities_url} target="_blank" rel="noreferrer">Accessibility resources</a><a href={campus.shuttle.service_url} target="_blank" rel="noreferrer">Shuttle service</a></div><label htmlFor="text-search">Search buildings</label><input id="text-search" className="wide-input" type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Building, office, service or address"/><p aria-live="polite">{rows.length} buildings</p><div className="text-list">{rows.map(b=><article key={b.id}><h2>{b.common_name}</h2><p>{b.address||'Address pending'}</p>{b.services?.length>0&&<p>{b.services.join(' · ')}</p>}<p><Link to={`/?place=${encodeURIComponent(b.id)}`}>Open on map</Link>{b.source_url&&<> · <a href={b.source_url} target="_blank" rel="noreferrer">UAF profile</a></>} · <Link to={`/print?mode=selected&place=${encodeURIComponent(b.id)}`}>Print this area</Link></p></article>)}</div></main>
}
