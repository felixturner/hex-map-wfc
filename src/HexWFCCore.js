/**
 * Shared WFC core logic - no browser dependencies
 * Importable by both main thread and web workers
 */

import {
  TILE_LIST,
  HexDir,
  rotateHexEdges,
  LEVELS_COUNT,
} from './HexTileData.js'
import { random } from './SeededRandom.js'

// ============================================================================
// Cube Coordinate Utilities
// ============================================================================

/**
 * Cube direction vectors for pointy-top hex (matching HexDir order: NE, E, SE, SW, W, NW)
 */
export const CUBE_DIRS = [
  { name: 'NE', dq: +1, dr: -1, ds: 0 },
  { name: 'E',  dq: +1, dr: 0,  ds: -1 },
  { name: 'SE', dq: 0,  dr: +1, ds: -1 },
  { name: 'SW', dq: -1, dr: +1, ds: 0 },
  { name: 'W',  dq: -1, dr: 0,  ds: +1 },
  { name: 'NW', dq: 0,  dr: -1, ds: +1 },
]

/**
 * Create a string key from cube coordinates
 */
export function cubeKey(q, r, s) {
  return `${q},${r},${s}`
}

/**
 * Parse a cube key string back to {q, r, s}
 */
export function parseCubeKey(key) {
  const [q, r, s] = key.split(',').map(Number)
  return { q, r, s }
}

/**
 * Convert offset coordinates (col, row) to cube coordinates (q, r, s)
 * Using odd-r offset (pointy-top hex tiles)
 */
export function offsetToCube(col, row) {
  const q = col - Math.floor(row / 2)
  const r = row
  const s = -q - r
  return { q, r, s }
}

/**
 * Convert cube coordinates to offset coordinates
 */
export function cubeToOffset(q, r, s) {
  const col = q + Math.floor(r / 2)
  const row = r
  return { col, row }
}

/**
 * Convert local grid coordinates to global offset coordinates
 */
export function localToGlobalCoords(x, z, gridRadius, globalCenterCube) {
  const localCol = x - gridRadius
  const localRow = z - gridRadius
  const localCube = offsetToCube(localCol, localRow)
  const globalCube = {
    q: localCube.q + globalCenterCube.q,
    r: localCube.r + globalCenterCube.r,
    s: localCube.s + globalCenterCube.s
  }
  return cubeToOffset(globalCube.q, globalCube.r, globalCube.s)
}

/**
 * Get all cube coordinates within a hex radius of a center point
 */
export function cubeCoordsInRadius(cq, cr, cs, radius) {
  const coords = []
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      const s = -q - r
      coords.push({ q: cq + q, r: cr + r, s: cs + s })
    }
  }
  return coords
}

/**
 * Calculate hex distance between two cube coordinates
 */
export function cubeDistance(q1, r1, s1, q2, r2, s2) {
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2))
}

/**
 * Check if two edges are compatible (edge type + level must match)
 * @param {string} edgeTypeA - Edge type (grass, road, etc.)
 * @param {number} levelA - Level of edge A
 * @param {string} edgeTypeB - Edge type of neighbor
 * @param {number} levelB - Level of edge B
 */
export function edgesCompatible(edgeTypeA, levelA, edgeTypeB, levelB) {
  if (edgeTypeA !== edgeTypeB) return false
  // Grass edges can connect at any level (used for seed replacement compatibility)
  if (edgeTypeA === 'grass') return true
  // Other edges (road, water, etc.) must match levels
  return levelA === levelB
}

// Cache for rotated high edges: Map<"type_rotation", Set<dir>>
const highEdgeCache = new Map()

/**
 * Get the level for a specific edge of a tile
 * Slopes have different levels on high vs low edges
 * Uses levelIncrement from tile definition (default 1)
 */
export function getEdgeLevel(tileType, rotation, dir, baseLevel) {
  const def = TILE_LIST[tileType]
  if (!def || !def.highEdges) {
    return baseLevel
  }

  const cacheKey = `${tileType}_${rotation}`
  let highEdges = highEdgeCache.get(cacheKey)

  if (!highEdges) {
    highEdges = new Set()
    for (const highDir of def.highEdges) {
      const dirIndex = HexDir.indexOf(highDir)
      const rotatedIndex = (dirIndex + rotation) % 6
      highEdges.add(HexDir[rotatedIndex])
    }
    highEdgeCache.set(cacheKey, highEdges)
  }

  const levelIncrement = def.levelIncrement ?? 1
  return highEdges.has(dir) ? baseLevel + levelIncrement : baseLevel
}

