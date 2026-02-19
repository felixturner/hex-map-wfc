import {
  Object3D,
  BatchedMesh,
  Group,
  AxesHelper,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  DoubleSide,
  Color,
  ArrowHelper,
  Vector3,
  Quaternion,
} from 'three/webgpu'
import { CSS2DObject } from 'three/examples/jsm/Addons.js'
import gsap from 'gsap'
import { TILE_LIST, HexDir } from './HexTileData.js'
import { HexTile, HexTileGeometry, isInHexRadius } from './HexTiles.js'
import { Decorations } from './Decorations.js'
import { HexGridHelper } from './HexGridHelper.js'
import { Placeholder } from './Placeholder.js'
import { cubeToOffset, globalToLocalGrid } from './HexWFCCore.js'
import {
  hideAllInstances as _hideAllInstances,
  animateTileDrop as _animateTileDrop,
  animatePlacements as _animatePlacements,
  animateDecoration as _animateDecoration,
} from './HexGridAnimation.js'

const LEVEL_HEIGHT = 0.5
const Y_AXIS = new Vector3(0, 1, 0)

/**
 * Compute debug overlay quaternion and Y offset for a tile definition + rotation
 */
function computeDebugTransform(tileDef, rotation) {
  const isObj = typeof tileDef.debug === 'object'
  const stripe = isObj ? tileDef.debug.stripe : null

  // Y rotation for stripe direction
  let rotY = 0
  if (stripe) {
    const baseDirIdx = HexDir.indexOf(stripe)
    const actualDirIdx = (baseDirIdx + rotation) % 6
    const actualDir = HexDir[actualDirIdx]
    const dirVec = HexGrid.HEX_DIR_VECTORS[actualDir]
    rotY = Math.atan2(dirVec.x, dirVec.z)
  }

  const quat = new Quaternion().setFromAxisAngle(Y_AXIS, rotY)
  let yOffset = 1.1

  // Tilt for slope tiles
  const isSlope = tileDef.highEdges && tileDef.highEdges.length > 0
  if (isSlope) {
    const increment = tileDef.levelIncrement ?? 1
    // Slope direction: average of high edges, rotated by tile rotation
    // For highEdges ['NE','E','SE'], center is E (index 1)
    const slopeDir = new Vector3(0, 0, 0)
    for (const edge of tileDef.highEdges) {
      const edgeIdx = HexDir.indexOf(edge)
      const rotIdx = (edgeIdx + rotation) % 6
      const v = HexGrid.HEX_DIR_VECTORS[HexDir[rotIdx]]
      slopeDir.x += v.x
      slopeDir.z += v.z
    }
    slopeDir.normalize()

    // Tilt axis = perpendicular to slope direction in XZ plane
    const tiltAxis = new Vector3(-slopeDir.z, 0, slopeDir.x).normalize()
    const tiltAngle = Math.atan2(increment * LEVEL_HEIGHT, 1)
    const tiltQuat = new Quaternion().setFromAxisAngle(tiltAxis, tiltAngle)
    quat.premultiply(tiltQuat)

    // Y at slope midpoint + 0.2 extra lift
    yOffset = 1.3 + increment * LEVEL_HEIGHT / 2
  }

  // Per-tile extra Y offset
  const extraY = isObj ? (tileDef.debug.yOffset ?? 0) : 0
  yOffset += extraY

  return { quat, yOffset }
}

/**
 * HexGrid states
 */
export const HexGridState = {
  PLACEHOLDER: 'placeholder',  // Not yet populated, shows clickable button
  POPULATED: 'populated',      // Has tiles, shows helper when debug enabled
}

/**
 * HexGrid - Self-contained hex grid with its own BatchedMesh instances
 *
 * Each grid manages:
 * - hexMesh (tiles)
 * - decorations (trees, buildings, bridges)
 * - gridHelper (debug visualization)
 * - placeholder (clickable expansion button)
 *
 * State determines what's visible:
 * - PLACEHOLDER: Shows Placeholder, hides Helper
 * - POPULATED: Hides Placeholder, shows Helper (if debug enabled)
 */
