import test from 'node:test'
import assert from 'node:assert/strict'
import { HexWFCAdjacencyRules, HexWFCCell } from '../src/hexmap/HexWFCCore.js'
import { TileType, TILE_LIST } from '../src/hexmap/HexTileData.js'
import { setSeed } from '../src/SeededRandom.js'

globalThis.self = { postMessage() {} }
const { HexWFCSolver } = await import('../src/workers/wfc.worker.js')
const grass = { type: TileType.GRASS, rotation: 0, level: 0 }
const water = { type: TileType.WATER, rotation: 0, level: 0 }
const key = HexWFCCell.stateKey
const cells = [{ q: 0, r: 0, s: 0 }, { q: 1, r: 0, s: -1 }]

test('a failed decision retries an untried state before resuming entropy selection', () => {
  setSeed(1)
  const solver = new HexWFCSolver(HexWFCAdjacencyRules.fromTileDefinitions(), {
    quiet: true, maxBacktracks: 5, weights: { [TileType.GRASS]: 1, [TileType.WATER]: 1e9 },
  })
  solver.init(cells, [])
  solver.cells.get('0,0,0').possibilities = new Set([key(grass), key(water)])
  solver.cells.get('1,0,-1').possibilities = new Set([key(grass)])
  solver.saveDecision('0,0,0')
  assert.equal(solver.collapseWithExclusions('0,0,0', solver.decisions[0].triedStates), true)
  assert.equal(solver.cells.get('0,0,0').tile.type, TileType.WATER)
  assert.equal(solver.propagate(), false)
  assert.equal(solver.backtrack(), true)
  assert.equal(solver.cells.get('0,0,0').collapsed, true)
  assert.equal(solver.cells.get('0,0,0').tile.type, TileType.GRASS)
  assert.deepEqual(solver.decisions[0].triedStates, new Set([key(water), key(grass)]))
  assert.deepEqual(solver.cells.get('1,0,-1').possibilities, new Set([key(grass)]))
  assert.equal(solver.collapseOrder.length, 1)
})

test('backtracking restores no-chaining removals and detects an emptied source domain', () => {
  const type = TILE_LIST.findIndex(tile => tile.preventChaining)
  assert.ok(type >= 0)
  const chained = key({ type, rotation: 0, level: 0 })
  const solver = new HexWFCSolver(HexWFCAdjacencyRules.fromTileDefinitions(), { quiet: true })
  solver.init(cells, [])
  solver.cells.get('0,0,0').possibilities = new Set([key(grass), chained])
  solver.cells.get('1,0,-1').possibilities = new Set([chained])
  solver.saveDecision('0,0,0')
  solver._pruneChaining('0,0,0', type)
  assert.equal(solver.cells.get('1,0,-1').possibilities.size, 0)
  assert.equal(solver.propagate(), false)
  solver.undoLastDecision()
  assert.deepEqual(solver.cells.get('1,0,-1').possibilities, new Set([chained]))
})

test('reported seed 87811 solves the default workshop and every shared edge agrees', { timeout: 300000 }, async () => {
  const { readFile } = await import('node:fs/promises')
  const { cubeCoordsInRadius, cubeKey, CUBE_DIRS } = await import('../src/hexmap/HexWFCCore.js')
  const { HexOpposite } = await import('../src/hexmap/HexTileData.js')
  const { terrainOptions, DEFAULT_GENERATION_SETTINGS } = await import('../src/maps/GenerationSettings.js')
  // Recorded 19-grid, radius-8 workshop layout; protects the actual map scale.
  const footprint = JSON.parse(await readFile(new URL('./fixtures/workshop-footprint.json', import.meta.url)))
  const cells = new Map()
  for (const { center } of footprint.grids) {
    for (const cell of cubeCoordsInRadius(center.q, center.r, center.s, footprint.radius)) cells.set(cubeKey(cell.q, cell.r, cell.s), cell)
  }
  assert.equal(cells.size, 4123)
  const options = terrainOptions(DEFAULT_GENERATION_SETTINGS)
  const rules = HexWFCAdjacencyRules.fromTileDefinitions(options.tileTypes)
  const solver = new HexWFCSolver(rules, { ...options, quiet: true, maxTries: 12, maxBacktracks: 5000 })
  setSeed(87811)
  const tiles = solver.solve([...cells.values()], [], [{ q: 0, r: 0, s: 0, ...grass }])
  assert.ok(tiles, 'default map must solve without exhausting the backtrack budget')
  assert.equal(tiles.length, cells.size)
  const byKey = new Map(tiles.map(tile => [cubeKey(tile.q, tile.r, tile.s), tile]))
  for (const tile of tiles) for (const direction of CUBE_DIRS) {
    const neighbor = byKey.get(cubeKey(tile.q + direction.dq, tile.r + direction.dr, tile.s + direction.ds))
    if (!neighbor) continue
    const edge = rules.stateEdges.get(key(tile))[direction.name]
    const opposite = rules.stateEdges.get(key(neighbor))[HexOpposite[direction.name]]
    assert.ok(edge && opposite)
    assert.deepEqual(edge, opposite, `shared edge at ${cubeKey(tile.q, tile.r, tile.s)}`)
    if (TILE_LIST[tile.type].preventChaining) assert.notEqual(tile.type, neighbor.type)
  }
})