/**
 * HexWFCCell - Tracks possibility space for one hex grid cell
 */
export class HexWFCCell {
  constructor(allStates) {
    this.possibilities = new Set(allStates.map(s => HexWFCCell.stateKey(s)))
    this.collapsed = false
    this.tile = null
  }

  static stateKey(state) {
    return `${state.type}_${state.rotation}_${state.level ?? 0}`
  }

  static parseKey(key) {
    const [type, rotation, level] = key.split('_').map(Number)
    return { type, rotation, level: level ?? 0 }
  }

  get entropy() {
    if (this.collapsed) return 0
    return Math.log(this.possibilities.size) + random() * 0.001
  }

  collapse(state) {
    this.possibilities.clear()
    this.possibilities.add(HexWFCCell.stateKey(state))
    this.collapsed = true
    this.tile = state
  }

  remove(stateKey) {
    return this.possibilities.delete(stateKey)
  }

  has(stateKey) {
    return this.possibilities.has(stateKey)
  }
}

/**
 * HexWFCAdjacencyRules - Pre-computed tile compatibility for hex grids
 * Handles offset coordinate asymmetry by indexing by edge type
 */
export class HexWFCAdjacencyRules {
  constructor() {
    this.allowed = new Map()
    this.stateEdges = new Map()
    // 3D index: edgeType → dir → level → Set<stateKey>
    this.byEdge = new Map()
  }

  /**
   * Build adjacency rules from TILE_LIST
   * @param {number[]} tileTypes - Tile types to include
   */
  static fromTileDefinitions(tileTypes = null) {
    const rules = new HexWFCAdjacencyRules()
    const types = tileTypes ?? TILE_LIST.map((_, i) => i)

    const allStates = []
    for (const type of types) {
      const def = TILE_LIST[type]
      if (!def) continue

      const isSlope = def.highEdges && def.highEdges.length > 0

      for (let rotation = 0; rotation < 6; rotation++) {
        if (isSlope) {
          const increment = def.levelIncrement ?? 1
          const maxBaseLevel = LEVELS_COUNT - 1 - increment
          for (let level = 0; level <= maxBaseLevel; level++) {
            allStates.push({ type, rotation, level })
          }
        } else {
          for (let level = 0; level < LEVELS_COUNT; level++) {
            allStates.push({ type, rotation, level })
          }
        }
      }
    }

    for (const state of allStates) {
      const stateKey = HexWFCCell.stateKey(state)
      const edges = rotateHexEdges(TILE_LIST[state.type].edges, state.rotation)
      const stateEdgeInfo = {}

      for (const dir of HexDir) {
        const edgeType = edges[dir]
        const edgeLevel = getEdgeLevel(state.type, state.rotation, dir, state.level)
        stateEdgeInfo[dir] = { type: edgeType, level: edgeLevel }

        if (!rules.byEdge.has(edgeType)) {
          rules.byEdge.set(edgeType, {})
          for (const d of HexDir) rules.byEdge.get(edgeType)[d] = []
        }
        const levelIndex = rules.byEdge.get(edgeType)[dir]
        if (!levelIndex[edgeLevel]) {
          levelIndex[edgeLevel] = new Set()
        }
        levelIndex[edgeLevel].add(stateKey)
      }

      rules.stateEdges.set(stateKey, stateEdgeInfo)
    }

    return rules
  }

  getAllowed(stateKey, direction) {
    return this.allowed.get(stateKey)?.[direction] ?? new Set()
  }

  /**
   * Get states that have a specific edge type, direction, AND level
   * O(1) lookup - used for fast constraint propagation
   */
  getByEdge(edgeType, direction, level) {
    return this.byEdge.get(edgeType)?.[direction]?.[level] ?? new Set()
  }

  isAllowed(stateKeyA, direction, stateKeyB) {
    return this.allowed.get(stateKeyA)?.[direction]?.has(stateKeyB) ?? false
  }
}
