import { Object3D, BatchedMesh, Matrix4 } from 'three/webgpu'
import { TILE_LIST, TileType, HexDir, getHexNeighborOffset, rotateHexEdges, LEVELS_COUNT } from './HexTileData.js'
import { HexTileGeometry } from './HexTiles.js'
import { random, shuffle } from '../SeededRandom.js'
import { createTreeGeometry, detailTerrain } from './NaturalGeometry.js'
import gsap from 'gsap'
import {
  LEVEL_HEIGHT, TILE_SURFACE, HIGH_GRASS_MOUNTAIN_CHANCE,
  decorationSettings, hillDefinitions, decorationAllowed,
  globalNoiseA, globalNoiseB, globalNoiseC,
  getCurrentTreeThreshold, getBuildingThreshold,
  weightedPick, isCoastOrWater, getRoadDeadEndInfo,
  TreesByType, TreeMeshNames,
  BuildingDefs, CoastBuildingDefs, BuildingMeshNames, CoastBuildingMeshNames,
  TOWER_TOP_MESH, TOWER_TOP_CHANCE,
  WindmillMeshNames, WINDMILL_TOP_OFFSET, WINDMILL_FAN_OFFSET,
  BridgeMeshNames, WaterlilyMeshNames, FlowerMeshNames, RockMeshNames,
  HillDefs, MountainDefs, HillMeshNames, MountainMeshNames, RiverEndDefs,
  RareBuildingNames, RareBuildingDefs2,
  WHITE, levelColor,
  MAX_TREES, MAX_BUILDINGS, MAX_BRIDGES, MAX_WATERLILIES, MAX_FLOWERS, MAX_ROCKS, MAX_HILLS, MAX_MOUNTAINS,
  MAX_DEC_INSTANCES,
} from './DecorationDefs.js'

// Re-export noise functions so existing imports from Decorations.js still work
export { initGlobalTreeNoise, rebuildNoiseTables, setTreeNoiseFrequency, getTreeNoiseFrequency, setTreeThreshold, getTreeThreshold, setBuildingNoiseFrequency, getBuildingNoiseFrequency, setBuildingThreshold, getBuildingThreshold } from './DecorationDefs.js'

export class Decorations {
  // Static geometry cache — extracted once from GLB, shared by all instances
  static cachedGeoms = null  // Map<meshName, geometry>

