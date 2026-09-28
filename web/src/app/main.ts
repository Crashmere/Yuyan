import { createApp } from 'vue'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/content.css'
import App from './App.vue'
import { applyPrefs } from './prefs'
import { router } from './router'
import { installTooltips } from '../ui/tooltip'
import { installModuleLoadRecovery } from '../shared/moduleLoad'

installModuleLoadRecovery()
applyPrefs()
installTooltips()
createApp(App).use(router).mount('#app')
