import { Object3D, BatchedMesh, Color } from 'three/webgpu'
import { TILE_LIST, TileType, HexDir, getHexNeighborOffset, LEVELS_COUNT } from './HexTileData.js'
import { HexTileGeometry } from './HexTiles.js'
import FastSimplexNoise from '@webvoxel/fast-simplex-noise'
import { random, shuffle } from './SeededRandom.js'
import gsap from 'gsap'

const LEVEL_HEIGHT = 0.5
const TILE_SURFACE = 1

// Global noise instances shared across all Decorations
// Created lazily on first use, seeded from global RNG
let globalNoiseA = null
let globalNoiseB = null

let currentTreeNoiseFreq = 0.05
let currentTreeThreshold = 0.5

export function initGlobalTreeNoise(frequency = 0.05) {
  setTreeNoiseFrequency(frequency)
}

export function setTreeNoiseFrequency(frequency) {
  currentTreeNoiseFreq = frequency
  globalNoiseA = new FastSimplexNoise({ frequency, min: 0, max: 1, random })
  globalNoiseB = new FastSimplexNoise({ frequency, min: 0, max: 1, random })

}

export function getTreeNoiseFrequency() {
  return currentTreeNoiseFreq
}

export function setTreeThreshold(threshold) {
  currentTreeThreshold = threshold
}

export function getTreeThreshold() {
  return currentTreeThreshold
}

// Pick a random item from a weighted defs array [{ name, weight }]
function weightedPick(defs) {
  const total = defs.reduce((sum, d) => sum + d.weight, 0)
  let r = random() * total
  for (const d of defs) {
    r -= d.weight
    if (r <= 0) return d.name
  }
  return defs[defs.length - 1].name
}

// Check if a tile type has any road edges
function hasRoadEdge(tileType) {
  const def = TILE_LIST[tileType]
  if (!def) return false
  return Object.values(def.edges).some(edge => edge === 'road')
}

function isCoastOrOcean(tileType) {
  const def = TILE_LIST[tileType]
  if (!def) return false
  return def.name.startsWith('COAST_') || def.name === 'OCEAN'
}

// Check if a tile is a road dead-end (exactly 1 road edge) and return the exit direction
// Returns { isDeadEnd: true, exitDir } or { isDeadEnd: false }
function getRoadDeadEndInfo(tileType, rotation) {
  const def = TILE_LIST[tileType]
  if (!def) return { isDeadEnd: false }

  // Count road edges and find the exit direction
  const dirs = ['NE', 'E', 'SE', 'SW', 'W', 'NW']
  const roadDirs = []
  for (const dir of dirs) {
    if (def.edges[dir] === 'road') {
      roadDirs.push(dir)
    }
  }

  if (roadDirs.length !== 1) return { isDeadEnd: false }

  // Apply rotation to find actual exit direction
  const baseDirIndex = dirs.indexOf(roadDirs[0])
  const rotatedIndex = (baseDirIndex + rotation) % 6
  const exitDir = dirs[rotatedIndex]

  return { isDeadEnd: true, exitDir }
}

// Tree meshes organized by type and density (single -> small -> medium -> large)
const TreesByType = {
  A: ['tree_single_A', 'trees_A_small', 'trees_A_medium', 'trees_A_large'],
  B: ['tree_single_B', 'trees_B_small', 'trees_B_medium', 'trees_B_large'],
}

const TreeMeshNames = [...TreesByType.A, ...TreesByType.B]

// Building meshes
const BuildingDefs = [
  { name: 'building_home_A_yellow', weight: 10 },
  { name: 'building_home_B_yellow', weight: 6 },
  { name: 'building_church_yellow', weight: 2 },
  { name: 'building_tower_A_yellow', weight: 2 },
  { name: 'building_townhall_yellow', weight: 1 },
  { name: 'building_well_yellow', weight: 3 },
]

// Rural buildings — placed away from roads on flat grass
const RuralBuildingDefs = [
  // { name: 'building_shrine_yellow', weight: 1 },
]

const BuildingMeshNames = BuildingDefs.map(b => b.name)
const RuralBuildingMeshNames = RuralBuildingDefs.map(b => b.name)

// Windmill (3-part composite building)
const WindmillMeshNames = [
  'building_windmill_yellow',       // base
  'building_windmill_top_yellow',   // top section
  'building_windmill_top_fan_yellow', // fan blades
]
// Offsets relative to base (from GLB hierarchy transforms)
const WINDMILL_TOP_OFFSET = { x: 0, y: 0.685, z: 0 }
const WINDMILL_FAN_OFFSET = { x: 0, y: 0.957, z: 0.332 }

// Bridge meshes
const BridgeMeshNames = [
  'building_bridge_A',
  'building_bridge_B',
]

// Waterlily meshes (placed on river tiles)
const WaterlilyMeshNames = [
  'waterlily_A',
  'waterlily_B',
]

// Flower meshes (placed on grass tiles)
const FlowerMeshNames = [
  'waterplant_A',
  'waterplant_B',
  'waterplant_C',
]

// Rock meshes (placed near cliffs and slopes)
const RockMeshNames = [
  'rock_single_A',
  'rock_single_B',
  'rock_single_C',
  'rock_single_D',
  'rock_single_E',
]

// Hill meshes (placed on 1-level cliffs)
const HillDefs = [
  { name: 'hills_A', weight: 5 },
  { name: 'hills_A_trees', weight: 5 },
  { name: 'hills_B', weight: 5 },
  { name: 'hills_B_trees', weight: 5 },
  { name: 'hills_C', weight: 5 },
  { name: 'hills_C_trees', weight: 5 },
  { name: 'hill_single_A', weight: 5 },
  { name: 'hill_single_B', weight: 5 },
  { name: 'hill_single_C', weight: 5 },
]

// Mountain meshes (placed on 2-level cliffs)
const MountainDefs = [
  // { name: 'mountain_A', weight: 1 },
  // { name: 'mountain_B', weight: 1 },
  // { name: 'mountain_C', weight: 1 },
  { name: 'mountain_A_grass', weight: 3 },
  { name: 'mountain_B_grass', weight: 3 },
  { name: 'mountain_C_grass', weight: 3 },
  { name: 'mountain_A_grass_trees', weight: 2 },
  { name: 'mountain_B_grass_trees', weight: 2 },
  { name: 'mountain_C_grass_trees', weight: 2 },
]

const HillMeshNames = HillDefs.map(h => h.name)
const MountainMeshNames = MountainDefs.map(m => m.name)

