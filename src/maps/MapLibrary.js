import { MapStore } from './MapStore.js'
import { decodeMapSnapshot } from './MapSnapshot.js'
import { DEFAULT_GENERATION_SETTINGS, GENERATION_CONTROLS, validateGenerationSettings } from './GenerationSettings.js'
import { getSeed, setSeed } from '../SeededRandom.js'

export class MapLibrary {
  constructor(app) {
    this.app = app
    this.store = new MapStore()
    this.available = false
    this.busy = false
    this.entries = new Map()
    this.current = null
    this.sourceId = null
    this.draftSettings = { ...DEFAULT_GENERATION_SETTINGS }
    this.draftSeed = getSeed() ?? 1
  }

  async init() {
    this.createControls()
    try {
      await this.store.open()
      this.available = true
      const records = await this.store.list()
      let unreadable = 0
      for (const entry of records) {
        try {
          decodeMapSnapshot(entry)
          this.entries.set(entry.id, entry)
        } catch { unreadable++ }
      }
      this.refresh()
      if (unreadable) this.message(`${unreadable} saved map(s) could not be read. Open another save, import JSON, or generate a map.`)
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
      this.select.add(new Option(map.name, map.id))
    }
    if (this.sourceId) this.select.value = this.sourceId
    this.updatePending()
  }

  updatePending() {
    const changed = this.current && (Number(this.seedInput.value) !== this.current.seed ||
      JSON.stringify(this.draftSettings) !== JSON.stringify(this.current.generationSettings))
    this.pending.textContent = changed ? 'Settings changed — Generate to apply. Saving keeps the displayed map’s recipe.' : 'Settings apply only when you click Generate.'
    this.saveChanges.disabled = this.busy || !this.sourceId || !this.current
    this.saveCopy.disabled = this.busy || !this.current
    this.exportButton.disabled = this.busy || !this.current
  }

  syncControls() {
    for (const control of GENERATION_CONTROLS) {
      const input = this.controls.querySelector(`[name="${control.key}"]`)
      input.value = this.draftSettings[control.key]
      input.dispatchEvent(new Event('input'))
    }
    this.oceanInput.checked = this.draftSettings.oceanEdge
    this.seedInput.value = this.draftSeed
    this.updatePending()
  }

  async saveCurrent(asCopy = true) {
    if (!this.current) throw new Error('Generate or open a map first.')
    const name = this.nameInput.value.trim()
    if (!name || name.length > 200) throw new Error('Enter a map name (1–200 characters).')
    // Capture applied settings from the map, never from pending controls.
    const snapshot = this.app.city.createSnapshot()
    snapshot.name = name
    if (!asCopy && this.sourceId) snapshot.id = this.sourceId
    this.current = snapshot
    this.entries.set(snapshot.id, snapshot)
    this.sourceId = snapshot.id
    this.refresh()
    try {
      if (!this.available) throw new Error('Browser storage is unavailable')
      await this.store.save(snapshot)
      this.message(`Saved “${name}”.`)
    } catch (error) {
      this.message(`“${name}” is only in memory. Export JSON to keep it. ${error.message}`)
    }
  }

  async open(snapshot) {
    const decoded = decodeMapSnapshot(snapshot)
    await this.app.city.restoreSnapshot(snapshot)
    this.current = snapshot
    this.sourceId = this.entries.has(snapshot.id) ? snapshot.id : null
    this.draftSettings = { ...(decoded.generationSettings ?? DEFAULT_GENERATION_SETTINGS) }
    this.draftSeed = snapshot.seed ?? 1
    this.nameInput.value = snapshot.name
    this.syncControls()
    this.refresh()
    this.app.seedElement.textContent = `seed: ${snapshot.seed}`
    this.app.publishMap()
    this.app.fadeIn(0)
    this.app.statusElement.textContent = 'Saved map loaded'
    this.message(decoded.generationSettings
      ? `Opened “${snapshot.name}”. Map and generation settings restored.`
      : `Opened “${snapshot.name}”. This older save has no recipe; controls use defaults for the next generation.`)
    if (this.available && this.sourceId) {
      try { await this.store.select(snapshot.id) }
      catch (error) { this.message(`Opened map, but could not remember it for reload: ${error.message}`) }
    }
  }

