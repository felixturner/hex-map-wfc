import test from 'node:test'
import assert from 'node:assert/strict'
import { createMapSnapshot, decodeMapSnapshot } from '../src/maps/MapSnapshot.js'
import { cubeCoordsInRadius } from '../src/hexmap/HexWFCCore.js'
import { TILE_LIST } from '../src/hexmap/HexTileData.js'

function fixture() {
  return createMapSnapshot({
    seed: 42, radius: 1,
    grids: [{ x: 0, z: 0, center: { q: 0, r: 0, s: 0 } }],
    tiles: cubeCoordsInRadius(0, 0, 0, 1).map(cell => ({ ...cell, type: 0, rotation: 3, level: 2 })),
  })
}

test('solved tiles round-trip through JSON with semantic tile names', () => {
  const snapshot = fixture()
  assert.equal(snapshot.tiles[0].tile, 'GRASS')
  const decoded = decodeMapSnapshot(JSON.parse(JSON.stringify(snapshot)))
  assert.equal(decoded.tiles.length, 7)
  assert.deepEqual(decoded.tiles[0], { q: -1, r: 0, s: 1, type: 0, rotation: 3, level: 2 })
  assert.equal(decoded.seed, 42)
})

test('incomplete and duplicate tile maps cannot be saved', () => {
  const missing = fixture()
  missing.tiles.pop()
  assert.throws(() => decodeMapSnapshot(missing), /incomplete/)
  const duplicate = fixture()
  duplicate.tiles[0] = duplicate.tiles[1]
  assert.throws(() => decodeMapSnapshot(duplicate), /duplicate/)
})

test('unsupported versions, unknown types, coordinates and invalid states are rejected', () => {
  for (const mutate of [
    s => { s.version = 99 },
    s => { s.tiles[0].tile = 'FUTURE_TILE' },
    s => { s.tiles[0].rotation = 6 },
    s => { s.tiles[0].q = 100 },
    s => { s.tiles[0].level = -1 },
    s => { s.grids.push(s.grids[0]) },
    s => { s.seed = NaN },
    s => { s.waterSideIndex = 6 },
  ]) {
    const snapshot = fixture()
    mutate(snapshot)
    assert.throws(() => decodeMapSnapshot(snapshot), /Invalid saved map/)
  }
})

test('ocean direction survives serialization for subsequent map expansion', () => {
  const snapshot = fixture()
  snapshot.waterSideIndex = 4
  assert.equal(decodeMapSnapshot(JSON.parse(JSON.stringify(snapshot))).waterSideIndex, 4)
})

test('slopes cannot exceed the elevation limit', () => {
  const snapshot = fixture()
  snapshot.tiles[0].tile = TILE_LIST.find(tile => tile.highEdges?.length).name
  snapshot.tiles[0].level = 4
  assert.throws(() => decodeMapSnapshot(snapshot), /elevation/)
})

test('generation recipes are copied into snapshots and restored after serialization', () => {
  const snapshot = fixture()
  snapshot.generationSettings.trees = 2
  snapshot.generationSettings.roads = 0
  const decoded = decodeMapSnapshot(JSON.parse(JSON.stringify(snapshot)))
  assert.equal(decoded.generationSettings.trees, 2)
  assert.equal(decoded.generationSettings.roads, 0)
  assert.notEqual(decoded.generationSettings, snapshot.generationSettings)
  assert.equal(fixture().generationSettings.trees, 1)
})

test('legacy saves remain readable without inventing their original recipe', () => {
  const snapshot = fixture()
  snapshot.version = 1
  delete snapshot.generationSettings
  const decoded = decodeMapSnapshot(snapshot)
  assert.equal(decoded.generationSettings, null)
  assert.equal(decoded.tiles.length, 7)
})

test('version 2 saves require a valid recipe or explicit unknown legacy recipe', () => {
  const snapshot = fixture()
  delete snapshot.generationSettings
  assert.throws(() => decodeMapSnapshot(snapshot), /generation settings/)
  snapshot.generationSettings = null
  assert.equal(decodeMapSnapshot(snapshot).generationSettings, null)
})
