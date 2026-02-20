import {
  Object3D,
  MeshPhysicalNodeMaterial,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Mesh,
  MeshStandardMaterial,
  TextureLoader,
  SRGBColorSpace,
} from 'three/webgpu'
import { uniform, varyingProperty, materialColor, diffuseColor, materialOpacity, vec3, vec4, texture, uv, mix, select, positionWorld, positionLocal, positionGeometry, normalLocal, mx_noise_float, float, clamp, time as tslTime, sin, cos, modelWorldMatrix, fract, floor as tslFloor, instanceIndex, drawIndex, textureLoad, textureSize, mat3, mat4, int, ivec2 } from 'three/tsl'
import { cubeKey, parseCubeKey, cubeCoordsInRadius, cubeDistance, offsetToCube, cubeToOffset, localToGlobalCoords, globalToLocalGrid } from './HexWFCCore.js'
import { WFCManager } from './WFCManager.js'
import { ConflictResolver } from './ConflictResolver.js'
import { HexMapDebug } from './HexMapDebug.js'
import { HexMapInteraction } from './HexMapInteraction.js'
import { setStatus, setStatusAsync, log, App } from '../App.js'
import { TILE_LIST, TileType, LEVELS_COUNT } from './HexTileData.js'
import { HexTileGeometry } from './HexTiles.js'
import { HexGrid, HexGridState } from './HexGrid.js'
import {
  GridDirection,
  getGridKey,
  parseGridKey,
  getAdjacentGridKey,
  getGridWorldOffset,
  worldOffsetToGlobalCube,
} from './HexGridConnector.js'
import { initGlobalTreeNoise, Decorations } from './Decorations.js'
import { Water } from './effects/Water.js'
import { Weather } from './effects/Weather.js'
import { random } from '../SeededRandom.js'
import { Sounds } from '../lib/Sounds.js'

const LEVEL_HEIGHT = 0.5
const TILE_SURFACE = 1

/**
 * Get all grid coordinates within the hex radius (19 grids at radius 2)
 * Returns [q, gz] pairs in flat-top hex odd-q offset layout
 */
function getAllGridCoordinates(cubeRadius = 2) {
  const coords = []
  for (let q = -cubeRadius; q <= cubeRadius; q++) {
    for (let r = -cubeRadius; r <= cubeRadius; r++) {
      const s = -q - r
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= cubeRadius) {
        const gz = r + Math.floor((q - (q & 1)) / 2)
        coords.push([q, gz])
      }
    }
  }
  return coords
}

/**
 * HexMap - Manages the entire world of multiple HexGrid instances
 *
 * Handles:
 * - Creating and managing multiple HexGrid instances
 * - Grid expansion via placeholder clicks
 * - Shared resources (WFC rules, material)
 *
 * Grids can be in two states:
 * - PLACEHOLDER: Shows clickable button, no tiles yet
 * - POPULATED: Has tiles, shows debug helper when enabled
 */
export class HexMap {
  constructor(scene, params) {
    this.scene = scene
    this.params = params

    this.dummy = new Object3D()

    // Grid management - all grids (both PLACEHOLDER and POPULATED)
    this.grids = new Map()  // key: "x,z" grid coords, value: HexGrid instance
    this.hexGridRadius = 8
    this.roadMaterial = null



    // Global cell map — all collapsed cells across all grids
    // key: "q,r,s" cube coords, value: { q, r, s, type, rotation, level, gridKey }
    this.globalCells = new Map()

    // WFC solver (owns worker, rules, and cell helpers)
    this.wfcManager = new WFCManager(this.globalCells)

    // Debug tile labels
    this.tileLabels = new Object3D()
    this.tileLabels.visible = false
    this.tileLabelMode = 'coords'
    this.failedCells = new Set()   // Track global coords of cells that caused WFC failures (purple labels)
    this.droppedCells = new Set() // Track global coords of dropped fixed cells (red labels)
    this.replacedCells = new Set() // Track global coords of replaced fixed cells (orange labels)

    // Conflict resolution (replacement/validation of fixed cells)
    this.conflictResolver = new ConflictResolver(this.globalCells, this.grids, this.replacedCells)

    // Interaction (hover, pointer events)
    this.interaction = new HexMapInteraction(this)

    // Debug/display manager
    this.debug = new HexMapDebug(this)

    // Helper visibility state
    this.helpersVisible = false
    this.axesHelpersVisible = false

    // Weather
    this.weather = null

    // Regeneration state (prevents overlay rendering during disposal)
    this.isRegenerating = false

    // Convenience alias
    this.hexWfcRules = null
  }

  async init() {
    await HexTileGeometry.init('./assets/models/hex-terrain.glb')
    Decorations.initGeometries(HexTileGeometry.gltfScene)
    this.createFloor()
    this.water = new Water(this.scene, this.coastMaskTexture)
    this.water.init()
    await this.initMaterial()
    this.initWfcRules()
    this.initWfcWorker()
    initGlobalTreeNoise()  // Initialize shared noise for tree placement

    this.weather = new Weather()
    this.weather.init()
    this.scene.add(this.weather.group)

    // Hover highlight for click-to-solve region
    this.interaction.initHoverHighlight()

    // Pre-create all 19 grids with meshes (avoids lag on Build All)
    // Only show center placeholder — others stay hidden until adjacent to a populated grid
    const allCoords = getAllGridCoordinates()
    for (const [gx, gz] of allCoords) {
      const hidden = gx !== 0 || gz !== 0
      const grid = await this.createGrid(gx, gz, { hidden })
      await grid.initMeshes(HexTileGeometry.geoms)
    }

    this.scene.add(this.tileLabels)
  }

