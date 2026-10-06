import { Matrix4, Object3D } from 'three'
import { HexTileGeometry } from '../hexmap/HexTiles.js'
import { Decorations } from '../hexmap/Decorations.js'
import { TILE_LIST, TileType } from '../hexmap/HexTileData.js'
import { LEVEL_HEIGHT } from '../hexmap/DecorationDefs.js'
import { buildResourceGrid } from './ResourceGrid.js'

export function createWaterSampler(texture) {
  const canvas = document.createElement('canvas')
  canvas.width = texture.image.width; canvas.height = texture.image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(texture.image, 0, 0)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  return (u, v) => data[(Math.min(height - 1, Math.max(0, Math.floor(v * height))) * width +
    Math.min(width - 1, Math.max(0, Math.floor(u * width)))) * 4] > 127
}

export function captureMapResources(grids, waterAtUV, cache = {}, { requireCachedResources = false } = {}) {
  const landscape = { version: 1, assetVersion: 1, matrixConvention: 'three-column-major-local-to-grid', grids: [] }
  const surfaces = [], dummy = new Object3D()
  for (const grid of grids) {
    const instances = grid.decorations.exportLandscape()
    const offset = { x: grid.worldOffset.x, z: grid.worldOffset.z }
    landscape.grids.push({ x: grid.gridCoords.x, z: grid.gridCoords.z, offset, instances })
    for (const tile of grid.hexTiles) {
      // Roads have exactly the yield of the corresponding unpaved terrain.
      const name = TILE_LIST[tile.type].name
      const resourceType = name.startsWith('ROAD_')
        ? name.includes('SLOPE') ? TILE_LIST.findIndex(t => t.name === name.replace('ROAD_A', 'GRASS')) : TileType.GRASS
        : tile.type
      const geometry = HexTileGeometry.geoms.get(resourceType)
      if (!geometry) throw new Error('Terrain geometry is unavailable for resource sampling')
      const pos = HexTileGeometry.getWorldPosition(tile.gridX - grid.gridRadius, tile.gridZ - grid.gridRadius)
      dummy.position.set(pos.x + offset.x, tile.level * LEVEL_HEIGHT, pos.z + offset.z)
      dummy.rotation.set(0, -tile.rotation * Math.PI / 3, 0)
      dummy.updateMatrix()
      surfaces.push({ kind: 'terrain', geometry, matrix: dummy.matrix.clone() })
    }
    for (const instance of instances) {
      const geometry = Decorations.cachedGeoms.get(instance.mesh)
      if (!geometry) throw new Error('Landscape geometry is unavailable for resource sampling')
      const matrix = new Matrix4().fromArray(instance.matrix)
      matrix.elements[12] += offset.x; matrix.elements[14] += offset.z
      surfaces.push({ kind: instance.kind, geometry, matrix })
    }
  }
  const key = JSON.stringify([landscape, grids.map(g => g.hexTiles.map(t => [t.gridX, t.gridZ, t.type, t.rotation, t.level]))])
  if (!cache.resources || (cache.key !== undefined && cache.key !== key)) {
    if (requireCachedResources) throw new Error('Map resources are unresolved. Save the current map before exporting.')
    cache.resources = buildResourceGrid(surfaces, { cellSize: HexTileGeometry.HEX_WIDTH / 8, waterAtUV })
  }
  cache.key = key
  return { landscape, resources: cache.resources }
}
