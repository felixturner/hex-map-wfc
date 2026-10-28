import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BufferGeometryLoader } from 'three'
import { DEFAULT_GENERATION_SETTINGS, terrainOptions } from '../src/maps/GenerationSettings.js'
import { getMapGridCoordinates, MAP_SIZE_PRESETS } from '../src/maps/MapLayout.js'
import { cubeCoordsInRadius, cubeKey, globalToLocalGrid, CUBE_DIRS } from '../src/hexmap/HexWFCCore.js'
import { getAdjacentGridKey, getGridWorldOffset, GridDirection, worldOffsetToGlobalCube } from '../src/hexmap/HexGridConnector.js'
import { createMapSnapshot, decodeMapSnapshot } from '../src/maps/MapSnapshot.js'
import { captureMapResources } from '../src/maps/MapResources.js'
import { HexTileGeometry } from '../src/hexmap/HexTiles.js'
import { splitMapSnapshot, combineExportPair } from '../src/maps/PairedExport.js'

const layouts = MAP_SIZE_PRESETS.flatMap(preset => Object.keys(preset.shapes).map(mapShape => ({
  ...DEFAULT_GENERATION_SETTINGS, playerCount: preset.playerCount, mapShape,
})))

function regions(settings) {
  const ne = getGridWorldOffset(8, GridDirection.NE)
  const south = getGridWorldOffset(8, GridDirection.S)
  return getMapGridCoordinates(settings).map(([x, z]) => {
    const r = z - Math.floor((x - (x & 1)) / 2)
    const worldOffset = { x: x * ne.x + (x + r) * south.x, z: x * ne.z + (x + r) * south.z }
    return { x, z, worldOffset, center: worldOffsetToGlobalCube(worldOffset) }
  })
}

test('all size/shape footprints are connected, bounded, unique and contain the origin', () => {
  for (const settings of layouts) {
    const coordinates = getMapGridCoordinates(settings)
    const keys = new Set(coordinates.map(([x, z]) => `${x},${z}`))
    const preset = MAP_SIZE_PRESETS.find(p => p.playerCount === settings.playerCount)
    assert.equal(coordinates.length, preset.regionCount)
    assert.equal(keys.size, preset.regionCount)
    assert.ok(keys.has('0,0'))
    for (const [q, z] of coordinates) {
      const r = z - Math.floor((q - (q & 1)) / 2)
      assert.ok(Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= 2)
    }
    const reached = new Set(['0,0']), queue = ['0,0']
    for (const key of queue) for (let direction = 0; direction < 6; direction++) {
      const adjacent = getAdjacentGridKey(key, direction)
      if (keys.has(adjacent) && !reached.has(adjacent)) { reached.add(adjacent); queue.push(adjacent) }
    }
    assert.equal(reached.size, keys.size)
    const cells = regions(settings).flatMap(g => cubeCoordsInRadius(g.center.q, g.center.r, g.center.s, 8))
    const cellKeys = new Set(cells.map(c => cubeKey(c.q, c.r, c.s)))
    assert.equal(cellKeys.size, preset.regionCount * 217)
    const reachedCells = new Set(['0,0,0']), cellQueue = [{ q: 0, r: 0, s: 0 }]
    for (const cell of cellQueue) for (const dir of CUBE_DIRS) {
      const next = { q: cell.q + dir.dq, r: cell.r + dir.dr, s: cell.s + dir.ds }
      const key = cubeKey(next.q, next.r, next.s)
      if (cellKeys.has(key) && !reachedCells.has(key)) { reachedCells.add(key); cellQueue.push(next) }
    }
    assert.equal(reachedCells.size, cellKeys.size, 'terrain must be connected across region boundaries')
  }
  assert.equal(getMapGridCoordinates().length, 10)
})

test('player counts use the requested footprints and retain the previous larger shapes', () => {
  assert.deepEqual(MAP_SIZE_PRESETS.map(({ playerCount, regionCount }) => [playerCount, regionCount]),
    [[12, 19], [6, 10], [3, 6], [2, 4]])
  const asCubes = settings => getMapGridCoordinates(settings).map(([q, z]) => [q, z - Math.floor((q - (q & 1)) / 2)])
  const triangle = []
  const hexagon = []
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
    const s = -q - r
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 2) {
      hexagon.push([q, r])
      if (Math.min(q, r, s) >= -1) triangle.push([q, r])
    }
  }
  assert.deepEqual(asCubes({ playerCount: 12, mapShape: 'hexagon' }), hexagon)
  assert.deepEqual(asCubes({ playerCount: 6, mapShape: 'triangle' }), triangle)
  assert.deepEqual(asCubes({ playerCount: 6, mapShape: 'compact' }),
    [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-2, 1], [1, -2], [1, 1]])
})

