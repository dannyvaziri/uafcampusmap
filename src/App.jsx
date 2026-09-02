import React from 'react'
import {Link,NavLink,Route,Routes,useLocation} from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import AccessiblePage from './pages/AccessiblePage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import ImageOverlayPage from './pages/ImageOverlayPage.jsx'
import PrintPage from './pages/PrintPage.jsx'
import {campus} from './data/runtime.js'

function telHref(value){const digits=String(value||'').replace(/\D/g,'');return `tel:${digits.length===10?'+1'+digits:'+'+digits}`}

function Header(){
 const ui=campus.ui||{},subtitle=ui.siteSubtitle||'Campus Map',location=useLocation(),admin=location.pathname.startsWith('/admin')
 return <header className="site-header">
  <div className="brand-grid" aria-hidden="true"/>
  <Link className="brand-lockup" to="/" aria-label="University of Alaska Fairbanks campus map home">
   <img className="uaf-logo" src="/uaf-logo.svg" alt="University of Alaska Fairbanks"/>
   <span className="map-product-name">{subtitle}</span>
  </Link>
  <nav className="header-nav" aria-label="Campus map tools">
   <NavLink to="/" end>Map</NavLink>
   <NavLink to="/accessible">Text map</NavLink>
   <NavLink to="/print">Print</NavLink>
   {admin&&<><NavLink to="/admin" end>Admin</NavLink><NavLink to="/admin/images">PNG overlays</NavLink></>}
  </nav>
 </header>
}

function Footer(){
 const c=campus.ui?.contacts||{},general=c.general||'907-474-7034',admissions=c.admissions||'1-800-478-1823',emergency=c.emergency||'911',corrections=c.corrections||'uaf-web@alaska.edu'
 return <footer className="site-footer">
  <div className="footer-brand"><strong>University of Alaska Fairbanks</strong><span>Troth Yeddha' Campus · Fairbanks, Alaska</span></div>
  <div className="footer-links"><a href="https://www.uaf.edu/" target="_blank" rel="noreferrer">UAF home</a><a href={telHref(general)}>General {general}</a><a href={telHref(admissions)}>Admissions {admissions}</a><a href={`tel:${emergency.replace(/\D/g,'')}`}>Emergency {emergency}</a><a href={`mailto:${corrections}`}>Map corrections</a></div>
 </footer>
}

function NotFound(){return <main id="main-content" className="page narrow"><p className="eyebrow">UAF CAMPUS MAP</p><h1>That path doesn't lead anywhere.</h1><p><Link to="/">Return to the campus map</Link>.</p></main>}

export default function App(){return <><a className="skip-link" href="#main-content">Skip to main content</a><Header/><Routes><Route path="/" element={<MapPage/>}/><Route path="/accessible" element={<AccessiblePage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/admin/images" element={<ImageOverlayPage/>}/><Route path="/print" element={<PrintPage/>}/><Route path="*" element={<NotFound/>}/></Routes><Footer/></>}
