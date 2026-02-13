import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import { Color } from 'three/webgpu'

// Tile type enum - matches order in TILE_MESH_NAMES
export const TileType = {
  FORWARD: 0,
  END: 1,
  T: 2,
  X: 3,
  ANGLE: 4,
  TURN_90: 5,
}

// Mesh names in roads.glb (without _Placeable_0 suffix)
const TILE_MESH_NAMES = [
  'RoadForward',
  'RoadEnd',
  'RoadT',
  'RoadX',
  'RoadAngle',
  'Road90',
]

// Tile definitions with exit edges (N, E, S, W = has road exit on that side)
// Base orientation (rotation = 0)
export const TileDefinitions = {
  [TileType.FORWARD]: { exits: { N: true, E: false, S: true, W: false } },
  [TileType.END]:     { exits: { N: false, E: false, S: true, W: false } },  // Cap at N, exit S
  [TileType.T]:       { exits: { N: false, E: true, S: true, W: true } },   // Corner fill NE
  [TileType.X]:       { exits: { N: true, E: true, S: true, W: true } },
  [TileType.ANGLE]:   { exits: { N: false, E: true, S: true, W: false } },   // Corner fill NW
  [TileType.TURN_90]: { exits: { N: false, E: true, S: true, W: false } },  // Corner fill NW
}

// Rotate exits CCW by rotation steps (0-3)
// rot=1: exit at E moves to N, S→E, W→S, N→W
export function rotateExits(exits, rotation) {
  const dirs = ['N', 'E', 'S', 'W']
  const rotated = {}
  for (let i = 0; i < 4; i++) {
    rotated[dirs[i]] = exits[dirs[(i + rotation) % 4]]
  }
  return rotated
}

/**
 * Tile class - represents a single road tile instance
 * Similar to Tower.js but simpler (no stacking, no animation)
 */
export class Tile {
  static ID = 0
  static DEFAULT_COLOR = new Color(0x888888)
  static LAYER_HEIGHT = 1.0 // 10 Blender units = 1 cell height

  constructor(gridX, gridZ, type, rotation = 0, layer = 0) {
    this.id = Tile.ID++
    this.gridX = gridX
    this.gridZ = gridZ
    this.type = type
    this.rotation = rotation // 0-3 = 0, 90, 180, 270 degrees
    this.layer = layer // 0 = ground, 1+ = elevated
    this.instanceId = null
    this.color = Tile.DEFAULT_COLOR.clone()
  }
}

/**
 * TileGeometry - loads road tile geometries from roads.glb
 * Follows BlockGeometry.js pattern
 */
export class TileGeometry {
  static geoms = []
  static halfHeights = []
  static roadTexture = null  // Texture from GLB material
  // Uniform scale: 10 Blender units = 1 cell (20x20 BU tile = 2x2 cells)
  static SCALE = 1 / 10

  static async init() {
    const file = './assets/models/roads.glb'
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(file)

    // Log all meshes and materials in scene for debugging
    console.log('GLB meshes:')
    const materials = new Map()
    gltf.scene.traverse((child) => {
      if (child.geometry) {
        child.geometry.computeBoundingBox()
        const bb = child.geometry.boundingBox
        const size = {
          x: (bb.max.x - bb.min.x).toFixed(1),
          y: (bb.max.y - bb.min.y).toFixed(1),
          z: (bb.max.z - bb.min.z).toFixed(1)
        }
        const mat = child.material
        const matName = mat ? (mat.name || 'unnamed') : 'none'
        console.log(`  ${child.name}: ${size.x} x ${size.y} x ${size.z} [mat: ${matName}]`)
        if (mat && !materials.has(matName)) {
          materials.set(matName, mat)
        }
      }
    })

    // Log material details and extract texture
    console.log('GLB materials:')
    for (const [name, mat] of materials) {
      const info = []
      if (mat.color) info.push(`color: #${mat.color.getHexString()}`)
      if (mat.map) info.push(`map: ${mat.map.name || 'texture'}`)
      if (mat.roughness !== undefined) info.push(`rough: ${mat.roughness}`)
      if (mat.metalness !== undefined) info.push(`metal: ${mat.metalness}`)
      console.log(`  ${name}: ${info.join(', ')}`)

      // Store the Placeable material's texture
      if (name === 'Placeable' && mat.map) {
        this.roadTexture = mat.map
        console.log('  → Stored road texture')
      }
    }

    // Load geometries by name from entire scene (TILE_MESH_NAMES defines which meshes we want)
    for (const baseName of TILE_MESH_NAMES) {
      const meshName = `${baseName}_Placeable_0`
      const result = this.findScaleAndCenterGeometry(gltf.scene, meshName)
      this.geoms.push(result.geom)
      this.halfHeights.push(result.halfHeight)
    }

    console.log(`TileGeometry: Loaded ${this.geoms.length} road tile geometries`)
  }

  /**
   * Find geometry by name within a parent node, center at origin
   * Converts from Blender coordinates (Z-up) to Three.js (Y-up)
   * Does NOT scale - tiles keep their original sizes from Blender
   */
  static findScaleAndCenterGeometry(parent, name) {
    // Find mesh by traversing from parent node
    let mesh = null
    parent.traverse((child) => {
      if (child.name === name && child.geometry) {
        mesh = child
      }
    })

    if (!mesh) {
      console.error(`TileGeometry: Mesh not found: ${name}`)
      return { geom: null, halfHeight: 0 }
    }

    // Clone geometry so we don't modify the original
    const geom = mesh.geometry.clone()

    // Apply transforms using built-in geometry methods (handles positions, normals, etc.)
    geom.scale(this.SCALE, this.SCALE, this.SCALE)

    // Compute bounding box after transforms
    geom.computeBoundingBox()
    const { min, max } = geom.boundingBox
    const width = max.x - min.x
    const depth = max.z - min.z
    const height = max.y - min.y

    console.log(`${name}:`)
    console.log(`  bbox: X[${min.x.toFixed(2)}, ${max.x.toFixed(2)}] Y[${min.y.toFixed(2)}, ${max.y.toFixed(2)}] Z[${min.z.toFixed(2)}, ${max.z.toFixed(2)}]`)
    console.log(`  size: ${width.toFixed(2)} x ${depth.toFixed(2)} x ${height.toFixed(3)} (W x D x H)`)

    // Shift Y so bottom sits slightly above floor
    geom.translate(0, -min.y + 0.01, 0)

    // Recompute bounds after translation
    geom.computeBoundingBox()
    geom.computeBoundingSphere()

    const halfHeight = height / 2

    return { geom, halfHeight }
  }
}
