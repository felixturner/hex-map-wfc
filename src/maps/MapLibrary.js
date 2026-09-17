import { MapStore } from './MapStore.js'
import { decodeMapSnapshot } from './MapSnapshot.js'
import { setSeed } from '../SeededRandom.js'

export class MapLibrary {
  constructor(app) {
    this.app = app
    this.store = new MapStore()
    this.available = false
    this.busy = false
    this.entries = new Map()
    this.current = null
    this.hasStoredMaps = false
  }

  async init() {
    this.createControls()
    this.app.city.onMapSolved = snapshot => this.save(snapshot)
    try {
      await this.store.open()
      this.available = true
      const records = await this.store.list()
      this.hasStoredMaps = records.length > 0
      let unreadable = 0
      for (const entry of records) {
        try {
          decodeMapSnapshot(entry)
          this.entries.set(entry.id, entry)
        } catch {
          unreadable++
        }
      }
      this.refresh()
      if (unreadable) this.message(`${unreadable} saved map(s) could not be read. Choose another save, import JSON, or choose New map.`)
      return this.entries.get(await this.store.lastId()) || null
    } catch (error) {
      this.message(`Browser saving unavailable. Export JSON to keep maps. ${error.message}`)
      return null
    }
  }

  message(text) { this.status.textContent = text }

  refresh() {
    this.select.replaceChildren(new Option('Choose a saved map', ''))
    for (const map of [...this.entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      this.select.add(new Option(`${map.name} (${map.tiles.length} tiles)`, map.id))
    }
    if (this.current) this.select.value = this.current.id
  }

  async save(snapshot) {
    // Keep the solved document available for export even when browser storage fails.
    this.current = snapshot
    this.entries.set(snapshot.id, snapshot)
    this.refresh()
    try {
      if (!this.available) throw new Error('Browser storage is unavailable')
      await this.store.save(snapshot)
      this.message(`Saved ${snapshot.name}`)
    } catch (error) {
      this.message(`Map is only in memory. Export JSON now. ${error.message}`)
    }
  }

  async open(snapshot) {
    await this.app.city.restoreSnapshot(snapshot)
    this.current = snapshot
    this.refresh()
    this.app.seedElement.textContent = `seed: ${snapshot.seed}`
    this.app.publishMap()
    this.app.fadeIn(0)
    this.app.statusElement.textContent = 'Saved map loaded'
    this.message(`Opened ${snapshot.name} without generation`)
    if (this.available) {
      try { await this.store.select(snapshot.id) }
      catch (error) { this.message(`Opened map, but could not remember it for reload: ${error.message}`) }
    }
  }

  async run(action) {
    if (this.busy || this.app.city._wfcBusy || this.app.city._autoBuilding || this.app.city._restoring) {
      this.message('Wait for the current map operation to finish.')
      return
    }
    this.busy = true
    this.controls.querySelectorAll('button, select').forEach(control => { control.disabled = true })
    try { await action() }
    catch (error) { this.message(error.message); console.error(error) }
    finally {
      this.busy = false
      this.controls.querySelectorAll('button, select').forEach(control => { control.disabled = false })
    }
  }

  exportMap() {
    const snapshot = this.entries.get(this.select.value) || this.current
    if (!snapshot) throw new Error('Generate or open a map first.')
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `hex-map-${snapshot.seed ?? 'saved'}-${snapshot.id}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  createControls() {
    const panel = document.createElement('section')
    panel.id = 'map-library'
    panel.setAttribute('aria-label', 'Saved maps')
    const row = document.createElement('div')
    this.controls = row
    this.select = document.createElement('select')
    this.select.setAttribute('aria-label', 'Saved maps')
    row.append(this.select)
    const button = (label, action) => {
      const element = document.createElement('button')
      element.textContent = label
      element.addEventListener('click', () => this.run(action))
      row.append(element)
    }
    button('Open', async () => {
      const snapshot = this.entries.get(this.select.value)
      if (!snapshot) throw new Error('Choose a saved map first.')
      await this.open(snapshot)
    })
    button('Save current', () => this.save(this.app.city.createSnapshot()))
    button('Export JSON', () => this.exportMap())
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.hidden = true
    input.addEventListener('change', () => {
      const file = input.files[0]
      input.value = ''
      if (!file) return
      this.run(async () => {
        if (file.size > 20 * 1024 * 1024) throw new Error('Map files must be smaller than 20 MB.')
        const snapshot = JSON.parse(await file.text())
        decodeMapSnapshot(snapshot)
        // Give imports their own identity so an existing save is never overwritten.
        snapshot.id = crypto.randomUUID()
        await this.open(snapshot)
        await this.save(snapshot)
      })
    })
    button('Import JSON', () => input.click())
    button('New map', async () => {
      setSeed(Math.floor(Math.random() * 100000))
      this.app.city.wfcManager.cancelAndRestart()
      this.message('Generating a new map… Previous saves are kept.')
      const result = await this.app.city.populateAllGrids(null, { animate: false })
      this.app.publishMap()
      this.app.fadeIn(0)
      if (!result.success) this.message('Generation failed. Try New map again, or open a saved map.')
    })
    this.status = document.createElement('div')
    this.status.setAttribute('role', 'status')
    this.status.textContent = 'Completed maps save automatically in this browser.'
    panel.append(row, input, this.status)
    for (const event of ['pointerdown', 'pointerup', 'click', 'wheel']) panel.addEventListener(event, e => e.stopPropagation())
    document.body.append(panel)
    this.refresh()
  }
}