  /**
   * Initialize shared material
   */
  async initMaterial() {
    if (!HexTileGeometry.loaded || HexTileGeometry.geoms.size === 0) {
      console.warn('HexTileGeometry not loaded')
      return
    }

    const mat = new MeshPhysicalNodeMaterial()
    mat.roughness = 0.5
    mat.metalness = 0
    this.roadMaterial = mat

    // Override setupDiffuseColor to skip the automatic batchColor multiply.
    // We read vBatchColor ourselves in the colorNode for level data, not as a tint.
    this.roadMaterial.setupDiffuseColor = function(builder) {
      const colorNode = this.colorNode ? vec4(this.colorNode) : materialColor
      diffuseColor.assign(colorNode)
      const opacityNode = this.opacityNode ? float(this.opacityNode) : materialOpacity
      diffuseColor.a.assign(diffuseColor.a.mul(opacityNode))
    }

    // Clone material for trees (separate so we can add wind sway positionNode)
    this.treeMaterial = this.roadMaterial.clone()
    this.treeMaterial.setupDiffuseColor = this.roadMaterial.setupDiffuseColor

    // Load season textures and set up noise-blended colorNode
    await this._initTextureBlend()

    this.roadMaterial.colorNode = this._combinedColor
    this.treeMaterial.colorNode = this._combinedColor

    // Wind sway — override setupPosition to apply sway AFTER batch transform.
    // Replicates BatchNode logic inline so positionLocal is post-batch (world space)
    // before sway is added, ensuring consistent sway direction across all instances.
    this._windStrength = uniform(0.0375)
    this._windSpeed = uniform(1.46)
    this._windFreq = uniform(0.902)
    const time = tslTime
    const windStrength = this._windStrength
    const windSpeed = this._windSpeed
    const windFreq = this._windFreq

    this.treeMaterial.setupPosition = function(builder) {
      const { object } = builder

      if (object.isBatchedMesh) {
        // --- Replicate BatchNode logic to get batchingMatrix ---
        const batchingIdNode = builder.getDrawIndex() === null ? instanceIndex : drawIndex

        // Indirect index lookup
        const indTex = object._indirectTexture
        const indSize = textureSize(textureLoad(indTex), 0)
        const indX = int(batchingIdNode).modInt(int(indSize))
        const indY = int(batchingIdNode).div(int(indSize))
        const indirectId = textureLoad(indTex, ivec2(indX, indY)).x

        // Per-instance matrix from _matricesTexture
        const matTex = object._matricesTexture
        const matSize = textureSize(textureLoad(matTex), 0)
        const j = float(indirectId).mul(4).toInt().toVar()
        const mx = j.modInt(matSize)
        const my = j.div(int(matSize))
        const batchingMatrix = mat4(
          textureLoad(matTex, ivec2(mx, my)),
          textureLoad(matTex, ivec2(mx.add(1), my)),
          textureLoad(matTex, ivec2(mx.add(2), my)),
          textureLoad(matTex, ivec2(mx.add(3), my))
        )

        // Apply batch transform to position
        positionLocal.assign(batchingMatrix.mul(positionLocal))

        // Transform normals
        const bm = mat3(batchingMatrix)
        const transformedNormal = normalLocal.div(vec3(bm[0].dot(bm[0]), bm[1].dot(bm[1]), bm[2].dot(bm[2])))
        normalLocal.assign(bm.mul(transformedNormal).xyz)

        // Per-instance colors (level data + rotation)
        if (object._colorsTexture) {
          const colSize = textureSize(textureLoad(object._colorsTexture), 0).x
          const cx = int(indirectId).modInt(colSize)
          const cy = int(indirectId).div(colSize)
          varyingProperty('vec3', 'vBatchColor').assign(
            textureLoad(object._colorsTexture, ivec2(cx, cy)).rgb
          )
        }

        // --- Wind sway in world space (positionLocal is now post-batch) ---
        const wPos = modelWorldMatrix.mul(vec4(positionLocal, float(1))).xyz
        const phase = wPos.x.mul(windFreq).add(wPos.z.mul(windFreq).mul(0.6))
        const swayMask = positionGeometry.y.mul(windStrength)
        const swayX = sin(time.mul(windSpeed).add(phase)).mul(swayMask)
        const swayZ = sin(time.mul(windSpeed).mul(0.85).add(phase).add(1.5)).mul(swayMask)
        positionLocal.addAssign(vec3(swayX, float(0), swayZ))
      }

      return positionLocal
    }

  }

  /**
   * Load season textures and build the TSL blend node
   */
  async _initTextureBlend() {
    // Load both season textures
    const loader = new TextureLoader()
    const loadTex = (path) => new Promise((resolve) => {
      loader.load(path, (tex) => {
        tex.flipY = false  // GLB geometry UVs expect non-flipped textures
        tex.colorSpace = SRGBColorSpace
        tex.needsUpdate = true
        resolve(tex)
      })
    })

    // Load mask texture (linear, not sRGB — it's a data mask)
    const loadMask = (path) => new Promise((resolve) => {
      loader.load(path, (tex) => {
        tex.flipY = false
        tex.needsUpdate = true
        resolve(tex)
      })
    })

    const [texA, texB, texMask] = await Promise.all([
      loadTex('./assets/textures/moody.png'),
      loadTex('./assets/textures/winter.png'),
      loadMask('./assets/textures/water-mask.png'),
    ])

    this._texA = texA
    this._texB = texB

    // Sample both textures at the same UVs (store nodes for runtime swapping)
    const texCoord = uv()
    this._texNodeA = texture(texA, texCoord)
    this._texNodeB = texture(texB, texCoord)
    this._texNodeMask = texture(texMask, texCoord)
    const sampleA = this._texNodeA
    const sampleB = this._texNodeB

    // Tile level stored in instance color R channel (0 at level 0, 1 at max level)
    // G channel flags decorations (G=1) vs tiles (G=0) to skip slope contribution
    // setupDiffuseColor override prevents auto-multiply, so this is pure data
    const batchColor = varyingProperty('vec3', 'vBatchColor')
    const levelBlend = batchColor.r
    const isDecoration = batchColor.g.greaterThan(0.5)
    // Raw geometry Y (before batch transform) for slope gradient
    // Tile surface is at geomY=1.0, each 0.5u above = +1 level
    // So slope contribution = (geomY - 1.0) / 0.5 / (LEVELS_COUNT - 1)
    const rawGeomPos = positionGeometry.varying('vRawGeomPos')
    const slopeContrib = select(isDecoration,
      rawGeomPos.y.mul(2.0 / (LEVELS_COUNT - 1)),          // decorations: geom starts at y=0
      rawGeomPos.y.sub(1.0).mul(2.0 / (LEVELS_COUNT - 1))  // tiles: surface at y=1.0
    )
    // Level bias shifts the blend ramp up or down (-1 to 1)
    this._levelBias = uniform(0)
    const blendFactor = clamp(levelBlend.add(slopeContrib).add(this._levelBias), 0, 1)

    // Blended season textures (normal mode)
    const blendedColor = mix(sampleA, sampleB, blendFactor)

    // Debug HSL gradient (level colors mode): hue 0 (red) → 250/360 (blue)
    const hue = blendFactor.mul(250.0 / 360.0)
    const h6 = hue.mul(6.0)
    const hslR = clamp(h6.sub(3.0).abs().sub(1.0), 0, 1)
    const hslG = clamp(float(2.0).sub(h6.sub(2.0).abs()), 0, 1)
    const hslB = clamp(float(2.0).sub(h6.sub(4.0).abs()), 0, 1)
    const debugColor = vec3(hslR, hslG, hslB)

    // Mode uniform: 0 = normal (blended textures), 1 = debug HSL, 2 = white
    this._colorMode = uniform(0)
    const isDebug = this._colorMode.equal(1)
    const isWhite = this._colorMode.equal(2)
    this._combinedColor = select(isWhite, vec3(1, 1, 1), select(isDebug, debugColor, blendedColor))

    // Unlit water mask material (for per-frame mask RT render — no PBR overhead)
    this.waterMaskMaterial = new MeshBasicNodeMaterial()
    this.waterMaskMaterial.colorNode = vec3(this._texNodeMask.r)
    // Skip batchColor multiply (R channel encodes level, not a tint)
    this.waterMaskMaterial.setupDiffuseColor = this.roadMaterial.setupDiffuseColor

    this.roadMaterial.needsUpdate = true
  }

  // ---- WFCManager delegators ----
  initWfcRules() { this.wfcManager.initWfcRules(); this.hexWfcRules = this.wfcManager.hexWfcRules; this.conflictResolver.setWfcRules(this.hexWfcRules) }
  initWfcWorker() { this.wfcManager.initWfcWorker() }
  solveWfcAsync(solveCells, fixedCells, options) { return this.wfcManager.solveWfcAsync(solveCells, fixedCells, options) }
  addToGlobalCells(gridKey, tiles) { this.wfcManager.addToGlobalCells(gridKey, tiles) }
  getFixedCellsForRegion(solveCells) { return this.wfcManager.getFixedCellsForRegion(solveCells) }
  getAnchorsForCell(fc, solveSet, fixedSet) { return this.wfcManager.getAnchorsForCell(fc, solveSet, fixedSet) }
  getDefaultTileTypes() { return this.wfcManager.getDefaultTileTypes() }

