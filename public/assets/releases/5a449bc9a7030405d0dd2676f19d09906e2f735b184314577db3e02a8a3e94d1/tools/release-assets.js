import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HexTileGeometry } from '../src/hexmap/HexTiles.js'
import { Decorations } from '../src/hexmap/Decorations.js'
import { TILE_LIST } from '../src/hexmap/HexTileData.js'

const hash = data => createHash('sha256').update(data).digest('hex')
const files = []
async function add(path, role, data) { data ??= await readFile(path); files.push({ name: path.replace(/^public\//, ''), role, data, sha256: hash(data), bytes: data.length }) }
async function walk(path) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${path}/${entry.name}`
    if (entry.isDirectory()) await walk(name)
    else if (!name.endsWith('AssetRelease.json')) await add(name, name.startsWith('src/') ? 'implementation' : name.includes('/textures/') ? 'textures' : 'source')
  }
}
await walk('src')
await walk('public/assets/textures')
await add('public/assets/models/hex-terrain.glb', 'source')
await add('package-lock.json', 'implementation')
await add('tools/release-assets.js', 'implementation')
// Parse the geometry without browser image decoders. Materials are separately released textures.
const glb = await readFile('public/assets/models/hex-terrain.glb')
const jsonLength = glb.readUInt32LE(12)
const document = JSON.parse(glb.subarray(20, 20 + jsonLength).toString())
const binaryStart = 20 + jsonLength + 8
const binary = glb.subarray(binaryStart, binaryStart + glb.readUInt32LE(20 + jsonLength))
document.buffers = [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }]
delete document.images; delete document.textures; delete document.materials
for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values) } }
const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(document), '')
const meshes = {}
for (const tile of TILE_LIST) {
  const { geom } = HexTileGeometry.findAndProcessGeometry(scene, tile.mesh, tile.levelIncrement)
  if (!geom) throw new Error(`Missing tile mesh ${tile.mesh}`)
  meshes[`tile:${tile.name}`] = geom.toJSON()
}
const { geom: bottom } = HexTileGeometry.findAndProcessGeometry(scene, 'hex_grass_bottom')
bottom.computeBoundingBox(); bottom.translate(0, -bottom.boundingBox.max.y, 0)
meshes['terrain:bottom'] = bottom.toJSON()
Decorations.initGeometries(scene)
for (const [name, geom] of Decorations.cachedGeoms) meshes[`scenery:${name}`] = geom.toJSON()
// UUIDs are runtime identities, not asset content.
for (const geometry of Object.values(meshes)) delete geometry.uuid
const grass = HexTileGeometry.findAndProcessGeometry(scene, TILE_LIST[0].mesh).geom.boundingBox
const catalog = { format: 'hex-map-wfc-catalog', version: 1, assetVersion: 1,
  coordinates: { version: 1, hexWidth: grass.max.x - grass.min.x, hexHeight: grass.max.z - grass.min.z, levelHeight: 0.5, tileSurface: 1 },
  tiles: TILE_LIST.map(tile => ({ ...tile, geometry: `tile:${tile.name}` })),
  scenery: [...Decorations.cachedGeoms.keys()].map(name => ({ name, geometry: `scenery:${name}` })),
  bottomGeometry: 'terrain:bottom', geometryFormat: 'three-buffer-geometry-json',
}
await add('catalog.json', 'catalog', Buffer.from(JSON.stringify(catalog)))
await add('meshes.json', 'models', Buffer.from(JSON.stringify({ format: 'hex-map-wfc-meshes', version: 1, meshes })))
const release = hash(JSON.stringify(files.map(({ name, sha256 }) => ({ name, sha256 }))))
const root = `public/assets/releases/${release}`
await mkdir(root, { recursive: true })
for (const file of files) {
  const destination = `${root}/${file.name}`
  await mkdir(destination.slice(0, destination.lastIndexOf('/')), { recursive: true })
  try {
    if (hash(await readFile(destination)) !== file.sha256) throw new Error(`Immutable asset collision: ${destination}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(destination, file.data)
  }
}
const assets = { version: 1, release, files: files.map(({ name, role, sha256, bytes }) => ({ path: `assets/releases/${release}/${name}`, role, sha256, bytes })) }
const generatorCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await writeFile('src/maps/AssetRelease.json', JSON.stringify({ generatorCommit, assets }, null, 2) + '\n')
await writeFile(`${root}/manifest.json`, JSON.stringify({ generatorCommit, assets }, null, 2) + '\n')
console.log(`Asset release ${release}: ${files.length} files, ${Object.keys(meshes).length} processed meshes`)
