// Use complete regions so terrain, scenery and resources share one footprint.
export const MAP_SIZE_PRESETS = [
  { playerCount: 6, label: '6 players · Full size', regionCount: 19, defaultShape: 'hexagon', shapes: { hexagon: 'Hexagon' } },
  { playerCount: 3, label: '3 players · About half size', regionCount: 10, defaultShape: 'triangle', shapes: { triangle: 'Triangle', compact: 'Compact' } },
  { playerCount: 2, label: '2 players · About quarter size', regionCount: 5, defaultShape: 'compact', shapes: { compact: 'Compact diamond', triangle: 'Clipped triangle' } },
]
export const DEFAULT_MAP_LAYOUT = Object.freeze({ playerCount: 6, mapShape: 'hexagon' })

export function mapSizePreset(playerCount) {
  return MAP_SIZE_PRESETS.find(preset => preset.playerCount === playerCount)
}

export function getMapGridCoordinates({ playerCount, mapShape } = DEFAULT_MAP_LAYOUT) {
  const preset = mapSizePreset(playerCount)
  if (!preset || typeof mapShape !== 'string' || !Object.hasOwn(preset.shapes, mapShape)) throw new Error('Invalid map layout')
  let cubes = []
  if (playerCount === 6 || (playerCount === 3 && mapShape === 'triangle')) {
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        const s = -q - r
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > 2) continue
        if (mapShape === 'triangle' && Math.min(q, r, s) < -1) continue
        cubes.push([q, r])
      }
    }
  } else if (playerCount === 3) {
    cubes = [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-2, 1], [1, -2], [1, 1]]
  } else if (mapShape === 'triangle') {
    cubes = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0]]
  } else {
    cubes = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]
  }
  // Region coordinates use flat-top odd-q offsets, unlike the terrain cells.
  return cubes.map(([q, r]) => [q, r + Math.floor((q - (q & 1)) / 2)])
}
