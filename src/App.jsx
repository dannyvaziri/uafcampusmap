import React from 'react'
import {Link,NavLink,Route,Routes} from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import AccessiblePage from './pages/AccessiblePage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import PrintPage from './pages/PrintPage.jsx'

export function PilotNotice(){return <aside className="pilot-notice" aria-label="Public pilot limitations"><strong>Public pilot.</strong> Campus walking and accessible routes are not yet turn-by-turn. Use posted campus signage and current UAF accessibility resources for verified accessible-route information. Parking enforcement boundaries and construction detours are not authoritative until UAF GIS or operational feeds are added.</aside>}
function Header(){return <header className="site-header"><div className="brand-lockup" aria-label="University of Alaska Fairbanks campus map"><div className="brand-mark" aria-hidden="true">UAF</div><div><strong>University of Alaska Fairbanks</strong><span>Campus Map — Public Pilot</span></div></div><nav className="header-nav" aria-label="Campus map tools"><NavLink to="/accessible">Text map</NavLink><NavLink to="/print?template=visitor">Print</NavLink><NavLink to="/admin">Data health</NavLink></nav></header>}
function Footer(){return <footer className="site-footer"><div><strong>University of Alaska Fairbanks</strong><br/>General information: <a href="tel:+19074747034">907-474-7034</a> · Admissions: <a href="tel:+18004781823">1-800-478-1823</a> · Emergency: <a href="tel:911">911</a></div><div>Map corrections: <a href="mailto:uaf-web@alaska.edu">uaf-web@alaska.edu</a></div></footer>}
function NotFound(){return <main id="main-content" className="page narrow"><h1>Page not found</h1><p><Link to="/">Return to the campus map</Link>.</p></main>}
export default function App(){return <><a className="skip-link" href="#main-content">Skip to main content</a><Header/><Routes><Route path="/" element={<MapPage/>}/><Route path="/accessible" element={<AccessiblePage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/print" element={<PrintPage/>}/><Route path="*" element={<NotFound/>}/></Routes><Footer/></>}
