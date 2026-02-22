import {
  RenderTarget, RGBAFormat, LinearFilter,
  Scene, OrthographicCamera,
  Mesh, PlaneGeometry, CircleGeometry, MeshBasicNodeMaterial, Color, Vector2, Vector4,
} from 'three/webgpu'
import { vec3, vec2, uv, float, texture, uniform, select } from 'three/tsl'
import { CUBE_DIRS, cubeKey, cubeToOffset } from '../HexWFCCore.js'
import { TileType } from '../HexTileData.js'
import { HexTileGeometry } from '../HexTiles.js'

/**
 * Standalone waves mask renderer with GPU expand + blur.
 *
 * Dimensions:
 *   Map radius ≈ 84 WU, camera extent = 180 WU (-90..90)
 *   Texture size = 2048px → 1px ≈ 0.088 world units
 *   HEX_WIDTH = 2 WU → 1 tile ≈ 22.8px
 *   2 hex tiles (target wave reach) ≈ 45px
 *
 * Pipeline (runs once after grid build):
 *   1. Render tile BatchedMeshes top-down (hide everything else)
 *   2. Dilation: blue → black (water), non-blue bright → white (land), max-filter expand → _rtA
 *   3. Blur: smooth into coast distance gradient → _rtA
 *   4. Cove: white hexes at concave cells → dilate → blur → _rtCove
 */
