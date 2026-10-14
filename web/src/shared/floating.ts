import { deferred } from './deferred'

// floating-ui for the reading page's own popups (link previews, the code block menu); the editor
// imports it directly.
export const floatingUI = deferred(() => import('@floating-ui/dom'))
