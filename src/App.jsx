import React from 'react'
import {Link,NavLink,Route,Routes} from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import AccessiblePage from './pages/AccessiblePage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import PrintPage from './pages/PrintPage.jsx'
import {campus} from './data/runtime.js'

function telHref(value){const digits=String(value||'').replace(/\D/g,'');return `tel:${digits.length===10?'+1'+digits:'+'+digits}`}
function Header(){const ui=campus.ui||{},title=ui.siteTitle||'University of Alaska Fairbanks',subtitle=ui.siteSubtitle||'Campus Map — Public Pilot';return <header className="site-header"><div className="brand-lockup" aria-label={`${title} campus map`}><div className="brand-mark" aria-hidden="true">UAF</div><div><strong>{title}</strong><span>{subtitle}</span></div></div><nav className="header-nav" aria-label="Campus map tools"><NavLink to="/accessible">Text map</NavLink><NavLink to="/print?template=visitor">Print</NavLink></nav></header>}
function Footer(){const c=campus.ui?.contacts||{},general=c.general||'907-474-7034',admissions=c.admissions||'1-800-478-1823',emergency=c.emergency||'911',corrections=c.corrections||'uaf-web@alaska.edu';return <footer className="site-footer"><div><strong>{campus.ui?.siteTitle||'University of Alaska Fairbanks'}</strong><br/>General information: <a href={telHref(general)}>{general}</a> · Admissions: <a href={telHref(admissions)}>{admissions}</a> · Emergency: <a href={`tel:${emergency.replace(/\D/g,'')}`}>{emergency}</a></div><div>Map corrections: <a href={`mailto:${corrections}`}>{corrections}</a></div></footer>}
function NotFound(){return <main id="main-content" className="page narrow"><h1>Page not found</h1><p><Link to="/">Return to the campus map</Link>.</p></main>}
export default function App(){return <><a className="skip-link" href="#main-content">Skip to main content</a><Header/><Routes><Route path="/" element={<MapPage/>}/><Route path="/accessible" element={<AccessiblePage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/print" element={<PrintPage/>}/><Route path="*" element={<NotFound/>}/></Routes><Footer/></>}
