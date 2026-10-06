// Coordinate contract v1. Supply dimensions from the matching release catalog.
export const COORDINATE_VERSION = 1
export const DEFAULT_DIMENSIONS = Object.freeze({ hexWidth: 2, hexHeight: 4 / Math.sqrt(3), levelHeight: 0.5 })
export function cubeToWorld({ q, r }, dimensions = DEFAULT_DIMENSIONS) {
  return { x: dimensions.hexWidth * (q + r / 2), z: dimensions.hexHeight * 0.75 * r }
}
export function worldToFractionalCube({ x, z }, dimensions = DEFAULT_DIMENSIONS) {
  const r = z / (dimensions.hexHeight * 0.75), q = x / dimensions.hexWidth - r / 2
  return { q, r, s: -q - r || 0 }
}
// Compare squared world distances; ties within 1e-12 WU² choose numeric (q,r,s).
export function worldToCube(position, dimensions = DEFAULT_DIMENSIONS) {
  const f = worldToFractionalCube(position, dimensions)
  let best, distance = Infinity
  for (let q = Math.floor(f.q) - 1; q <= Math.ceil(f.q) + 1; q++) {
    for (let r = Math.floor(f.r) - 1; r <= Math.ceil(f.r) + 1; r++) {
      const cube = { q, r, s: -q - r || 0 }, center = cubeToWorld(cube, dimensions)
      const d = (center.x - position.x) ** 2 + (center.z - position.z) ** 2
      if (d < distance - 1e-12) { best = cube; distance = d }
    }
  }
  return best
}
export function resourceCellCenter(resources, cell) {
  return { x: resources.origin.x + (cell[0] + 0.5) * resources.cellSize,
    z: resources.origin.z + (cell[1] + 0.5) * resources.cellSize }
}
const key = ({ q, r, s }) => `${q},${r},${s}`
// Grid offsets are authoritative (they can contain tiny authored-mesh rounding).
export function createResourceHexAssigner(render, dimensions = DEFAULT_DIMENSIONS) {
  const tiles = new Map(render.tiles.map(tile => [key(tile), tile]))
  const grids = render.grids.map(grid => ({ ...grid,
    offset: render.landscape.grids.find(g => g.x === grid.x && g.z === grid.z).offset }))
  return cellPosition => {
    const candidates = []
    for (const grid of grids) {
      const local = worldToCube({ x: cellPosition.x - grid.offset.x, z: cellPosition.z - grid.offset.z }, dimensions)
      if (Math.max(Math.abs(local.q), Math.abs(local.r), Math.abs(local.s)) > render.radius) continue
      const global = { q: local.q + grid.center.q, r: local.r + grid.center.r, s: local.s + grid.center.s }
      const tile = tiles.get(key(global))
      if (tile) candidates.push(tile)
    }
    candidates.sort((a, b) => a.q - b.q || a.r - b.r || a.s - b.s)
    return candidates[0] ?? null
  }
}
