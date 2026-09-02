import React from 'react'
import {isVerifiedPoint} from '../lib.js'

export function FilterChips({filter,setFilter}){
  const filters=[['all','All'],['buildings','Buildings'],['visitor','Visitor parking'],['housing','Housing'],['services','Services']]
  return <div className="chips" aria-label="Search filters">{filters.map(([id,label])=><button key={id} type="button" className={filter===id?'chip active':'chip'} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
}
export function BuildingCard({b,onOpen}){return <button type="button" className="result-card" onClick={e=>onOpen(b,e)}><span><strong>{b.common_name}</strong><small>{b.address}</small></span><span className={isVerifiedPoint(b)?'status-pill verified':'status-pill pending'}>{isVerifiedPoint(b)?'UAF-linked point':'GIS pending'}</span></button>}
export function ParkingCard({p,onOpen}){return <button type="button" className="result-card" onClick={e=>onOpen(p,e)}><span><strong>{p.code} — {p.name}</strong><small>{p.restrictions}</small></span><span className="status-pill">{(p.type||'parking').replaceAll('_',' ')}</span></button>}