  async generate() {
    const seedText = this.seedInput.value.trim()
    const seed = Number(seedText)
    if (!seedText || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a whole number from 0 to 4294967295.')
    const settings = validateGenerationSettings(this.draftSettings)
    const city = this.app.city
    const previous = this.current ? city.createSnapshot() : null
    const previousSettings = city.generationSettings
    const previousSeed = getSeed()
    this.message('Generating preview… You can save it when it is ready.')
    try {
      city.applyGenerationSettings(settings)
      setSeed(seed)
      city.wfcManager.cancelAndRestart()
      const result = await city.populateAllGrids(null, { animate: false })
      if (!result.success) throw new Error('Generation could not satisfy these settings. Try a new seed or reduce the amounts.')
      this.current = city.createSnapshot()
      if (!this.nameInput.value.trim()) this.nameInput.value = `Map ${seed}`
      this.app.seedElement.textContent = `seed: ${seed}`
      this.message('Unsaved preview. Name it and save when you want to keep it.')
    } catch (error) {
      // A failed attempt must not replace a usable preview or its applied recipe.
      city._autoBuilding = false
      city._releaseWfcLock()
      if (previous) await city.restoreSnapshot(previous)
      else {
        await city.reset()
        city.applyGenerationSettings(previousSettings)
        setSeed(previousSeed)
      }
      throw error
    } finally {
      this.app.publishMap()
      this.app.fadeIn(0)
      this.updatePending()
    }
  }

  async run(action) {
    if (this.busy || this.app.city._wfcBusy || this.app.city._autoBuilding || this.app.city._restoring) {
      this.message('Wait for the current map operation to finish.')
      return
    }
    this.busy = true
    const buildMode = this.app.buildMode
    this.app.buildMode = false
    this.controls.querySelectorAll('button, select, input').forEach(c => { c.disabled = true })
    try { await action() }
    catch (error) { this.message(error.message); console.error(error) }
    finally {
      this.busy = false
      this.app.buildMode = buildMode
      this.controls.querySelectorAll('button, select, input').forEach(c => { c.disabled = false })
      this.updatePending()
    }
  }

  exportMap() {
    if (!this.current) throw new Error('Generate or open a map first.')
    const snapshot = this.app.city.createSnapshot()
    snapshot.name = this.nameInput.value.trim() || this.current.name
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `hex-map-${snapshot.seed ?? 'saved'}-${snapshot.id}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  createControls() {
    const panel = document.createElement('details')
    panel.id = 'map-library'
    panel.open = true
    panel.innerHTML = `
      <summary>Map workshop <span>Customize · Generate · Save</span></summary>
      <div class="workshop-body">
        <p class="workshop-intro">Shape your next map. Zero means off; 100% is the default amount.</p>
        <div class="recipe-controls"></div>
        <label class="ocean-control"><input type="checkbox" name="oceanEdge"> Seed an ocean along one side</label>
        <p class="workshop-hint">Terrain amounts are relative preferences. Peaks need high ground; trees and structures compete for space. Decoration counts have per-region limits.</p>
        <label class="seed-label">Seed <input name="seed" type="number" min="0" max="4294967295" step="1"></label>
        <div class="workshop-row seed-actions"></div>
        <p class="pending-settings" aria-live="polite"></p>
        <div class="workshop-row generate-actions"></div>
        <div class="save-section">
          <label>Map name <input name="mapName" type="text" maxlength="200" placeholder="e.g. Pine Highlands"></label>
          <div class="workshop-row save-actions"></div>
          <label>Saved maps <select aria-label="Saved maps"></select></label>
          <div class="workshop-row library-actions"></div>
        </div>
        <div role="status"></div>
      </div>`
    this.controls = panel.querySelector('.workshop-body')
    this.pending = panel.querySelector('.pending-settings')
    this.select = panel.querySelector('select')
    this.nameInput = panel.querySelector('[name=mapName]')
    this.seedInput = panel.querySelector('[name=seed]')
    this.oceanInput = panel.querySelector('[name=oceanEdge]')
    this.status = panel.querySelector('[role=status]')
    const groups = new Map()
    for (const control of GENERATION_CONTROLS) {
      let group = groups.get(control.group)
      if (!group) {
        group = document.createElement('details')
        group.open = control.group === 'Terrain' || control.group === 'Vegetation'
        const summary = document.createElement('summary')
        summary.textContent = control.group
        group.append(summary)
        panel.querySelector('.recipe-controls').append(group)
        groups.set(control.group, group)
      }
      const label = document.createElement('label')
      label.className = 'slider-control'
      const title = document.createElement('span')
      title.textContent = control.label
      const output = document.createElement('output')
      const input = document.createElement('input')
      input.type = 'range'
      input.name = control.key
      input.id = `recipe-${control.key}`
      output.htmlFor = input.id
      input.min = control.min
      input.max = control.max
      input.step = control.step ?? 0.05
      input.addEventListener('input', () => {
        const value = Number(input.value)
        this.draftSettings[control.key] = value
        output.value = control.unit === 'level' ? `${value} / 4` : control.unit === 'scale' ? `${value.toFixed(2)}×` : value === 0 ? 'Off' : `${Math.round(value * 100)}%`
        input.setAttribute('aria-valuetext', output.value)
        this.updatePending()
      })
      label.append(title, output, input)
      group.append(label)
    }
    const button = (container, label, action, className = '') => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = label
      element.className = className
      element.addEventListener('click', () => this.run(action))
      panel.querySelector(container).append(element)
      return element
    }
    button('.seed-actions', 'New seed', () => {
      this.draftSeed = Math.floor(Math.random() * 0x100000000)
      this.seedInput.value = this.draftSeed
      this.updatePending()
    })
    button('.seed-actions', 'Reset settings', () => {
      this.draftSettings = { ...DEFAULT_GENERATION_SETTINGS }
      this.syncControls()
    })
    button('.generate-actions', 'Generate', () => this.generate(), 'primary')
    this.saveCopy = button('.save-actions', 'Save as copy', () => this.saveCurrent(true))
    this.saveChanges = button('.save-actions', 'Save changes', () => this.saveCurrent(false))
    button('.library-actions', 'Open', async () => {
      const snapshot = this.entries.get(this.select.value)
      if (!snapshot) throw new Error('Choose a saved map first.')
      await this.open(snapshot)
    })
    this.exportButton = button('.library-actions', 'Export JSON', () => this.exportMap())
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.json,application/json'
    fileInput.hidden = true
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0]
      fileInput.value = ''
      if (!file) return
      this.run(async () => {
        if (file.size > 20 * 1024 * 1024) throw new Error('Map files must be smaller than 20 MB.')
        const snapshot = JSON.parse(await file.text())
        decodeMapSnapshot(snapshot)
        snapshot.id = crypto.randomUUID()
        await this.open(snapshot)
        this.message('Imported preview. Save as copy to keep it in this browser.')
      })
    })
    button('.library-actions', 'Import JSON', () => fileInput.click())
    this.controls.append(fileInput)
    this.seedInput.addEventListener('input', () => {
      this.draftSeed = Number(this.seedInput.value)
      this.updatePending()
    })
    this.oceanInput.addEventListener('change', () => {
      this.draftSettings.oceanEdge = this.oceanInput.checked
      this.updatePending()
    })
    this.message('Generated maps stay unsaved until you choose to save. Browser saves can also be exported as JSON.')
    for (const event of ['pointerdown', 'pointerup', 'click', 'wheel']) panel.addEventListener(event, e => e.stopPropagation())
    document.body.append(panel)
    this.syncControls()
    this.refresh()
  }
}