  // ---- ConflictResolver delegators ----
  findReplacementTilesForCell(q, r, s, currentType, currentRotation, currentLevel) { return this.conflictResolver.findReplacementTilesForCell(q, r, s, currentType, currentRotation, currentLevel) }
  filterConflictingFixedCells(fixedCells) { return this.conflictResolver.filterConflictingFixedCells(fixedCells) }
  validateFixedCellConflicts(solveCells, fixedCells) { return this.conflictResolver.validateFixedCellConflicts(solveCells, fixedCells) }
  tryReplaceFixedCell(fixedCell, fixedCells, replacedKeys) { return this.conflictResolver.tryReplaceFixedCell(fixedCell, fixedCells, replacedKeys) }
  applyTileResultsToGrids(tiles) { return this.conflictResolver.applyTileResultsToGrids(tiles) }

  createFloor() {
    const floorGeometry = new PlaneGeometry(296, 296)
    floorGeometry.rotateX(-Math.PI / 2)

    const floorMaterial = new MeshStandardMaterial({
      color: 0x999999,
      roughness: 0.9,
      metalness: 0.0
    })

    this.floor = new Mesh(floorGeometry, floorMaterial)
    this.floor.receiveShadow = true
    this.scene.add(this.floor)
  }

  /**
   * Create a new HexGrid at grid coordinates (starts in PLACEHOLDER state)
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridZ - Grid Z coordinate
   * @returns {HexGrid} The created grid
   */
  async createGrid(gridX, gridZ, { hidden = false } = {}) {
    const key = getGridKey(gridX, gridZ)
    if (this.grids.has(key)) {
      console.warn(`Grid already exists at ${key}`)
      return this.grids.get(key)
    }

    // Calculate world offset and global cube center
    const worldOffset = this.calculateWorldOffset(gridX, gridZ)
    const globalCenterCube = worldOffsetToGlobalCube(worldOffset)

    // Create grid in PLACEHOLDER state
    const grid = new HexGrid(this.scene, this.roadMaterial, this.hexGridRadius, worldOffset, this.treeMaterial)
    grid.gridCoords = { x: gridX, z: gridZ }
    grid.globalCenterCube = globalCenterCube
    grid.onClick = () => this.onGridClick(grid)

    await grid.init(null, { hidden })  // Placeholder only — meshes init lazily or in batch

    // Apply current axes helper visibility
    if (grid.axesHelper) {
      grid.axesHelper.visible = this.axesHelpersVisible
    }

    // Apply current grid label visibility
    grid.setGridLabelVisible(this.tileLabels.visible)

    this.grids.set(key, grid)

    // Set triangle indicators for populated neighbors
    const neighborDirs = this.getPopulatedNeighborDirections(key)
    grid.setPlaceholderNeighbors(neighborDirs)

    return grid
  }

  /**
   * Populate a grid using global cube coordinates.
   * Orchestrates setup → WFC solve with recovery → result application.
   * @param {HexGrid} grid - Grid to populate
   * @param {Array} seedTiles - Unused (kept for API compatibility)
   * @param {Object} options - { animate, animateDelay, initialCollapses, weights }
   */
  async populateGrid(grid, seedTiles = [], options = {}) {
    if (grid.state === HexGridState.POPULATED) {
      console.warn('Grid already populated')
      return
    }

    this.onBeforeTilesChanged?.()

    const ctx = this._setupPopulateContext(grid, options)
    log(`[${ctx.gridKey}] POPULATING GRID (${ctx.solveCells.length} cells, ${ctx.initialFixedCount} fixed)`, 'color: blue')
    await setStatusAsync(`[${ctx.gridKey}] Solving WFC...`)

    grid.placeholder?.startSpinning()
    const solveResult = await this._runWfcWithRecovery(ctx)
    grid.placeholder?.stopSpinning()

    return this._applyPopulateResults(grid, ctx, solveResult, options)
  }

  /** Build the context object used by _runWfcWithRecovery and _applyPopulateResults */
  _setupPopulateContext(grid, options) {
    const gridKey = getGridKey(grid.gridCoords.x, grid.gridCoords.z)
    const center = grid.globalCenterCube
    const solveCells = cubeCoordsInRadius(center.q, center.r, center.s, this.hexGridRadius)
    const fixedCells = this.getFixedCellsForRegion(solveCells)

    const initialCollapses = options.initialCollapses ?? []
    if (fixedCells.length === 0 && initialCollapses.length === 0) {
      initialCollapses.push({ q: center.q, r: center.r, s: center.s, type: TileType.GRASS, rotation: 0, level: 0 })
      this.addWaterEdgeSeeds(initialCollapses, center, this.hexGridRadius)
    }

    const tileTypes = this.getDefaultTileTypes()
    const solveSet = new Set(solveCells.map(c => cubeKey(c.q, c.r, c.s)))
    const fixedSet = new Set(fixedCells.map(fc => cubeKey(fc.q, fc.r, fc.s)))
    const anchorMap = new Map()
    for (const fc of fixedCells) {
      anchorMap.set(cubeKey(fc.q, fc.r, fc.s), this.getAnchorsForCell(fc, solveSet, fixedSet))
    }

    return {
      gridKey, center, solveCells, fixedCells, initialCollapses, tileTypes,
      anchorMap,
      persistedUnfixedKeys: new Set(),
      persistedUnfixedOriginals: new Map(),
      initialFixedCount: fixedCells.length,
      attempt: 0,
      options,
    }
  }

  /** Track WFC failure info (add to failedCells, log contradiction) */
  _trackWfcFailure(gridKey, wfcResult) {
    if (wfcResult.seedingContradiction) {
      const c = wfcResult.seedingContradiction
      this.failedCells.add(`${c.failedCol},${c.failedRow}`)
      log(`[${gridKey}] Seed conflict at (${c.failedCol},${c.failedRow})`, 'color: red')
    } else if (wfcResult.lastContradiction) {
      const c = wfcResult.lastContradiction
      log(`[${gridKey}] WFC failed at (${c.failedCol},${c.failedRow})`, 'color: red')
    }
  }