// Default white color for decorations (no tinting)
const WHITE = new Color(0xffffff)
const _lvlColor = new Color()
function levelColor(level) {
  const blend = Math.min(level / (LEVELS_COUNT - 1), 1)
  _lvlColor.setRGB(blend, 1, 0)  // G=1 flags decoration (skip slopeContrib in shader)
  return _lvlColor
}

// Instance limits for BatchedMesh (per-type caps)
const MAX_TREES = 100
const MAX_BUILDINGS = 20
const MAX_BRIDGES = 30
const MAX_WATERLILIES = 10
const MAX_FLOWERS = 40
const MAX_ROCKS = 50
const MAX_HILLS = 10
const MAX_MOUNTAINS = 10

// Merged mesh limits (2 BMs total)
const MAX_TREE_INSTANCES = MAX_TREES + MAX_FLOWERS + 1   // treeMaterial: trees + flowers + dummy
const MAX_STATIC_INSTANCES = MAX_BUILDINGS + MAX_BRIDGES + MAX_WATERLILIES + MAX_ROCKS + MAX_HILLS + MAX_MOUNTAINS + 1  // material: everything else + dummy

export class Decorations {
  // Static geometry cache — extracted once from GLB, shared by all instances
  static cachedGeoms = null  // Map<meshName, geometry>

  static initGeometries(gltfScene) {
    if (Decorations.cachedGeoms) return  // Already initialized
    Decorations.cachedGeoms = new Map()

    const allMeshNames = [
      ...TreeMeshNames,
      ...BuildingMeshNames,
      ...RuralBuildingMeshNames,
      ...WindmillMeshNames,
      ...BridgeMeshNames,
      ...WaterlilyMeshNames,
      ...FlowerMeshNames,
      ...RockMeshNames,
      ...HillMeshNames,
      ...MountainMeshNames,
    ]

    // Windmill fan needs centering
    const centeredMeshes = new Set(['building_windmill_top_fan_yellow'])

    for (const meshName of allMeshNames) {
      let geom = null
      gltfScene.traverse((child) => {
        if (child.name === meshName && child.geometry) {
          geom = child.geometry.clone()
          geom.computeBoundingBox()
          if (centeredMeshes.has(meshName)) {
            const { min, max } = geom.boundingBox
            geom.translate(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -(min.z + max.z) / 2)
          } else {
            geom.translate(0, -geom.boundingBox.min.y, 0)
          }
          geom.computeBoundingSphere()
        }
      })
      if (geom) {
        // Sink mountain meshes so they appear shorter
        if (MountainMeshNames.includes(meshName)) {
          geom.translate(0, -0.5, 0)
        }
        Decorations.cachedGeoms.set(meshName, geom)
      } else {
        console.warn(`[Dec] NOT FOUND: ${meshName}`)
      }
    }

    console.log(`[GLB] Cached ${Decorations.cachedGeoms.size} decoration geometries`)
  }

  constructor(scene, worldOffset = { x: 0, z: 0 }) {
    this.scene = scene
    this.worldOffset = worldOffset

    // Two merged BatchedMeshes
    this.treeMesh = null        // treeMaterial: trees + flowers
    this.treeGeomIds = new Map()
    this.staticMesh = null      // material: buildings + bridges + waterlilies + rocks + hills + mountains
    this.staticGeomIds = new Map()

    // Per-type instance tracking (needed for per-type clears and populate logic)
    this.trees = []
    this.buildings = []
    this.windmillFans = []  // { instanceId, x, y, z, baseRotationY }
    this.bridges = []
    this.waterlilies = []
    this.flowers = []
    this.rocks = []
    this.hills = []
    this.mountains = []

    this.dummy = new Object3D()
  }

  // Safe addInstance — returns -1 if mesh is full
  _addInstance(mesh, geomId) {
    try {
      return mesh.addInstance(geomId)
    } catch (_) {
      return -1
    }
  }

