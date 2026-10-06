import { BufferGeometryLoader, Group, Mesh, MeshStandardMaterial, Matrix4, TextureLoader, SRGBColorSpace } from 'three'
import { decodeMapSnapshot } from './MapSnapshot.js'
import { sha256 } from './PairedExport.js'
import { cubeToWorld } from './CoordinatesV1.js'

// A standalone render-only consumer. The only fetches are manifest assets;
// it has no resource-file URL and never invokes resource sampling or map RNG.
export async function loadRenderGroup(render, baseURL, { fetchAsset = fetch, loadTexture = url => new TextureLoader().loadAsync(url) } = {}) {
  decodeMapSnapshot(render)
  const read = async file => {
    const response = await fetchAsset(new URL(file.path, baseURL))
    if (!response.ok) throw new Error(`Asset request failed: ${file.path}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new Error(`Asset integrity mismatch: ${file.path}`)
    return bytes
  }
  const json = async role => JSON.parse(new TextDecoder().decode(await read(render.assets.files.find(f => f.role === role))))
  const [catalog, model] = await Promise.all([json('catalog'), json('models')])
  if (catalog.format !== 'hex-map-wfc-catalog' || catalog.version !== 1 || catalog.assetVersion !== render.landscape.assetVersion ||
      model.format !== 'hex-map-wfc-meshes' || model.version !== 1) throw new Error('Incompatible asset catalog')
  const textureFile = render.assets.files.find(f => f.path.endsWith('/assets/textures/default.png'))
  if (!textureFile) throw new Error('Missing atlas texture')
  const textureBytes = await read(textureFile)
  const textureURL = URL.createObjectURL(new Blob([textureBytes], { type: 'image/png' }))
  let texture
  try { texture = await loadTexture(textureURL) }
  finally { URL.revokeObjectURL(textureURL) }
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  const material = new MeshStandardMaterial({ map: texture, roughness: 1 })
  const parser = new BufferGeometryLoader(), geometries = new Map()
  const geometry = name => {
    if (!model.meshes[name]) throw new Error(`Missing processed geometry: ${name}`)
    if (!geometries.has(name)) geometries.set(name, parser.parse(model.meshes[name]))
    return geometries.get(name)
  }
  const definitions = new Map(catalog.tiles.map(tile => [tile.name, tile]))
  const scenery = new Map(catalog.scenery.map(item => [item.name, item]))
  const group = new Group(), seen = new Set()
  for (const grid of render.grids) {
    const saved = render.landscape.grids.find(g => g.x === grid.x && g.z === grid.z)
    for (const tile of render.tiles) {
      const local = { q: tile.q - grid.center.q, r: tile.r - grid.center.r, s: tile.s - grid.center.s }
      const key = `${tile.q},${tile.r},${tile.s}`
      if (Math.max(Math.abs(local.q), Math.abs(local.r), Math.abs(local.s)) > render.radius || seen.has(key)) continue
      seen.add(key)
      const position = cubeToWorld(local, catalog.coordinates)
      const def = definitions.get(tile.tile)
      if (!def) throw new Error(`Missing tile definition: ${tile.tile}`)
      const mesh = new Mesh(geometry(def.geometry), material)
      mesh.position.set(position.x + saved.offset.x, tile.level * catalog.coordinates.levelHeight, position.z + saved.offset.z)
      mesh.rotation.y = -tile.rotation * Math.PI / 3
      group.add(mesh)
      if (tile.level > 0) {
        const bottom = new Mesh(geometry(catalog.bottomGeometry), material)
        bottom.position.copy(mesh.position)
        bottom.scale.y = tile.level * catalog.coordinates.levelHeight
        group.add(bottom)
      }
    }
    for (const instance of saved.instances) {
      const def = scenery.get(instance.mesh)
      if (!def) throw new Error(`Missing scenery definition: ${instance.mesh}`)
      const mesh = new Mesh(geometry(def.geometry), material)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(new Matrix4().fromArray(instance.matrix))
      mesh.matrix.elements[12] += saved.offset.x
      mesh.matrix.elements[14] += saved.offset.z
      group.add(mesh)
    }
  }
  group.userData.dispose = () => {
    for (const geom of geometries.values()) geom.dispose()
    material.dispose(); texture.dispose()
  }
  return group
}