  /**
   * Run WFC with full conflict recovery: initial attempt → conflict-WFC → replace → drop
   * @param {Object} ctx - Populate context from _setupPopulateContext
   * @returns {{ result, resultCollapseOrder, changedFixedCells, unfixedKeys, droppedFixedCubes, stats }}
   */
  async _runWfcWithRecovery(ctx) {
    const stats = { postReplacedCount: 0, postDroppedCount: 0, conflictWfcAttempts: 0 }
    const droppedFixedCubes = []
    let result = null
    let resultCollapseOrder = []
    let changedFixedCells = []
    let unfixedKeys = []

    // Phase 0: Initial attempt (solver handles soft fixed cell unfixing internally)
    const initialResult = await this.wfcManager.runWfcAttempt(ctx)
    if (initialResult.success) {
      result = initialResult.tiles
      resultCollapseOrder = initialResult.collapseOrder
      changedFixedCells = initialResult.changedFixedCells || []
      unfixedKeys = initialResult.unfixedKeys || []
      if (unfixedKeys.length > 0) stats.postReplacedCount += changedFixedCells.length
    } else {
      this._trackWfcFailure(ctx.gridKey, initialResult)
      let failedCell = initialResult.failedCell
      let isSeedConflict = initialResult.seedConflict
      let sourceKey = initialResult.sourceKey
      const replacedKeys = new Set()

      // Conflict-WFC phase: Re-solve the area around the conflict source in neighbor grids
      // Only runs for seed conflicts where we know which fixed cell caused the problem
      const maxConflictWfcAttempts = 3
      if (isSeedConflict && sourceKey) {
        for (let cwfc = 0; cwfc < maxConflictWfcAttempts; cwfc++) {
          stats.conflictWfcAttempts++
          const { q: centerQ, r: centerR, s: centerS } = parseCubeKey(sourceKey)
          log(`[${ctx.gridKey}] [Conflict-WFC #${cwfc + 1}] re-solving around (${centerQ},${centerR},${centerS})`, 'color: blue')

          const conflictSolveCells = cubeCoordsInRadius(centerQ, centerR, centerS, 2)
            .filter(c => this.globalCells.has(cubeKey(c.q, c.r, c.s)))
          const conflictFixedCells = this.getFixedCellsForRegion(conflictSolveCells)

          const conflictResult = await this.solveWfcAsync(conflictSolveCells, conflictFixedCells, {
            tileTypes: ctx.tileTypes,
            maxRestarts: 5,
          })

          if (!conflictResult.success || !conflictResult.tiles) {
            log(`[${ctx.gridKey}] [Conflict-WFC #${cwfc + 1}] failed`, 'color: red')
            break
          }

          const changedTilesPerGrid = this.applyTileResultsToGrids(conflictResult.tiles)
          for (const [g, tiles] of changedTilesPerGrid) {
            g.decorations?.repopulateTilesAt(tiles, g.gridRadius, g.hexGrid)
          }
          this.addToGlobalCells('conflict-wfc', conflictResult.tiles)
          log(`[${ctx.gridKey}] [Conflict-WFC #${cwfc + 1}] re-solved ${conflictResult.tiles.length} cells`, 'color: green')

          // Rebuild context from updated globalCells
          ctx.fixedCells = this.getFixedCellsForRegion(ctx.solveCells)
          const newSolveSet = new Set(ctx.solveCells.map(c => cubeKey(c.q, c.r, c.s)))
          const newFixedSet = new Set(ctx.fixedCells.map(fc => cubeKey(fc.q, fc.r, fc.s)))
          ctx.anchorMap.clear()
          for (const fc of ctx.fixedCells) {
            ctx.anchorMap.set(cubeKey(fc.q, fc.r, fc.s), this.getAnchorsForCell(fc, newSolveSet, newFixedSet))
          }
          ctx.persistedUnfixedKeys.clear()
          ctx.persistedUnfixedOriginals.clear()

          const retryResult = await this.wfcManager.runWfcAttempt(ctx)
          if (retryResult.success) {
            result = retryResult.tiles
            resultCollapseOrder = retryResult.collapseOrder
            changedFixedCells = retryResult.changedFixedCells || []
            unfixedKeys = retryResult.unfixedKeys || []
            if (unfixedKeys.length > 0) stats.postReplacedCount += changedFixedCells.length
            break
          }

          this._trackWfcFailure(ctx.gridKey, retryResult)
          failedCell = retryResult.failedCell
          isSeedConflict = retryResult.seedConflict
          sourceKey = retryResult.sourceKey
          if (!isSeedConflict || !sourceKey) break
        }
      }

      // Replace phase: Try replacing fixed cells near the failure (grass-any-level matching)
      // Skip if failure was a seed conflict — replacing won't fix those, only dropping can
      const maxReplaceAttempts = 5
      let replaceAttempts = 0
      if (!isSeedConflict) {
        let replaceExhausted = false
        while (!result && !replaceExhausted && replaceAttempts < maxReplaceAttempts) {
          const replaceCandidates = ctx.fixedCells.filter(fc =>
            !fc.dropped && !replacedKeys.has(cubeKey(fc.q, fc.r, fc.s))
              && !ctx.persistedUnfixedKeys.has(cubeKey(fc.q, fc.r, fc.s))
          )
          if (replaceCandidates.length === 0) { replaceExhausted = true; break }

          if (failedCell) {
            replaceCandidates.sort((a, b) => {
              const distA = cubeDistance(a.q, a.r, a.s, failedCell.q, failedCell.r, failedCell.s)
              const distB = cubeDistance(b.q, b.r, b.s, failedCell.q, failedCell.r, failedCell.s)
              return distA - distB
            })
          }

          const fcToReplace = replaceCandidates[0]
          const replaced = this.tryReplaceFixedCell(fcToReplace, ctx.fixedCells.filter(fc => !fc.dropped), replacedKeys)
          if (!replaced) {
            replacedKeys.add(cubeKey(fcToReplace.q, fcToReplace.r, fcToReplace.s))
            continue
          }

          const co = cubeToOffset(fcToReplace.q, fcToReplace.r, fcToReplace.s)
          stats.postReplacedCount++
          replaceAttempts++
          log(`[${ctx.gridKey}] Post-WFC: replaced fixed cell at (${co.col},${co.row})`, 'color: blue')

          const wfcResult = await this.wfcManager.runWfcAttempt(ctx)
          if (wfcResult.success) {
            result = wfcResult.tiles
            resultCollapseOrder = wfcResult.collapseOrder
            changedFixedCells = wfcResult.changedFixedCells || []
            unfixedKeys = wfcResult.unfixedKeys || []
            if (unfixedKeys.length > 0) stats.postReplacedCount += changedFixedCells.length
          } else {
            this._trackWfcFailure(ctx.gridKey, wfcResult)
            if (wfcResult.seedConflict) break
            if (wfcResult.failedCell) failedCell = wfcResult.failedCell
          }
        }
      }

      // Drop phase: Drop fixed cells one by one, sorted by proximity to failed cell
      while (!result) {
        const dropCandidates = ctx.fixedCells.filter(fc =>
          !fc.dropped && !ctx.persistedUnfixedKeys.has(cubeKey(fc.q, fc.r, fc.s))
        )
        if (dropCandidates.length === 0) break

        if (failedCell) {
          dropCandidates.sort((a, b) => {
            const distA = cubeDistance(a.q, a.r, a.s, failedCell.q, failedCell.r, failedCell.s)
            const distB = cubeDistance(b.q, b.r, b.s, failedCell.q, failedCell.r, failedCell.s)
            return distA - distB
          })
        }

        const fcToDrop = dropCandidates[0]
        const co = cubeToOffset(fcToDrop.q, fcToDrop.r, fcToDrop.s)
        this.droppedCells.add(`${co.col},${co.row}`)
        droppedFixedCubes.push({ q: fcToDrop.q, r: fcToDrop.r, s: fcToDrop.s })
        fcToDrop.dropped = true
        stats.postDroppedCount++
        log(`[${ctx.gridKey}] Post-WFC: dropped fixed cell at (${co.col},${co.row})`, 'color: red')

        const wfcResult = await this.wfcManager.runWfcAttempt(ctx)
        if (wfcResult.success) {
          result = wfcResult.tiles
          resultCollapseOrder = wfcResult.collapseOrder
          changedFixedCells = wfcResult.changedFixedCells || []
          unfixedKeys = wfcResult.unfixedKeys || []
          if (unfixedKeys.length > 0) stats.postReplacedCount += changedFixedCells.length
        } else {
          this._trackWfcFailure(ctx.gridKey, wfcResult)
          if (wfcResult.failedCell) failedCell = wfcResult.failedCell
        }
      }
    }

    return { result, resultCollapseOrder, changedFixedCells, unfixedKeys, droppedFixedCubes, stats }
  }

