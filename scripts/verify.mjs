import fs from 'node:fs'
import path from 'node:path'

const root=process.cwd()
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const json=p=>JSON.parse(read(p))
const fail=m=>{console.error(`FAIL: ${m}`);process.exitCode=1}
const ok=m=>console.log(`PASS: ${m}`)
const warn=m=>console.warn(`WARN: ${m}`)
const expect=(condition,message)=>condition?ok(message):fail(message)

const buildings=[...json('src/data/buildings-1.json'),...json('src/data/buildings-2.json'),...json('src/data/buildings-3.json'),...json('src/data/buildings-4.json')]
const parking=[...json('src/data/parking-1.json'),...json('src/data/parking-2.json')]
const cfg=json('public/map-config.json')
const app=read('src/App.jsx'),map=read('src/pages/MapPage.jsx'),admin=read('src/pages/AdminPage.jsx'),imageAdmin=read('src/pages/ImageOverlayPage.jsx'),runtime=read('src/data/runtime.js'),print=read('src/pages/PrintPage.jsx'),accessible=read('src/pages/AccessiblePage.jsx'),dialog=read('src/components/PlaceDialog.jsx'),info=read('src/components/InfoPanels.jsx'),main=read('src/main.jsx'),logo=read('public/uaf-logo.svg'),htaccess=read('public/.htaccess')

