import test from 'node:test'
import assert from 'node:assert/strict'
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three'
import { buildResourceGrid, RESOURCE_RULES } from '../src/maps/ResourceGrid.js'
import { createMapSnapshot, decodeMapSnapshot } from '../src/maps/MapSnapshot.js'
import { cubeCoordsInRadius } from '../src/hexmap/HexWFCCore.js'
import { captureMapResources } from '../src/maps/MapResources.js'
import { HexTileGeometry } from '../src/hexmap/HexTiles.js'
import { Decorations } from '../src/hexmap/Decorations.js'
import { TileType } from '../src/hexmap/HexTileData.js'

function square({ x = 0, z = 0, size = 2, y = 1, rise = 0, u = 0.05, v = 0.6, kind = 'terrain' } = {}) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    x, y, z, x, y, z + size, x + size, y + rise, z,
    x + size, y + rise, z, x, y, z + size, x + size, y + rise, z + size,
  ], 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(Array.from({ length: 6 }, () => [u, v]).flat(), 2))
  return { kind, geometry, matrix: new Matrix4() }
}
const totals = grid => [4, 5, 6].map(index => grid.cells.reduce((sum, c) => sum + c[index], 0))
const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

test('flat grass yields food proportional to area, independently of resolution', () => {
  for (const cellSize of [0.125, 0.25, 0.5]) {
    const grid = buildResourceGrid([square()], { cellSize })
    assert.deepEqual(totals(grid), [0, 0, 4])
    assert.ok(grid.cells.every(c => c[2] === 1 && c[3] === 0 && c[7] === 1))
  }
})

test('mixed cells combine forest, rock and grass; overlapping trees never double yields or change ground elevation', () => {
  const tree = square({ x: 0.125, z: 0.125, size: 0.25, y: 3, kind: 'trees' })
  const rock = square({ x: 0.375, z: 0.125, size: 0.25, y: 2, kind: 'rocks', u: 0.3 })
  const one = buildResourceGrid([square(), tree, rock])
  const two = buildResourceGrid([square(), tree, tree, rock])
  assert.deepEqual(one, two)
  assert.ok(one.cells.some(c => c[4] > 0 && c[5] > 0 && c[6] > 0))
  near(totals(one)[0], 0.0625)
  near(totals(one)[1], 0.0625)
  near(totals(one)[2], 3.875)
  assert.equal(one.cells.find(c => c[0] === 0 && c[1] === 0)[2], 1)
})

test('steep rocky slopes favor minerals over farming and preserve sampled elevation', () => {
  const grid = buildResourceGrid([square({ rise: 2 })])
  const [wood, minerals, food] = totals(grid)
  assert.equal(wood, 0)
  assert.ok(minerals > 3.8 && food < 0.01)
  assert.ok(grid.cells.every(c => c[3] === 45))
  assert.ok(grid.cells.some(c => c[2] > 2.5))
})

test('fishing requires connected water area; separate tiny pools cannot qualify together', () => {
  const waterAtUV = u => u > 0.8
  const options = { waterAtUV, rules: { ...RESOURCE_RULES, minimumFishingArea: 5 } }
  const separate = buildResourceGrid([square({ u: 0.9 }), square({ x: 3, u: 0.9 })], options)
  assert.deepEqual(totals(separate), [0, 0, 0])
  const connected = buildResourceGrid([square({ u: 0.9 }), square({ x: 2, u: 0.9 })], options)
  near(totals(connected)[2], 8 * RESOURCE_RULES.fishing)
})

test('roads count as grass and buildings cannot occlude resources', () => {
  assert.deepEqual(buildResourceGrid([square({ u: 0.43 })]), buildResourceGrid([square()]))
  const base = [square(), square({ kind: 'trees', y: 2, size: 1 })]
  assert.deepEqual(buildResourceGrid([...base, square({ kind: 'buildings', y: 5 })]), buildResourceGrid(base))
})

test('negative world coordinates, transforms, map edges and gaps are represented without phantom yields', () => {
  const left = square({ size: 1 })
  left.matrix.makeTranslation(-3, 2, -2)
  const grid = buildResourceGrid([left, square({ size: 1 })])
  assert.deepEqual(grid.origin, { x: -3, z: -2 })
  assert.equal(grid.cells.length, 32)
  assert.deepEqual(totals(grid), [0, 0, 2])
  assert.equal(grid.cells[0][2], 3)
})

function snapshot() {
  return createMapSnapshot({
    seed: 12, radius: 1, grids: [{ x: 0, z: 0, center: { q: 0, r: 0, s: 0 } }],
    tiles: cubeCoordsInRadius(0, 0, 0, 1).map(c => ({ ...c, type: 0, rotation: 0, level: 0 })),
    landscape: { version: 1, assetVersion: 1, matrixConvention: 'three-column-major-local-to-grid', grids: [
      { x: 0, z: 0, offset: { x: 0, z: 0 }, instances: [
        { kind: 'trees', mesh: 'tree_single_A', tile: { x: 1, z: 1 }, matrix: new Matrix4().makeTranslation(0, 1, 0).toArray() },
      ] },
    ] },
    resources: buildResourceGrid([square()]),
  })
}