  /** Apply WFC results: update global cells, render tiles, animate, handle dropped/replaced cells */
  async _applyPopulateResults(grid, ctx, solveResult, options) {
    const { result, resultCollapseOrder, changedFixedCells, unfixedKeys, droppedFixedCubes, stats } = solveResult

    if (!result) {
      log(`[${ctx.gridKey}] WFC FAILED`, 'color: red')
      await setStatusAsync(`[${ctx.gridKey}] WFC FAILED`)
      Sounds.play('incorrect')
      return
    }

    // Log final status
    const { postReplacedCount, postDroppedCount, conflictWfcAttempts } = stats
    const statParts = [`${ctx.initialFixedCount} neighbours`]
    if (ctx.attempt > 1) statParts.push(`${ctx.attempt} attempts`)
    if (postReplacedCount > 0) statParts.push(`${postReplacedCount} post-replaced`)
    if (conflictWfcAttempts > 0) statParts.push(`${conflictWfcAttempts} conflict-wfc`)
    if (postDroppedCount > 0) statParts.push(`${postDroppedCount} post-dropped`)
    const statusMsg = `[${ctx.gridKey}] WFC SUCCESS (${statParts.join(', ')})`
    if (postDroppedCount > 0) {
      const prefix = statParts.filter(s => !s.includes('dropped')).join(', ')
      const dropParts = [`${postDroppedCount} post-dropped`]
      // Multi-style for console (red dropped counts), status bar gets green
      console.log(`%c[${ctx.gridKey}] WFC SUCCESS (${prefix}, %c${dropParts.join(', ')}%c)`, 'color: green', 'color: red', 'color: green')
      setStatus(statusMsg)
    } else {
      log(statusMsg, 'color: green')
    }
    await setStatusAsync(statusMsg)

    // Process changed fixed cells BEFORE addToGlobalCells (which would overwrite gridKey)
    if (changedFixedCells.length > 0) {
      for (const changed of changedFixedCells) {
        const key = cubeKey(changed.q, changed.r, changed.s)
        const existing = this.globalCells.get(key)
        if (existing) {
          // Update rendered tile in source grid (before globalCells is overwritten)
          const sourceGrid = this.grids.get(existing.gridKey)
          if (sourceGrid) {
            const { gridX, gridZ } = globalToLocalGrid(changed, sourceGrid.globalCenterCube, sourceGrid.gridRadius)
            sourceGrid.replaceTile(gridX, gridZ, changed.type, changed.rotation, changed.level)
            // Remove old decorations and add bridge if new tile is a crossing
            sourceGrid.decorations?.clearDecorationsAt(gridX, gridZ)
            const replacedTile = sourceGrid.hexGrid[gridX]?.[gridZ]
            if (replacedTile) {
              sourceGrid.decorations?.addBridgeAt(replacedTile, sourceGrid.gridRadius)
            }
          }

          // Update globalCells with new tile data (keep original gridKey)
          existing.type = changed.type
          existing.rotation = changed.rotation
          existing.level = changed.level

          // Mark as replaced for orange debug labels
          const co = cubeToOffset(changed.q, changed.r, changed.s)
          this.replacedCells.add(`${co.col},${co.row}`)
        }
      }
      log(`[${ctx.gridKey}] Solver replaced ${changedFixedCells.length} soft fixed cell(s)`, 'color: blue')
    }

    // Process persisted-unfixed cells — compare solved result with originals, update source grids
    if (ctx.persistedUnfixedOriginals.size > 0) {
      let persistedReplacedCount = 0
      for (const [key, original] of ctx.persistedUnfixedOriginals) {
        const solvedTile = result.find(t => cubeKey(t.q, t.r, t.s) === key)
        if (!solvedTile) continue

        // Check if tile changed
        if (solvedTile.type !== original.type || solvedTile.rotation !== original.rotation || solvedTile.level !== original.level) {
          persistedReplacedCount++
          const existing = this.globalCells.get(key)
          if (existing) {
            const sourceGrid = this.grids.get(existing.gridKey)
            if (sourceGrid) {
              const { gridX, gridZ } = globalToLocalGrid(original, sourceGrid.globalCenterCube, sourceGrid.gridRadius)
              sourceGrid.replaceTile(gridX, gridZ, solvedTile.type, solvedTile.rotation, solvedTile.level)
              sourceGrid.decorations?.clearDecorationsAt(gridX, gridZ)
              const replacedTile = sourceGrid.hexGrid[gridX]?.[gridZ]
              if (replacedTile) {
                sourceGrid.decorations?.addBridgeAt(replacedTile, sourceGrid.gridRadius)
              }
            }

            existing.type = solvedTile.type
            existing.rotation = solvedTile.rotation
            existing.level = solvedTile.level

            const co = cubeToOffset(original.q, original.r, original.s)
            this.replacedCells.add(`${co.col},${co.row}`)
          }
        }
      }
      if (persistedReplacedCount > 0) {
        log(`[${ctx.gridKey}] Solver replaced ${persistedReplacedCount} persisted-unfixed cell(s)`, 'color: blue')
      }
    }

    // Place mountains on dropped cells to hide edge mismatches
    if (droppedFixedCubes.length > 0) {
      for (const dropped of droppedFixedCubes) {
        const key = cubeKey(dropped.q, dropped.r, dropped.s)
        const existing = this.globalCells.get(key)
        if (existing) {
          const sourceGrid = this.grids.get(existing.gridKey)
          if (sourceGrid) {
            const { gridX, gridZ } = globalToLocalGrid(dropped, sourceGrid.globalCenterCube, sourceGrid.gridRadius)
            const tile = sourceGrid.hexGrid[gridX]?.[gridZ]
            if (tile) {
              sourceGrid.decorations?.clearDecorationsAt(gridX, gridZ)
              sourceGrid.decorations?.addMountainAt(tile, sourceGrid.gridRadius)
            }
          }
        }
      }
    }

    // Add results to global cell map (exclude unfixed cells — they stay in their source grid)
    const unfixedSet = new Set([...unfixedKeys, ...ctx.persistedUnfixedKeys])
    const resultForGlobal = unfixedSet.size > 0
      ? result.filter(t => !unfixedSet.has(cubeKey(t.q, t.r, t.s)))
      : result
    this.addToGlobalCells(ctx.gridKey, resultForGlobal)

    // Populate grid from cube results (exclude unfixed cells — they're rendered in their source grid)
    const params = App.instance?.params ?? this.params
    const animate = options.animate ?? (params?.roads?.animateWFC ?? false)
    const animateDelay = options.animateDelay ?? (params?.roads?.animateDelay ?? 20)

    const resultForGrid = unfixedSet.size > 0
      ? result.filter(t => !unfixedSet.has(cubeKey(t.q, t.r, t.s)))
      : result
    const collapseOrderForGrid = unfixedSet.size > 0
      ? resultCollapseOrder.filter(t => !unfixedSet.has(cubeKey(t.q, t.r, t.s)))
      : resultCollapseOrder

    const animDuration = await grid.populateFromCubeResults(resultForGrid, collapseOrderForGrid, ctx.center, {
      animate,
      animateDelay,
    })

    // Apply current helper visibility state
    grid.setHelperVisible(this.helpersVisible)

    // Notify listeners that tiles changed (for coast mask rebuild)
    // Pass animDuration so caller can wait for drop animation to finish
    this.onTilesChanged?.(animDuration)

    return animDuration
  }

