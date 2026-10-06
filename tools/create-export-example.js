// A reproducible example built from real release meshes; not a user-supplied sample.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { BufferGeometryLoader, Matrix4 } from 'three'
import { createMapSnapshot } from '../src/maps/MapSnapshot.js'
import { cubeCoordsInRadius } from '../src/hexmap/HexWFCCore.js'
import { cubeToWorld } from '../src/maps/CoordinatesV1.js'
import { buildResourceGrid } from '../src/maps/ResourceGrid.js'
import { splitMapSnapshot, validateExportPair } from '../src/maps/PairedExport.js'
const release = JSON.parse(await readFile('src/maps/AssetRelease.json'))
const readAsset = async role => JSON.parse(await readFile(`public/${release.assets.files.find(f => f.role === role).path}`))
const catalog = await readAsset('catalog'), model = await readAsset('models')
const loader = new BufferGeometryLoader()
const grass = loader.parse(model.meshes['tile:GRASS'])
const tree = loader.parse(model.meshes['scenery:tree_single_A'])
const tiles = cubeCoordsInRadius(0, 0, 0, 4).map((c, i) => ({ ...c, type: 0, rotation: i % 6, level: 0 }))
const matrix = new Matrix4().makeRotationY(0.73).setPosition(0.123456789, 1, -0.23456789)
const surfaces = tiles.map(tile => {
  const { x, z } = cubeToWorld(tile, catalog.coordinates)
  return { kind: 'terrain', geometry: grass, matrix: new Matrix4().makeRotationY(-tile.rotation * Math.PI / 3).setPosition(x, 0, z) }
})
surfaces.push({ kind: 'trees', geometry: tree, matrix })
const snapshot = createMapSnapshot({ name: 'Paired export example (not supplied sample)', seed: 12, radius: 4,
  grids: [{ x: 0, z: 0, center: { q: 0, r: 0, s: 0 } }], tiles,
  landscape: { version: 1, assetVersion: 1, matrixConvention: 'three-column-major-local-to-grid', grids: [{ x: 0, z: 0, offset: { x: 0, z: 0 },
    instances: [{ kind: 'trees', mesh: 'tree_single_A', tile: { x: 4, z: 4 }, matrix: matrix.toArray() }] }] },
  resources: buildResourceGrid(surfaces) })
snapshot.id = 'example'; snapshot.createdAt = '2026-09-18T00:00:00.000Z'
const pair = await splitMapSnapshot(snapshot, release)
await validateExportPair(pair.renderText, pair.resourcesText)
await mkdir('examples/paired', { recursive: true })
await writeFile('examples/paired/combined-v3.json', JSON.stringify(snapshot))
await writeFile(`examples/paired/${pair.renderFilename}`, pair.renderText)
await writeFile(`examples/paired/${pair.resourcesFilename}`, pair.resourcesText)
await writeFile('examples/paired/index.json', JSON.stringify({ render: pair.renderFilename, resources: pair.resourcesFilename }))
console.log(`${tiles.length} tiles, 1 saved tree, ${snapshot.resources.cells.length} resource rows`)