export class WavesMask {
  constructor(renderer) {
    this.renderer = renderer
    const size = 2048

    function makeRT() {
      const rt = new RenderTarget(size, size, { samples: 1 })
      rt.texture.format = RGBAFormat
      rt.texture.minFilter = LinearFilter
      rt.texture.magFilter = LinearFilter
      return rt
    }

    this._rtA = makeRT()
    this._rtB = makeRT()
    this._rtCove = makeRT()

    /** Coast gradient texture — sample in water shader */
    this.texture = this._rtA.texture
    /** Cove mask texture — separate from gradient */
    this.coveTexture = this._rtCove.texture
    this.showDebug = true

    // ---- Scene render setup (top-down ortho) ----
    this._sceneCam = new OrthographicCamera(-90, 90, 90, -90, 0.1, 200)
    this._sceneCam.position.set(0, 100, 0)
    this._sceneCam.up.set(0, 0, -1)
    this._sceneCam.lookAt(0, 0, 0)

    // Shared fullscreen quad + camera for all post passes
    this._postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._quad = new Mesh(new PlaneGeometry(2, 2))
    this._quadScene = new Scene()
    this._quadScene.add(this._quad)

    const texelSize = float(1.0 / size)

    // Shared direction uniform for both dilation materials
    this._dilateDir = uniform(new Vector2(1, 0))

    // ---- Dilation material (max-filter with blue detection) ----
    // Radius 14 → ~14px expansion ≈ 1.2 WU
    const dilateTexNode = texture(this._rtA.texture)
    this._dilateTexNode = dilateTexNode

    const dilateUV = uv()
    const dilateRadius = 14

    function sampleMask(uvCoord) {
      const s = dilateTexNode.sample(uvCoord)
      const lum = s.r.mul(0.2126).add(s.g.mul(0.7152)).add(s.b.mul(0.0722))
      const isBlue = s.b.greaterThan(s.r.mul(2.0))
        .and(s.b.greaterThan(s.g.mul(1.15)))
        .and(s.b.sub(s.r).greaterThan(0.15))
      return select(isBlue, float(0), select(lum.greaterThan(0.03), float(1), float(0)))
    }

    let maxVal = sampleMask(dilateUV)
    for (let i = 1; i <= dilateRadius; i++) {
      const off = vec2(this._dilateDir.x, this._dilateDir.y).mul(texelSize.mul(i))
      maxVal = maxVal.max(sampleMask(dilateUV.add(off)))
      maxVal = maxVal.max(sampleMask(dilateUV.sub(off)))
    }

    this._dilateMat = new MeshBasicNodeMaterial()
    this._dilateMat.colorNode = vec3(maxVal, maxVal, maxVal)

    // ---- Simple max-filter dilation (for cove mask — no color classification) ----
    const sDilateTexNode = texture(this._rtCove.texture)
    this._simpleDilateTexNode = sDilateTexNode
    const sDilateUV = uv()
    const sDilateRadius = 14
    let sMaxVal = sDilateTexNode.sample(sDilateUV).r
    for (let i = 1; i <= sDilateRadius; i++) {
      const off = vec2(this._dilateDir.x, this._dilateDir.y).mul(texelSize.mul(i))
      sMaxVal = sMaxVal.max(sDilateTexNode.sample(sDilateUV.add(off)).r)
      sMaxVal = sMaxVal.max(sDilateTexNode.sample(sDilateUV.sub(off)).r)
    }
    this._simpleDilateMat = new MeshBasicNodeMaterial()
    this._simpleDilateMat.colorNode = vec3(sMaxVal, sMaxVal, sMaxVal)

    // ---- Blur material (separable box blur) ----
    // Radius 12 → 25-tap kernel, each pass spreads ~12px ≈ 1.05 WU
    this._blurDir = uniform(new Vector2(1, 0))
    const blurTexNode = texture(this._rtA.texture)
    this._blurTexNode = blurTexNode

    const blurUV = uv()
    const blurRadius = 12
    let sum = blurTexNode.sample(blurUV)
    for (let i = 1; i <= blurRadius; i++) {
      const off = vec2(this._blurDir.x, this._blurDir.y).mul(texelSize.mul(i))
      sum = sum.add(blurTexNode.sample(blurUV.add(off)))
      sum = sum.add(blurTexNode.sample(blurUV.sub(off)))
    }
    sum = sum.div(blurRadius * 2 + 1)

    this._blurMat = new MeshBasicNodeMaterial()
    this._blurMat.colorNode = vec3(sum.r, sum.g, sum.b)

    // ---- Debug materials (gradient from _rtA, cove from _rtCove) ----
    const dbgFlipUV = vec2(uv().x, float(1).sub(uv().y))

    this._dbgMat = new MeshBasicNodeMaterial()
    this._dbgMat.colorNode = texture(this._rtA.texture).sample(dbgFlipUV)
    this._dbgMat.depthTest = false
    this._dbgMat.depthWrite = false

    this._dbgCoveMat = new MeshBasicNodeMaterial()
    this._dbgCoveMat.colorNode = texture(this._rtCove.texture).sample(dbgFlipUV)
    this._dbgCoveMat.depthTest = false
    this._dbgCoveMat.depthWrite = false

    // ---- Cove overlay (white hexes at concave cells, rendered to separate RT) ----
    this._coveCutoff = 0.978
    this._coveRadius = 2.041
    this._coveBlur = 3
    this._lastGlobalCells = null
    this._coveMat = new MeshBasicNodeMaterial()
    this._coveMat.colorNode = vec3(float(1), float(1), float(1))
    this._coveMat.depthTest = false
    this._coveMat.depthWrite = false
    const hexRadius = 2 / Math.sqrt(3)
    this._coveGeom = new CircleGeometry(hexRadius, 6, Math.PI / 6)
    this._coveGeom.rotateX(-Math.PI / 2)
    this._covePool = []
    this._coveScene = new Scene()

    // ---- Solid blue material (for water plane in mask render) ----
    this._blueMat = new MeshBasicNodeMaterial()
    this._blueMat.colorNode = vec3(0, 0, float(1))
  }

