/**
 * Pure tile data - no browser/Three.js dependencies
 * This file can be safely imported by web workers
 */

/**
 * Number of elevation levels in the WFC system
 */
export const LEVELS_COUNT = 4

/**
 * Consolidated tile definitions - single source of truth
 * Array index IS the tile's numeric ID (used internally during a session only)
 * Each entry: { name, mesh, edges, weight, highEdges?, levelIncrement? }
 */
export const TILE_LIST = [
  // Base
  { name: 'GRASS', mesh: 'hex_grass',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 500 },
  { name: 'OCEAN', mesh: 'hex_water',
    edges: { NE: 'ocean', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'ocean', NW: 'ocean' },
    weight: 500 },

  // Roads
  { name: 'ROAD_A', mesh: 'hex_road_A',
    edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 30 },
  { name: 'ROAD_B', mesh: 'hex_road_B',
    edges: { NE: 'road', E: 'grass', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 8 },
  // { name: 'ROAD_C', mesh: 'hex_road_C',  // removed from GLB
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'road', NW: 'road' },
  //   weight: 1 },
  { name: 'ROAD_D', mesh: 'hex_road_D',
    edges: { NE: 'road', E: 'grass', SE: 'road', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 2, preventChaining: true },
  { name: 'ROAD_E', mesh: 'hex_road_E',
    edges: { NE: 'road', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 2, preventChaining: true },
  { name: 'ROAD_F', mesh: 'hex_road_F',
    edges: { NE: 'grass', E: 'road', SE: 'road', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 2, preventChaining: true },
  // { name: 'ROAD_G', mesh: 'hex_road_G',  // removed from GLB
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'road', W: 'road', NW: 'road' },
  //   weight: 2 },
  // { name: 'ROAD_H', mesh: 'hex_road_H',  // disabled — too many road edges
  //   edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'road', W: 'road', NW: 'road' },
  //   weight: 2 },
  // { name: 'ROAD_I', mesh: 'hex_road_I',  // removed from GLB
  //   edges: { NE: 'road', E: 'grass', SE: 'road', SW: 'road', W: 'grass', NW: 'road' },
  //   weight: 2 },
  // { name: 'ROAD_J', mesh: 'hex_road_J',  // disabled — too many road edges
  //   edges: { NE: 'grass', E: 'road', SE: 'road', SW: 'road', W: 'road', NW: 'grass' },
  //   weight: 1 },
  // { name: 'ROAD_K', mesh: 'hex_road_K',  // removed from GLB
  //   edges: { NE: 'road', E: 'grass', SE: 'road', SW: 'road', W: 'road', NW: 'road' },
  //   weight: 1 },
  // { name: 'ROAD_L', mesh: 'hex_road_L',  // removed from GLB
  //   edges: { NE: 'road', E: 'road', SE: 'road', SW: 'road', W: 'road', NW: 'road' },
  //   weight: 1 },
  { name: 'ROAD_END', mesh: 'hex_road_M',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 1, preventChaining: true },

  // Rivers
  { name: 'RIVER_A', mesh: 'hex_river_A',
    edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 20 },
  { name: 'RIVER_A_CURVY', mesh: 'hex_river_A_curvy',
    edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 20 },
  { name: 'RIVER_B', mesh: 'hex_river_B',
    edges: { NE: 'river', E: 'grass', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 30 },
  // { name: 'RIVER_C', mesh: 'hex_river_C',  // removed from GLB
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'river', NW: 'river' },
  //   weight: 8 },
  { name: 'RIVER_D', mesh: 'hex_river_D',
    edges: { NE: 'river', E: 'grass', SE: 'river', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 4, preventChaining: true },
  { name: 'RIVER_E', mesh: 'hex_river_E',
    edges: { NE: 'river', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 4, preventChaining: true },
  { name: 'RIVER_F', mesh: 'hex_river_F',
    edges: { NE: 'grass', E: 'river', SE: 'river', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 4, preventChaining: true },
  // { name: 'RIVER_G', mesh: 'hex_river_G',  // disabled — too many river edges
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'river', W: 'river', NW: 'river' },
  //   weight: 4 },
  // { name: 'RIVER_H', mesh: 'hex_river_H',  // disabled — too many river edges
  //   edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'river', W: 'river', NW: 'river' },
  //   weight: 2 },
  // { name: 'RIVER_I', mesh: 'hex_river_I',  // removed from GLB
  //   edges: { NE: 'river', E: 'grass', SE: 'river', SW: 'river', W: 'grass', NW: 'river' },
  //   weight: 2 },
  // { name: 'RIVER_J', mesh: 'hex_river_J',  // removed from GLB
  //   edges: { NE: 'grass', E: 'river', SE: 'river', SW: 'river', W: 'river', NW: 'grass' },
  //   weight: 2 },
  // { name: 'RIVER_K', mesh: 'hex_river_K',  // removed from GLB
  //   edges: { NE: 'river', E: 'grass', SE: 'river', SW: 'river', W: 'river', NW: 'river' },
  //   weight: 2 },
  // { name: 'RIVER_L', mesh: 'hex_river_L',  // removed from GLB
  //   edges: { NE: 'river', E: 'river', SE: 'river', SW: 'river', W: 'river', NW: 'river' },
  //   weight: 2 },
  { name: 'RIVER_END', mesh: 'hex_river_M',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 4, preventChaining: true },

  // Coasts
  { name: 'COAST_A', mesh: 'hex_coast_A',
    edges: { NE: 'grass', E: 'coast', SE: 'ocean', SW: 'coast', W: 'grass', NW: 'grass' },
    weight: 20 },
  { name: 'COAST_B', mesh: 'hex_coast_B',
    edges: { NE: 'grass', E: 'coast', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'grass' },
    weight: 15 },
  { name: 'COAST_C', mesh: 'hex_coast_C',
    edges: { NE: 'coast', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'grass' },
    weight: 15 },
  { name: 'COAST_D', mesh: 'hex_coast_D',
    edges: { NE: 'ocean', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'coast' },
    weight: 15, preventChaining: true },
  { name: 'COAST_E', mesh: 'hex_coast_E',
    edges: { NE: 'grass', E: 'grass', SE: 'coast', SW: 'coast', W: 'grass', NW: 'grass' },
    weight: 10, preventChaining: true },

  // Coast slope (debug)
  { name: 'COAST_SLOPE_A_LOW', mesh: 'hex_grass_sloped_low',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'coast', W: 'ocean', NW: 'coast' },
    weight: 1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1, debug: { color: 0xff0000, stripe: 'W' } },
  { name: 'COAST_SLOPE_A_HIGH', mesh: 'hex_grass_sloped_high',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'coast', W: 'ocean', NW: 'coast' },
    weight: 1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2, debug: { color: 0xff0000, stripe: 'W', yOffset: 0.5 } },

  // River slope (debug)
  { name: 'RIVER_A_SLOPE_LOW', mesh: 'hex_road_A_sloped_low',
    edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' },
    weight: 1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1, debug: { color: 0xff0000 } },

  // River-into-coast (debug)
  { name: 'RIVER_INTO_COAST', mesh: 'hex_coast_C',
    edges: { NE: 'coast', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'river' },
    weight: 3, preventChaining: true, debug: { color: 0xff0000, stripe: 'NW' } },

  // Crossings
  { name: 'RIVER_CROSSING_A', mesh: 'hex_river_crossing_A',
    edges: { NE: 'grass', E: 'river', SE: 'road', SW: 'grass', W: 'river', NW: 'road' },
    weight: 4, preventChaining: true },
  { name: 'RIVER_CROSSING_B', mesh: 'hex_river_crossing_B',
    edges: { NE: 'road', E: 'river', SE: 'grass', SW: 'road', W: 'river', NW: 'grass' },
    weight: 4, preventChaining: true },

  // High slopes (2-level rise)
  { name: 'GRASS_SLOPE_HIGH', mesh: 'hex_grass_sloped_high',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 10, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  { name: 'ROAD_A_SLOPE_HIGH', mesh: 'hex_road_A_sloped_high',
    edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 3, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  { name: 'GRASS_CLIFF', mesh: 'hex_grass',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  // { name: 'GRASS_CLIFF_B', mesh: 'hex_grass',
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
  //   weight: 6, highEdges: ['NE', 'E', 'SE', 'SW'], levelIncrement: 2 },
  { name: 'GRASS_CLIFF_C', mesh: 'hex_grass',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 1, highEdges: ['E'], levelIncrement: 2 },

  // Low slopes (1-level rise)
  { name: 'GRASS_SLOPE_LOW', mesh: 'hex_grass_sloped_low',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 10, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  { name: 'ROAD_A_SLOPE_LOW', mesh: 'hex_road_A_sloped_low',
    edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' },
    weight: 3, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  { name: 'GRASS_CLIFF_LOW', mesh: 'hex_grass',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  // { name: 'GRASS_CLIFF_LOW_B', mesh: 'hex_grass',
  //   edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
  //   weight: 6, highEdges: ['NE', 'E', 'SE', 'SW'], levelIncrement: 1 },
  { name: 'GRASS_CLIFF_LOW_C', mesh: 'hex_grass',
    edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' },
    weight: 1, highEdges: ['E'], levelIncrement: 1 },
]

/**
 * Name → index lookup (derived from TILE_LIST)
 * e.g. TileType.GRASS === 0, TileType.OCEAN === 1
 */
export const TileType = Object.fromEntries(TILE_LIST.map((t, i) => [t.name, i]))

/**
 * Terrain palette categories — maps palette key to favored tile types and level weights
 */
export const TERRAIN_CATEGORIES = {
  grass: {
    types: [TileType.GRASS],
    levelWeights: { 0: 10, 1: 1, 2: 0.1, 3: 0.01 },
  },
  mountain: {
    types: [
      TileType.GRASS_SLOPE_HIGH, TileType.GRASS_SLOPE_LOW,
      TileType.GRASS_CLIFF, TileType.GRASS_CLIFF_C,
      TileType.GRASS_CLIFF_LOW, TileType.GRASS_CLIFF_LOW_C,
      TileType.ROAD_A_SLOPE_HIGH, TileType.ROAD_A_SLOPE_LOW,
    ],
    levelWeights: { 0: 0.1, 1: 1, 2: 5, 3: 10 },
  },
  ocean: {
    types: [
      TileType.OCEAN, TileType.COAST_A, TileType.COAST_B, TileType.COAST_C, TileType.COAST_D, TileType.COAST_E,
      TileType.RIVER_INTO_COAST, TileType.COAST_SLOPE_A_LOW, TileType.COAST_SLOPE_A_HIGH,
    ],
    levelWeights: null,
  },
  river: {
    types: [
      TileType.RIVER_A, TileType.RIVER_A_CURVY, TileType.RIVER_B,
      TileType.RIVER_D, TileType.RIVER_E, TileType.RIVER_F,
      TileType.RIVER_END, TileType.RIVER_CROSSING_A, TileType.RIVER_CROSSING_B,
      TileType.RIVER_INTO_COAST, TileType.RIVER_A_SLOPE_LOW,
    ],
    levelWeights: null,
  },
  road: {
    types: [
      TileType.ROAD_A, TileType.ROAD_B, TileType.ROAD_D,
      TileType.ROAD_E, TileType.ROAD_F, TileType.ROAD_END,
      TileType.ROAD_A_SLOPE_HIGH, TileType.ROAD_A_SLOPE_LOW,
    ],
    levelWeights: null,
  },
}

/**
 * Hex directions (6 edges) for pointy-top orientation
 */
export const HexDir = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

export const HexOpposite = {
  NE: 'SW',
  E: 'W',
  SE: 'NW',
  SW: 'NE',
  W: 'E',
  NW: 'SE',
}

/**
 * Hex neighbor offsets for odd-r offset coordinates (pointy-top)
 */
export const HexNeighborOffsets = {
  even: {
    NE: { dx: 0, dz: -1 },
    E:  { dx: 1, dz: 0 },
    SE: { dx: 0, dz: 1 },
    SW: { dx: -1, dz: 1 },
    W:  { dx: -1, dz: 0 },
    NW: { dx: -1, dz: -1 },
  },
  odd: {
    NE: { dx: 1, dz: -1 },
    E:  { dx: 1, dz: 0 },
    SE: { dx: 1, dz: 1 },
    SW: { dx: 0, dz: 1 },
    W:  { dx: -1, dz: 0 },
    NW: { dx: 0, dz: -1 },
  },
}

/**
 * Get neighbor offset for a hex position
 */
export function getHexNeighborOffset(x, z, dir) {
  const parity = (z % 2 === 0) ? 'even' : 'odd'
  return HexNeighborOffsets[parity][dir]
}

/**
 * Rotate hex edges by N steps (each step = 60°)
 */
export function rotateHexEdges(edges, rotation) {
  const rotated = {}
  for (let i = 0; i < 6; i++) {
    const fromDir = HexDir[i]
    const toDir = HexDir[(i + rotation) % 6]
    rotated[toDir] = edges[fromDir]
  }
  return rotated
}
