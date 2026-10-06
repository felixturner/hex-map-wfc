import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createMapSnapshot, decodeMapSnapshot } from '../src/maps/MapSnapshot.js'
import { cubeCoordsInRadius } from '../src/hexmap/HexWFCCore.js'
import { splitMapSnapshot, validateExportPair, combineExportPair, sha256 } from '../src/maps/PairedExport.js'
import { cubeToWorld, worldToCube, resourceCellCenter, createResourceHexAssigner } from '../src/maps/CoordinatesV1.js'
import { RESOURCE_COLUMNS, RESOURCE_RULES } from '../src/maps/ResourceGrid.js'
const release = JSON.parse(await readFile(new URL('../src/maps/AssetRelease.json', import.meta.url)))
export function fixture() {
  return createMapSnapshot({ seed: 12, radius: 1, name: 'Contract fixture (not supplied sample)',
    grids: [{ x: 0, z: 0, center: { q: 0, r: 0, s: 0 } }],
    tiles: cubeCoordsInRadius(0, 0, 0, 1).map((c, i) => ({ ...c, type: 0, rotation: i % 6, level: i % 5 })),
    landscape: { version: 1, assetVersion: 1, matrixConvention: 'three-column-major-local-to-grid', grids: [
      { x: 0, z: 0, offset: { x: 0, z: 0 }, instances: [{ kind: 'trees', mesh: 'tree_single_A', tile: { x: 1, z: 1 },
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.123456789, 1, -0.23456789, 1] }] }] },
    resources: { version: 1, coordinates: 'world-xz-y-up', cellSize: 0.25, origin: { x: -0.5, z: -0.5 }, width: 4, height: 4,
      samplesPerCell: 4, yieldUnits: 'per-cell-per-tick', rules: { ...RESOURCE_RULES }, columns: [...RESOURCE_COLUMNS],
      cells: [[0, 0, 1.123456, 2.654321, 0.012345, 0.000001, 0.061234, 0.25], [3, 3, 1, 0, 0, 0, 0.0625, 1]] },
  })
}
const totals = resource => [4, 5, 6].map(i => resource.cells.reduce((sum, row) => sum + row[i], 0))
test('paired JSON preserves every tile, transform, resource row and total', async () => {
  const source = fixture(), pair = await splitMapSnapshot(source, release)
  const checked = await validateExportPair(pair.renderText, pair.resourcesText)
  assert.deepEqual(checked.render.tiles, source.tiles)
  assert.deepEqual(checked.render.landscape, source.landscape)
  assert.deepEqual(checked.resources.resources, source.resources)
  assert.deepEqual(totals(checked.resources.resources), totals(source.resources))
  assert.equal('resources' in checked.render, false)
  assert.equal('tiles' in checked.resources, false)
  const combined = await combineExportPair(pair.renderText, pair.resourcesText)
  assert.deepEqual(combined, source)
  const visual = decodeMapSnapshot(JSON.parse(pair.renderText))
  assert.equal(visual.resources, undefined)
  assert.deepEqual(visual.landscape, source.landscape)
  assert.equal(visual.tiles.length, source.tiles.length)
})
test('revision covers either dataset and dependencies and is stable for repeat exports', async () => {
  const source = fixture(), baseline = await splitMapSnapshot(source, release)
  assert.equal((await splitMapSnapshot(source, release)).renderText, baseline.renderText)
  for (const mutate of [s => s.tiles[0].rotation = 5, s => s.resources.cells[0][4] += 0.000001,
    s => s.landscape.grids[0].instances[0].matrix[12] += 0.01, s => s.name += ' changed']) {
    const copy = structuredClone(source); mutate(copy)
    assert.notEqual((await splitMapSnapshot(copy, release)).render.revision, baseline.render.revision)
  }
  const changed = structuredClone(release); changed.assets.files[0].sha256 = 'f'.repeat(64)
  assert.notEqual((await splitMapSnapshot(source, changed)).render.revision, baseline.render.revision)
  // Mutating caller data while hashing cannot tear the snapshot.
  const pending = splitMapSnapshot(source, release); source.resources.cells[0][4] = 20
  assert.equal((await pending).resourcesText, baseline.resourcesText)
})
test('rejects byte changes, mixed pairs, tampering, invalid transforms and legacy conversion', async () => {
  const source = fixture(), pair = await splitMapSnapshot(source, release)
  await assert.rejects(validateExportPair(pair.renderText + '\n', pair.resourcesText), /SHA-256/)
  for (const mutate of [r => r.id += 'other', r => r.revision = '0'.repeat(64), r => r.createdAt = '2020-01-01',
    r => r.resources.cells[0][4] += 1, r => r.tiles = []]) {
    const resource = structuredClone(pair.resources); mutate(resource)
    await assert.rejects(validateExportPair(pair.renderText, JSON.stringify(resource)))
  }
  const render = structuredClone(pair.render); render.resources = source.resources
  assert.throws(() => decodeMapSnapshot(render))
  delete render.resources; render.landscape.grids[0].instances[0].matrix[0] = 0
  assert.throws(() => decodeMapSnapshot(render))
  source.version = 2
  await assert.rejects(splitMapSnapshot(source, release), /version-3/)
})
test('coordinate inverses, negative rows, numeric boundary ties and outside centers', () => {
  for (const cube of cubeCoordsInRadius(0, 0, 0, 8)) assert.deepEqual(worldToCube(cubeToWorld(cube)), cube)
  assert.deepEqual(worldToCube({ x: 1, z: 0 }), { q: 0, r: 0, s: 0 })
  assert.deepEqual(worldToCube({ x: -1, z: 0 }), { q: -1, r: 0, s: 1 })
  const source = fixture(), assign = createResourceHexAssigner(source)
  assert.equal(assign({ x: 100, z: 100 }), null)
  assert.equal(assign({ x: 1, z: 0 }).q, 0)
  assert.deepEqual(resourceCellCenter(source.resources, source.resources.cells[0]), { x: -0.375, z: -0.375 })
  assert.ok(assign(resourceCellCenter(source.resources, source.resources.cells[0])))
})
test('immutable release file bytes match all hashes', async () => {
  for (const file of release.assets.files) {
    const bytes = await readFile(`public/${file.path}`)
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(await sha256(bytes), file.sha256, file.path)
  }
})