  /** Swap material on shared quad and render to target */
  _renderPass(material, target) {
    this._quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this._quadScene, this._postCam)
  }

  /**
   * Render waves mask and process it. Call once after each grid build.
   * Hides everything in the scene except the tile meshes and water plane.
   * @param {Scene} mainScene
   * @param {Object3D[]} showMeshes - tile BatchedMeshes to render
   * @param {Mesh} [waterPlane] - water plane mesh (rendered as blue for water detection)
   * @param {Map} [globalCells] - global cell map for cove probe
   */
  render(mainScene, showMeshes = [], waterPlane = null, globalCells = null) {
    console.log('%c[waves]%c render', 'color:blue', 'color:black')
    const { renderer, _sceneCam, _rtA, _rtB } = this

    // ---- Step 1: render tiles + blue water plane top-down to _rtA ----
    const savedBackground = mainScene.background
    const savedClearColor = renderer.getClearColor(new Color())
    const savedClearAlpha = renderer.getClearAlpha()

    mainScene.background = null

    let savedWaterMat = null
    if (waterPlane) {
      savedWaterMat = waterPlane.material
      waterPlane.material = this._blueMat
    }

    const showSet = new Set(showMeshes)
    if (waterPlane) showSet.add(waterPlane)
    const savedVis = new Map()
    mainScene.traverse((child) => {
      if (!child.isMesh && !child.isBatchedMesh && !child.isInstancedMesh &&
          !child.isLine && !child.isLineSegments && !child.isPoints) return
      savedVis.set(child, child.visible)
      child.visible = showSet.has(child)
    })

    renderer.setRenderTarget(_rtA)
    renderer.setClearColor(0xFFFFFF, 1)
    renderer.clear()
    renderer.render(mainScene, _sceneCam)

    mainScene.background = savedBackground
    for (const [obj, vis] of savedVis) obj.visible = vis
    if (waterPlane && savedWaterMat) waterPlane.material = savedWaterMat

    // ---- Step 2: Dilation (H+V) ----
    this._dilateTexNode.value = _rtA.texture
    this._dilateDir.value.set(1, 0)
    this._renderPass(this._dilateMat, _rtB)

    this._dilateTexNode.value = _rtB.texture
    this._dilateDir.value.set(0, 1)
    this._renderPass(this._dilateMat, _rtA)

    // ---- Step 3: Blur gradient ----
    this._blurPingPong(_rtA)

    // ---- Step 4: Cove mask (separate RT) ----
    this._lastGlobalCells = globalCells
    this._renderCoveAndBlur(globalCells)

    renderer.setRenderTarget(null)
    renderer.setClearColor(savedClearColor, savedClearAlpha)
  }

  /** Render debug viewports: gradient (left) and cove mask (right) */
  renderDebug() {
    const { renderer, _postCam } = this
    const vp = new Vector4()
    renderer.getViewport(vp)
    const savedAutoClear = renderer.autoClear

    renderer.setRenderTarget(null)
    renderer.autoClear = false

    const dbgSize = 300
    const y = window.innerHeight - dbgSize

    // Left: gradient mask (_rtA)
    renderer.setViewport(0, y, dbgSize, dbgSize)
    renderer.setScissor(0, y, dbgSize, dbgSize)
    renderer.setScissorTest(true)
    this._quad.material = this._dbgMat
    renderer.render(this._quadScene, _postCam)

    // Right: cove mask (_rtCove)
    renderer.setViewport(dbgSize, y, dbgSize, dbgSize)
    renderer.setScissor(dbgSize, y, dbgSize, dbgSize)
    this._quad.material = this._dbgCoveMat
    renderer.render(this._quadScene, _postCam)

    renderer.setScissorTest(false)
    renderer.autoClear = savedAutoClear
    renderer.setViewport(vp)
  }

  /**
   * Lightweight re-render of cove mask only.
   * Called from GUI slider changes without re-running the full gradient pipeline.
   */
  renderCoveOverlay() {
    if (!this._lastGlobalCells) return
    this._renderCoveAndBlur(this._lastGlobalCells)
    this.renderer.setRenderTarget(null)
  }

  /**
   * Run separable box blur on the given RT (ping-pong with _rtB).
   * Result ends up back in the source RT.
   */
  _blurPingPong(srcRT, iterations = 2) {
    for (let i = 0; i < iterations; i++) {
      this._blurTexNode.value = srcRT.texture
      this._blurDir.value.set(1, 0)
      this._renderPass(this._blurMat, this._rtB)

      this._blurTexNode.value = this._rtB.texture
      this._blurDir.value.set(0, 1)
      this._renderPass(this._blurMat, srcRT)
    }
  }

  /** Render white cove hexes to _rtCove, then dilate and blur independently. */
  _renderCoveAndBlur(globalCells) {
    if (!globalCells || globalCells.size === 0) return
    const { renderer, _rtCove, _sceneCam } = this

    const coveCells = this._computeCoveCells(globalCells)

    // Grow pool if needed
    while (this._covePool.length < coveCells.length) {
      const mesh = new Mesh(this._coveGeom, this._coveMat)
      mesh.visible = false
      this._covePool.push(mesh)
      this._coveScene.add(mesh)
    }

    // Update positions and visibility
    for (let i = 0; i < coveCells.length; i++) {
      this._covePool[i].position.set(coveCells[i].worldX, 50, coveCells[i].worldZ)
      this._covePool[i].visible = true
    }
    for (let i = coveCells.length; i < this._covePool.length; i++) {
      this._covePool[i].visible = false
    }

    renderer.setRenderTarget(_rtCove)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    if (coveCells.length > 0) {
      renderer.render(this._coveScene, _sceneCam)
    }

    // Dilate outward (expand white into surrounding black)
    this._simpleDilateTexNode.value = _rtCove.texture
    this._dilateDir.value.set(1, 0)
    this._renderPass(this._simpleDilateMat, this._rtB)

    this._simpleDilateTexNode.value = this._rtB.texture
    this._dilateDir.value.set(0, 1)
    this._renderPass(this._simpleDilateMat, _rtCove)

    // Blur to smooth edges
    if (this._coveBlur > 0) this._blurPingPong(_rtCove, this._coveBlur)

    console.log(`%c[cove]%c ${coveCells.length} cove cells (cutoff=${this._coveCutoff}, radius=${this._coveRadius})`, 'color:green', 'color:black')
  }

  /**
   * Compute which water cells are "covy" — enclosed by land on opposing sides.
   * Probes 6 axial directions, then scores 3 opposing pairs (NE↔SW, E↔W, SE↔NW).
   * Pair score = min(dirA_weight, dirB_weight). Range: 0.0–3.0.
   */
  _computeCoveCells(globalCells) {
    const cutoff = this._coveCutoff
    const radius = this._coveRadius
    const maxSteps = Math.ceil(radius)
    const pairs = [[0, 3], [1, 4], [2, 5]]
    const results = []

    for (const cell of globalCells.values()) {
      if (cell.type !== TileType.OCEAN) continue

      const weights = new Float32Array(6)
      for (let d = 0; d < 6; d++) {
        const dir = CUBE_DIRS[d]
        for (let step = 1; step <= maxSteps; step++) {
          const nq = cell.q + dir.dq * step
          const nr = cell.r + dir.dr * step
          const ns = cell.s + dir.ds * step
          const neighbor = globalCells.get(cubeKey(nq, nr, ns))

          if (!neighbor) continue  // off map edge = open water
          if (neighbor.type !== TileType.OCEAN) {
            weights[d] = Math.max(0, 1 - (step - 1) / radius)
            break
          }
        }
      }

      let covyness = 0
      for (const [a, b] of pairs) {
        covyness += Math.min(weights[a], weights[b])
      }

      if (covyness >= cutoff) {
        const { col, row } = cubeToOffset(cell.q, cell.r, cell.s)
        const pos = HexTileGeometry.getWorldPosition(col, row)
        results.push({ worldX: pos.x, worldZ: pos.z, covyness })
      }
    }

    return results
  }
}