  /**
   * Add a single ocean seed at a random corner of the first grid
   * @param {Array} initialCollapses - Array to push water seeds into
   * @param {Object} center - {q,r,s} grid center cube coords
   * @param {number} radius - Grid radius
   */
  addWaterEdgeSeeds(initialCollapses, center, radius) {
    // 6 corner directions in cube coords
    const corners = [
      { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 },
      { q: -1, r: 1, s: 0 }, { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
    ]
    const dir = corners[Math.floor(random() * 6)]
    const q = center.q + dir.q * radius
    const r = center.r + dir.r * radius
    const s = center.s + dir.s * radius
    initialCollapses.push({ q, r, s, type: TileType.OCEAN, rotation: 0, level: 0 })
  }

  /**
   * Check if a grid position is within the valid bounds (2 rings = 19 grids)
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridZ - Grid Z coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(gridX, gridZ) {
    // Convert flat-top hex odd-q offset to cube coordinates
    const q = gridX
    const r = gridZ - Math.floor((gridX - (gridX & 1)) / 2)
    const s = -q - r
    // Hex distance = max of absolute cube coords
    const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s))
    return ring <= 2
  }

  /**
   * Count how many populated neighbors a grid position has
   * @param {string} gridKey - Grid key to check
   * @returns {number} Number of populated neighbors
   */
  countPopulatedNeighbors(gridKey) {
    return this.getPopulatedNeighborDirections(gridKey).length
  }

  /**
   * Get directions (0-5) that have populated neighbors for a grid position
   * @param {string} gridKey - Grid key to check
   * @returns {number[]} Array of directions with populated neighbors
   */
  getPopulatedNeighborDirections(gridKey) {
    const directions = []
    for (let dir = 0; dir < 6; dir++) {
      const adjacentKey = getAdjacentGridKey(gridKey, dir)
      const adjacentGrid = this.grids.get(adjacentKey)
      if (adjacentGrid?.state === HexGridState.POPULATED) {
        directions.push(dir)
      }
    }
    return directions
  }

  /**
   * Count how many grids are populated
   * @returns {number} Number of populated grids
   */
  countPopulatedGrids() {
    let count = 0
    for (const grid of this.grids.values()) {
      if (grid.state === HexGridState.POPULATED) count++
    }
    return count
  }

  /**
   * Update triangle indicators on all placeholder grids
   * Call this after a grid is populated to update adjacent placeholders
   */
  updateAllPlaceholderTriangles() {
    for (const [key, grid] of this.grids) {
      if (grid.state === HexGridState.PLACEHOLDER) {
        const neighborDirs = this.getPopulatedNeighborDirections(key)
        grid.setPlaceholderNeighbors(neighborDirs)
      }
    }
  }

  /**
   * Remove placeholder grids that are outside bounds or don't have a populated neighbor
   */
  pruneInvalidPlaceholders() {
    for (const [key, grid] of this.grids) {
      if (grid.state !== HexGridState.PLACEHOLDER) continue

      const { x, z } = parseGridKey(key)
      const valid = this.isValidGridPosition(x, z) && this.countPopulatedNeighbors(key) >= 1

      if (!valid) {
        grid.placeholder?.hide()
        if (grid.outline) grid.outline.visible = false
      }
    }
  }

  /**
   * Create placeholder grids around a populated grid
   * Only creates within valid bounds (2 rings = 19 grids max)
   * Only creates placeholders with 1+ populated neighbors
   * @param {string} centerKey - Grid key of the populated grid
   */
  async createAdjacentPlaceholders(centerKey, fadeDelay = 0) {
    const createPromises = []
    const existingToShow = []

    for (let dir = 0; dir < 6; dir++) {
      const adjacentKey = getAdjacentGridKey(centerKey, dir)

      const { x: gridX, z: gridZ } = parseGridKey(adjacentKey)

      // Must be within bounds
      if (!this.isValidGridPosition(gridX, gridZ)) continue

      // Require at least 1 populated neighbor
      const neighborCount = this.countPopulatedNeighbors(adjacentKey)
      if (neighborCount < 1) continue

      const existing = this.grids.get(adjacentKey)
      if (existing) {
        // Already exists (pre-created) — show if it's a hidden placeholder
        if (existing.state === HexGridState.PLACEHOLDER) {
          existingToShow.push(existing)
        }
        continue
      }

      createPromises.push(this.createGrid(gridX, gridZ))
    }

    const newGrids = await Promise.all(createPromises)

    // Fade in new and existing-but-hidden placeholders after WFC animation
    const allToShow = [...newGrids, ...existingToShow]
    if (fadeDelay > 0) {
      for (const grid of allToShow) {
        grid?.fadeIn(fadeDelay)
      }
    } else {
      for (const grid of existingToShow) {
        grid?.placeholder?.show()
        if (grid?.outline) grid.outline.visible = true
      }
    }
  }

  /**
   * Handle click on a grid (placeholder button clicked)
   * @param {HexGrid} grid - Grid that was clicked
   */
  async onGridClick(grid, { skipPrune = false } = {}) {
    if (grid.state !== HexGridState.PLACEHOLDER) return

    const gridKey = getGridKey(grid.gridCoords.x, grid.gridCoords.z)
    const params = App.instance?.params

    const animDuration = await this.populateGrid(grid, [], {
      animate: params?.roads?.animateWFC ?? false,
      animateDelay: params?.roads?.animateDelay ?? 20,
    }) || 0

    if (!skipPrune) {
      // Create placeholders around this newly populated grid, fade in after animation
      await this.createAdjacentPlaceholders(gridKey, animDuration + 300)

      // Remove placeholders outside bounds
      this.pruneInvalidPlaceholders()

      // Update triangle indicators on all remaining placeholders
      this.updateAllPlaceholderTriangles()
    }

    // Refresh tile labels if visible
    if (this.tileLabels.visible) {
      this.createTileLabels()
    }
  }

  /**
   * Auto-expand grids in a given order (for testing/replay)
   * @param {Array<[number,number]>} order - Array of [gridX, gridZ] pairs
   */
  async autoExpand(order) {
    const startTime = performance.now()
    for (const [gx, gz] of order) {
      const key = getGridKey(gx, gz)
      let grid = this.grids.get(key)
      if (!grid) {
        grid = await this.createGrid(gx, gz)
      }
      if (grid.state === HexGridState.PLACEHOLDER) {
        await this.onGridClick(grid, { skipPrune: true })
      }
    }
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    const stats = [
      `${elapsed}s`,
      `${this.replacedCells.size} replaced`,
      `${this.droppedCells.size} dropped`,
      `${this.failedCells.size} conflicts`,
    ]
    log(`[AUTO-BUILD] Done (${stats.join(', ')})`, 'color: green')
  }

  /**
   * Build all grids in a single WFC pass (no fixed cells, no incremental solving)
   * @param {Array<[number,number]>} expansionCoords - Grid coords to populate (besides 0,0)
   * @param {Object} options - { animate, animateDelay }
   */
  async populateAllGrids(expansionCoords = null, options = {}) {
    if (!expansionCoords) {
      expansionCoords = getAllGridCoordinates().filter(([q, gz]) => q !== 0 || gz !== 0)
    }
    const params = App.instance?.params ?? this.params
    const animate = options.animate ?? (params?.roads?.animateWFC ?? false)
    const animateDelay = options.animateDelay ?? (params?.roads?.animateDelay ?? 20)

    // ---- Clear state (inline from regenerateAll) ----
    this.isRegenerating = true
    this.globalCells.clear()
    this.failedCells.clear()
    this.replacedCells.clear()
    this.droppedCells.clear()
    this.clearTileLabels()

    const gridsToDispose = [...this.grids.values()]
    this.grids.clear()
    for (const grid of gridsToDispose) {
      this.scene.remove(grid.group)
    }
    setTimeout(() => {
      for (const grid of gridsToDispose) {
        grid.dispose()
      }
    }, 500)

    this.initWfcRules()

    // ---- Create all grids (PLACEHOLDER state) ----
    const allGridCoords = [[0, 0], ...expansionCoords]
    log(`[BUILD ALL] Creating ${allGridCoords.length} grids...`, 'color: blue')

    for (const [gx, gz] of allGridCoords) {
      await this.createGrid(gx, gz)
    }

    // Allow overlay/AO bypass now that grids exist
    this.isRegenerating = false

    // Start all placeholders spinning
    for (const grid of this.grids.values()) {
      grid.placeholder?.startSpinning()
    }

    // ---- Collect all solve cells (deduplicated) ----
    const solveKeySet = new Set()
    const allSolveCells = []

    for (const [gx, gz] of allGridCoords) {
      const key = getGridKey(gx, gz)
      const grid = this.grids.get(key)
      if (!grid) continue
      const center = grid.globalCenterCube
      const cells = cubeCoordsInRadius(center.q, center.r, center.s, this.hexGridRadius)
      for (const c of cells) {
        const ck = cubeKey(c.q, c.r, c.s)
        if (!solveKeySet.has(ck)) {
          solveKeySet.add(ck)
          allSolveCells.push(c)
        }
      }
    }

    log(`[BUILD ALL] Solving ${allSolveCells.length} cells across ${allGridCoords.length} grids`, 'color: blue')
    await setStatusAsync(`[BUILD ALL] Solving ${allSolveCells.length} cells...`)
    const startTime = performance.now()

    // ---- Seed initial collapses ----
    const centerGrid = this.grids.get('0,0')
    const centerCube = centerGrid.globalCenterCube
    const initialCollapses = [
      { q: centerCube.q, r: centerCube.r, s: centerCube.s, type: TileType.GRASS, rotation: 0, level: 0 }
    ]

    // ---- Single WFC solve (no fixed cells) ----
    const tileTypes = this.getDefaultTileTypes()
    const result = await this.solveWfcAsync(allSolveCells, [], {
      tileTypes,
      weights: {},
      maxRestarts: 5,
      initialCollapses,
      gridId: 'BUILD_ALL',
      attemptNum: 1,
    })

    if (!result.success) {
      log('[BUILD ALL] WFC FAILED', 'color: red')
      const { Sounds } = await import('../lib/Sounds.js')
      Sounds.play('incorrect')
      await setStatusAsync('[BUILD ALL] WFC FAILED')
      for (const grid of this.grids.values()) {
        grid.placeholder?.stopSpinning()
      }
      return
    }

    const solveTime = ((performance.now() - startTime) / 1000).toFixed(1)
    log(`[BUILD ALL] WFC SUCCESS (${result.tiles.length} tiles, ${solveTime}s, ${result.backtracks || 0} backtracks, ${result.restarts || 0} restarts)`, 'color: green')
    await setStatusAsync(`[BUILD ALL] Success! Distributing ${result.tiles.length} tiles...`)

    // ---- Build lookup map from results ----
    const tileMap = new Map()
    for (const tile of result.tiles) {
      tileMap.set(cubeKey(tile.q, tile.r, tile.s), tile)
    }

    // ---- Distribute results to each grid ----
    for (const [gx, gz] of allGridCoords) {
      const gridKey = getGridKey(gx, gz)
      const grid = this.grids.get(gridKey)
      if (!grid) continue

      const center = grid.globalCenterCube
      const gridCells = cubeCoordsInRadius(center.q, center.r, center.s, this.hexGridRadius)

      // Collect tiles for this grid
      const gridTiles = []
      for (const c of gridCells) {
        const ck = cubeKey(c.q, c.r, c.s)
        const tile = tileMap.get(ck)
        if (tile) gridTiles.push(tile)
      }

      // Add to global cells
      this.addToGlobalCells(gridKey, gridTiles)

      // Filter collapse order for this grid's cells
      const gridCollapseOrder = []
      if (result.collapseOrder) {
        const gridCellKeys = new Set(gridCells.map(c => cubeKey(c.q, c.r, c.s)))
        for (const c of result.collapseOrder) {
          const ck = cubeKey(c.q, c.r, c.s)
          if (gridCellKeys.has(ck)) {
            gridCollapseOrder.push(c)
          }
        }
      }

      // Populate the grid visuals
      await grid.populateFromCubeResults(gridTiles, gridCollapseOrder, center, {
        animate,
        animateDelay,
      })

      grid.setHelperVisible(this.helpersVisible)
    }

    // ---- Create placeholders for further expansion ----
    for (const [gx, gz] of allGridCoords) {
      const gridKey = getGridKey(gx, gz)
      await this.createAdjacentPlaceholders(gridKey)
    }
    this.pruneInvalidPlaceholders()
    this.updateAllPlaceholderTriangles()

    // ---- Cleanup ----
    if (this.tileLabels.visible) {
      this.createTileLabels()
    }

    const totalTime = ((performance.now() - startTime) / 1000).toFixed(1)
    log(`[BUILD ALL] Complete (${totalTime}s total)`, 'color: green')
    await setStatusAsync(`[BUILD ALL] Complete (${totalTime}s)`)

    // Notify listeners that tiles changed (for coast mask rebuild + wave fade-in)
    const animDuration = animate ? allGridCoords.length * animateDelay * 10 : 0
    this.onTilesChanged?.(animDuration)
  }

  /**
   * Calculate world offset for grid coordinates
   * Traverses from origin using getGridWorldOffset for consistency
   */
  calculateWorldOffset(gridX, gridZ) {
    if (gridX === 0 && gridZ === 0) {
      return { x: 0, z: 0 }
    }

    const hexWidth = HexTileGeometry.HEX_WIDTH || 2
    const hexHeight = HexTileGeometry.HEX_HEIGHT || (2 / Math.sqrt(3) * 2)

    // Traverse from (0,0) to (gridX, gridZ) using flat-top hex directions
    let totalX = 0
    let totalZ = 0
    let currentX = 0
    let currentZ = 0

    while (currentX !== gridX || currentZ !== gridZ) {
      const dx = gridX - currentX
      const dz = gridZ - currentZ
      const isOddCol = Math.abs(currentX) % 2 === 1

      let direction = null
      let nextX = currentX
      let nextZ = currentZ

      // For flat-top hex, pick direction based on where we need to go
      // N/S for vertical, NE/SE/SW/NW for diagonal
      if (dx === 0) {
        // Pure vertical movement
        if (dz < 0) {
          direction = GridDirection.N
          nextZ -= 1
        } else {
          direction = GridDirection.S
          nextZ += 1
        }
      } else if (dx > 0) {
        // Need to go right (positive x)
        if (dz < 0 || (dz === 0 && !isOddCol)) {
          direction = GridDirection.NE
          nextX += 1
          nextZ += isOddCol ? 0 : -1
        } else {
          direction = GridDirection.SE
          nextX += 1
          nextZ += isOddCol ? 1 : 0
        }
      } else {
        // Need to go left (negative x)
        if (dz < 0 || (dz === 0 && !isOddCol)) {
          direction = GridDirection.NW
          nextX -= 1
          nextZ += isOddCol ? 0 : -1
        } else {
          direction = GridDirection.SW
          nextX -= 1
          nextZ += isOddCol ? 1 : 0
        }
      }

      if (direction !== null) {
        const offset = getGridWorldOffset(this.hexGridRadius, direction, hexWidth, hexHeight)
        totalX += offset.x
        totalZ += offset.z
        currentX = nextX
        currentZ = nextZ
      }

      // Safety check
      if (Math.abs(currentX) > 100 || Math.abs(currentZ) > 100) {
        console.warn('calculateWorldOffset: loop limit reached')
        break
      }
    }

    return { x: totalX, z: totalZ }
  }

  // ---- HexMapInteraction delegators ----
  onPointerMove(pointer, camera) { this.interaction.onPointerMove(pointer, camera) }
  onPointerDown(pointer, camera) { return this.interaction.onPointerDown(pointer, camera) }
  clearHoverHighlight() { this.interaction.clearHoverHighlight() }

  async regenerate(options = {}) {
    await this.regenerateAll(options)
  }

  async regenerateAll(options = {}) {
    // Set flag to prevent overlay rendering during disposal
    this.isRegenerating = true

    // Clear global state
    this.globalCells.clear()
    this.failedCells.clear()
    this.droppedCells.clear()
    this.replacedCells.clear()

    // Clear labels first (they reference grid data)
    this.clearTileLabels()

    // Collect grids to dispose, then clear map FIRST
    // (so getOverlayObjects() won't return disposed objects)
    const gridsToDispose = [...this.grids.values()]
    this.grids.clear()

    // Remove all grid groups from scene BEFORE waiting
    // (so they won't be rendered during the wait)
    for (const grid of gridsToDispose) {
      this.scene.remove(grid.group)
    }

    // Defer disposal to ensure GPU queue has finished with textures
    setTimeout(() => {
      for (const grid of gridsToDispose) {
        grid.dispose()
      }
    }, 500)

    // Clear WFC rules to pick up any changes
    this.initWfcRules()

    // Create center grid and populate it
    const centerGrid = await this.createGrid(0, 0)
    await this.populateGrid(centerGrid, [], options)

    // Create placeholders around center
    await this.createAdjacentPlaceholders('0,0')

    // Refresh labels if visible
    if (this.tileLabels.visible) {
      this.createTileLabels()
    }

    // Clear regeneration flag
    this.isRegenerating = false
  }

  update(dt) {
    if (this.weather) {
      const app = App.instance
      const target = app?.controls?.target
      const camera = app?.camera
      this.weather.update(dt, target, camera)
    }
  }

  // === Water uniform proxies (GUI accesses via app.city._waterSpeed etc.) ===
  get waterPlane() { return this.water?.mesh }
  get _waterOpacity() { return this.water?._waterOpacity }
  get _waterSpeed() { return this.water?._waterSpeed }
  get _waterFreq() { return this.water?._waterFreq }
  get _waterAngle() { return this.water?._waterAngle }
  get _waterBrightness() { return this.water?._waterBrightness }
  get _waterContrast() { return this.water?._waterContrast }
  get _waveSpeed() { return this.water?._waveSpeed }
  get _waveCount() { return this.water?._waveCount }
  get _waveOpacity() { return this.water?._waveOpacity }
  get _waveNoiseBreak() { return this.water?._waveNoiseBreak }
  get _waveWidth() { return this.water?._waveWidth }
  get _waveOffset() { return this.water?._waveOffset }
  get _waveGradientOpacity() { return this.water?._waveGradientOpacity }
  get _waveGradientColor() { return this.water?._waveGradientColor }
  get _waveMaskStrength() { return this.water?._waveMaskStrength }
  get _waveThinRef() { return this.water?._waveThinRef }
  get _waveLowGradCut() { return this.water?._waveLowGradCut }
  get _waveCoveRadius() { return this.water?._waveCoveRadius }
  get _waveCoveEnabled() { return this.water?._waveCoveEnabled }
  get _waveCoveFadeRate() { return this.water?._waveCoveFadeRate }

  // === Accessors for backward compatibility ===

  /**
   * Get all hex tiles across all grids
   */
  get hexTiles() {
    const allTiles = []
    for (const grid of this.grids.values()) {
      allTiles.push(...grid.hexTiles)
    }
    return allTiles
  }

  /**
   * Get hex grid (returns center grid for compatibility)
   */
  get hexGrid() {
    return this.grids.get('0,0')?.hexGrid ?? null
  }

  /**
   * Get WFC grid radius
   */
  get wfcGridRadius() {
    return this.hexGridRadius
  }

  // ---- HexMapDebug delegators ----
  clearTileLabels() { this.debug.clearTileLabels() }
  createTileLabels() { this.debug.createTileLabels() }
  setTileLabelsVisible(visible) { this.debug.setTileLabelsVisible(visible) }
  setHelpersVisible(visible) { this.debug.setHelpersVisible(visible) }
  setAxesHelpersVisible(visible) { this.debug.setAxesHelpersVisible(visible) }
  setOutlinesVisible(visible) { this.debug.setOutlinesVisible(visible) }
  repopulateDecorations() { this.debug.repopulateDecorations() }
  setWhiteMode(enabled) { this.debug.setWhiteMode(enabled) }
  _updateColorNode() { this.debug._updateColorNode() }
  updateTileColors() { this.debug.updateTileColors() }
  getOverlayObjects() { return this.debug.getOverlayObjects() }
  getEffectsObjects() { return this.debug.getEffectsObjects() }
  getWaterObjects() {
    const water = []
    if (this.water?.mesh) water.push(this.water.mesh)
    return water
  }

  /**
   * Swap a biome texture at runtime (lo or hi) — stays on HexMap (tightly coupled to material init)
   */
  swapBiomeTexture(slot, path) {
    const node = slot === 'lo' ? this._texNodeA : this._texNodeB
    if (!node) return
    const ref = this._texA
    const loader = new TextureLoader()
    loader.load(path, (tex) => {
      if (ref) {
        tex.flipY = ref.flipY
        tex.colorSpace = ref.colorSpace
        tex.wrapS = ref.wrapS
        tex.wrapT = ref.wrapT
        tex.channel = ref.channel
      }
      tex.needsUpdate = true
      node.value = tex
      if (slot === 'lo') this._texA = tex
      else this._texB = tex
      this.roadMaterial.needsUpdate = true
      if (this.treeMaterial) this.treeMaterial.needsUpdate = true
    })
  }

  // Stub methods for App.js compatibility
  onHover() {}
  onPointerUp() {}
  onRightClick() {}
  startIntroAnimation() {}
}