export class HexGrid {
  constructor(scene, material, gridRadius, worldOffset = { x: 0, z: 0 }, treeMaterial = null) {
    this.scene = scene
    this.material = material
    this.treeMaterial = treeMaterial
    this.gridRadius = gridRadius
    this.worldOffset = worldOffset

    // Container group positioned at worldOffset
    this.group = new Group()
    this.group.position.set(worldOffset.x, 0, worldOffset.z)
    this.scene.add(this.group)

    // State management
    this.state = HexGridState.PLACEHOLDER

    // Hex dimensions
    this.hexWidth = 2
    this.hexHeight = 2 / Math.sqrt(3) * 2

    this.hexTiles = []
    this.hexGrid = null  // 2D array
    this.hexMesh = null
    this.debugMesh = null     // Debug overlay BatchedMesh
    this.debugGeomId = null   // Single geometry ID for debug plane
    this.debugInstances = new Map()  // `gridX,gridZ` -> instanceId
    this.decorations = null
    this.gridHelper = null
    this.placeholder = null
    this.axesHelper = null   // Always visible
    this.outline = null      // Always visible

    // Callback for placeholder click
    this.onClick = null

    this.dummy = new Object3D()
  }

  /**
   * Initialize the grid (creates placeholder and helper, but doesn't populate tiles yet)
   * @param {Map} geometries - HexTileGeometry.geoms (optional, only needed for population)
   * @param {Object} options
   * @param {boolean} options.hidden - Start with placeholder hidden
   */
  async init(geometries = null, { hidden = false } = {}) {
    // Create axes helper (always visible)
    this.axesHelper = new AxesHelper(5)
    this.axesHelper.position.set(0, 2, 0)
    this.group.add(this.axesHelper)

    // Create outline (always visible, renders through terrain)
    this.createOutline()

    // Create always-visible grid coordinate label
    const gridKey = this.gridCoords ? `${this.gridCoords.x},${this.gridCoords.z}` : '?'
    this.gridLabel = this.createGridLabel(gridKey)
    this.group.add(this.gridLabel)

    // Create placeholder (visible in PLACEHOLDER state)
    this.placeholder = new Placeholder(this.gridRadius, this.hexWidth, this.hexHeight)
    this.placeholder.group.userData.hexGrid = this  // Reference for raycasting
    this.group.add(this.placeholder.group)

    // Create grid helper (visible in POPULATED state when debug enabled)
    this.gridHelper = new HexGridHelper(this.gridRadius, this.hexWidth, this.hexHeight)
    this.gridHelper.create()
    this.gridHelper.hide()  // Hidden by default
    this.group.add(this.gridHelper.group)

    // Set initial visibility based on state
    if (hidden) {
      this.placeholder?.hide()
      if (this.outline) this.outline.visible = false
    } else {
      this.updateVisibility()
    }

    // Only initialize meshes if geometries provided (for immediate population)
    if (geometries && geometries.size > 0) {
      await this.initMeshes(geometries)
    }

    return true
  }

