import fs from 'node:fs'
import path from 'node:path'

const root=process.cwd()
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const json=p=>JSON.parse(read(p))
const fail=(m)=>{console.error(`FAIL: ${m}`);process.exitCode=1}
const ok=(m)=>console.log(`PASS: ${m}`)

const buildings=[...json('src/data/buildings-1.json'),...json('src/data/buildings-2.json'),...json('src/data/buildings-3.json'),...json('src/data/buildings-4.json')]
const parking=[...json('src/data/parking-1.json'),...json('src/data/parking-2.json')]
const cfg=json('public/map-config.json')
const app=read('src/App.jsx')
const map=read('src/pages/MapPage.jsx')
const admin=read('src/pages/AdminPage.jsx')
const print=read('src/pages/PrintPage.jsx')
const accessible=read('src/pages/AccessiblePage.jsx')
const logo=read('public/uaf-logo.svg')

if(buildings.length===67)ok('67 building records');else fail(`expected 67 buildings, found ${buildings.length}`)
if(parking.length===62)ok('62 parking records');else fail(`expected 62 parking records, found ${parking.length}`)

for(const [label,rows] of [['building',buildings],['parking',parking]]){
 const ids=rows.map(x=>x.id)
 if(new Set(ids).size===ids.length)ok(`${label} IDs are unique`);else fail(`${label} IDs contain duplicates`)
 for(const x of rows){if(!x.id)fail(`${label} missing id`)}
}

for(const b of buildings){
 if(!b.common_name&&!b.official_name)fail(`building ${b.id} missing name`)
 if(!b.address)fail(`building ${b.id} missing address`)
 if(b.source_url&&!/^https:\/\//.test(b.source_url))fail(`building ${b.id} has non-HTTPS source URL`)
 const lat=b.latitude,lon=b.longitude
 if((lat==null)!=(lon==null))fail(`building ${b.id} has only one coordinate`)
 if(lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180))fail(`building ${b.id} has invalid coordinates`)
}

const hex=/^#[0-9A-F]{6}$/i
for(const [k,v] of Object.entries(cfg.settings?.colors||{})){if(!hex.test(v))fail(`config color ${k} is invalid: ${v}`)}
for(const id of cfg.settings?.popularIds||[]){if(!buildings.some(b=>b.id===id)&&!cfg.customBuildings?.some(b=>b.id===id))fail(`popular destination ${id} is missing`)}
for(const key of ['search','parking','access','shuttle','trails','updates']){if(typeof cfg.settings?.tabs?.[key]!=='boolean')fail(`tab setting ${key} must be boolean`)}

for(const route of ['path="/"','path="/accessible"','path="/admin"','path="/print"']){if(app.includes(route))ok(`route ${route.replace('path=','')} exists`);else fail(`missing route ${route}`)}
for(const control of ['Use my location','Show campus','Print map','Pan map']){if(map.includes(control))ok(`map control "${control}" exists`);else fail(`missing map control ${control}`)}
for(const section of ['Buildings','Shapes','Content','Appearance','Layers','Advanced JSON','Publish']){if(admin.includes(section))ok(`admin section ${section} exists`);else fail(`missing admin section ${section}`)}
for(const template of ['visitor','full','accessibility','event','bw','directions']){if(print.includes(`${template}:`))ok(`print template ${template} exists`);else fail(`missing print template ${template}`)}
if(accessible.includes('Text-only campus map')&&accessible.includes('Print directions'))ok('text-only map exposes destination and print actions');else fail('text-only map is missing essential actions')
if(logo.length>5000&&!logo.includes('TRUNCATED')&&logo.includes('University of Alaska Fairbanks'))ok('official UAF logo asset is present and intact');else fail('UAF logo asset appears incomplete')

const sourceFiles=['src/App.jsx','src/pages/MapPage.jsx','src/pages/AccessiblePage.jsx','src/pages/PrintPage.jsx','src/pages/AdminPage.jsx','src/components/InfoPanels.jsx','src/components/PlaceDialog.jsx']
for(const f of sourceFiles){const s=read(f);if(/href=["']#["']/.test(s))fail(`${f} contains a dead # link`);if(/\bTODO\b|\bFIXME\b/.test(s))fail(`${f} contains TODO/FIXME`)}

if(!process.exitCode)console.log('\nUAF campus map verification passed.')
