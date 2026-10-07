// IndexedDB keeps mixed-image drafts off the document and out of localStorage's
// small quota. A scope includes the document revision and original node source.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('yuyan-drawing-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function drawingDraft(key: string, action: 'get' | 'put' | 'delete', value?: unknown): Promise<any> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore('drafts')
      const request = action === 'get' ? store.get(key) : action === 'put' ? store.put({ savedAt: Date.now(), value }, key) : store.delete(key)
      tx.oncomplete = () => resolve(request.result?.value)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
