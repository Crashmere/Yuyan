import { createApp } from 'vue'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/content.css'
import App from './App.vue'
import { applyTheme } from './prefs'
import { router } from './router'

applyTheme()
createApp(App).use(router).mount('#app')