  async init(material, treeMaterial = null) {
    const geoms = Decorations.cachedGeoms
    if (!geoms || geoms.size === 0) {
      console.warn('Decorations: No cached geometries (call Decorations.initGeometries first)')
      return
    }

    // Helper: collect cached geoms for a set of mesh names
    const collectGeoms = (meshNames) => {
      const map = new Map()
      for (const name of meshNames) {
        const geom = geoms.get(name)
        if (geom) map.set(name, geom)
      }
      return map
    }

    // Helper: create a BatchedMesh from a geometry map
    const createBatchedMesh = (geomMap, maxInstances, mat) => {
      let totalV = 0, totalI = 0
      for (const geom of geomMap.values()) {
        totalV += geom.attributes.position.count
        totalI += geom.index ? geom.index.count : 0
      }
      const mesh = new BatchedMesh(maxInstances, totalV * 2, totalI * 2, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      this.scene.add(mesh)

      const idMap = new Map()
      for (const [name, geom] of geomMap) {
        idMap.set(name, mesh.addGeometry(geom))
      }

      // Dummy white instance (fixes WebGPU color sync issue)
      const firstGeomId = idMap.values().next().value
      mesh._dummyInstanceId = mesh.addInstance(firstGeomId)
      mesh.setColorAt(mesh._dummyInstanceId, WHITE)
      this.dummy.position.set(0, -1000, 0)
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(mesh._dummyInstanceId, this.dummy.matrix)

      return { mesh, idMap }
    }

    // treeMesh: trees + flowers (treeMaterial — wind sway)
    const treeGeoms = collectGeoms([...TreeMeshNames, ...FlowerMeshNames])
    if (treeGeoms.size > 0) {
      const { mesh, idMap } = createBatchedMesh(treeGeoms, MAX_TREE_INSTANCES, treeMaterial || material)
      this.treeMesh = mesh
      this.treeGeomIds = idMap
    }

    // staticMesh: buildings + bridges + waterlilies + rocks + hills + mountains (material — no sway)
    const staticNames = [
      ...BuildingMeshNames, ...RuralBuildingMeshNames, ...WindmillMeshNames,
      ...BridgeMeshNames, ...WaterlilyMeshNames, ...RockMeshNames,
      ...HillMeshNames, ...MountainMeshNames,
    ]
    const staticGeoms = collectGeoms(staticNames)
    if (staticGeoms.size > 0) {
      const { mesh, idMap } = createBatchedMesh(staticGeoms, MAX_STATIC_INSTANCES, material)
      this.staticMesh = mesh
      this.staticGeomIds = idMap
    }
  }

  populate(hexTiles, gridRadius, options = {}) {
    this.clearTrees()
    this.dummy.rotation.set(0, 0, 0)  // Reset from windmill fan animation

    if (!this.treeMesh || this.treeGeomIds.size === 0) return
    if (!globalNoiseA || !globalNoiseB) return  // Need global noise initialized

    const threshold = currentTreeThreshold  // noise > threshold = tree
    const { x: offsetX, z: offsetZ } = this.worldOffset

    for (const tile of hexTiles) {
      // Only flat grass tiles (not slopes)
      if (tile.type !== TileType.GRASS) continue

      // Get local position (relative to grid group)
      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      // Use world position for noise sampling (consistent across grids)
      const worldX = localPos.x + offsetX
      const worldZ = localPos.z + offsetZ
      const noiseA = globalNoiseA.scaled2D(worldX, worldZ)
      const noiseB = globalNoiseB.scaled2D(worldX, worldZ)

      const aAbove = noiseA >= threshold
      const bAbove = noiseB >= threshold

      // Skip if neither noise field is above threshold
      if (!aAbove && !bAbove) continue

      // Determine tree type: if both overlap, higher noise value wins
      let treeType, noiseVal
      if (aAbove && bAbove) {
        treeType = noiseA >= noiseB ? 'A' : 'B'
        noiseVal = treeType === 'A' ? noiseA : noiseB
      } else if (aAbove) {
        treeType = 'A'
        noiseVal = noiseA
      } else {
        treeType = 'B'
        noiseVal = noiseB
      }

      // Check instance limit before adding
      if (this.trees.length >= MAX_TREES - 1) {  // -1 for dummy instance
        console.warn(`Decorations: Tree instance limit (${MAX_TREES}) reached`)
        break
      }

      // Map noise value to density tier (0-3)
      // threshold..1.0 maps to single -> small -> medium -> large
      const normalizedNoise = (noiseVal - threshold) / (1 - threshold)  // 0..1
      const tierIndex = Math.min(3, Math.floor(normalizedNoise * 4))
      const meshName = TreesByType[treeType][tierIndex]
      const geomId = this.treeGeomIds.get(meshName)
      const instanceId = this._addInstance(this.treeMesh, geomId)
      if (instanceId === -1) break
      this.treeMesh.setColorAt(instanceId, levelColor(tile.level))

      // Position at tile center with random offset (local coords since mesh is in group)
      const rotationY = 0 // random() * Math.PI * 2  // TEMP: disabled for wind debug
      random() // consume RNG to keep sequence stable
      const ox = (random() - 0.5) * 1.0
      const oz = (random() - 0.5) * 1.0
      this.dummy.position.set(
        localPos.x + ox,
        tile.level * LEVEL_HEIGHT + TILE_SURFACE,
        localPos.z + oz
      )
      this.dummy.rotation.y = rotationY
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()

      this.treeMesh.setMatrixAt(instanceId, this.dummy.matrix)
      this.trees.push({ tile, meshName, instanceId, rotationY, ox, oz })
    }
  }

  populateBuildings(hexTiles, hexGrid, gridRadius, options = {}) {
    this.clearBuildings()

    if (!this.staticMesh || this.staticGeomIds.size === 0) return

    const maxBuildings = options.maxBuildings ?? Math.floor(random() * 11)
    const maxRuralBuildings = Math.floor(random() * 4)  // 0-3
    const buildingNames = [...BuildingMeshNames].filter(n => this.staticGeomIds.has(n))
    const ruralNames = [...RuralBuildingMeshNames].filter(n => this.staticGeomIds.has(n))
    const hasWindmill = WindmillMeshNames.every(n => this.staticGeomIds.has(n))

    // Direction to Y-rotation mapping (building front is +Z, atan2(worldX, worldZ) for each hex dir)
    const dirToAngle = {
      'NE': 5 * Math.PI / 6,
      'E': Math.PI / 2,
      'SE': Math.PI / 6,
      'SW': -Math.PI / 6,
      'W': -Math.PI / 2,
      'NW': -5 * Math.PI / 6,
    }

    const deadEndCandidates = []
    const roadAdjacentCandidates = []
    const coastWindmillCandidates = []
    const flatGrassCandidates = []
    const size = gridRadius * 2 + 1

    // Get tiles that already have trees
    const treeTileIds = new Set(this.trees.map(t => t.tile.id))

    for (const tile of hexTiles) {
      // Skip tiles that already have trees
      if (treeTileIds.has(tile.id)) continue

      // Check for road dead-ends - place building facing the road exit
      const deadEndInfo = getRoadDeadEndInfo(tile.type, tile.rotation)
      if (deadEndInfo.isDeadEnd) {
        const roadAngle = dirToAngle[deadEndInfo.exitDir] ?? 0
        deadEndCandidates.push({ tile, roadAngle })
        continue
      }

      // Only consider grass tiles for road-adjacent placement
      if (tile.type !== TileType.GRASS) continue

      // Check if any hex neighbor has a road, track direction to road
      let roadAngle = null
      for (const dir of HexDir) {
        const { dx, dz } = getHexNeighborOffset(tile.gridX, tile.gridZ, dir)
        const nx = tile.gridX + dx
        const nz = tile.gridZ + dz
        if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
          const neighbor = hexGrid[nx]?.[nz]
          if (neighbor && hasRoadEdge(neighbor.type)) {
            roadAngle = dirToAngle[dir]
            break
          }
        }
      }

      // Check if any hex neighbor is coast/ocean — windmill candidate facing the water
      let waterAngle = null
      for (const dir of HexDir) {
        const { dx, dz } = getHexNeighborOffset(tile.gridX, tile.gridZ, dir)
        const nx = tile.gridX + dx
        const nz = tile.gridZ + dz
        if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
          const neighbor = hexGrid[nx]?.[nz]
          if (neighbor && isCoastOrOcean(neighbor.type)) {
            waterAngle = dirToAngle[dir]
            break
          }
        }
      }

      if (waterAngle !== null && tile.level === 0) {
        coastWindmillCandidates.push({ tile, roadAngle: waterAngle })
      } else if (roadAngle !== null) {
        roadAdjacentCandidates.push({ tile, roadAngle })
      } else if (tile.level === 0) {
        // Flat grass with no road neighbor — lowest priority
        const randomAngle = random() * Math.PI * 2
        flatGrassCandidates.push({ tile, roadAngle: randomAngle })
      }
    }