  /**
   * Initialize BatchedMesh for tiles (called before population)
   * @param {Map} geometries - HexTileGeometry.geoms
   */
  async initMeshes(geometries) {
    if (!geometries || geometries.size === 0) {
      console.warn('HexGrid.initMeshes: No geometries provided')
      return false
    }

    // Calculate total vertices/indices for BatchedMesh
    let totalV = 0
    let totalI = 0
    for (const geom of geometries.values()) {
      if (!geom) continue
      totalV += geom.attributes.position.count
      totalI += geom.index ? geom.index.count : 0
    }
    // Include bottom fill geometry
    if (HexTileGeometry.bottomGeom) {
      totalV += HexTileGeometry.bottomGeom.attributes.position.count
      totalI += HexTileGeometry.bottomGeom.index ? HexTileGeometry.bottomGeom.index.count : 0
    }

    const maxInstances = 25 * 25 * 2  // Extra room for bottom fill instances

    // Create BatchedMesh for hex tiles (positioned at 0,0,0 local - group handles offset)
    this.hexMesh = new BatchedMesh(maxInstances, totalV * 2, totalI * 2, this.material)
    this.hexMesh.sortObjects = false
    this.hexMesh.receiveShadow = true
    this.hexMesh.castShadow = true
    this.hexMesh.frustumCulled = false
    this.group.add(this.hexMesh)

    // Register geometries in BatchedMesh
    this.geomIds = new Map()
    for (const [type, geom] of geometries) {
      if (geom) {
        const geomId = this.hexMesh.addGeometry(geom)
        this.geomIds.set(type, geomId)
      }
    }

    // Register bottom fill geometry
    this.bottomGeomId = null
    this.bottomFills = new Map()  // `gridX,gridZ` -> instanceId
    if (HexTileGeometry.bottomGeom) {
      this.bottomGeomId = this.hexMesh.addGeometry(HexTileGeometry.bottomGeom)
    }

    // Initialize color buffer with a dummy white instance (fixes WebGPU color sync issue)
    // This ensures setColorAt is called before first render
    const firstGeomId = this.geomIds.values().next().value
    if (firstGeomId !== undefined) {
      const WHITE = new Color(0xffffff)
      this.hexMesh._dummyInstanceId = this.hexMesh.addInstance(firstGeomId)
      this.hexMesh.setColorAt(this.hexMesh._dummyInstanceId, WHITE)
      this.dummy.position.set(0, -1000, 0)
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      this.hexMesh.setMatrixAt(this.hexMesh._dummyInstanceId, this.dummy.matrix)
    }

    // Initialize decorations for this grid (pass worldOffset for noise sampling)
    this.decorations = new Decorations(this.group, this.worldOffset)
    await this.decorations.init(this.material, this.treeMaterial)

    // Initialize debug overlay mesh (colored planes for debug tiles)
    this.initDebugMesh()

    return true
  }

