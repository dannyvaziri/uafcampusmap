import React from 'react'
import {campus} from '../data/runtime.js'
export default function PilotNotice(){const ui=campus.ui||{};return <aside className="pilot-notice" aria-label="Public pilot limitations"><strong>{ui.pilotTitle||'Public pilot.'}</strong> {ui.pilotNotice||'Campus walking and accessible routes are not yet turn-by-turn. Use posted campus signage and current UAF accessibility resources for verified accessible-route information.'}</aside>}
