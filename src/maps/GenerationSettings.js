import { TILE_LIST, LEVELS_COUNT } from '../hexmap/HexTileData.js'
import { DEFAULT_MAP_LAYOUT, mapSizePreset } from './MapLayout.js'

// Shared by the workshop, snapshot validation and the worker. Amounts are
// relative preferences, not promised percentages of a constrained map.
export const GENERATION_CONTROLS = [
  { key: 'water', label: 'Lakes & coasts', group: 'Terrain', value: 1, min: 0, max: 3 },
  { key: 'ruggedness', label: 'Slopes & cliffs', group: 'Terrain', value: 1, min: 0, max: 3 },
  { key: 'elevation', label: 'Elevation preference', group: 'Terrain', value: 2, min: 0, max: 4, step: 1, unit: 'level' },
  { key: 'roads', label: 'Roads', group: 'Routes', value: 1, min: 0, max: 3 },
  { key: 'rivers', label: 'Rivers', group: 'Routes', value: 1, min: 0, max: 3 },
  { key: 'trees', label: 'Trees', group: 'Vegetation', value: 1, min: 0, max: 2 },
  { key: 'treePatchSize', label: 'Forest patch size', group: 'Vegetation', value: 1, min: 0.25, max: 4, unit: 'scale' },
  { key: 'structures', label: 'All structures', group: 'Structures', value: 1, min: 0, max: 3 },
  { key: 'buildingPatchSize', label: 'Settlement patch size', group: 'Structures', value: 1, min: 0.25, max: 4, unit: 'scale' },
  { key: 'mountains', label: 'Mountain peaks', group: 'Details', value: 1, min: 0, max: 3 },
  { key: 'hills', label: 'Hills', group: 'Details', value: 1, min: 0, max: 3 },
  { key: 'rocks', label: 'Rocks', group: 'Details', value: 1, min: 0, max: 3 },
  { key: 'flowers', label: 'Flowers & bushes', group: 'Details', value: 1, min: 0, max: 3 },
  { key: 'waterlilies', label: 'Water plants', group: 'Details', value: 1, min: 0, max: 3 },
]
export const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  ...Object.fromEntries(GENERATION_CONTROLS.map(c => [c.key, c.value])),
  oceanEdge: false,
  ...DEFAULT_MAP_LAYOUT,
})

export function validateGenerationSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid generation settings')
  const settings = {}
  for (const control of GENERATION_CONTROLS) {
    const n = value[control.key]
    if (!Number.isFinite(n) || n < control.min || n > control.max || (control.step === 1 && !Number.isInteger(n))) {
      throw new Error(`Invalid generation setting: ${control.key}`)
    }
    settings[control.key] = n
  }
  if (typeof value.oceanEdge !== 'boolean') throw new Error('Invalid generation setting: oceanEdge')
  settings.oceanEdge = value.oceanEdge
  // Older full-size recipes used six players; preserve their footprint.
  const legacyFullSize = !Object.hasOwn(value, 'playerCount') || (value.playerCount === 6 && value.mapShape === 'hexagon')
  const playerCount = legacyFullSize ? 12 : value.playerCount
  const preset = mapSizePreset(playerCount)
  if (!preset) throw new Error('Invalid generation setting: playerCount')
  const mapShape = Object.hasOwn(value, 'mapShape') ? value.mapShape : preset.defaultShape
  if (typeof mapShape !== 'string' || !Object.hasOwn(preset.shapes, mapShape)) throw new Error('Invalid generation setting: mapShape')
  settings.playerCount = playerCount
  settings.mapShape = mapShape
  return settings
}

export function terrainOptions(settings) {
  const weights = {}
  const tileTypes = []
  TILE_LIST.forEach((tile, type) => {
    const edges = Object.values(tile.edges)
    let weight = tile.weight
    if (edges.includes('road')) weight *= settings.roads
    if (edges.includes('river')) weight *= settings.rivers
    if (edges.includes('water') || edges.includes('coast')) weight *= settings.water
    if (tile.highEdges?.length) weight *= settings.ruggedness
    // Crossings require bridges; structures off must not leave broken crossings.
    if (!settings.structures && tile.name.startsWith('RIVER_CROSSING')) weight = 0
    if (weight > 0) tileTypes.push(type)
    weights[type] = weight
  })
  return { tileTypes, weights, elevation: settings.elevation }
}

export function stateWeight(state, options = {}) {
  const weight = options.weights?.[state.type] ?? TILE_LIST[state.type]?.weight ?? 1
  const bias = (options.elevation ?? 2) - 2
  return weight * Math.exp(bias * (state.level / (LEVELS_COUNT - 1) - 0.5) * 2)
}
