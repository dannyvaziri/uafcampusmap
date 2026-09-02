import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import './brand.css'
import './brand-extras.css'
import './admin-wizard.css'
import App from './App.jsx'
import {applyMapConfig,loadPublishedConfig} from './data/runtime.js'

const config=await loadPublishedConfig()
applyMapConfig(config)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
