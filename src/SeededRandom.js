/**
 * Global seeded random number generator
 * Allows deterministic map generation for debugging
 */

let rng = Math.random
let currentSeed = null

/**
 * Set the global RNG seed
 * @param {number|null} seed - Seed value, or null/0 for Math.random
 */
export function setSeed(seed) {
  currentSeed = seed
  if (seed === null) {
    rng = Math.random
  } else {
    // Mulberry32 seeded PRNG
    let s = seed
    rng = () => {
      s |= 0
      s = s + 0x6D2B79F5 | 0
      let t = Math.imul(s ^ s >>> 15, 1 | s)
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
      return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
  }
}

/**
 * Get a random number [0, 1)
 */
export function random() {
  return rng()
}

/**
 * Get current seed value
 */
export function getSeed() {
  return currentSeed
}
