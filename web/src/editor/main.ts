import { createApp } from 'vue'
import 'katex/dist/katex.min.css'
import '../styles/app.css'
import '../styles/content.css'
import '../styles/editor.css'
import EditorApp from './EditorApp.vue'

const el = document.getElementById('editor-app')
if (el) {
  createApp(EditorApp, {
    docId: Number(el.dataset.docId),
    bookName: el.dataset.bookName ?? '',
  }).mount(el)
}
