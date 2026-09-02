import meta from './meta.json'
import b1 from './buildings-1.json'
import b2 from './buildings-2.json'
import b3 from './buildings-3.json'
import b4 from './buildings-4.json'
import p1 from './parking-1.json'
import p2 from './parking-2.json'
import gis from './gis.json'

export const campus = {...meta, buildings:[...b1,...b2,...b3,...b4], parking:[...p1,...p2]}
export { gis }
