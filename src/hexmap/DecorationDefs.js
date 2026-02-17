import { Color } from 'three/webgpu'
import { TILE_LIST, TileType, HexDir, getHexNeighborOffset, LEVELS_COUNT } from './HexTileData.js'
import FastSimplexNoise from '@webvoxel/fast-simplex-noise'
import { random } from '../SeededRandom.js'

export const LEVEL_HEIGHT = 0.5
export const TILE_SURFACE = 1

// Global noise instances shared across all Decorations
// Created lazily on first use, seeded from global RNG
export let globalNoiseA = null
export let globalNoiseB = null

let currentTreeNoiseFreq = 0.05
let currentTreeThreshold = 0.5

export function initGlobalTreeNoise(frequency = 0.05) {
  setTreeNoiseFrequency(frequency)
}

export function setTreeNoiseFrequency(frequency) {
  currentTreeNoiseFreq = frequency
  globalNoiseA = new FastSimplexNoise({ frequency, min: 0, max: 1, random })
  globalNoiseB = new FastSimplexNoise({ frequency, min: 0, max: 1, random })

}

export function getTreeNoiseFrequency() {
  return currentTreeNoiseFreq
}

export function setTreeThreshold(threshold) {
  currentTreeThreshold = threshold
}

export function getTreeThreshold() {
  return currentTreeThreshold
}

export function getCurrentTreeThreshold() {
  return currentTreeThreshold
}

// Pick a random item from a weighted defs array [{ name, weight }]
export function weightedPick(defs) {
  const total = defs.reduce((sum, d) => sum + d.weight, 0)
  let r = random() * total
  for (const d of defs) {
    r -= d.weight
    if (r <= 0) return d.name
  }
  return defs[defs.length - 1].name
}

// Check if a tile type has any road edges
export function hasRoadEdge(tileType) {
  const def = TILE_LIST[tileType]
  if (!def) return false
  return Object.values(def.edges).some(edge => edge === 'road')
}

export function isCoastOrOcean(tileType) {
  const def = TILE_LIST[tileType]
  if (!def) return false
  return def.name.startsWith('COAST_') || def.name === 'OCEAN'
}

// Check if a tile is a road dead-end (exactly 1 road edge) and return the exit direction
// Returns { isDeadEnd: true, exitDir } or { isDeadEnd: false }
export function getRoadDeadEndInfo(tileType, rotation) {
  const def = TILE_LIST[tileType]
  if (!def) return { isDeadEnd: false }

  // Count road edges and find the exit direction
  const dirs = ['NE', 'E', 'SE', 'SW', 'W', 'NW']
  const roadDirs = []
  for (const dir of dirs) {
    if (def.edges[dir] === 'road') {
      roadDirs.push(dir)
    }
  }

  if (roadDirs.length !== 1) return { isDeadEnd: false }

  // Apply rotation to find actual exit direction
  const baseDirIndex = dirs.indexOf(roadDirs[0])
  const rotatedIndex = (baseDirIndex + rotation) % 6
  const exitDir = dirs[rotatedIndex]

  return { isDeadEnd: true, exitDir }
}

// Tree meshes organized by type and density (single -> small -> medium -> large)
export const TreesByType = {
  A: ['tree_single_A', 'trees_A_small', 'trees_A_medium', 'trees_A_large'],
  B: ['tree_single_B', 'trees_B_small', 'trees_B_medium', 'trees_B_large'],
}

export const TreeMeshNames = [...TreesByType.A, ...TreesByType.B]

// Building meshes
export const BuildingDefs = [
  { name: 'building_home_A_yellow', weight: 10 },
  { name: 'building_home_B_yellow', weight: 6 },
  { name: 'building_church_yellow', weight: 2 },
  { name: 'building_tower_A_yellow', weight: 2 },
  { name: 'building_townhall_yellow', weight: 1 },
  { name: 'building_well_yellow', weight: 3 },
]