  /**
   * Initialize debug overlay BatchedMesh (colored planes above debug tiles)
   */
  initDebugMesh() {
    // Flat overlay plane (for simple color debug tiles)
    const planeGeom = new PlaneGeometry(1.2, 1.2)
    planeGeom.rotateX(-Math.PI / 2)  // Lay flat (XZ plane)

    // Stripe plane (flat, extends from center toward +Z)
    const stripeGeom = new PlaneGeometry(1.4, 0.9)
    stripeGeom.rotateX(-Math.PI / 2)  // Lay flat (XZ plane)
    stripeGeom.translate(0, 0, 0.45)  // Offset toward +Z (center to edge)

    const debugMat = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
    })

    const maxInstances = 25 * 25 + 1  // Generous cap + dummy
    const totalV = planeGeom.attributes.position.count + stripeGeom.attributes.position.count
    const totalI = (planeGeom.index?.count ?? 0) + (stripeGeom.index?.count ?? 0)
    this.debugMesh = new BatchedMesh(maxInstances, totalV * 2, totalI * 2, debugMat)
    this.debugMesh.sortObjects = false
    this.debugMesh.receiveShadow = false
    this.debugMesh.castShadow = false
    this.debugMesh.frustumCulled = false
    this.group.add(this.debugMesh)

    this.debugGeomId = this.debugMesh.addGeometry(planeGeom)
    this.debugStripeGeomId = this.debugMesh.addGeometry(stripeGeom)

    // Dummy instance (WebGPU color sync fix)
    const WHITE = new Color(0xffffff)
    this.debugMesh._dummyInstanceId = this.debugMesh.addInstance(this.debugGeomId)
    this.debugMesh.setColorAt(this.debugMesh._dummyInstanceId, WHITE)
    this.dummy.position.set(0, -1000, 0)
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    this.debugMesh.setMatrixAt(this.debugMesh._dummyInstanceId, this.dummy.matrix)

    this.debugInstances = new Map()
  }

  /**
   * Create outline showing grid boundary (always visible, renders through terrain)
   */
  createOutline() {
    const d = this.gridRadius * 2 + 1
    const halfW = (d * this.hexWidth) / 2
    const halfH = (d * this.hexHeight * 0.75) / 2

    // 6 vertices of flat-top hex
    const verts = [
      halfW, 0, 0,
      halfW * 0.5, 0, -halfH,
      -halfW * 0.5, 0, -halfH,
      -halfW, 0, 0,
      -halfW * 0.5, 0, halfH,
      halfW * 0.5, 0, halfH,
    ]
    const lineVerts = []
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      lineVerts.push(verts[i*3], verts[i*3+1], verts[i*3+2])
      lineVerts.push(verts[j*3], verts[j*3+1], verts[j*3+2])
    }

    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3))
    const material = new LineBasicMaterial({ color: 0xffffff, transparent: true })
    material.depthTest = false
    material.depthWrite = false  // Exclude from AO (no depth contribution)

    this.outline = new LineSegments(geom, material)
    this.outline.position.set(0, 1, 0)
    this.outline.renderOrder = 999
    this.group.add(this.outline)
  }

  /**
   * Update visibility based on current state
   */
  updateVisibility() {
    if (this.state === HexGridState.PLACEHOLDER) {
      this.placeholder?.show()
      this.gridHelper?.hide()
    } else {
      this.fadeOut()
      // gridHelper visibility controlled separately via setHelperVisible()
    }
  }

  /**
   * Set helper visibility (works for both POPULATED and PLACEHOLDER states)
   */
  setHelperVisible(visible) {
    if (this.gridHelper) {
      if (visible) {
        this.gridHelper.show()
      } else {
        this.gridHelper.hide()
      }
    }
  }

  /**
   * Set hover state on placeholder button
   */
  setHover(isHovered) {
    this.placeholder?.setHover(isHovered)
  }

  /**
   * Get the placeholder button for raycasting
   */
  getPlaceholderButton() {
    return this.placeholder?.getButton()
  }

  /**
   * Get all placeholder clickables (button + triangles) for raycasting
   */
  getPlaceholderClickables() {
    return this.placeholder?.getClickables() ?? []
  }

  /**
   * Create always-visible grid coordinate label
   */
  createGridLabel(gridKey) {
    const div = document.createElement('div')
    div.className = 'grid-label'
    div.textContent = gridKey
    div.style.cssText = `
      color: yellow;
      font-family: monospace;
      font-size: 16px;
      font-weight: bold;
      background: rgba(0,0,0,0.7);
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
    `
    const label = new CSS2DObject(div)
    label.position.set(0, 3, 0)
    label.visible = false  // Hidden by default
    return label
  }

  /**
   * Set grid label visibility
   */
  setGridLabelVisible(visible) {
    if (this.gridLabel) {
      this.gridLabel.visible = visible
    }
  }

  /**
   * Update placeholder triangle indicators for neighbor directions
   * @param {number[]} directions - Array of directions (0-5) that have populated neighbors
   */
  setPlaceholderNeighbors(directions) {
    this.placeholder?.setNeighborDirections(directions)
  }

  /**
   * Fade in placeholder and outline from invisible
   * @param {number} delay - ms to wait before starting fade
   */
  fadeIn(delay = 0) {
    if (this.placeholder) {
      this.placeholder.fadeIn(delay)
    }
    if (this.outline) {
      clearTimeout(this._outlineFadeTimer)
      gsap.killTweensOf(this._outlineAnim)
      this.outline.visible = false
      this._outlineAnim = { opacity: 0 }
      this._outlineFadeTimer = setTimeout(() => {
        this.outline.visible = true
        this.outline.material.opacity = 0
        gsap.to(this._outlineAnim, {
          opacity: 1,
          duration: 0.3,
          ease: 'power2.out',
          onUpdate: () => { this.outline.material.opacity = this._outlineAnim.opacity },
        })
      }, delay)
    }
  }

  /**
   * Fade out placeholder (outline visibility is controlled separately via GUI)
   */
  fadeOut() {
    this.placeholder?.fadeOut()
  }

  /**
   * Populate from cube-coordinate WFC results
   * @param {Array} tiles - [{q,r,s,type,rotation,level}] solved tiles in global cube coords
   * @param {Array} collapseOrder - [{q,r,s,type,rotation,level}] in WFC collapse order for animation
   * @param {Object} globalCenterCube - {q,r,s} grid center in global cube coords
   * @param {Object} options - { animate, animateDelay }
   */
  async populateFromCubeResults(tiles, collapseOrder, globalCenterCube, options = {}) {
    // Ensure meshes are initialized
    if (!this.hexMesh) {
      await this.initMeshes(HexTileGeometry.geoms)
    }

    const baseSize = this.gridRadius * 2 + 1
    this.hexTiles = []
    this.hexGrid = Array.from({ length: baseSize }, () => Array(baseSize).fill(null))

    // Convert cube coords to local grid coords and place tiles
    const placements = []
    for (const tile of tiles) {
      const { gridX, gridZ } = globalToLocalGrid(tile, globalCenterCube, this.gridRadius)

      placements.push({
        gridX, gridZ,
        type: tile.type,
        rotation: tile.rotation,
        level: tile.level,
      })
    }

    // Convert collapse order the same way
    const localCollapseOrder = collapseOrder.map(tile => {
      const { gridX, gridZ } = globalToLocalGrid(tile, globalCenterCube, this.gridRadius)
      return {
        gridX, gridZ,
        type: tile.type,
        rotation: tile.rotation,
        level: tile.level,
      }
    })

    // Transition to POPULATED state
    this.state = HexGridState.POPULATED
    this.updateVisibility()

    // Place all tiles
    for (const placement of placements) {
      this.placeTile(placement)
    }
    this.updateMatrices()
    this.populateDecorations()

    // Apply debug level colors if active
    if (HexTile.debugLevelColors) {
      this.updateTileColors()
    }

    const animate = options.animate ?? false
    const animateDelay = options.animateDelay ?? 20

    if (animate) {
      // Pause windmill fan spin tweens so they don't fight the drop animation
      if (this.decorations) {
        for (const fan of this.decorations.windmillFans) {
          fan.tween?.pause()
        }
      }
      this.hideAllInstances()
      this.animatePlacements(localCollapseOrder, animateDelay)
    }

    // Return estimated animation duration so callers can time follow-up actions
    const animDuration = animate ? localCollapseOrder.length * animateDelay : 0
    return animDuration
  }

  /**
   * Place a single tile
   */
  placeTile(placement) {
    const gridRadius = this.gridRadius
    const offsetCol = placement.gridX - gridRadius
    const offsetRow = placement.gridZ - gridRadius
    if (!isInHexRadius(offsetCol, offsetRow, gridRadius)) return null

    const tile = new HexTile(placement.gridX, placement.gridZ, placement.type, placement.rotation)
    tile.level = placement.level ?? 0
    tile.updateLevelColor()
    this.hexGrid[placement.gridX][placement.gridZ] = tile
    this.hexTiles.push(tile)

    if (this.hexMesh && this.geomIds.has(placement.type)) {
      const geomId = this.geomIds.get(placement.type)
      tile.instanceId = this.hexMesh.addInstance(geomId)
      this.hexMesh.setColorAt(tile.instanceId, tile.color)
      // Hide initially
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      this.hexMesh.setMatrixAt(tile.instanceId, this.dummy.matrix)
    }

    // Add debug overlay if tile has debug property
    const tileDef = TILE_LIST[placement.type]
    if (tileDef?.debug !== undefined && this.debugMesh) {
      const isObj = typeof tileDef.debug === 'object'
      const color = isObj ? tileDef.debug.color : tileDef.debug
      const stripe = isObj ? tileDef.debug.stripe : null

      const geomId = stripe ? this.debugStripeGeomId : this.debugGeomId
      const debugId = this.debugMesh.addInstance(geomId)
      this.debugMesh.setColorAt(debugId, new Color(color))

      const { quat, yOffset } = computeDebugTransform(tileDef, placement.rotation)

      // Hide initially
      this.dummy.scale.setScalar(0)
      this.dummy.updateMatrix()
      this.debugMesh.setMatrixAt(debugId, this.dummy.matrix)
      this.debugInstances.set(`${placement.gridX},${placement.gridZ}`, { id: debugId, quat, yOffset })
    }

    return tile
  }

  /**
   * Replace an existing tile with a different type/rotation
   * Used by neighbor tile replacement to fix seed conflicts
   */
  replaceTile(gridX, gridZ, newType, newRotation, newLevel = 0) {
    if (!this.hexGrid) return null
    const oldTile = this.hexGrid[gridX]?.[gridZ]
    if (!oldTile) {
      console.warn(`[replaceTile] No tile at (${gridX}, ${gridZ})`)
      return null
    }

    // Kill any running drop animation on this tile
    if (oldTile._anim) {
      gsap.killTweensOf(oldTile._anim)
      oldTile._anim = null
    }

    // Update tile data
    oldTile.type = newType
    oldTile.rotation = newRotation
    oldTile.level = newLevel
    oldTile.updateLevelColor()

    // Update BatchedMesh geometry
    if (this.hexMesh && this.geomIds.has(newType) && oldTile.instanceId !== undefined) {
      const newGeomId = this.geomIds.get(newType)
      this.hexMesh.setGeometryIdAt(oldTile.instanceId, newGeomId)
      this.hexMesh.setColorAt(oldTile.instanceId, oldTile.color)

      // Update matrix for new rotation
      const offsetCol = gridX - this.gridRadius
      const offsetRow = gridZ - this.gridRadius
      const pos = HexTileGeometry.getWorldPosition(offsetCol, offsetRow)
      this.dummy.position.set(pos.x, oldTile.level * LEVEL_HEIGHT, pos.z)
      this.dummy.rotation.y = -oldTile.rotation * Math.PI / 3
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()
      this.hexMesh.setMatrixAt(oldTile.instanceId, this.dummy.matrix)

      // Update debug overlay
      const tileKey = `${gridX},${gridZ}`
      const existingDebug = this.debugInstances.get(tileKey)
      if (existingDebug !== undefined && this.debugMesh) {
        this.debugMesh.deleteInstance(existingDebug.id)
        this.debugInstances.delete(tileKey)
      }
      const newDef = TILE_LIST[newType]
      if (newDef?.debug !== undefined && this.debugMesh) {
        const isObj = typeof newDef.debug === 'object'
        const color = isObj ? newDef.debug.color : newDef.debug
        const stripe = isObj ? newDef.debug.stripe : null
        const geomId = stripe ? this.debugStripeGeomId : this.debugGeomId
        const debugId = this.debugMesh.addInstance(geomId)
        this.debugMesh.setColorAt(debugId, new Color(color))
        const { quat, yOffset } = computeDebugTransform(newDef, newRotation)
        this.dummy.position.set(pos.x, oldTile.level * LEVEL_HEIGHT + yOffset, pos.z)
        this.dummy.quaternion.copy(quat)
        this.dummy.scale.setScalar(1)
        this.dummy.updateMatrix()
        this.debugMesh.setMatrixAt(debugId, this.dummy.matrix)
        this.dummy.rotation.set(0, 0, 0)
        this.debugInstances.set(tileKey, { id: debugId, quat, yOffset })
      }

      // Update bottom fill
      const fillKey = tileKey
      const existingFillId = this.bottomFills.get(fillKey)
      if (existingFillId !== undefined) {
        this.hexMesh.deleteInstance(existingFillId)
        this.bottomFills.delete(fillKey)
      }
      if (newLevel >= 1 && this.bottomGeomId !== null) {
        const fillId = this.hexMesh.addInstance(this.bottomGeomId)
        this.hexMesh.setColorAt(fillId, oldTile.color)
        const tileY = newLevel * LEVEL_HEIGHT
        this.dummy.position.set(pos.x, tileY, pos.z)
        this.dummy.rotation.y = 0
        this.dummy.scale.set(1, tileY, 1)
        this.dummy.updateMatrix()
        this.hexMesh.setMatrixAt(fillId, this.dummy.matrix)
        this.bottomFills.set(fillKey, fillId)
      }
    }

    return oldTile
  }

  hideAllInstances() { _hideAllInstances(this) }
  animateTileDrop(tile) { _animateTileDrop(this, tile) }
  animatePlacements(collapseOrder, delay) { _animatePlacements(this, collapseOrder, delay) }
  animateDecoration(items) { _animateDecoration(this, items) }

  /**
   * Update all tile matrices
   */
  updateMatrices() {
    if (!this.hexMesh || !this.hexTiles) return

    const dummy = this.dummy
    const rotationAngles = [0, 1, 2, 3, 4, 5].map(r => -r * Math.PI / 3)
    const gridRadius = this.gridRadius
    // Clear old bottom fills
    for (const fillId of this.bottomFills.values()) {
      this.hexMesh.deleteInstance(fillId)
    }
    this.bottomFills = new Map()

    const WHITE = new Color(0xffffff)

    for (const tile of this.hexTiles) {
      if (tile.instanceId === null) continue

      const pos = HexTileGeometry.getWorldPosition(
        tile.gridX - gridRadius,
        tile.gridZ - gridRadius
      )
      dummy.position.set(pos.x, tile.level * LEVEL_HEIGHT, pos.z)
      dummy.scale.set(1, 1, 1)
      dummy.rotation.y = rotationAngles[tile.rotation]
      dummy.updateMatrix()

      this.hexMesh.setMatrixAt(tile.instanceId, dummy.matrix)
      this.hexMesh.setVisibleAt(tile.instanceId, true)

      // Position debug overlay
      const debugEntry = this.debugInstances.get(`${tile.gridX},${tile.gridZ}`)
      if (debugEntry !== undefined) {
        dummy.position.set(pos.x, tile.level * LEVEL_HEIGHT + debugEntry.yOffset, pos.z)
        dummy.quaternion.copy(debugEntry.quat)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        this.debugMesh.setMatrixAt(debugEntry.id, dummy.matrix)
        dummy.rotation.set(0, 0, 0)
      }

      // Add bottom fill under elevated tiles (geometry hangs downward from Y=0)
      if (tile.level >= 1 && this.bottomGeomId !== null) {
        const fillId = this.hexMesh.addInstance(this.bottomGeomId)
        this.hexMesh.setColorAt(fillId, tile.color)
        const tileY = tile.level * LEVEL_HEIGHT
        dummy.position.set(pos.x, tileY, pos.z)
        dummy.rotation.y = 0
        dummy.scale.set(1, tileY, 1)
        dummy.updateMatrix()
        this.hexMesh.setMatrixAt(fillId, dummy.matrix)
        this.bottomFills.set(`${tile.gridX},${tile.gridZ}`, fillId)
      }
    }
  }

  /**
   * Populate decorations (trees, buildings, bridges)
   */
  populateDecorations() {
    if (!this.decorations) return
    this.decorations.populate(this.hexTiles, this.gridRadius)
    this.decorations.populateBuildings(this.hexTiles, this.hexGrid, this.gridRadius)
    this.decorations.populateFlowers(this.hexTiles, this.gridRadius)
    this.decorations.populateRocks(this.hexTiles, this.gridRadius)
    this.decorations.populateHillsAndMountains(this.hexTiles, this.gridRadius)
    this.decorations.populateBridges(this.hexTiles, this.gridRadius)
    this.decorations.populateWaterlilies(this.hexTiles, this.gridRadius)
  }

  /**
   * Update all tile colors (for debug level visualization toggle)
   */
  updateTileColors() {
    if (!this.hexMesh) return
    for (const tile of this.hexTiles) {
      tile.updateLevelColor()
      if (tile.instanceId !== null) {
        this.hexMesh.setColorAt(tile.instanceId, tile.color)
      }
    }
    this.updateSlopeArrows()
  }

  // Pointy-top hex direction unit vectors in XZ plane (+X=east, +Z=south)
  static HEX_DIR_VECTORS = {
    NE: new Vector3(0.5, 0, -Math.sqrt(3) / 2),
    E:  new Vector3(1, 0, 0),
    SE: new Vector3(0.5, 0, Math.sqrt(3) / 2),
    SW: new Vector3(-0.5, 0, Math.sqrt(3) / 2),
    W:  new Vector3(-1, 0, 0),
    NW: new Vector3(-0.5, 0, -Math.sqrt(3) / 2),
  }

  /**
   * Add/remove slope direction arrows for debug level visualization
   */
  updateSlopeArrows() {
    // Remove existing arrows
    if (this.slopeArrows) {
      for (const arrow of this.slopeArrows) this.group.remove(arrow)
    }
    this.slopeArrows = []

    if (!HexTile.debugLevelColors) return

    for (const tile of this.hexTiles) {
      if (!tile.isSlope()) continue

      const highEdges = tile.getHighEdges()
      if (!highEdges || highEdges.size === 0) continue

      // Average high edge directions to get slope direction
      const dir = new Vector3()
      for (const edge of highEdges) {
        const v = HexGrid.HEX_DIR_VECTORS[edge]
        dir.x += v.x
        dir.z += v.z
      }
      dir.normalize()

      const pos = HexTileGeometry.getWorldPosition(
        tile.gridX - this.gridRadius,
        tile.gridZ - this.gridRadius
      )
      const baseDef = TILE_LIST[tile.type]
      const increment = baseDef.levelIncrement ?? 1
      const topY = (tile.level + increment) * LEVEL_HEIGHT + 1.0 + 0.3

      const origin = new Vector3(pos.x, topY, pos.z)
      const arrow = new ArrowHelper(dir, origin, 1.0, 0xffffff, 0.3, 0.15)
      this.group.add(arrow)
      this.slopeArrows.push(arrow)
    }
  }

  /**
   * Clear all tiles
   */
  clearTiles() {
    if (this.hexMesh) {
      for (const tile of this.hexTiles) {
        if (tile.instanceId !== null) {
          this.hexMesh.deleteInstance(tile.instanceId)
        }
      }
      for (const fillId of this.bottomFills.values()) {
        this.hexMesh.deleteInstance(fillId)
      }
    }
    if (this.debugMesh) {
      for (const entry of this.debugInstances.values()) {
        this.debugMesh.deleteInstance(entry.id)
      }
    }
    this.debugInstances = new Map()
    this.bottomFills = new Map()
    this.hexTiles = []
    this.hexGrid = null
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.clearTiles()

    if (this.decorations) {
      this.decorations.dispose()
      this.decorations = null
    }

    if (this.gridHelper) {
      this.gridHelper.dispose()
      this.gridHelper = null
    }

    if (this.placeholder) {
      this.placeholder.dispose()
      this.placeholder = null
    }

    if (this.axesHelper) {
      this.axesHelper.dispose()
      this.axesHelper = null
    }

    if (this.gridLabel) {
      this.gridLabel.element?.remove()
      this.gridLabel = null
    }

    if (this.outline) {
      this.outline.geometry?.dispose()
      this.outline.material?.dispose()
      this.outline = null
    }

    if (this.hexMesh) {
      this.hexMesh.dispose()
      this.hexMesh = null
    }

    if (this.debugMesh) {
      this.debugMesh.dispose()
      this.debugMesh = null
    }
    this.debugInstances = new Map()

    // Remove group from scene
    this.scene.remove(this.group)

    this.geomIds?.clear()
  }
}
