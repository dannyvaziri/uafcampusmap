import fs from 'node:fs'
import path from 'node:path'

const root=process.cwd()
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const json=p=>JSON.parse(read(p))
const fail=m=>{console.error(`FAIL: ${m}`);process.exitCode=1}
const ok=m=>console.log(`PASS: ${m}`)

const buildings=[...json('src/data/buildings-1.json'),...json('src/data/buildings-2.json'),...json('src/data/buildings-3.json'),...json('src/data/buildings-4.json')]
const parking=[...json('src/data/parking-1.json'),...json('src/data/parking-2.json')]
const cfg=json('public/map-config.json'),app=read('src/App.jsx'),map=read('src/pages/MapPage.jsx'),admin=read('src/pages/AdminPage.jsx'),runtime=read('src/data/runtime.js'),print=read('src/pages/PrintPage.jsx'),accessible=read('src/pages/AccessiblePage.jsx'),logo=read('public/uaf-logo.svg')

if(buildings.length===67)ok('67 building records');else fail(`expected 67 buildings, found ${buildings.length}`)
if(parking.length===62)ok('62 parking records');else fail(`expected 62 parking records, found ${parking.length}`)
for(const [label,rows] of [['building',buildings],['parking',parking]]){const ids=rows.map(x=>x.id);if(new Set(ids).size===ids.length)ok(`${label} IDs are unique`);else fail(`${label} IDs contain duplicates`);for(const x of rows)if(!x.id)fail(`${label} missing id`)}
for(const b of buildings){if(!b.common_name&&!b.official_name)fail(`building ${b.id} missing name`);if(!b.address)fail(`building ${b.id} missing address`);if(b.source_url&&!/^https:\/\//.test(b.source_url))fail(`building ${b.id} has non-HTTPS source URL`);const lat=b.latitude,lon=b.longitude;if((lat==null)!=(lon==null))fail(`building ${b.id} has only one coordinate`);if(lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180))fail(`building ${b.id} has invalid coordinates`)}
const hex=/^#[0-9A-F]{6}$/i
for(const [k,v] of Object.entries(cfg.settings?.colors||{}))if(!hex.test(v))fail(`config color ${k} is invalid: ${v}`)
for(const id of cfg.settings?.popularIds||[])if(!buildings.some(b=>b.id===id)&&!cfg.customBuildings?.some(b=>b.id===id))fail(`popular destination ${id} is missing`)
for(const key of ['search','parking','access','shuttle','trails','updates'])if(typeof cfg.settings?.tabs?.[key]!=='boolean')fail(`tab setting ${key} must be boolean`)
for(const route of ['path="/"','path="/accessible"','path="/admin"','path="/print"'])app.includes(route)?ok(`route ${route.replace('path=','')} exists`):fail(`missing route ${route}`)
for(const control of ['Use my location','Show campus','Print map','Pan map'])map.includes(control)?ok(`map control "${control}" exists`):fail(`missing map control ${control}`)
for(const step of ['What do you want to edit?','STEP 2','Publish to the live map','Publish to GitHub & live map'])admin.includes(step)?ok(`admin wizard "${step}" exists`):fail(`missing admin wizard element ${step}`)
for(const type of ['Building','Parking','Shape / area','Words','Appearance','Layers','Advanced'])admin.includes(type)?ok(`admin editor ${type} exists`):fail(`missing admin editor ${type}`)
for(const visual of ['Draw footprint','Edit corners','Save shape changes','Draw parking area','Draw polygon','Draw line','Add point'])admin.includes(visual)?ok(`visual editor control "${visual}" exists`):fail(`missing visual editor control ${visual}`)
if(admin.includes("kind:'building-footprint'")&&admin.includes('building_id'))ok('building footprint geometry is linked to buildings');else fail('building footprint association missing')
if(admin.includes("kind:'parking-area'")&&admin.includes('parking_id'))ok('parking geometry is linked to parking records');else fail('parking area association missing')
if(admin.includes('layer.toGeoJSON()')&&admin.includes('editing?.enable()'))ok('existing geometry can be reshaped and saved');else fail('geometry edit/save path missing')
if(admin.includes("public/map-config.json")&&admin.includes('api.github.com')&&admin.includes("branch:'main'"))ok('admin publishes map configuration to GitHub main');else fail('admin GitHub publishing path is incomplete')
if(admin.includes('sessionStorage')&&!admin.includes("localStorage.setItem('uaf-github-token'"))ok('GitHub token is session-scoped');else fail('GitHub token must remain session-scoped')
if(admin.includes('BroadcastChannel')&&admin.includes('uaf-map-live-refresh')&&map.includes('uaf-map-live-refresh')&&map.includes("BroadcastChannel('uaf-map-live')"))ok('open public map tabs refresh after admin publish');else fail('live refresh channel is incomplete')
if(runtime.includes('recentBrowserPublish')&&runtime.includes('uaf-map-live-config'))ok('freshly published browser config is available immediately');else fail('immediate published-config fallback is missing')
if(map.includes('parking_id')&&map.includes('onParking'))ok('parking polygons open their parking record publicly');else fail('public parking geometry interaction missing')
for(const template of ['visitor','full','accessibility','event','bw','directions'])print.includes(`${template}:`)?ok(`print template ${template} exists`):fail(`missing print template ${template}`)
if(accessible.includes('Text-only campus map')&&accessible.includes('Print directions'))ok('text-only map exposes destination and print actions');else fail('text-only map is missing essential actions')
if(logo.length>5000&&!logo.includes('TRUNCATED')&&logo.includes('University of Alaska Fairbanks'))ok('official UAF logo asset is present and intact');else fail('UAF logo asset appears incomplete')
const sourceFiles=['src/App.jsx','src/pages/MapPage.jsx','src/pages/AccessiblePage.jsx','src/pages/PrintPage.jsx','src/pages/AdminPage.jsx','src/components/InfoPanels.jsx','src/components/PlaceDialog.jsx']
for(const f of sourceFiles){const s=read(f);if(/href=["']#["']/.test(s))fail(`${f} contains a dead # link`);if(/\bTODO\b|\bFIXME\b/.test(s))fail(`${f} contains TODO/FIXME`)}
if(!process.exitCode)console.log('\nUAF campus map verification passed.')
