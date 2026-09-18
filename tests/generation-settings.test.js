import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GENERATION_SETTINGS, terrainOptions, stateWeight, validateGenerationSettings } from '../src/maps/GenerationSettings.js'
import { TILE_LIST } from '../src/hexmap/HexTileData.js'
import { decorationAllowed, TreeMeshNames, HillMeshNames, BuildingMeshNames, CoastBuildingMeshNames, WindmillMeshNames, BridgeMeshNames, RareBuildingNames, MountainMeshNames } from '../src/hexmap/DecorationDefs.js'
import { cubeCoordsInRadius } from '../src/hexmap/HexWFCCore.js'

const recipe = overrides => ({ ...DEFAULT_GENERATION_SETTINGS, ...overrides })

test('hard exclusions cover road slopes, crossings, river transitions, coasts and cliffs', () => {
  for (const [setting, edges] of [['roads', ['road']], ['rivers', ['river']], ['water', ['water', 'coast']]]) {
    const options = terrainOptions(recipe({ [setting]: 0 }))
    assert.ok(options.tileTypes.length)
    for (const type of options.tileTypes) assert.ok(!Object.values(TILE_LIST[type].edges).some(e => edges.includes(e)))
  }
  assert.ok(terrainOptions(recipe({ ruggedness: 0 })).tileTypes.every(type => !TILE_LIST[type].highEdges?.length))
  assert.ok(terrainOptions(recipe({ structures: 0 })).tileTypes.every(type => !TILE_LIST[type].name.startsWith('RIVER_CROSSING')))
})

test('relative preferences affect collapse weights and elevation independently', () => {
  const road = TILE_LIST.findIndex(t => t.name === 'ROAD_A')
  assert.equal(terrainOptions(recipe({ roads: 3 })).weights[road], TILE_LIST[road].weight * 3)
  assert.ok(stateWeight({type: 0, level: 4}, {elevation: 4}) > stateWeight({type: 0, level: 0}, {elevation: 4}))
  assert.equal(stateWeight({type: 0, level: 4}, {elevation: 2}), TILE_LIST[0].weight)
})

test('all structures and embedded trees honor hard off switches', () => {
  for (const name of [...BuildingMeshNames, ...CoastBuildingMeshNames, ...WindmillMeshNames, ...BridgeMeshNames, ...RareBuildingNames]) {
    assert.equal(decorationAllowed(name, recipe({structures: 0})), false, name)
  }
  for (const name of [...TreeMeshNames, ...HillMeshNames.filter(n => n.includes('_trees'))]) {
    assert.equal(decorationAllowed(name, recipe({trees: 0})), false, name)
  }
  for (const name of MountainMeshNames) assert.equal(decorationAllowed(name, recipe({mountains: 0})), false)
})

test('invalid imported recipes are rejected rather than silently normalized', () => {
  for (const invalid of [null, {}, recipe({roads: -1}), recipe({trees: Infinity}), recipe({elevation: 2.5}), recipe({oceanEdge: 'yes'})]) {
    assert.throws(() => validateGenerationSettings(invalid), /Invalid generation/)
  }
})

test('real worker solves reproducibly with disabled elements and flat terrain', async () => {
  const messages = []
  globalThis.self = { postMessage: message => messages.push(message) }
  await import('../src/workers/wfc.worker.js')
  const solve = settings => {
    messages.length = 0
    self.onmessage({data: {type: 'init', seed: 123}})
    self.onmessage({data: {
      type: 'solve', id: 'test', solveCells: cubeCoordsInRadius(0, 0, 0, 3), fixedCells: [],
      options: {...terrainOptions(settings), quiet: true, maxTries: 5, maxBacktracks: 500,
        initialCollapses: [{q: 0, r: 0, s: 0, type: 0, rotation: 0, level: 0}]},
    }})
    const result = messages.find(m => m.type === 'result')
    assert.equal(result.success, true)
    assert.equal(result.tiles.length, 37)
    return result.tiles
  }
  const settings = recipe({roads: 0, rivers: 0, water: 0, ruggedness: 0})
  const tiles = solve(settings)
  assert.ok(tiles.every(t => t.type === 0 && t.level === 0))
  assert.deepEqual(solve(settings), tiles)
  const varied = recipe({roads: 0, structures: 0, mountains: 3})
  const variedTiles = solve(varied)
  assert.ok(variedTiles.every(t => !Object.values(TILE_LIST[t.type].edges).includes('road')))
  assert.deepEqual(solve(varied), variedTiles)
  delete globalThis.self
})
