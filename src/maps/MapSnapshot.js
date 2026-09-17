import { TILE_LIST, LEVELS_COUNT } from '../hexmap/HexTileData.js'
import { cubeCoordsInRadius, cubeKey } from '../hexmap/HexWFCCore.js'

const FORMAT = 'hex-map-wfc'
const VERSION = 1
const tileTypes = new Map(TILE_LIST.map((tile, index) => [tile.name, index]))
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

// Save semantic tile names: numeric IDs can change when tile definitions are reordered.
export function createMapSnapshot({ seed, radius, grids, tiles, name, waterSideIndex = null }) {
  const snapshot = {
    format: FORMAT, version: VERSION,
    id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    name: name || `Map ${seed ?? 'unseeded'} — ${new Date().toLocaleString()}`,
    seed, radius, grids, waterSideIndex,
    tiles: tiles.map(({ q, r, s, type, rotation, level }) => ({
      q, r, s, tile: TILE_LIST[type]?.name, rotation, level,
    })),
  }
  decodeMapSnapshot(snapshot)
  return snapshot
}

// Validate the entire document before storage or any scene mutation.
export function decodeMapSnapshot(snapshot) {
  const fail = message => { throw new Error(`Invalid saved map: ${message}`) }
  if (!snapshot || snapshot.format !== FORMAT || snapshot.version !== VERSION) fail('unsupported format or version')
  if (typeof snapshot.id !== 'string' || !snapshot.id || snapshot.id.length > 100 ||
      typeof snapshot.name !== 'string' || !snapshot.name.trim() || snapshot.name.length > 200 ||
      typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) fail('invalid metadata')
  if (snapshot.seed !== null && !integer(snapshot.seed, 0, 0xffffffff)) fail('invalid seed')
  if (snapshot.waterSideIndex != null && !integer(snapshot.waterSideIndex, 0, 5)) fail('invalid ocean side')
  if (!integer(snapshot.radius, 1, 8)) fail('unsupported grid radius')
  if (!Array.isArray(snapshot.grids) || !snapshot.grids.length || snapshot.grids.length > 200) fail('invalid grids')
  if (!Array.isArray(snapshot.tiles) || snapshot.tiles.length > 50000) fail('invalid tiles')
  const expected = new Set()
  const gridKeys = new Set()
  for (const grid of snapshot.grids) {
    if (!grid || !integer(grid.x, -100, 100) || !integer(grid.z, -100, 100)) fail('invalid grid coordinates')
    const key = `${grid.x},${grid.z}`
    if (gridKeys.has(key)) fail('duplicate grid')
    gridKeys.add(key)
    const c = grid.center
    if (!c || !['q', 'r', 's'].every(k => integer(c[k], -10000, 10000)) || c.q + c.r + c.s !== 0) fail('invalid grid center')
    for (const cell of cubeCoordsInRadius(c.q, c.r, c.s, snapshot.radius)) expected.add(cubeKey(cell.q, cell.r, cell.s))
  }
  const tiles = snapshot.tiles.map(cell => {
    if (!cell || !['q', 'r', 's'].every(k => integer(cell[k], -10000, 10000)) || cell.q + cell.r + cell.s !== 0) fail('invalid tile coordinates')
    const key = cubeKey(cell.q, cell.r, cell.s)
    if (!expected.delete(key)) fail('duplicate or out-of-bounds tile')
    const type = tileTypes.get(cell.tile)
    if (type === undefined) fail(`unknown tile ${cell.tile}`)
    const def = TILE_LIST[type]
    const maxLevel = LEVELS_COUNT - 1 - (def.highEdges?.length ? (def.levelIncrement ?? 1) : 0)
    if (!integer(cell.rotation, 0, 5) || !integer(cell.level, 0, maxLevel)) fail('invalid tile rotation or elevation')
    return { q: cell.q, r: cell.r, s: cell.s, type, rotation: cell.rotation, level: cell.level }
  })
  if (expected.size) fail('map is incomplete')
  return { ...snapshot, tiles }
}