test('render-only consumer constructs terrain and saved scenery using only three verified assets', async () => {
  const { loadRenderGroup } = await import('../src/maps/RenderAssets.js')
  const { Texture } = await import('three')
  const { render } = await splitMapSnapshot(fixture(), release)
  const requested = []
  const fetchAsset = async url => {
    requested.push(url.pathname)
    assert.ok(!url.pathname.includes('.resources.json'))
    return new Response(await readFile(`public${url.pathname}`))
  }
  const group = await loadRenderGroup(render, 'http://localhost/', { fetchAsset, loadTexture: async () => new Texture() })
  assert.equal(requested.length, 3)
  assert.equal(group.children.length, render.tiles.length + render.tiles.filter(t => t.level > 0).length + 1)
  assert.deepEqual(group.children.at(-1).matrix.toArray(), render.landscape.grids[0].instances[0].matrix)
  group.userData.dispose()
  await assert.rejects(loadRenderGroup(render, 'http://localhost/', { fetchAsset: async () => new Response('{}') }), /integrity/)
})

test('cell assignment respects saved grid offsets and retains outside-center totals', () => {
  const source = fixture()
  source.grids[0].center = { q: -8, r: 3, s: 5 }
  source.landscape.grids[0].offset = { x: -12.99, z: 5.2 }
  source.tiles = source.tiles.map(t => ({ ...t, q: t.q - 8, r: t.r + 3, s: t.s + 5 }))
  const assign = createResourceHexAssigner(source)
  assert.deepEqual(assign({ x: -12.99, z: 5.2 }), source.tiles.find(t => t.q === -8 && t.r === 3))
  const resource = structuredClone(source.resources)
  resource.origin = { x: -13.49, z: 4.7 }
  resource.width = 1000
  resource.cells.push([999, 0, 1, 0, 0.123456, 0.654321, 0.25, 0.25])
  const assigned = [0, 0, 0], unassigned = [0, 0, 0]
  for (const cell of resource.cells) {
    const bucket = assign(resourceCellCenter(resource, cell)) ? assigned : unassigned
    for (let i = 0; i < 3; i++) bucket[i] += cell[i + 4]
  }
  assert.deepEqual(unassigned, [0.123456, 0.654321, 0.25])
  assert.deepEqual(assigned.map((n, i) => n + unassigned[i]), totals(resource))
})
