import { decodeMapSnapshot } from './MapSnapshot.js'

export class MapStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hex-map-library', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('maps', { keyPath: 'id' })
        request.result.createObjectStore('settings')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Close other map tabs to upgrade saved-map storage.'))
    })
    this.db.onversionchange = () => this.db.close()
  }

  transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['maps', 'settings'], mode)
      const result = action(tx.objectStore('maps'), tx.objectStore('settings'))
      tx.oncomplete = () => resolve(result?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Saving was interrupted'))
    })
  }

  list() { return this.transaction('readonly', maps => maps.getAll()) }
  get(id) { return this.transaction('readonly', maps => maps.get(id)) }
  lastId() { return this.transaction('readonly', (_, settings) => settings.get('lastMap')) }
  select(id) { return this.transaction('readwrite', (_, settings) => settings.put(id, 'lastMap')) }
  save(snapshot) {
    decodeMapSnapshot(snapshot)
    return this.transaction('readwrite', (maps, settings) => {
      maps.put(snapshot)
      settings.put(snapshot.id, 'lastMap')
    })
  }
}
