/**
 * Centralized map-generation tuning constants.
 * Adjust these values to rebalance terrain distribution.
 */
export const TILE_WEIGHTS = {
  // Base
  GRASS: 500,
  WATER: 24,

  // Roads
  ROAD_A: 30,
  ROAD_B: 8,
  ROAD_D: 2,
  ROAD_E: 2,
  ROAD_F: 2,
  ROAD_END: 1,

  // Rivers
  RIVER_A: 20,
  RIVER_A_CURVY: 20,
  RIVER_B: 30,
  RIVER_D: 4,
  RIVER_E: 4,
  RIVER_F: 4,
  RIVER_END: 4,

  // Coasts
  COAST_A: 20,
  COAST_B: 15,
  COAST_C: 15,
  COAST_D: 15,
  COAST_E: 10,

  // Coast slopes
  COAST_SLOPE_A_LOW: 1,
  COAST_SLOPE_A_HIGH: 1,

  // River slopes / transitions
  RIVER_A_SLOPE_LOW: 1,
  RIVER_A_SLOPE_HIGH: 1,
  RIVER_INTO_COAST: 3,

  // Crossings
  RIVER_CROSSING_A: 4,
  RIVER_CROSSING_B: 4,

  // High slopes / cliffs
  GRASS_SLOPE_HIGH: 20,
  ROAD_A_SLOPE_HIGH: 12,
  GRASS_CLIFF: 6,
  GRASS_CLIFF_C: 6,

  // Low slopes / cliffs
  GRASS_SLOPE_LOW: 20,
  ROAD_A_SLOPE_LOW: 12,
  GRASS_CLIFF_LOW: 6,
  GRASS_CLIFF_LOW_C: 6,
}