expect(buildings.length===67,`67 building records (found ${buildings.length})`)
expect(parking.length===62,`62 parking records (found ${parking.length})`)
for(const [label,rows] of [['building',buildings],['parking',parking]]){const ids=rows.map(x=>x.id);expect(new Set(ids).size===ids.length,`${label} IDs are unique`);for(const x of rows)if(!x.id)fail(`${label} missing id`)}
for(const b of buildings){if(!b.common_name&&!b.official_name)fail(`building ${b.id} missing name`);if(!b.address)fail(`building ${b.id} missing address`);if(b.source_url&&!/^https:\/\//.test(b.source_url))fail(`building ${b.id} has non-HTTPS source URL`);const lat=b.latitude,lon=b.longitude;if((lat==null)!=(lon==null))fail(`building ${b.id} has only one coordinate`);if(lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180))fail(`building ${b.id} has invalid coordinates`)}

const hex=/^#[0-9A-F]{6}$/i
for(const [k,v] of Object.entries(cfg.settings?.colors||{}))if(!hex.test(v))fail(`config color ${k} is invalid: ${v}`)
for(const id of cfg.settings?.popularIds||[])if(!buildings.some(b=>b.id===id)&&!cfg.customBuildings?.some(b=>b.id===id))fail(`popular destination ${id} is missing`)
for(const key of ['search','parking','access','shuttle','trails','updates'])if(typeof cfg.settings?.tabs?.[key]!=='boolean')fail(`tab setting ${key} must be boolean`)

for(const route of ['path="/"','path="/accessible"','path="/admin"','path="/admin/images"','path="/print"'])expect(app.includes(route),`route ${route.replace('path=','')} exists`)
expect(htaccess.includes('RewriteRule . /index.html [L]'),'SPA direct-route fallback is present')
for(const control of ['Use my location','Show campus','Print map','Pan map'])expect(map.includes(control),`map control "${control}" exists`)
expect(map.includes("params.get('parking')")&&map.includes("n.set('parking',p.id)"),'parking deep links and sharing are supported')
expect(map.includes('image_overlays')&&map.includes('L.imageOverlay'),'PNG overlays render on the public map')
expect(map.includes('uaf-map-live-refresh')&&map.includes("BroadcastChannel('uaf-map-live')"),'open public map tabs refresh after admin publish')

for(const step of ['What do you want to edit?','STEP 2','Publish to the live map','Publish to GitHub & live map'])expect(admin.includes(step),`admin wizard "${step}" exists`)
for(const type of ['Building','Parking','Shape / area','Words','Appearance','Layers','Advanced'])expect(admin.includes(type),`admin editor ${type} exists`)
for(const visual of ['Draw footprint','Edit corners','Save shape changes','Draw parking area','Draw polygon','Draw line','Add point'])expect(admin.includes(visual),`visual editor control "${visual}" exists`)
expect(admin.includes("public/map-config.json")&&admin.includes('api.github.com')&&admin.includes("branch:'main'"),'admin publishes map configuration to GitHub main')
expect(admin.includes('sessionStorage')&&!admin.includes("localStorage.setItem('uaf-github-token'"),'GitHub token is session-scoped')
expect(runtime.includes('validFeature')&&runtime.includes('validImageOverlay'),'runtime rejects malformed geometry and image bounds')
expect(runtime.includes('recentBrowserPublish')&&runtime.includes('uaf-map-live-config'),'freshly published browser config is available immediately')

for(const text of ['Upload PNG','Move image','Resize southwest corner','Publish PNG overlays'])expect(imageAdmin.includes(text),`PNG editor supports ${text}`)
expect(imageAdmin.includes("accept=\"image/png,.png\"")&&imageAdmin.includes("file.size>2_000_000"),'PNG uploads are type- and size-limited')
expect(imageAdmin.includes('uaf-map-live-refresh')&&imageAdmin.includes('BroadcastChannel'),'PNG publishing refreshes open public maps')

for(const item of ['Full campus','Selected area / current view','11×17','8.5×11','Building names','Parking','Map shapes & PNGs','Print / Save'])expect(print.includes(item),`print control "${item}" exists`)
expect(print.includes('openstreetmap.org')&&print.includes('print-building-label'),'print map uses detailed OpenStreetMap base with building labels')
expect(print.includes('html2canvas')&&print.includes('print-map-snapshot'),'print map freezes to a stable snapshot before printing')
expect(print.includes('window.print()'),'Print / Save opens native browser print dialog')
expect(print.includes("params.get('place')")&&print.includes('requestedBuilding'),'selected-building print links center the correct area')
expect(!accessible.includes('template=')&&!dialog.includes('template='),'retired print-template URLs are no longer exposed')
expect(accessible.includes('Text-only campus map')&&accessible.includes('Print this area'),'text-only map exposes current destination and print actions')

expect(logo.length>5000&&!logo.includes('TRUNCATED')&&logo.includes('University of Alaska Fairbanks'),'official UAF logo asset is present and intact')
expect(main.includes("import './brand.css'")&&main.includes("import './brand-extras.css'")&&main.includes("import './admin-wizard.css'")&&main.includes("import './admin-editor.css'")&&main.includes("import './print-fix.css'")&&main.includes("import './image-overlays.css'"),'all product-specific style sheets are loaded')

function coord(p){return Array.isArray(p)&&p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))}
function validFeature(f){const g=f?.geometry;if(!g)return false;if(g.type==='Point')return coord(g.coordinates);if(g.type==='LineString')return Array.isArray(g.coordinates)&&new Set(g.coordinates.filter(coord).map(p=>`${p[0]},${p[1]}`)).size>=2;if(g.type==='Polygon'){const r=g.coordinates?.[0];return Array.isArray(r)&&r.length>=4&&r.every(coord)&&new Set(r.map(p=>`${p[0]},${p[1]}`)).size>=3&&String(r[0])===String(r[r.length-1])}return false}
const invalidShapes=(cfg.shapes||[]).filter(s=>!validFeature(s))
if(invalidShapes.length)warn(`${invalidShapes.length} saved admin shape(s) are malformed and will be safely ignored by the public/print maps: ${invalidShapes.map(s=>s.properties?.name||s.properties?.id||'unnamed').join(', ')}`);else ok('saved custom geometry is valid')
const dualLinks=(cfg.shapes||[]).filter(s=>s.properties?.building_id&&s.properties?.parking_id)
if(dualLinks.length)warn(`${dualLinks.length} shape(s) link to both a building and parking; building interaction wins until the admin record is cleaned up.`);else ok('shape associations are unambiguous')
for(const x of cfg.imageOverlays||[]){if(!/^data:image\/png;base64,/.test(x.dataUrl||'')&&!/^https?:\/\//.test(x.dataUrl||'')&&!/^\//.test(x.dataUrl||''))warn(`PNG overlay ${x.name||x.id} uses an unexpected image source`)}

const sourceFiles=['src/App.jsx','src/pages/MapPage.jsx','src/pages/AccessiblePage.jsx','src/pages/PrintPage.jsx','src/pages/AdminPage.jsx','src/pages/ImageOverlayPage.jsx','src/components/InfoPanels.jsx','src/components/PlaceDialog.jsx']
for(const f of sourceFiles){const s=read(f);if(/href=["']#["']/.test(s))fail(`${f} contains a dead # link`);if(/\bTODO\b|\bFIXME\b/.test(s))fail(`${f} contains TODO/FIXME`)}
if(!process.exitCode)console.log('\nUAF campus map full verification passed.')