// Rural buildings — placed away from roads on flat grass
export const RuralBuildingDefs = [
  // { name: 'building_shrine_yellow', weight: 1 },
]

export const BuildingMeshNames = BuildingDefs.map(b => b.name)
export const RuralBuildingMeshNames = RuralBuildingDefs.map(b => b.name)

// Windmill (3-part composite building)
export const WindmillMeshNames = [
  'building_windmill_yellow',       // base
  'building_windmill_top_yellow',   // top section
  'building_windmill_top_fan_yellow', // fan blades
]
// Offsets relative to base (from GLB hierarchy transforms)
export const WINDMILL_TOP_OFFSET = { x: 0, y: 0.685, z: 0 }
export const WINDMILL_FAN_OFFSET = { x: 0, y: 0.957, z: 0.332 }

// Bridge meshes
export const BridgeMeshNames = [
  'building_bridge_A',
  'building_bridge_B',
]

// Waterlily meshes (placed on river tiles)
export const WaterlilyMeshNames = [
  'waterlily_A',
  'waterlily_B',
]

// Flower meshes (placed on grass tiles)
export const FlowerMeshNames = [
  'waterplant_A',
  'waterplant_B',
  'waterplant_C',
]

// Rock meshes (placed near cliffs and slopes)
export const RockMeshNames = [
  'rock_single_A',
  'rock_single_B',
  'rock_single_C',
  'rock_single_D',
  'rock_single_E',
]

// Hill meshes (placed on 1-level cliffs)
export const HillDefs = [
  { name: 'hills_A', weight: 5 },
  { name: 'hills_A_trees', weight: 5 },
  { name: 'hills_B', weight: 5 },
  { name: 'hills_B_trees', weight: 5 },
  { name: 'hills_C', weight: 5 },
  { name: 'hills_C_trees', weight: 5 },
  { name: 'hill_single_A', weight: 5 },
  { name: 'hill_single_B', weight: 5 },
  { name: 'hill_single_C', weight: 5 },
]

// Mountain meshes (placed on 2-level cliffs)
export const MountainDefs = [
  // { name: 'mountain_A', weight: 1 },
  // { name: 'mountain_B', weight: 1 },
  // { name: 'mountain_C', weight: 1 },
  { name: 'mountain_A_grass', weight: 3 },
  { name: 'mountain_B_grass', weight: 3 },
  { name: 'mountain_C_grass', weight: 3 },
  { name: 'mountain_A_grass_trees', weight: 2 },
  { name: 'mountain_B_grass_trees', weight: 2 },
  { name: 'mountain_C_grass_trees', weight: 2 },
]

export const HillMeshNames = HillDefs.map(h => h.name)
export const MountainMeshNames = MountainDefs.map(m => m.name)

// Default white color for decorations (no tinting)
export const WHITE = new Color(0xffffff)
const _lvlColor = new Color()
export function levelColor(level) {
  const blend = Math.min(level / (LEVELS_COUNT - 1), 1)
  _lvlColor.setRGB(blend, 1, 0)  // G=1 flags decoration (skip slopeContrib in shader)
  return _lvlColor
}

// Instance limits for BatchedMesh (per-type caps)
export const MAX_TREES = 100
export const MAX_BUILDINGS = 20
export const MAX_BRIDGES = 30
export const MAX_WATERLILIES = 10
export const MAX_FLOWERS = 40
export const MAX_ROCKS = 50
export const MAX_HILLS = 10
export const MAX_MOUNTAINS = 10

// Merged mesh limits (2 BMs total)
export const MAX_TREE_INSTANCES = MAX_TREES + MAX_FLOWERS + 1   // treeMaterial: trees + flowers + dummy
export const MAX_STATIC_INSTANCES = MAX_BUILDINGS + MAX_BRIDGES + MAX_WATERLILIES + MAX_ROCKS + MAX_HILLS + MAX_MOUNTAINS + 1  // material: everything else + dummy