    // Shuffle each group separately
    shuffle(deadEndCandidates)
    shuffle(roadAdjacentCandidates)
    shuffle(flatGrassCandidates)
    shuffle(coastWindmillCandidates)

    // Dead-ends first, then road-adjacent (no flat grass for road buildings)
    const candidates = [...deadEndCandidates, ...roadAdjacentCandidates]

    // Place road buildings (no windmills — those are coast-only)
    for (let i = 0; i < Math.min(maxBuildings, candidates.length); i++) {
      const { tile, roadAngle } = candidates[i]

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE

      const meshName = weightedPick(BuildingDefs)
      const geomId = this.staticGeomIds.get(meshName)
      const instanceId = this._addInstance(this.staticMesh, geomId)
      if (instanceId === -1) break
      this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

      this.dummy.position.set(localPos.x, baseY, localPos.z)
      this.dummy.rotation.y = roadAngle
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()

      this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
      this.buildings.push({ tile, meshName, instanceId, rotationY: roadAngle })
    }

    // Place rural buildings (shrine, tent, well) on flat grass away from roads
    if (ruralNames.length > 0) {
      for (let i = 0; i < Math.min(maxRuralBuildings, flatGrassCandidates.length); i++) {
        const { tile, roadAngle } = flatGrassCandidates[i]
        const localPos = HexTileGeometry.getWorldPosition(
          tile.gridX - gridRadius,
          tile.gridZ - gridRadius
        )
        const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE

        const meshName = weightedPick(RuralBuildingDefs)
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) break
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = roadAngle
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()

        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.buildings.push({ tile, meshName, instanceId, rotationY: roadAngle })
      }
    }

    // Place windmills on coast-adjacent grass tiles, facing the water
    if (hasWindmill && coastWindmillCandidates.length > 0) {
      const maxCoastWindmills = Math.min(1, coastWindmillCandidates.length)
      for (let i = 0; i < maxCoastWindmills; i++) {
        const { tile, roadAngle: waterAngle } = coastWindmillCandidates[i]
        const localPos = HexTileGeometry.getWorldPosition(
          tile.gridX - gridRadius,
          tile.gridZ - gridRadius
        )
        const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE

        // Place windmill base
        const baseGeomId = this.staticGeomIds.get('building_windmill_yellow')
        const baseInstanceId = this._addInstance(this.staticMesh, baseGeomId)
        if (baseInstanceId === -1) break
        this.staticMesh.setColorAt(baseInstanceId, levelColor(tile.level))
        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = waterAngle
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(baseInstanceId, this.dummy.matrix)
        this.buildings.push({ tile, meshName: 'building_windmill_yellow', instanceId: baseInstanceId, rotationY: waterAngle, oy: 0 })

        // Place windmill top
        const topGeomId = this.staticGeomIds.get('building_windmill_top_yellow')
        const topInstanceId = this._addInstance(this.staticMesh, topGeomId)
        if (topInstanceId === -1) break
        this.staticMesh.setColorAt(topInstanceId, levelColor(tile.level))
        const cosA = Math.cos(waterAngle), sinA = Math.sin(waterAngle)
        const topOx = WINDMILL_TOP_OFFSET.x * cosA + WINDMILL_TOP_OFFSET.z * sinA
        const topOz = -WINDMILL_TOP_OFFSET.x * sinA + WINDMILL_TOP_OFFSET.z * cosA
        this.dummy.position.set(localPos.x + topOx, baseY + WINDMILL_TOP_OFFSET.y, localPos.z + topOz)
        this.dummy.rotation.y = waterAngle
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(topInstanceId, this.dummy.matrix)
        this.buildings.push({ tile, meshName: 'building_windmill_top_yellow', instanceId: topInstanceId, rotationY: waterAngle, oy: WINDMILL_TOP_OFFSET.y })

        // Place windmill fan
        const fanGeomId = this.staticGeomIds.get('building_windmill_top_fan_yellow')
        const fanInstanceId = this._addInstance(this.staticMesh, fanGeomId)
        if (fanInstanceId === -1) break
        this.staticMesh.setColorAt(fanInstanceId, levelColor(tile.level))
        const fanOx = WINDMILL_FAN_OFFSET.x * cosA + WINDMILL_FAN_OFFSET.z * sinA
        const fanOz = -WINDMILL_FAN_OFFSET.x * sinA + WINDMILL_FAN_OFFSET.z * cosA
        const fanX = localPos.x + fanOx
        const fanY = baseY + WINDMILL_FAN_OFFSET.y
        const fanZ = localPos.z + fanOz
        this.dummy.position.set(fanX, fanY, fanZ)
        this.dummy.rotation.y = waterAngle
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(fanInstanceId, this.dummy.matrix)
        this.buildings.push({ tile, meshName: 'building_windmill_top_fan_yellow', instanceId: fanInstanceId, rotationY: waterAngle, oy: WINDMILL_FAN_OFFSET.y, oz: fanOz, ox: fanOx })
        const fan = { instanceId: fanInstanceId, x: fanX, y: fanY, z: fanZ, baseRotationY: waterAngle, spin: { angle: 0 } }
        fan.tween = gsap.to(fan.spin, {
          angle: Math.PI * 2,
          duration: 4,
          repeat: -1,
          ease: 'none',
          onUpdate: () => {
            this.dummy.position.set(fan.x, fan.y, fan.z)
            this.dummy.rotation.set(0, fan.baseRotationY, 0)
            this.dummy.rotateZ(fan.spin.angle)
            this.dummy.scale.setScalar(1)
            this.dummy.updateMatrix()
            try { this.staticMesh.setMatrixAt(fan.instanceId, this.dummy.matrix) } catch (_) {}
          }
        })
        this.windmillFans.push(fan)
      }
    }
  }

  populateBridges(hexTiles, gridRadius) {
    this.clearBridges()

    if (!this.staticMesh || this.staticGeomIds.size === 0) return

    for (const tile of hexTiles) {
      // Only river crossing tiles
      if (tile.type !== TileType.RIVER_CROSSING_A &&
          tile.type !== TileType.RIVER_CROSSING_B) continue

      // Pick matching bridge mesh
      const meshName = tile.type === TileType.RIVER_CROSSING_A
        ? 'building_bridge_A'
        : 'building_bridge_B'

      const geomId = this.staticGeomIds.get(meshName)
      if (geomId === undefined) continue

      const instanceId = this._addInstance(this.staticMesh, geomId)
      if (instanceId === -1) break
      this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )

      this.dummy.position.set(
        localPos.x,
        tile.level * LEVEL_HEIGHT,
        localPos.z
      )
      // Match tile rotation (60° steps, same as hex tiles)
      this.dummy.rotation.y = -tile.rotation * Math.PI / 3
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()

      this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
      this.bridges.push({ tile, meshName, instanceId })
    }
  }

  populateWaterlilies(hexTiles, gridRadius) {
    this.clearWaterlilies()

    if (!this.staticMesh || this.staticGeomIds.size === 0) return

    const lilyNames = WaterlilyMeshNames.filter(n => this.staticGeomIds.has(n))

    for (const tile of hexTiles) {
      // River tiles (not crossings — those have bridges) and coast tiles
      const tileDef = TILE_LIST[tile.type]
      const tileName = tileDef?.name
      if (!tileName) continue
      if (tileDef.debug !== undefined) continue  // Skip debug tiles
      const isRiver = tileName.startsWith('RIVER_') && !tileName.startsWith('RIVER_CROSSING')
      const isCoast = tileName.startsWith('COAST_')
      if (!isRiver && !isCoast) continue

      // Random chance to skip (not every river tile gets lilies)
      if (random() > 0.075) continue

      if (this.waterlilies.length >= MAX_WATERLILIES - 1) break

      const meshName = lilyNames[Math.floor(random() * lilyNames.length)]
      const geomId = this.staticGeomIds.get(meshName)
      const instanceId = this._addInstance(this.staticMesh, geomId)
      if (instanceId === -1) break
      this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const ox = (random() - 0.5) * 0.3
      const oz = (random() - 0.5) * 0.3
      const rotationY = random() * Math.PI * 2

      this.dummy.position.set(localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE - 0.2, localPos.z + oz)
      this.dummy.rotation.y = rotationY
      this.dummy.scale.setScalar(2)
      this.dummy.updateMatrix()

      this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
      this.waterlilies.push({ tile, meshName, instanceId, rotationY, ox: ox, oz: oz })
    }
  }

  populateFlowers(hexTiles, gridRadius) {
    this.clearFlowers()

    if (!this.treeMesh || this.treeGeomIds.size === 0) return

    const flowerNames = FlowerMeshNames.filter(n => this.treeGeomIds.has(n))
    const { x: offsetX, z: offsetZ } = this.worldOffset
    const hasNoise = globalNoiseA && globalNoiseB

    // Exclude tiles with buildings only (flowers can share with trees)
    const buildingTileIds = new Set(this.buildings.map(b => b.tile.id))

    // Score candidate tiles by noise value
    const candidates = []
    for (const tile of hexTiles) {
      if (tile.type !== TileType.GRASS) continue
      if (buildingTileIds.has(tile.id)) continue

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      let noise = random()
      if (hasNoise) {
        const worldX = localPos.x + offsetX
        const worldZ = localPos.z + offsetZ
        noise = Math.max(globalNoiseA.scaled2D(worldX, worldZ), globalNoiseB.scaled2D(worldX, worldZ))
      }
      candidates.push({ tile, localPos, noise })
    }

    // Sort by closeness to just below tree threshold (tight forest edges)
    const target = currentTreeThreshold + 0.05
    candidates.sort((a, b) => Math.abs(a.noise - target) - Math.abs(b.noise - target))
    const budget = 7 + Math.floor(random() * 15)  // 7-21
    const selected = candidates.slice(0, budget)

    for (const { tile, localPos, noise } of selected) {
      // Higher noise = more flowers per tile (1-3)
      const count = 1 + Math.floor(noise * 2.99)

      for (let f = 0; f < count; f++) {
        if (this.flowers.length >= MAX_FLOWERS - 1) break

        const meshName = flowerNames[Math.floor(random() * flowerNames.length)]
        const geomId = this.treeGeomIds.get(meshName)
        const instanceId = this._addInstance(this.treeMesh, geomId)
        if (instanceId === -1) break
        this.treeMesh.setColorAt(instanceId, levelColor(tile.level))

        const ox = (random() - 0.5) * 1.6
        const oz = (random() - 0.5) * 1.6
        const rotationY = random() * Math.PI * 2

        this.dummy.position.set(localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE, localPos.z + oz)
        this.dummy.rotation.y = rotationY
        this.dummy.scale.setScalar(2)
        this.dummy.updateMatrix()

        this.treeMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.flowers.push({ tile, meshName, instanceId, rotationY, ox, oz })
      }
    }
  }

  populateRocks(hexTiles, gridRadius) {
    this.clearRocks()

    if (!this.staticMesh || this.staticGeomIds.size === 0) return

    const rockNames = RockMeshNames.filter(n => this.staticGeomIds.has(n))
    const treeTileIds = new Set(this.trees.map(t => t.tile.id))

    // Collect candidate tiles: cliffs, coasts, rivers, tree tiles
    const candidates = []
    for (const tile of hexTiles) {
      const def = TILE_LIST[tile.type]
      if (!def) continue
      if (def.debug !== undefined) continue  // Skip debug tiles
      const name = def.name
      const isCliff = name.includes('CLIFF')
      const isCoast = name.startsWith('COAST_')
      const isRiver = name.startsWith('RIVER_') && !name.startsWith('RIVER_CROSSING')
      const hasTree = treeTileIds.has(tile.id)
      if (!isCliff && !isCoast && !isRiver && !hasTree) continue
      candidates.push(tile)
    }

    // Shuffle and pick up to 20 tiles
    shuffle(candidates)
    const budget = Math.min(10, candidates.length)

    for (let i = 0; i < budget; i++) {
      const tile = candidates[i]
      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const count = 1 + Math.floor(random() * 2)  // 1-2 per tile

      for (let r = 0; r < count; r++) {
        if (this.rocks.length >= MAX_ROCKS - 1) break

        const meshName = rockNames[Math.floor(random() * rockNames.length)]
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) break
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        const ox = (random() - 0.5) * 1.2
        const oz = (random() - 0.5) * 1.2
        const rotationY = random() * Math.PI * 2

        const tileName = TILE_LIST[tile.type]?.name || ''
        const surfaceDip = tileName === 'OCEAN' ? -0.2 : (tileName.startsWith('COAST_') || tileName.startsWith('RIVER_')) ? -0.1 : 0
        this.dummy.position.set(localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE + surfaceDip, localPos.z + oz)
        this.dummy.rotation.y = rotationY
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()

        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.rocks.push({ tile, meshName, instanceId, rotationY, ox, oz })
      }
    }
  }

  populateHillsAndMountains(hexTiles, gridRadius) {
    this.clearHills()
    this.clearMountains()

    const hillNames = HillMeshNames.filter(n => this.staticGeomIds.has(n))
    const mountainNames = MountainMeshNames.filter(n => this.staticGeomIds.has(n))
    const hasHills = this.staticMesh && hillNames.length > 0
    const hasMountains = this.staticMesh && mountainNames.length > 0

    if (!hasHills && !hasMountains) return

    for (const tile of hexTiles) {
      const def = TILE_LIST[tile.type]
      if (!def) continue
      if (def.debug !== undefined) continue  // Skip debug tiles

      const isCliff = def.levelIncrement && def.name.includes('CLIFF')
      const isRiverEnd = def.name === 'RIVER_END'
      const isHighGrass = def.name === 'GRASS' && tile.level >= LEVELS_COUNT - 1

      if (!isCliff && !isRiverEnd && !isHighGrass) continue

      // 10% for cliffs, 30% for river ends, 15% for high grass
      const chance = isRiverEnd ? 0.3 : isHighGrass ? 0.1 : 0.1
      if (random() > chance) continue

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
      const rotationY = Math.floor(random() * 6) * Math.PI / 3

      // High grass gets mountains
      if (isHighGrass && hasMountains) {
        if (this.mountains.length >= MAX_MOUNTAINS - 1) continue

        const meshName = weightedPick(MountainDefs)
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) continue
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = Math.floor(random() * 6) * Math.PI / 3
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.mountains.push({ tile, meshName, instanceId, rotationY: this.dummy.rotation.y })
        continue
      }

      // River ends get hills
      if (isRiverEnd && hasHills) {
        if (this.hills.length >= MAX_HILLS - 1) continue

        const meshName = weightedPick(HillDefs)
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) continue
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = rotationY
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.hills.push({ tile, meshName, instanceId, rotationY })
        continue
      }

      if (def.levelIncrement >= 2 && hasMountains) {
        if (this.mountains.length >= MAX_MOUNTAINS - 1) continue

        const meshName = weightedPick(MountainDefs)
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) continue
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = Math.floor(random() * 6) * Math.PI / 3
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.mountains.push({ tile, meshName, instanceId, rotationY })
      } else if (def.levelIncrement === 1 && hasHills) {
        if (this.hills.length >= MAX_HILLS - 1) continue

        const meshName = weightedPick(HillDefs)
        const geomId = this.staticGeomIds.get(meshName)
        const instanceId = this._addInstance(this.staticMesh, geomId)
        if (instanceId === -1) continue
        this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

        this.dummy.position.set(localPos.x, baseY, localPos.z)
        this.dummy.rotation.y = rotationY
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
        this.hills.push({ tile, meshName, instanceId, rotationY })
      }
    }
  }

  clear() {
    this.clearTrees()
    this.clearBuildings()
    this.clearBridges()
    this.clearWaterlilies()
    this.clearFlowers()
    this.clearRocks()
    this.clearHills()
    this.clearMountains()
  }

  clearTrees() {
    if (!this.treeMesh) return
    for (const tree of this.trees) {
      this.treeMesh.deleteInstance(tree.instanceId)
    }
    this.trees = []
  }

  clearBuildings() {
    if (!this.staticMesh) return
    for (const fan of this.windmillFans) {
      if (fan.tween) fan.tween.kill()
    }
    this.windmillFans = []
    for (const building of this.buildings) {
      this.staticMesh.deleteInstance(building.instanceId)
    }
    this.buildings = []
  }

  clearBridges() {
    if (!this.staticMesh) return
    for (const bridge of this.bridges) {
      this.staticMesh.deleteInstance(bridge.instanceId)
    }
    this.bridges = []
  }

  clearWaterlilies() {
    if (!this.staticMesh) return
    for (const lily of this.waterlilies) {
      this.staticMesh.deleteInstance(lily.instanceId)
    }
    this.waterlilies = []
  }

  clearFlowers() {
    if (!this.treeMesh) return
    for (const flower of this.flowers) {
      this.treeMesh.deleteInstance(flower.instanceId)
    }
    this.flowers = []
  }

  clearRocks() {
    if (!this.staticMesh) return
    for (const rock of this.rocks) {
      this.staticMesh.deleteInstance(rock.instanceId)
    }
    this.rocks = []
  }

  clearHills() {
    if (!this.staticMesh) return
    for (const hill of this.hills) {
      this.staticMesh.deleteInstance(hill.instanceId)
    }
    this.hills = []
  }

  clearMountains() {
    if (!this.staticMesh) return
    for (const mountain of this.mountains) {
      this.staticMesh.deleteInstance(mountain.instanceId)
    }
    this.mountains = []
  }

  /**
   * Add a bridge on a single tile if it's a river crossing
   * @param {HexTile} tile - Tile to check
   * @param {number} gridRadius - Grid radius for position calculation
   */
  addBridgeAt(tile, gridRadius) {
    if (!this.staticMesh || this.staticGeomIds.size === 0) return
    if (tile.type !== TileType.RIVER_CROSSING_A &&
        tile.type !== TileType.RIVER_CROSSING_B) return

    const meshName = tile.type === TileType.RIVER_CROSSING_A
      ? 'building_bridge_A'
      : 'building_bridge_B'

    const geomId = this.staticGeomIds.get(meshName)
    if (geomId === undefined) return

    const instanceId = this._addInstance(this.staticMesh, geomId)
    if (instanceId === -1) return
    this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

    const localPos = HexTileGeometry.getWorldPosition(
      tile.gridX - gridRadius,
      tile.gridZ - gridRadius
    )
    this.dummy.position.set(localPos.x, tile.level * LEVEL_HEIGHT, localPos.z)
    this.dummy.rotation.y = -tile.rotation * Math.PI / 3
    this.dummy.scale.setScalar(1)
    this.dummy.updateMatrix()

    this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
    this.bridges.push({ tile, meshName, instanceId })
  }

  /**
   * Place a random mountain on a specific tile (used to hide dropped cells)
   */
  addMountainAt(tile, gridRadius) {
    if (!this.staticMesh || this.staticGeomIds.size === 0) return

    const mountainNames = MountainMeshNames.filter(n => this.staticGeomIds.has(n))
    if (mountainNames.length === 0) return

    const meshName = weightedPick(MountainDefs)
    const geomId = this.staticGeomIds.get(meshName)
    if (geomId === undefined) return

    const instanceId = this._addInstance(this.staticMesh, geomId)
    if (instanceId === -1) return
    this.staticMesh.setColorAt(instanceId, levelColor(tile.level))

    const localPos = HexTileGeometry.getWorldPosition(
      tile.gridX - gridRadius,
      tile.gridZ - gridRadius
    )
    const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
    const rotY = Math.floor(random() * 6) * Math.PI / 3
    this.dummy.position.set(localPos.x, baseY, localPos.z)
    this.dummy.rotation.y = rotY
    this.dummy.scale.setScalar(1)
    this.dummy.updateMatrix()
    this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
    this.mountains.push({ tile, meshName, instanceId, rotationY: rotY })
  }

  /**
   * Re-populate decorations for specific tiles (clear + re-add)
   * Used after click-to-solve replaces tiles in a small region
   * @param {Array} tiles - HexTile objects to repopulate
   * @param {number} gridRadius - Grid radius for position calculation
   * @param {Array} hexGrid - 2D grid array for neighbor lookups (needed for buildings)
   */
  repopulateTilesAt(tiles, gridRadius, hexGrid) {
    for (const tile of tiles) {
      this.clearDecorationsAt(tile.gridX, tile.gridZ)
    }

    const { x: offsetX, z: offsetZ } = this.worldOffset
    const newItems = []
    const treeTileIds = new Set()

    for (const tile of tiles) {
      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const def = TILE_LIST[tile.type]
      if (!def) continue
      if (def.debug !== undefined) continue  // Skip debug tiles
      const name = def.name

      // Trees (noise-based, same as populate)
      if (tile.type === TileType.GRASS && this.treeMesh && globalNoiseA && globalNoiseB) {
        const worldX = localPos.x + offsetX
        const worldZ = localPos.z + offsetZ
        const noiseA = globalNoiseA.scaled2D(worldX, worldZ)
        const noiseB = globalNoiseB.scaled2D(worldX, worldZ)
        const threshold = currentTreeThreshold
        const aAbove = noiseA >= threshold
        const bAbove = noiseB >= threshold

        if (aAbove || bAbove) {
          let treeType, noiseVal
          if (aAbove && bAbove) {
            treeType = noiseA >= noiseB ? 'A' : 'B'
            noiseVal = treeType === 'A' ? noiseA : noiseB
          } else if (aAbove) { treeType = 'A'; noiseVal = noiseA }
          else { treeType = 'B'; noiseVal = noiseB }

          if (this.trees.length < MAX_TREES - 1) {
            const normalizedNoise = (noiseVal - threshold) / (1 - threshold)
            const tierIndex = Math.min(3, Math.floor(normalizedNoise * 4))
            const meshName = TreesByType[treeType][tierIndex]
            const geomId = this.treeGeomIds.get(meshName)
            const instanceId = this._addInstance(this.treeMesh, geomId)
            if (instanceId !== -1) {
              this.treeMesh.setColorAt(instanceId, levelColor(tile.level))
              random() // consume for rotation (kept stable)
              const ox = (random() - 0.5) * 1.0
              const oz = (random() - 0.5) * 1.0
              const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
              this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
              this.dummy.rotation.set(0, 0, 0)
              this.dummy.scale.setScalar(1)
              this.dummy.updateMatrix()
              this.treeMesh.setMatrixAt(instanceId, this.dummy.matrix)
              this.trees.push({ tile, meshName, instanceId, rotationY: 0, ox, oz })
              newItems.push({ mesh: this.treeMesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY: 0 })
              treeTileIds.add(tile.id)
            }
          }
        }
      }

      // Buildings (road dead-ends and road-adjacent grass, skip tiles with trees)
      if (this.staticMesh && this.buildings.length < MAX_BUILDINGS - 1 && !treeTileIds.has(tile.id)) {
        const dirToAngle = { NE: 5*Math.PI/6, E: Math.PI/2, SE: Math.PI/6, SW: -Math.PI/6, W: -Math.PI/2, NW: -5*Math.PI/6 }
        const size = gridRadius * 2 + 1
        let buildingAngle = null

        const deadEndInfo = getRoadDeadEndInfo(tile.type, tile.rotation)
        if (deadEndInfo.isDeadEnd) {
          buildingAngle = dirToAngle[deadEndInfo.exitDir] ?? 0
        } else if (tile.type === TileType.GRASS && hexGrid) {
          for (const dir of HexDir) {
            const { dx, dz } = getHexNeighborOffset(tile.gridX, tile.gridZ, dir)
            const nx = tile.gridX + dx
            const nz = tile.gridZ + dz
            if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
              const neighbor = hexGrid[nx]?.[nz]
              if (neighbor && hasRoadEdge(neighbor.type)) {
                buildingAngle = dirToAngle[dir]
                break
              }
            }
          }
        }

        if (buildingAngle !== null && random() <= 0.4) {
          const meshName = weightedPick(BuildingDefs)
          const geomId = this.staticGeomIds.get(meshName)
          if (geomId !== undefined) {
            const instanceId = this._addInstance(this.staticMesh, geomId)
            if (instanceId !== -1) {
              this.staticMesh.setColorAt(instanceId, levelColor(tile.level))
              const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
              this.dummy.position.set(localPos.x, y, localPos.z)
              this.dummy.rotation.y = buildingAngle
              this.dummy.scale.setScalar(1)
              this.dummy.updateMatrix()
              this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
              this.buildings.push({ tile, meshName, instanceId, rotationY: buildingAngle })
              newItems.push({ mesh: this.staticMesh, instanceId, x: localPos.x, y, z: localPos.z, rotationY: buildingAngle })
            }
          }
        }
      }

      // Bridges
      const bridgeCountBefore = this.bridges.length
      this.addBridgeAt(tile, gridRadius)
      if (this.bridges.length > bridgeCountBefore) {
        const bridge = this.bridges[this.bridges.length - 1]
        const bPos = HexTileGeometry.getWorldPosition(tile.gridX - gridRadius, tile.gridZ - gridRadius)
        newItems.push({ mesh: this.staticMesh, instanceId: bridge.instanceId, x: bPos.x, y: tile.level * LEVEL_HEIGHT, z: bPos.z, rotationY: -tile.rotation * Math.PI / 3 })
      }

      // Waterlilies
      const isRiver = name.startsWith('RIVER_') && !name.startsWith('RIVER_CROSSING')
      const isCoast = name.startsWith('COAST_')
      if ((isRiver || isCoast) && this.staticMesh && random() <= 0.075) {
        const lilyNames = WaterlilyMeshNames.filter(n => this.staticGeomIds.has(n))
        if (lilyNames.length > 0 && this.waterlilies.length < MAX_WATERLILIES - 1) {
          const meshName = lilyNames[Math.floor(random() * lilyNames.length)]
          const geomId = this.staticGeomIds.get(meshName)
          const instanceId = this._addInstance(this.staticMesh, geomId)
          if (instanceId !== -1) {
            this.staticMesh.setColorAt(instanceId, levelColor(tile.level))
            const ox = (random() - 0.5) * 0.3
            const oz = (random() - 0.5) * 0.3
            const rotationY = random() * Math.PI * 2
            const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE - 0.2
            this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
            this.dummy.rotation.y = rotationY
            this.dummy.scale.setScalar(2)
            this.dummy.updateMatrix()
            this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
            this.waterlilies.push({ tile, meshName, instanceId, rotationY, ox, oz })
            newItems.push({ mesh: this.staticMesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY, scale: 2 })
          }
        }
      }

      // Hills and mountains
      const isCliff = def.levelIncrement && name.includes('CLIFF')
      const isRiverEnd = name === 'RIVER_END'
      const isHighGrass = name === 'GRASS' && tile.level >= 2
      if ((isCliff || isRiverEnd || isHighGrass) && this.staticMesh) {
        const chance = isRiverEnd ? 0.3 : isHighGrass ? 0.1 : 0.1
        if (random() <= chance) {
          if (isHighGrass) {
            const mtCountBefore = this.mountains.length
            this.addMountainAt(tile, gridRadius)
            if (this.mountains.length > mtCountBefore) {
              const mt = this.mountains[this.mountains.length - 1]
              newItems.push({ mesh: this.staticMesh, instanceId: mt.instanceId, x: localPos.x, y: tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: localPos.z, rotationY: mt.rotationY })
            }
          } else {
            const hillNames = HillMeshNames.filter(n => this.staticGeomIds.has(n))
            if (hillNames.length > 0 && this.hills.length < MAX_HILLS - 1) {
              const meshName = weightedPick(HillDefs)
              const geomId = this.staticGeomIds.get(meshName)
              const instanceId = this._addInstance(this.staticMesh, geomId)
              if (instanceId !== -1) {
                this.staticMesh.setColorAt(instanceId, levelColor(tile.level))
                const rotationY = Math.floor(random() * 6) * Math.PI / 3
                const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
                this.dummy.position.set(localPos.x, y, localPos.z)
                this.dummy.rotation.y = rotationY
                this.dummy.scale.setScalar(1)
                this.dummy.updateMatrix()
                this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
                this.hills.push({ tile, meshName, instanceId, rotationY })
                newItems.push({ mesh: this.staticMesh, instanceId, x: localPos.x, y, z: localPos.z, rotationY })
              }
            }
          }
        }
      }

      // Rocks
      if ((name.includes('CLIFF') || isCoast || isRiver) && this.staticMesh) {
        const rockNames = RockMeshNames.filter(n => this.staticGeomIds.has(n))
        if (rockNames.length > 0 && random() <= 0.3 && this.rocks.length < MAX_ROCKS - 1) {
          const meshName = rockNames[Math.floor(random() * rockNames.length)]
          const geomId = this.staticGeomIds.get(meshName)
          const instanceId = this._addInstance(this.staticMesh, geomId)
          if (instanceId !== -1) {
            this.staticMesh.setColorAt(instanceId, levelColor(tile.level))
            const ox = (random() - 0.5) * 1.2
            const oz = (random() - 0.5) * 1.2
            const rotationY = random() * Math.PI * 2
            const surfaceDip = (name === 'OCEAN') ? -0.2 : (isCoast || isRiver) ? -0.1 : 0
            const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE + surfaceDip
            this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
            this.dummy.rotation.y = rotationY
            this.dummy.scale.setScalar(1)
            this.dummy.updateMatrix()
            this.staticMesh.setMatrixAt(instanceId, this.dummy.matrix)
            this.rocks.push({ tile, meshName, instanceId, rotationY, ox, oz })
            newItems.push({ mesh: this.staticMesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY })
          }
        }
      }
    }

    // Hide new items so they don't flash at final position before animation
    for (const item of newItems) {
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      item.mesh.setMatrixAt(item.instanceId, this.dummy.matrix)
    }

    return newItems
  }

  /**
   * Remove decorations only on a specific tile position
   * @param {number} gridX - Tile grid X
   * @param {number} gridZ - Tile grid Z
   */
  clearDecorationsAt(gridX, gridZ) {
    const match = (item) => item.tile.gridX === gridX && item.tile.gridZ === gridZ

    // treeMesh: trees + flowers
    if (this.treeMesh) {
      this.trees = this.trees.filter(t => {
        if (match(t)) { this.treeMesh.deleteInstance(t.instanceId); return false }
        return true
      })
      this.flowers = this.flowers.filter(f => {
        if (match(f)) { this.treeMesh.deleteInstance(f.instanceId); return false }
        return true
      })
    }

    // staticMesh: buildings + bridges + waterlilies + rocks + hills + mountains
    if (this.staticMesh) {
      this.buildings = this.buildings.filter(b => {
        if (match(b)) { this.staticMesh.deleteInstance(b.instanceId); return false }
        return true
      })
      this.bridges = this.bridges.filter(b => {
        if (match(b)) { this.staticMesh.deleteInstance(b.instanceId); return false }
        return true
      })
      this.waterlilies = this.waterlilies.filter(l => {
        if (match(l)) { this.staticMesh.deleteInstance(l.instanceId); return false }
        return true
      })
      this.rocks = this.rocks.filter(r => {
        if (match(r)) { this.staticMesh.deleteInstance(r.instanceId); return false }
        return true
      })
      this.hills = this.hills.filter(h => {
        if (match(h)) { this.staticMesh.deleteInstance(h.instanceId); return false }
        return true
      })
      this.mountains = this.mountains.filter(m => {
        if (match(m)) { this.staticMesh.deleteInstance(m.instanceId); return false }
        return true
      })
    }
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.clear()

    if (this.treeMesh) {
      this.scene.remove(this.treeMesh)
      this.treeMesh.dispose()
      this.treeMesh = null
    }

    if (this.staticMesh) {
      this.scene.remove(this.staticMesh)
      this.staticMesh.dispose()
      this.staticMesh = null
    }

    this.treeGeomIds.clear()
    this.staticGeomIds.clear()
  }
}