test('version 3 JSON preserves exact landscape transforms and all resource values', () => {
  const original = snapshot(), restored = decodeMapSnapshot(JSON.parse(JSON.stringify(original)))
  assert.equal(original.version, 3)
  assert.deepEqual(restored.landscape, original.landscape)
  assert.deepEqual(restored.resources, original.resources)
})

test('malformed resource data and landscape transforms fail before scene mutation', () => {
  for (const mutate of [
    s => { delete s.resources }, s => { delete s.landscape },
    s => { s.resources.cells[0][4] = -1 }, s => { s.resources.cells[0][2] = NaN },
    s => { s.resources.cells[1] = s.resources.cells[0] },
    s => { s.resources.width = 10000000 }, s => { s.resources.cellSize = 0 },
    s => { s.landscape.grids[0].instances[0].mesh = 'unknown' },
    s => { s.landscape.grids[0].instances[0].matrix[15] = 0 },
    s => { s.landscape.grids[0].instances[0].matrix[0] = 0 },
    s => { s.landscape.grids[0].instances[0].tile.x = 100 },
  ]) {
    const saved = snapshot(); mutate(saved)
    assert.throws(() => decodeMapSnapshot(saved), /Invalid saved map/)
  }
})


test('legacy documents cannot bypass new-field validation by carrying version-3 fields', () => {
  for (const version of [1, 2]) {
    const saved = snapshot()
    saved.version = version
    saved.landscape = { grids: 'invalid' }
    saved.resources = { cells: 'invalid' }
    const decoded = decodeMapSnapshot(saved)
    assert.equal(decoded.landscape, undefined)
    assert.equal(decoded.resources, undefined)
  }
})

test('resource cache retains imported yields until the actual landscape changes', () => {
  const original = HexTileGeometry.geoms.get(TileType.GRASS)
  HexTileGeometry.geoms.set(TileType.GRASS, square().geometry)
  try {
    const tile = { gridX: 1, gridZ: 1, type: TileType.GRASS, rotation: 0, level: 0 }
    const grid = { gridCoords: { x: 0, z: 0 }, worldOffset: { x: 0, z: 0 }, gridRadius: 1,
      hexTiles: [tile], decorations: { exportLandscape: () => [] } }
    const imported = buildResourceGrid([square()])
    imported.cells[0][6] = 0.123 // preserved game balance from a saved export
    const cache = { resources: imported }
    assert.equal(captureMapResources([grid], () => false, cache).resources.cells[0][6], 0.123)
    assert.equal(captureMapResources([grid], () => false, cache).resources.cells[0][6], 0.123)
    tile.level = 2
    const changed = captureMapResources([grid], () => false, cache)
    assert.notEqual(changed.resources.cells[0][6], 0.123)
    assert.equal(changed.resources.cells[0][2], 2)
    // Switching the same flat tile to a road must not change its yield.
    const grass = structuredClone(changed.resources)
    tile.type = TileType.ROAD_A
    assert.deepEqual(captureMapResources([grid], () => false, cache).resources, grass)
  } finally {
    if (original) HexTileGeometry.geoms.set(TileType.GRASS, original)
    else HexTileGeometry.geoms.delete(TileType.GRASS)
  }
})

test('landscape export ignores animation matrices and restores exact final transforms', () => {
  const dec = new Decorations(null)
  let nextId = 0
  const matrices = new Map()
  dec.mesh = { addInstance: () => nextId++, setMatrixAt: (id, m) => matrices.set(id, m.clone()),
    deleteInstance: id => matrices.delete(id), setColorAt() {} }
  dec.geomIds.set('tree_single_A', 0)
  const tile = { gridX: 1, gridZ: 1, level: 0 }
  const saved = [{ kind: 'trees', mesh: 'tree_single_A', tile: { x: 1, z: 1 },
    matrix: new Matrix4().makeRotationY(0.73).scale({ x: 1.15, y: 1.15, z: 1.15 }).setPosition(0.3, 1, -0.2).toArray() }]
  dec.restoreLandscape(saved, [tile])
  assert.deepEqual(dec.exportLandscape(), saved)
  dec.mesh.setMatrixAt(dec.trees[0].instanceId, new Matrix4().makeScale(0, 0, 0))
  assert.deepEqual(dec.exportLandscape(), saved)
  dec.restoreLandscape(saved, [tile])
  assert.deepEqual(matrices.get(dec.trees[0].instanceId).toArray(), saved[0].matrix)
  dec.clearDecorationsAt(1, 1)
  assert.deepEqual(dec.exportLandscape(), [])
  assert.equal(dec.placementMatrices.size, 0)
})

test('export capture refuses unresolved resources rather than sampling', () => {
  assert.throws(() => captureMapResources([], () => false, {}, { requireCachedResources: true }), /unresolved/)
  const resources = { preserved: true }
  const cache = { resources, key: 'changed' }
  assert.throws(() => captureMapResources([], () => false, cache, { requireCachedResources: true }), /unresolved/)
  assert.equal(cache.resources, resources)
})