  static initGeometries(gltfScene) {
    if (Decorations.cachedGeoms) return  // Already initialized
    Decorations.cachedGeoms = new Map()

    const allMeshNames = [
      ...TreeMeshNames,
      ...BuildingMeshNames,
      TOWER_TOP_MESH,
      ...CoastBuildingMeshNames,
      ...WindmillMeshNames,
      ...BridgeMeshNames,
      ...WaterlilyMeshNames,
      ...FlowerMeshNames,
      ...RockMeshNames,
      ...HillMeshNames,
      ...MountainMeshNames,
      ...RareBuildingNames,
    ]

    // Windmill fan needs centering
    const centeredMeshes = new Set(['building_windmill_top_fan_yellow'])
    // Tower top keeps its original Y (sits on top of tower base)
    const keepYMeshes = new Set([TOWER_TOP_MESH, ...BuildingMeshNames, ...CoastBuildingMeshNames, ...WindmillMeshNames, ...RareBuildingNames])

    for (const meshName of allMeshNames) {
      if (TreeMeshNames.includes(meshName)) {
        Decorations.cachedGeoms.set(meshName, createTreeGeometry(meshName))
        continue
      }
      let geom = null
      gltfScene.traverse((child) => {
        if (child.name === meshName && child.geometry) {
          geom = child.geometry.clone()
          geom.computeBoundingBox()
          if (centeredMeshes.has(meshName)) {
            const { min, max } = geom.boundingBox
            geom.translate(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -(min.z + max.z) / 2)
          } else if (!keepYMeshes.has(meshName)) {
            geom.translate(0, -geom.boundingBox.min.y, 0)
          }
          geom.computeBoundingSphere()
        }
      })
      if (geom) {
        if (MountainMeshNames.includes(meshName) || HillMeshNames.includes(meshName) || RockMeshNames.includes(meshName)) {
          const authored = geom
          geom = detailTerrain(authored, meshName)
          authored.dispose()
        }
        geom.computeBoundingBox()
        geom.computeBoundingSphere()
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

    // Single merged BatchedMesh for all decorations
    this.mesh = null
    this.geomIds = new Map()
    this.geometryNames = new Map()

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

    // Instance IDs invalidated by clearDecorationsAt (prevents stale animation tweens)
    this._invalidDecIds = new Set()
    this.placementMatrices = new Map()

    this.dummy = new Object3D()
  }

  // Safe addInstance — returns -1 if mesh is full
  _addInstance(mesh, geomId) {
    if (!decorationAllowed(this.geometryNames.get(geomId), decorationSettings)) return -1
    try {
      const id = mesh.addInstance(geomId)
      this._invalidDecIds.delete(id)
      return id
    } catch (_) {
      return -1
    }
  }

  /** Delete all instances in an array from a BatchedMesh */
  _clearInstances(items, mesh) {
    if (!mesh) return
    for (const item of items) {
      mesh.deleteInstance(item.instanceId)
      this.placementMatrices.delete(item.instanceId)
    }
  }

  /** Create a decoration instance: add geometry, set color/transform, return instanceId (-1 on failure) */
  _placeInstance(mesh, geomIds, meshName, x, y, z, rotY = 0, scale = 1, level = 0) {
    const geomId = geomIds.get(meshName)
    if (geomId === undefined) return -1
    const instanceId = this._addInstance(mesh, geomId)
    if (instanceId === -1) return -1
    const c = levelColor(level)
    c.b = rotY / (Math.PI * 2)
    mesh.setColorAt(instanceId, c)
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, rotY, 0)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    this.setPlacementMatrix(instanceId, this.dummy.matrix)
    return instanceId
  }

  // Keep final placements separate from the transient drop-in animation matrices.
  setPlacementMatrix(instanceId, matrix) {
    this.mesh.setMatrixAt(instanceId, matrix)
    this.placementMatrices.set(instanceId, matrix.clone())
  }

  exportLandscape() {
    const instances = []
    for (const kind of ['trees', 'rocks', 'hills', 'mountains']) {
      for (const item of this[kind]) {
        const matrix = this.placementMatrices.get(item.instanceId)
        if (!matrix) throw new Error('Landscape placement is missing')
        instances.push({ kind, mesh: item.meshName, tile: { x: item.tile.gridX, z: item.tile.gridZ }, matrix: matrix.toArray() })
      }
    }
    return instances
  }

  restoreLandscape(instances, hexTiles) {
    for (const kind of ['trees', 'rocks', 'hills', 'mountains']) {
      this._clearInstances(this[kind], this.mesh)
      this[kind] = []
    }
    const tiles = new Map(hexTiles.map(tile => [`${tile.gridX},${tile.gridZ}`, tile]))
    for (const saved of instances) {
      const tile = tiles.get(`${saved.tile.x},${saved.tile.z}`)
      const geomId = this.geomIds.get(saved.mesh)
      if (!tile || geomId === undefined) throw new Error('Saved landscape asset or tile is unavailable')
      // A persisted placement is authoritative, even with an unknown legacy recipe.
      const instanceId = this.mesh.addInstance(geomId)
      this._invalidDecIds.delete(instanceId)
      const matrix = new Matrix4().fromArray(saved.matrix)
      this.setPlacementMatrix(instanceId, matrix)
      this.mesh.setColorAt(instanceId, levelColor(tile.level))
      const rotationY = Math.atan2(saved.matrix[8], saved.matrix[0])
      this[saved.kind].push({ tile, meshName: saved.mesh, instanceId, rotationY })
    }
  }

  async init(material) {
    const geoms = Decorations.cachedGeoms
    if (!geoms || geoms.size === 0) {
      console.warn('Decorations: No cached geometries (call Decorations.initGeometries first)')
      return
    }

    // Collect all decoration geometries into one map
    const allNames = [
      ...TreeMeshNames, ...FlowerMeshNames,
      ...BuildingMeshNames, TOWER_TOP_MESH, ...CoastBuildingMeshNames, ...WindmillMeshNames,
      ...BridgeMeshNames, ...WaterlilyMeshNames, ...RockMeshNames,
      ...HillMeshNames, ...MountainMeshNames,
      ...RareBuildingNames,
    ]
    const allGeoms = new Map()
    for (const name of allNames) {
      const geom = geoms.get(name)
      if (geom) allGeoms.set(name, geom)
    }
    if (allGeoms.size === 0) return

    // Create single BatchedMesh for all decorations
    let totalV = 0, totalI = 0
    for (const geom of allGeoms.values()) {
      totalV += geom.attributes.position.count
      totalI += geom.index ? geom.index.count : 0
    }
    const mesh = new BatchedMesh(MAX_DEC_INSTANCES, totalV * 2, totalI * 2, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    this.scene.add(mesh)

    const idMap = new Map()
    for (const [name, geom] of allGeoms) {
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

    this.mesh = mesh
    this.geomIds = idMap
    this.geometryNames = new Map([...idMap].map(([name, id]) => [id, name]))
  }

  populate(hexTiles, gridRadius, options = {}) {
    this.clearTrees()
    if (!decorationSettings.trees) return
    this.dummy.rotation.set(0, 0, 0)  // Reset from windmill fan animation

    if (!this.mesh || this.geomIds.size === 0) return
    if (!globalNoiseA || !globalNoiseB) return  // Need global noise initialized

    const threshold = getCurrentTreeThreshold()  // noise > threshold = tree
    const { x: offsetX, z: offsetZ } = this.worldOffset

    // Skip tiles that already have buildings (buildings placed first)
    const buildingTileIds = new Set(this.buildings.map(b => b.tile.id))

    for (const tile of hexTiles) {
      // Only flat grass tiles (not slopes)
      if (tile.type !== TileType.GRASS) continue

      // Skip tiles claimed by buildings
      if (buildingTileIds.has(tile.id)) continue

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
      // At tier 0 (single tree), 30% chance to use a C/D/E variant instead
      let meshName
      if (tierIndex === 0 && random() < 0.3) {
        const variants = ['C', 'D', 'E']
        meshName = TreesByType[variants[Math.floor(random() * variants.length)]][0]
      } else {
        meshName = TreesByType[treeType][tierIndex]
      }
      const geomId = this.geomIds.get(meshName)
      const instanceId = this._addInstance(this.mesh, geomId)
      if (instanceId === -1) break

      // Position at tile center with random offset (local coords since mesh is in group)
      const rotationY = random() * Math.PI * 2
      const ox = (random() - 0.5) * 0.4
      const oz = (random() - 0.5) * 0.4
      const c = levelColor(tile.level)
      c.b = rotationY / (Math.PI * 2)
      this.mesh.setColorAt(instanceId, c)
      this.dummy.position.set(
        localPos.x + ox,
        tile.level * LEVEL_HEIGHT + TILE_SURFACE,
        localPos.z + oz
      )
      this.dummy.rotation.y = rotationY
      this.dummy.scale.setScalar(1 + random() * 0.2)
      this.dummy.updateMatrix()

      this.setPlacementMatrix(instanceId, this.dummy.matrix)
      this.trees.push({ tile, meshName, instanceId, rotationY, ox, oz })
    }
  }

  populateBuildings(hexTiles, hexGrid, gridRadius, options = {}) {
    this.clearBuildings()
    if (!decorationSettings.structures) return

    if (!this.mesh || this.geomIds.size === 0) return

    const hasWindmill = WindmillMeshNames.every(n => this.geomIds.has(n))

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
    const coastWindmillCandidates = []
    const noiseCandidates = []
    const size = gridRadius * 2 + 1
    const { x: offsetX, z: offsetZ } = this.worldOffset
    const buildingThreshold = getBuildingThreshold()

    const buildingTileIds = new Set()

    for (const tile of hexTiles) {
      // Check for road dead-ends - place building facing the road exit
      const deadEndInfo = getRoadDeadEndInfo(tile.type, tile.rotation)
      if (deadEndInfo.isDeadEnd) {
        const roadAngle = dirToAngle[deadEndInfo.exitDir] ?? 0
        deadEndCandidates.push({ tile, roadAngle })
        continue
      }

      // Only consider grass tiles for noise-based and windmill placement
      if (tile.type !== TileType.GRASS) continue

      // Check if any hex neighbors are coast/ocean — average direction to all water neighbors
      let waterAngle = null
      let wdx = 0, wdz = 0
      const tilePos = HexTileGeometry.getWorldPosition(tile.gridX - gridRadius, tile.gridZ - gridRadius)
      for (const dir of HexDir) {
        const { dx, dz } = getHexNeighborOffset(tile.gridX, tile.gridZ, dir)
        const nx = tile.gridX + dx
        const nz = tile.gridZ + dz
        if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
          const neighbor = hexGrid[nx]?.[nz]
          if (neighbor && isCoastOrWater(neighbor.type)) {
            const neighborPos = HexTileGeometry.getWorldPosition(nx - gridRadius, nz - gridRadius)
            wdx += neighborPos.x - tilePos.x
            wdz += neighborPos.z - tilePos.z
          }
        }
      }
      if (wdx !== 0 || wdz !== 0) {
        waterAngle = Math.atan2(wdx, wdz)
      }

      if (waterAngle !== null && tile.level === 0) {
        coastWindmillCandidates.push({ tile, roadAngle: waterAngle })
      }

      // Noise-based village candidate
      if (globalNoiseC) {
        const localPos = HexTileGeometry.getWorldPosition(tile.gridX - gridRadius, tile.gridZ - gridRadius)
        const worldX = localPos.x + offsetX
        const worldZ = localPos.z + offsetZ
        const noise = globalNoiseC.scaled2D(worldX, worldZ)
        if (noise >= buildingThreshold) {
          noiseCandidates.push({ tile })
        }
      }
    }

    // Shuffle each group separately
    shuffle(deadEndCandidates)
    shuffle(noiseCandidates)
    shuffle(coastWindmillCandidates)

    // Place dead-end buildings first
    let hasChurch = false, hasMarket = false, hasBlacksmith = false
    const rerollIfUnique = (name) => {
      if (name === 'building_church_yellow' && hasChurch) return true
      if (name === 'building_market_yellow' && hasMarket) return true
      if (name === 'building_blacksmith_yellow' && hasBlacksmith) return true
      return false
    }
    const trackUnique = (name) => {
      if (name === 'building_church_yellow') hasChurch = true
      if (name === 'building_market_yellow') hasMarket = true
      if (name === 'building_blacksmith_yellow') hasBlacksmith = true
    }

    for (const { tile, roadAngle } of deadEndCandidates) {
      if (random() > decorationSettings.structures) continue
      if (this.buildings.length >= MAX_BUILDINGS - 1) break

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE

      let meshName = weightedPick(BuildingDefs)
      if (rerollIfUnique(meshName)) meshName = weightedPick(BuildingDefs)
      const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, roadAngle, 1, tile.level)
      if (instanceId === -1) break
      trackUnique(meshName)
      this.buildings.push({ tile, meshName, instanceId, rotationY: roadAngle })
      buildingTileIds.add(tile.id)

      // Optionally place tower top
      if (meshName === 'building_tower_A_yellow' && random() < TOWER_TOP_CHANCE) {
        const topId = this._placeInstance(this.mesh, this.geomIds, TOWER_TOP_MESH, localPos.x, baseY, localPos.z, roadAngle, 1, tile.level)
        if (topId !== -1) this.buildings.push({ tile, meshName: TOWER_TOP_MESH, instanceId: topId, rotationY: roadAngle })
      }
    }

    // Place noise-based village buildings (skip tiles already claimed)
    for (const { tile } of noiseCandidates) {
      if (this.buildings.length >= MAX_BUILDINGS - 1) break
      if (buildingTileIds.has(tile.id)) continue

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
      const jitterAngle = random() * Math.PI * 2
      const jitterOx = (random() - 0.5) * 0.6
      const jitterOz = (random() - 0.5) * 0.6

      let meshName = weightedPick(BuildingDefs)
      if (rerollIfUnique(meshName)) meshName = weightedPick(BuildingDefs)
      const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x + jitterOx, baseY, localPos.z + jitterOz, jitterAngle, 1, tile.level)
      if (instanceId === -1) break
      trackUnique(meshName)
      this.buildings.push({ tile, meshName, instanceId, rotationY: jitterAngle })
      buildingTileIds.add(tile.id)

      // Optionally place tower top (same jitter as base)
      if (meshName === 'building_tower_A_yellow' && random() < TOWER_TOP_CHANCE) {
        const topId = this._placeInstance(this.mesh, this.geomIds, TOWER_TOP_MESH, localPos.x + jitterOx, baseY, localPos.z + jitterOz, jitterAngle, 1, tile.level)
        if (topId !== -1) this.buildings.push({ tile, meshName: TOWER_TOP_MESH, instanceId: topId, rotationY: jitterAngle })
      }
    }

    // Place windmills on coast-adjacent grass tiles, facing the water (35% chance)
    if (hasWindmill && coastWindmillCandidates.length > 0 && random() < 0.35 * decorationSettings.structures) {
      const maxCoastWindmills = Math.min(1, coastWindmillCandidates.length)
      for (let i = 0; i < maxCoastWindmills; i++) {
        const { tile, roadAngle: waterAngle } = coastWindmillCandidates[i]
        if (buildingTileIds.has(tile.id)) continue
        const localPos = HexTileGeometry.getWorldPosition(
          tile.gridX - gridRadius,
          tile.gridZ - gridRadius
        )
        const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE

        // Place windmill base
        const baseInstanceId = this._placeInstance(this.mesh, this.geomIds, 'building_windmill_yellow', localPos.x, baseY, localPos.z, waterAngle, 1, tile.level)
        if (baseInstanceId === -1) break
        this.buildings.push({ tile, meshName: 'building_windmill_yellow', instanceId: baseInstanceId, rotationY: waterAngle, oy: 0 })
        buildingTileIds.add(tile.id)

        // Place windmill top
        const cosA = Math.cos(waterAngle), sinA = Math.sin(waterAngle)
        const topOx = WINDMILL_TOP_OFFSET.x * cosA + WINDMILL_TOP_OFFSET.z * sinA
        const topOz = -WINDMILL_TOP_OFFSET.x * sinA + WINDMILL_TOP_OFFSET.z * cosA
        const topInstanceId = this._placeInstance(this.mesh, this.geomIds, 'building_windmill_top_yellow', localPos.x + topOx, baseY + WINDMILL_TOP_OFFSET.y, localPos.z + topOz, waterAngle, 1, tile.level)
        if (topInstanceId === -1) break
        this.buildings.push({ tile, meshName: 'building_windmill_top_yellow', instanceId: topInstanceId, rotationY: waterAngle, oy: WINDMILL_TOP_OFFSET.y })

        // Place windmill fan
        const fanOx = WINDMILL_FAN_OFFSET.x * cosA + WINDMILL_FAN_OFFSET.z * sinA
        const fanOz = -WINDMILL_FAN_OFFSET.x * sinA + WINDMILL_FAN_OFFSET.z * cosA
        const fanX = localPos.x + fanOx
        const fanY = baseY + WINDMILL_FAN_OFFSET.y
        const fanZ = localPos.z + fanOz
        const fanInstanceId = this._placeInstance(this.mesh, this.geomIds, 'building_windmill_top_fan_yellow', fanX, fanY, fanZ, waterAngle, 1, tile.level)
        if (fanInstanceId === -1) break
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
            try { this.mesh.setMatrixAt(fan.instanceId, this.dummy.matrix) } catch (_) {}
          }
        })
        this.windmillFans.push(fan)
      }
    }

    // Place shipyard on COAST_A/COAST_B tiles, facing rotated SE direction, max 1 per grid (25% chance)
    const coastBuildingNames = [...CoastBuildingMeshNames].filter(n => this.geomIds.has(n))
    if (coastBuildingNames.length > 0) {
      const shipyardCandidates = []
      for (const tile of hexTiles) {
        const def = TILE_LIST[tile.type]
        if (!def || def.name !== 'COAST_A') continue
        const rotatedSE = HexDir[(2 + tile.rotation) % 6]
        const waterAngle = dirToAngle[rotatedSE]
        // Probe 2 tiles out in the jetty direction — reject if land (cove)
        const probeDir = HexDir[(2 + tile.rotation) % 6]  // rotated SE
        let blocked = false
        let px = tile.gridX, pz = tile.gridZ
        for (let step = 0; step < 3; step++) {
          const { dx, dz } = getHexNeighborOffset(px, pz, probeDir)
          px += dx; pz += dz
          if (px < 0 || px >= size || pz < 0 || pz >= size) { blocked = true; break }
          const probeCell = hexGrid[px]?.[pz]
          if (!probeCell || TILE_LIST[probeCell.type]?.name !== 'WATER') { blocked = true; break }
        }
        if (!blocked) shipyardCandidates.push({ tile, waterAngle })
      }
      shuffle(shipyardCandidates)
      const validCandidates = shipyardCandidates.filter(c => !buildingTileIds.has(c.tile.id))
      if (validCandidates.length > 0 && random() < 0.25 * decorationSettings.structures) {
        const { tile, waterAngle } = validCandidates[0]
        const localPos = HexTileGeometry.getWorldPosition(tile.gridX - gridRadius, tile.gridZ - gridRadius)
        const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
        const meshName = weightedPick(CoastBuildingDefs)
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, waterAngle, 1, tile.level)
        if (instanceId !== -1) {
          this.buildings.push({ tile, meshName, instanceId, rotationY: waterAngle })
          buildingTileIds.add(tile.id)
        }
      }
    }

    // Place a rare building (henge/ruin/mine/fort) on flat grass at level 2+, max 1 per grid
    const availableRare = RareBuildingNames.filter(n => this.geomIds.has(n))
    if (availableRare.length > 0) {
      const rareCandidates = []
      for (const tile of hexTiles) {
        if (tile.type !== TileType.GRASS) continue
        if (tile.level < 2) continue
        if (buildingTileIds.has(tile.id)) continue
        rareCandidates.push(tile)
      }
      shuffle(rareCandidates)
      if (rareCandidates.length > 0 && random() < 0.5 * decorationSettings.structures) {
        const tile = rareCandidates[0]
        const availableDefs = RareBuildingDefs2.filter(d => availableRare.includes(d.name))
        const meshName = weightedPick(availableDefs)
        const localPos = HexTileGeometry.getWorldPosition(tile.gridX - gridRadius, tile.gridZ - gridRadius)
        const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
        const rotationY = random() * Math.PI * 2
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, rotationY, 1, tile.level)
        if (instanceId !== -1) {
          this.buildings.push({ tile, meshName, instanceId, rotationY })
        }
      }
    }

  }

  populateBridges(hexTiles, gridRadius) {
    this.clearBridges()

    if (!this.mesh || this.geomIds.size === 0) return

    for (const tile of hexTiles) {
      // Only river crossing tiles
      if (tile.type !== TileType.RIVER_CROSSING_A &&
          tile.type !== TileType.RIVER_CROSSING_B) continue

      // Pick matching bridge mesh
      const meshName = tile.type === TileType.RIVER_CROSSING_A
        ? 'building_bridge_A'
        : 'building_bridge_B'

      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, tile.level * LEVEL_HEIGHT, localPos.z, -tile.rotation * Math.PI / 3, 1, tile.level)
      if (instanceId === -1) continue
      this.bridges.push({ tile, meshName, instanceId })
    }
  }

  populateWaterlilies(hexTiles, gridRadius) {
    this.clearWaterlilies()

    if (!this.mesh || this.geomIds.size === 0) return

    const lilyNames = WaterlilyMeshNames.filter(n => this.geomIds.has(n))

    for (const tile of hexTiles) {
      // River tiles (not crossings — those have bridges) and coast tiles
      const tileDef = TILE_LIST[tile.type]
      const tileName = tileDef?.name
      if (!tileName) continue
      const isRiver = tileName.startsWith('RIVER_') && !tileName.startsWith('RIVER_CROSSING')
      const isCoastWater = tileName === 'COAST_B' || tileName === 'COAST_C' || tileName === 'COAST_D'
      if (!isRiver && !isCoastWater) continue

      // Random chance to skip (not every tile gets lilies)
      if (random() > 0.075 * decorationSettings.waterlilies) continue

      if (this.waterlilies.length >= MAX_WATERLILIES - 1) break

      const meshName = lilyNames[Math.floor(random() * lilyNames.length)]
      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      let ox, oz
      if (isCoastWater) {
        const localSide = (random() - 0.5) * 0.3
        const localFwd = 0.4 + random() * 0.4
        const angle = tile.rotation * Math.PI / 3
        ox = localSide * Math.cos(angle) - localFwd * Math.sin(angle)
        oz = localSide * Math.sin(angle) + localFwd * Math.cos(angle)
      } else {
        ox = (random() - 0.5) * 0.3
        oz = (random() - 0.5) * 0.3
      }
      const rotationY = random() * Math.PI * 2
      const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE - 0.2, localPos.z + oz, rotationY, 2, tile.level)
      if (instanceId === -1) break
      this.waterlilies.push({ tile, meshName, instanceId, rotationY, ox, oz })
    }
  }

  populateFlowers(hexTiles, gridRadius) {
    this.clearFlowers()

    if (!this.mesh || this.geomIds.size === 0) return

    const flowerNames = FlowerMeshNames.filter(n => this.geomIds.has(n))
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
    const target = getCurrentTreeThreshold() + 0.05
    candidates.sort((a, b) => Math.abs(a.noise - target) - Math.abs(b.noise - target))
    const budget = Math.round((7 + Math.floor(random() * 15)) * decorationSettings.flowers)  // 7-21
    const selected = candidates.slice(0, budget)

    for (const { tile, localPos, noise } of selected) {
      // Higher noise = more flowers per tile (1-3)
      const count = 1 + Math.floor(noise * 2.99)

      for (let f = 0; f < count; f++) {
        if (this.flowers.length >= MAX_FLOWERS - 1) break

        const meshName = flowerNames[Math.floor(random() * flowerNames.length)]
        const ox = (random() - 0.5) * 1.6
        const oz = (random() - 0.5) * 1.6
        const rotationY = random() * Math.PI * 2
        const scale = meshName.startsWith('bush_') ? 1 : 2
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE, localPos.z + oz, rotationY, scale, tile.level)
        if (instanceId === -1) break
        this.flowers.push({ tile, meshName, instanceId, rotationY, ox, oz })
      }
    }
  }

  populateRocks(hexTiles, gridRadius) {
    this.clearRocks()

    if (!this.mesh || this.geomIds.size === 0) return

    const rockNames = RockMeshNames.filter(n => this.geomIds.has(n))
    const treeTileIds = new Set(this.trees.map(t => t.tile.id))

    // Collect candidate tiles: cliffs, coasts, rivers, tree tiles
    const candidates = []
    for (const tile of hexTiles) {
      const def = TILE_LIST[tile.type]
      if (!def) continue
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
    const budget = Math.min(Math.round(10 * decorationSettings.rocks), candidates.length)

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
        const ox = (random() - 0.5) * 1.2
        const oz = (random() - 0.5) * 1.2
        const rotationY = random() * Math.PI * 2
        const tileName = TILE_LIST[tile.type]?.name || ''
        const surfaceDip = tileName === 'WATER' ? -0.2 : (tileName.startsWith('COAST_') || tileName.startsWith('RIVER_')) ? -0.1 : 0
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x + ox, tile.level * LEVEL_HEIGHT + TILE_SURFACE + surfaceDip, localPos.z + oz, rotationY, 1, tile.level)
        if (instanceId === -1) break
        this.rocks.push({ tile, meshName, instanceId, rotationY, ox, oz })
      }
    }
  }

  populateHillsAndMountains(hexTiles, gridRadius) {
    this.clearHills()
    this.clearMountains()

    const hillNames = HillMeshNames.filter(n => this.geomIds.has(n))
    const mountainNames = MountainMeshNames.filter(n => this.geomIds.has(n))
    const hasHills = this.mesh && hillNames.length > 0
    const hasMountains = this.mesh && mountainNames.length > 0

    if (!hasHills && !hasMountains) return

    const buildingTileIds = new Set(this.buildings.map(b => b.tile.id))
    const treeTileIds = new Set(this.trees.map(t => t.tile.id))

    for (const tile of hexTiles) {
      if (buildingTileIds.has(tile.id)) continue
      if (treeTileIds.has(tile.id)) continue
      const def = TILE_LIST[tile.type]
      if (!def) continue

      const isCliff = def.levelIncrement && def.name.includes('CLIFF')
      const isRiverEnd = def.name === 'RIVER_END'
      const isHighGrass = def.name === 'GRASS' && tile.level >= LEVELS_COUNT - 1

      if (!isCliff && !isRiverEnd && !isHighGrass) continue

      // High plateaus carry a chain of peaks; roads and occupied tiles are
      // excluded above, so their authored connection/clearance stays intact.
      const amount = isHighGrass || (!isRiverEnd && def.levelIncrement >= 2) ? decorationSettings.mountains : decorationSettings.hills
      const chance = (isRiverEnd ? 0.7 : isHighGrass ? HIGH_GRASS_MOUNTAIN_CHANCE : 0.1) * amount
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
        const mtRotY = Math.floor(random() * 6) * Math.PI / 3
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, mtRotY, 1, tile.level)
        if (instanceId === -1) continue
        this.mountains.push({ tile, meshName, instanceId, rotationY: mtRotY })
        continue
      }

      // River ends get hills
      if (isRiverEnd && hasHills) {
        if (this.hills.length >= MAX_HILLS - 1) continue
        const meshName = weightedPick(hillDefinitions(RiverEndDefs))
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY - 0.1, localPos.z, rotationY, 1, tile.level)
        if (instanceId === -1) continue
        this.hills.push({ tile, meshName, instanceId, rotationY })
        continue
      }

      if (def.levelIncrement >= 2 && hasMountains) {
        if (this.mountains.length >= MAX_MOUNTAINS - 1) continue
        const meshName = weightedPick(MountainDefs)
        const mtRotY = Math.floor(random() * 6) * Math.PI / 3
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, mtRotY, 1, tile.level)
        if (instanceId === -1) continue
        this.mountains.push({ tile, meshName, instanceId, rotationY })
      } else if (def.levelIncrement === 1 && hasHills) {
        if (this.hills.length >= MAX_HILLS - 1) continue
        const meshName = weightedPick(hillDefinitions(HillDefs))
        const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, rotationY, 1, tile.level)
        if (instanceId === -1) continue
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
    this._invalidDecIds.clear()
  }

  clearTrees() { this._clearInstances(this.trees, this.mesh); this.trees = [] }

  clearBuildings() {
    for (const fan of this.windmillFans) { if (fan.tween) fan.tween.kill() }
    this.windmillFans = []
    this._clearInstances(this.buildings, this.mesh); this.buildings = []
  }

  clearBridges() { this._clearInstances(this.bridges, this.mesh); this.bridges = [] }
  clearWaterlilies() { this._clearInstances(this.waterlilies, this.mesh); this.waterlilies = [] }
  clearFlowers() { this._clearInstances(this.flowers, this.mesh); this.flowers = [] }
  clearRocks() { this._clearInstances(this.rocks, this.mesh); this.rocks = [] }
  clearHills() { this._clearInstances(this.hills, this.mesh); this.hills = [] }
  clearMountains() { this._clearInstances(this.mountains, this.mesh); this.mountains = [] }
  /**
   * Add a bridge on a single tile if it's a river crossing
   * @param {HexTile} tile - Tile to check
   * @param {number} gridRadius - Grid radius for position calculation
   */
  addBridgeAt(tile, gridRadius) {
    if (!this.mesh || this.geomIds.size === 0) return
    if (tile.type !== TileType.RIVER_CROSSING_A &&
        tile.type !== TileType.RIVER_CROSSING_B) return

    const meshName = tile.type === TileType.RIVER_CROSSING_A
      ? 'building_bridge_A'
      : 'building_bridge_B'

    const localPos = HexTileGeometry.getWorldPosition(
      tile.gridX - gridRadius,
      tile.gridZ - gridRadius
    )
    const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, tile.level * LEVEL_HEIGHT, localPos.z, -tile.rotation * Math.PI / 3, 1, tile.level)
    if (instanceId === -1) return
    this.bridges.push({ tile, meshName, instanceId })
  }

  /**
   * Place a random mountain on a specific tile (used to hide dropped cells)
   */
  addMountainAt(tile, gridRadius) {
    if (!this.mesh || this.geomIds.size === 0) return

    const mountainNames = MountainMeshNames.filter(n => this.geomIds.has(n))
    if (mountainNames.length === 0) return

    const meshName = weightedPick(MountainDefs)
    const localPos = HexTileGeometry.getWorldPosition(
      tile.gridX - gridRadius,
      tile.gridZ - gridRadius
    )
    const baseY = tile.level * LEVEL_HEIGHT + TILE_SURFACE
    const rotY = Math.floor(random() * 6) * Math.PI / 3
    const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, baseY, localPos.z, rotY, 1, tile.level)
    if (instanceId === -1) return
    this.mountains.push({ tile, meshName, instanceId, rotationY: rotY })
  }

  /**
   * Re-populate decorations for specific tiles (clear + re-add)
   * Used after click-to-solve replaces tiles in a small region
   * @param {Array} tiles - HexTile objects to repopulate
   * @param {number} gridRadius - Grid radius for position calculation
   * @param {Array} hexGrid - 2D grid array for neighbor lookups (needed for buildings)
   */
  repopulateTilesAt(tiles, gridRadius, hexGrid, { animate = true } = {}) {
    for (const tile of tiles) {
      this.clearDecorationsAt(tile.gridX, tile.gridZ)
    }

    const { x: offsetX, z: offsetZ } = this.worldOffset
    const newItems = []
    const buildingTileIds = new Set()
    const buildingThreshold = getBuildingThreshold()

    for (const tile of tiles) {
      const localPos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      const def = TILE_LIST[tile.type]
      if (!def) continue
      const name = def.name

      // Buildings first (dead-ends + noise-based villages)
      if (decorationSettings.structures > 0 && this.mesh && this.buildings.length < MAX_BUILDINGS - 1) {
        const dirToAngle = { NE: 5*Math.PI/6, E: Math.PI/2, SE: Math.PI/6, SW: -Math.PI/6, W: -Math.PI/2, NW: -5*Math.PI/6 }

        const deadEndInfo = getRoadDeadEndInfo(tile.type, tile.rotation)
        if (deadEndInfo.isDeadEnd && random() <= decorationSettings.structures) {
          const buildingAngle = dirToAngle[deadEndInfo.exitDir] ?? 0
          const meshName = weightedPick(BuildingDefs)
          const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x, tile.level * LEVEL_HEIGHT + TILE_SURFACE, localPos.z, buildingAngle, 1, tile.level)
          if (instanceId !== -1) {
            this.buildings.push({ tile, meshName, instanceId, rotationY: buildingAngle })
            newItems.push({ mesh: this.mesh, instanceId, x: localPos.x, y: tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: localPos.z, rotationY: buildingAngle })
            buildingTileIds.add(tile.id)

            if (meshName === 'building_tower_A_yellow' && random() < TOWER_TOP_CHANCE) {
              const topId = this._placeInstance(this.mesh, this.geomIds, TOWER_TOP_MESH, localPos.x, tile.level * LEVEL_HEIGHT + TILE_SURFACE, localPos.z, buildingAngle, 1, tile.level)
              if (topId !== -1) {
                this.buildings.push({ tile, meshName: TOWER_TOP_MESH, instanceId: topId, rotationY: buildingAngle })
                newItems.push({ mesh: this.mesh, instanceId: topId, x: localPos.x, y: tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: localPos.z, rotationY: buildingAngle })
              }
            }
          }
        } else if (tile.type === TileType.GRASS && globalNoiseC) {
          const worldX = localPos.x + offsetX
          const worldZ = localPos.z + offsetZ
          const noise = globalNoiseC.scaled2D(worldX, worldZ)
          if (noise >= buildingThreshold) {
            const jitterAngle = random() * Math.PI * 2
            const jOx = (random() - 0.5) * 0.6
            const jOz = (random() - 0.5) * 0.6
            const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
            const meshName = weightedPick(BuildingDefs)
            const instanceId = this._placeInstance(this.mesh, this.geomIds, meshName, localPos.x + jOx, y, localPos.z + jOz, jitterAngle, 1, tile.level)
            if (instanceId !== -1) {
              this.buildings.push({ tile, meshName, instanceId, rotationY: jitterAngle })
              newItems.push({ mesh: this.mesh, instanceId, x: localPos.x + jOx, y, z: localPos.z + jOz, rotationY: jitterAngle })
              buildingTileIds.add(tile.id)

              if (meshName === 'building_tower_A_yellow' && random() < TOWER_TOP_CHANCE) {
                const topId = this._placeInstance(this.mesh, this.geomIds, TOWER_TOP_MESH, localPos.x + jOx, y, localPos.z + jOz, jitterAngle, 1, tile.level)
                if (topId !== -1) {
                  this.buildings.push({ tile, meshName: TOWER_TOP_MESH, instanceId: topId, rotationY: jitterAngle })
                  newItems.push({ mesh: this.mesh, instanceId: topId, x: localPos.x + jOx, y, z: localPos.z + jOz, rotationY: jitterAngle })
                }
              }
            }
          }
        }
      }

      // Trees (noise-based, skip tiles with buildings)
      if (decorationSettings.trees > 0 && tile.type === TileType.GRASS && !buildingTileIds.has(tile.id) && this.mesh && globalNoiseA && globalNoiseB) {
        const worldX = localPos.x + offsetX
        const worldZ = localPos.z + offsetZ
        const noiseA = globalNoiseA.scaled2D(worldX, worldZ)
        const noiseB = globalNoiseB.scaled2D(worldX, worldZ)
        const threshold = getCurrentTreeThreshold()
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
            const geomId = this.geomIds.get(meshName)
            const instanceId = this._addInstance(this.mesh, geomId)
            if (instanceId !== -1) {
              const rotY = random() * Math.PI * 2
              const c = levelColor(tile.level)
              c.b = rotY / (Math.PI * 2)
              this.mesh.setColorAt(instanceId, c)
              const ox = (random() - 0.5) * 0.2
              const oz = (random() - 0.5) * 0.2
              const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
              this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
              this.dummy.rotation.set(0, rotY, 0)
              this.dummy.scale.setScalar(1)
              this.dummy.updateMatrix()
              this.setPlacementMatrix(instanceId, this.dummy.matrix)
              this.trees.push({ tile, meshName, instanceId, rotationY: rotY, ox, oz })
              newItems.push({ mesh: this.mesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY: rotY })
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
        newItems.push({ mesh: this.mesh, instanceId: bridge.instanceId, x: bPos.x, y: tile.level * LEVEL_HEIGHT, z: bPos.z, rotationY: -tile.rotation * Math.PI / 3 })
      }

      // Waterlilies
      const isRiver = name.startsWith('RIVER_') && !name.startsWith('RIVER_CROSSING')
      const isCoast = name.startsWith('COAST_')
      const isCoastWater = name === 'COAST_B' || name === 'COAST_C' || name === 'COAST_D'
      if ((isRiver || isCoastWater) && this.mesh && random() <= 0.075 * decorationSettings.waterlilies) {
        const lilyNames = WaterlilyMeshNames.filter(n => this.geomIds.has(n))
        if (lilyNames.length > 0 && this.waterlilies.length < MAX_WATERLILIES - 1) {
          const meshName = lilyNames[Math.floor(random() * lilyNames.length)]
          const geomId = this.geomIds.get(meshName)
          const instanceId = this._addInstance(this.mesh, geomId)
          if (instanceId !== -1) {
            this.mesh.setColorAt(instanceId, levelColor(tile.level))
            let ox, oz
            if (isCoastWater) {
              const localSide = (random() - 0.5) * 0.3
              const localFwd = 0.4 + random() * 0.4
              const angle = tile.rotation * Math.PI / 3
              ox = localSide * Math.cos(angle) - localFwd * Math.sin(angle)
              oz = localSide * Math.sin(angle) + localFwd * Math.cos(angle)
            } else {
              ox = (random() - 0.5) * 0.3
              oz = (random() - 0.5) * 0.3
            }
            const rotationY = random() * Math.PI * 2
            const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE - 0.2
            this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
            this.dummy.rotation.y = rotationY
            this.dummy.scale.setScalar(2)
            this.dummy.updateMatrix()
            this.setPlacementMatrix(instanceId, this.dummy.matrix)
            this.waterlilies.push({ tile, meshName, instanceId, rotationY, ox, oz })
            newItems.push({ mesh: this.mesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY, scale: 2 })
          }
        }
      }

      // Hills and mountains
      const isCliff = def.levelIncrement && name.includes('CLIFF')
      const isRiverEnd = name === 'RIVER_END'
      const isHighGrass = name === 'GRASS' && tile.level >= LEVELS_COUNT - 1
      const occupied = this.buildings.some(b => b.tile.id === tile.id) || this.trees.some(t => t.tile.id === tile.id)
      if ((isCliff || isRiverEnd || isHighGrass) && this.mesh && !occupied) {
        const amount = isHighGrass || (!isRiverEnd && def.levelIncrement >= 2) ? decorationSettings.mountains : decorationSettings.hills
        const chance = (isRiverEnd ? 0.7 : isHighGrass ? HIGH_GRASS_MOUNTAIN_CHANCE : 0.1) * amount
        if (random() <= chance) {
          if (isHighGrass) {
            const mtCountBefore = this.mountains.length
            this.addMountainAt(tile, gridRadius)
            if (this.mountains.length > mtCountBefore) {
              const mt = this.mountains[this.mountains.length - 1]
              newItems.push({ mesh: this.mesh, instanceId: mt.instanceId, x: localPos.x, y: tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: localPos.z, rotationY: mt.rotationY })
            }
          } else if (isRiverEnd) {
            if (this.hills.length < MAX_HILLS - 1) {
              const meshName = weightedPick(hillDefinitions(RiverEndDefs))
              const geomId = this.geomIds.get(meshName)
              if (geomId !== undefined) {
                const instanceId = this._addInstance(this.mesh, geomId)
                if (instanceId !== -1) {
                  this.mesh.setColorAt(instanceId, levelColor(tile.level))
                  const rotationY = Math.floor(random() * 6) * Math.PI / 3
                  const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE - 0.1
                  this.dummy.position.set(localPos.x, y, localPos.z)
                  this.dummy.rotation.y = rotationY
                  this.dummy.scale.setScalar(1)
                  this.dummy.updateMatrix()
                  this.setPlacementMatrix(instanceId, this.dummy.matrix)
                  this.hills.push({ tile, meshName, instanceId, rotationY })
                  newItems.push({ mesh: this.mesh, instanceId, x: localPos.x, y, z: localPos.z, rotationY })
                }
              }
            }
          } else {
            const hillNames = HillMeshNames.filter(n => this.geomIds.has(n))
            if (hillNames.length > 0 && this.hills.length < MAX_HILLS - 1) {
              const meshName = weightedPick(hillDefinitions(HillDefs))
              const geomId = this.geomIds.get(meshName)
              const instanceId = this._addInstance(this.mesh, geomId)
              if (instanceId !== -1) {
                this.mesh.setColorAt(instanceId, levelColor(tile.level))
                const rotationY = Math.floor(random() * 6) * Math.PI / 3
                const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE
                this.dummy.position.set(localPos.x, y, localPos.z)
                this.dummy.rotation.y = rotationY
                this.dummy.scale.setScalar(1)
                this.dummy.updateMatrix()
                this.setPlacementMatrix(instanceId, this.dummy.matrix)
                this.hills.push({ tile, meshName, instanceId, rotationY })
                newItems.push({ mesh: this.mesh, instanceId, x: localPos.x, y, z: localPos.z, rotationY })
              }
            }
          }
        }
      }

      // Rocks
      if ((name.includes('CLIFF') || isCoast || isRiver) && this.mesh) {
        const rockNames = RockMeshNames.filter(n => this.geomIds.has(n))
        if (rockNames.length > 0 && random() <= 0.3 && this.rocks.length < MAX_ROCKS - 1) {
          const meshName = rockNames[Math.floor(random() * rockNames.length)]
          const geomId = this.geomIds.get(meshName)
          const instanceId = this._addInstance(this.mesh, geomId)
          if (instanceId !== -1) {
            this.mesh.setColorAt(instanceId, levelColor(tile.level))
            const ox = (random() - 0.5) * 1.2
            const oz = (random() - 0.5) * 1.2
            const rotationY = random() * Math.PI * 2
            const surfaceDip = (name === 'WATER') ? -0.2 : (isCoast || isRiver) ? -0.1 : 0
            const y = tile.level * LEVEL_HEIGHT + TILE_SURFACE + surfaceDip
            this.dummy.position.set(localPos.x + ox, y, localPos.z + oz)
            this.dummy.rotation.y = rotationY
            this.dummy.scale.setScalar(1)
            this.dummy.updateMatrix()
            this.setPlacementMatrix(instanceId, this.dummy.matrix)
            this.rocks.push({ tile, meshName, instanceId, rotationY, ox, oz })
            newItems.push({ mesh: this.mesh, instanceId, x: localPos.x + ox, y, z: localPos.z + oz, rotationY })
          }
        }
      }
    }

    if (animate) {
      // Hide new items so they don't flash at final position before animation
      for (const item of newItems) {
        this.dummy.scale.setScalar(0)
        this.dummy.updateMatrix()
        item.mesh.setMatrixAt(item.instanceId, this.dummy.matrix)
      }
    }

    return animate ? newItems : []
  }

  /**
   * Remove decorations only on a specific tile position
   * @param {number} gridX - Tile grid X
   * @param {number} gridZ - Tile grid Z
   */
  clearDecorationsAt(gridX, gridZ) {
    const filterOut = (items, mesh) => {
      if (!mesh) return items
      return items.filter(item => {
        if (item.tile.gridX === gridX && item.tile.gridZ === gridZ) {
          this._invalidDecIds.add(item.instanceId)
          mesh.deleteInstance(item.instanceId)
          this.placementMatrices.delete(item.instanceId)
          return false
        }
        return true
      })
    }
    this.trees = filterOut(this.trees, this.mesh)
    this.flowers = filterOut(this.flowers, this.mesh)
    this.buildings = filterOut(this.buildings, this.mesh)
    this.bridges = filterOut(this.bridges, this.mesh)
    this.waterlilies = filterOut(this.waterlilies, this.mesh)
    this.rocks = filterOut(this.rocks, this.mesh)
    this.hills = filterOut(this.hills, this.mesh)
    this.mountains = filterOut(this.mountains, this.mesh)
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.clear()

    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.dispose()
      this.mesh = null
    }

    this.geomIds.clear()
  }
}