test('smaller footprints solve deterministically with the real worker', async () => {
  const messages = []
  globalThis.self = { postMessage: message => messages.push(message) }
  await import('../src/workers/wfc.worker.js')
  try {
    for (const settings of layouts.filter(s => s.playerCount !== 12)) {
      const cells = regions(settings).flatMap(g => cubeCoordsInRadius(g.center.q, g.center.r, g.center.s, 8))
      const solve = () => {
        messages.length = 0
        self.onmessage({ data: { type: 'init', seed: 42 } })
        self.onmessage({ data: { type: 'solve', id: 'layout', solveCells: cells, fixedCells: [], options: {
          ...terrainOptions({ ...settings, water: 0, roads: 0, rivers: 0, ruggedness: 0 }), quiet: true,
          initialCollapses: [{ q: 0, r: 0, s: 0, type: 0, rotation: 0, level: 0 }],
        } } })
        const result = messages.find(message => message.type === 'result')
        assert.equal(result.success, true)
        assert.equal(result.tiles.length, cells.length)
        assert.ok(result.tiles.every(t => t.type === 0 && t.level === 0))
        return result.tiles
      }
      assert.deepEqual(solve(), solve())
    }
  } finally { delete globalThis.self }
})

test('smaller snapshots and paired resource exports preserve only their selected footprint', async () => {
  const release = JSON.parse(await readFile(new URL('../src/maps/AssetRelease.json', import.meta.url)))
  const meshes = JSON.parse(await readFile(`public/${release.assets.files.find(f => f.role === 'models').path}`))
  const geometry = new BufferGeometryLoader().parse(meshes.meshes['tile:GRASS'])
  const oldGeometry = HexTileGeometry.geoms.get(0)
  const oldWidth = HexTileGeometry.HEX_WIDTH, oldHeight = HexTileGeometry.HEX_HEIGHT
  geometry.computeBoundingBox()
  HexTileGeometry.HEX_WIDTH = geometry.boundingBox.max.x - geometry.boundingBox.min.x
  HexTileGeometry.HEX_HEIGHT = geometry.boundingBox.max.z - geometry.boundingBox.min.z
  HexTileGeometry.geoms.set(0, geometry)
  try {
    for (const playerCount of [6, 3, 2]) {
      const settings = layouts.find(s => s.playerCount === playerCount)
      const footprint = regions(settings)
      const tiles = footprint.flatMap(g => cubeCoordsInRadius(g.center.q, g.center.r, g.center.s, 8)
        .map(c => ({ ...c, type: 0, rotation: 0, level: 0 })))
      const grids = footprint.map(g => ({
        gridCoords: { x: g.x, z: g.z }, gridRadius: 8, worldOffset: g.worldOffset,
        hexTiles: cubeCoordsInRadius(g.center.q, g.center.r, g.center.s, 8)
          .map(c => ({ ...globalToLocalGrid(c, g.center, 8), type: 0, rotation: 0, level: 0 })),
        decorations: { exportLandscape: () => [] },
      }))
      const cache = {}
      const captured = captureMapResources(grids, () => false, cache)
      assert.ok(captured.resources.cells.length > 0)
      const sampledArea = captured.resources.cells.reduce((sum, c) => sum + c[7] * captured.resources.cellSize ** 2, 0)
      const tileArea = 2 * Math.sqrt(3)
      assert.ok(Math.abs(sampledArea / (tiles.length * tileArea) - 1) < 0.02)
      const expectedKeys = new Set(grids.map(g => `${g.gridCoords.x},${g.gridCoords.z}`))
      assert.deepEqual(new Set(captured.landscape.grids.map(g => `${g.x},${g.z}`)), expectedKeys)
      const snapshot = createMapSnapshot({ seed: 42, radius: 8, generationSettings: settings, tiles,
        grids: footprint.map(({ x, z, center }) => ({ x, z, center })), ...captured })
      const pair = await splitMapSnapshot(snapshot, release)
      const combined = await combineExportPair(pair.renderText, pair.resourcesText)
      assert.deepEqual(combined, JSON.parse(JSON.stringify(snapshot)))
      assert.equal(decodeMapSnapshot(combined).tiles.length, tiles.length)
      assert.deepEqual(captureMapResources(grids, () => false, cache, { requireCachedResources: true }).resources, captured.resources)
      const incomplete = structuredClone(snapshot)
      incomplete.tiles.pop()
      assert.throws(() => decodeMapSnapshot(incomplete), /incomplete/)
    }
  } finally {
    HexTileGeometry.HEX_WIDTH = oldWidth
    HexTileGeometry.HEX_HEIGHT = oldHeight
    if (oldGeometry) HexTileGeometry.geoms.set(0, oldGeometry)
    else HexTileGeometry.geoms.delete(0)
    geometry.dispose()
  }
})
