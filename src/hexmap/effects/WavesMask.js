import {
  RenderTarget, RGBAFormat, LinearFilter, Scene, OrthographicCamera,
  Mesh, PlaneGeometry, MeshBasicNodeMaterial, Color, Vector2, Vector4,
} from 'three/webgpu'
import { vec3, vec2, uv, float, texture, uniform, select } from 'three/tsl'

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
 *   1. Render ONLY tile BatchedMeshes top-down (hide everything else)
 *   2. Dilation: blue pixels → black (water), non-blue bright → white (land), max-filter expand
 *   3. Blur: smooth into coast distance gradient
 */
export class WavesMask {
  constructor(renderer) {
    this.renderer = renderer
    const size = 2048

    // Two RTs for ping-pong
    this._rtA = new RenderTarget(size, size, { samples: 1 })
    this._rtA.texture.format = RGBAFormat
    this._rtA.texture.minFilter = LinearFilter
    this._rtA.texture.magFilter = LinearFilter

    this._rtB = new RenderTarget(size, size, { samples: 1 })
    this._rtB.texture.format = RGBAFormat
    this._rtB.texture.minFilter = LinearFilter
    this._rtB.texture.magFilter = LinearFilter

    /** Pre-blurred coast gradient — sample in water shader */
    this.texture = this._rtA.texture
    this.showDebug = false

    // ---- Scene render setup (top-down ortho) ----
    this._sceneCam = new OrthographicCamera(-90, 90, 90, -90, 0.1, 200)
    this._sceneCam.position.set(0, 100, 0)
    this._sceneCam.up.set(0, 0, -1)
    this._sceneCam.lookAt(0, 0, 0)

    // Shared fullscreen camera for post passes
    this._blurCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const texelSize = float(1.0 / size)

    // ---- Dilation material (max-filter with blue detection) ----
    // Radius 23 → ~23px expansion ≈ 2 WU ≈ 1 tile per side
    // 1 H+V pair closes gaps up to ~2 tiles wide
    this._dilateDir = uniform(new Vector2(1, 0))
    const dilateTexNode = texture(this._rtA.texture)
    this._dilateTexNode = dilateTexNode

    const dilateUV = uv()
    const dilateRadius = 14

    // Sample + classify: blue → 0 (water), non-blue bright → 1 (land), dark → 0 (empty)
    function sampleMask(uvCoord) {
      const s = dilateTexNode.sample(uvCoord)
      const lum = s.r.mul(0.2126).add(s.g.mul(0.7152)).add(s.b.mul(0.0722))
      // Blue detection (same as PostFX water masking)
      const isBlue = s.b.greaterThan(s.r.mul(2.0))
        .and(s.b.greaterThan(s.g.mul(1.15)))
        .and(s.b.sub(s.r).greaterThan(0.15))
      // Blue → black (water), non-blue with any brightness → white (land)
      return select(isBlue, float(0), select(lum.greaterThan(0.03), float(1), float(0)))
    }

    let maxVal = sampleMask(dilateUV)
    for (let i = 1; i <= dilateRadius; i++) {
      const off = vec2(this._dilateDir.x, this._dilateDir.y).mul(texelSize.mul(i))
      maxVal = maxVal.max(sampleMask(dilateUV.add(off)))
      maxVal = maxVal.max(sampleMask(dilateUV.sub(off)))
    }

    const dilateMat = new MeshBasicNodeMaterial()
    dilateMat.colorNode = vec3(maxVal, maxVal, maxVal)

    this._dilateScene = new Scene()
    this._dilateScene.add(new Mesh(new PlaneGeometry(2, 2), dilateMat))

    // ---- Blur material (separable box blur) ----
    // Radius 12 → 25-tap kernel, each pass spreads ~12px ≈ 1.05 WU
    // 4 H+V pairs → 4×12 = 48px reach ≈ 4.2 WU ≈ 2.1 tiles
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

    const blurMat = new MeshBasicNodeMaterial()
    blurMat.colorNode = vec3(sum.r, sum.g, sum.b)

    this._blurScene = new Scene()
    this._blurScene.add(new Mesh(new PlaneGeometry(2, 2), blurMat))

    // ---- Chroma key material (blue → white, non-blue → black) ----
    const chromaTexNode = texture(this._rtA.texture)
    this._chromaTexNode = chromaTexNode
    const chromaSample = chromaTexNode.sample(uv())
    const isBlue = chromaSample.b.greaterThan(chromaSample.r.mul(2.0))
      .and(chromaSample.b.greaterThan(chromaSample.g.mul(1.15)))
      .and(chromaSample.b.sub(chromaSample.r).greaterThan(0.15))
    const chromaVal = select(isBlue, float(1), float(0))
    const chromaMat = new MeshBasicNodeMaterial()
    chromaMat.colorNode = vec3(chromaVal, chromaVal, chromaVal)

    this._chromaScene = new Scene()
    this._chromaScene.add(new Mesh(new PlaneGeometry(2, 2), chromaMat))

    // ---- Copy material (passthrough, used to copy rtB → rtA) ----
    const copyTexNode = texture(this._rtB.texture)
    this._copyTexNode = copyTexNode
    const copyMat = new MeshBasicNodeMaterial()
    copyMat.colorNode = copyTexNode.sample(uv())

    this._copyScene = new Scene()
    this._copyScene.add(new Mesh(new PlaneGeometry(2, 2), copyMat))

    // ---- Solid blue material (for water plane in mask render) ----
    this._blueMat = new MeshBasicNodeMaterial()
    this._blueMat.colorNode = vec3(0, 0, float(1))

    // ---- Debug scene (renders rtA contents to a small viewport) ----
    const debugTexNode = texture(this._rtA.texture)
    const debugMat = new MeshBasicNodeMaterial()
    const debugUV = vec2(uv().x, float(1).sub(uv().y))
    debugMat.colorNode = debugTexNode.sample(debugUV)
    debugMat.depthTest = false
    debugMat.depthWrite = false

    this._debugScene = new Scene()
    this._debugScene.add(new Mesh(new PlaneGeometry(2, 2), debugMat))
  }

  /**
   * Render waves mask and process it. Call once after each grid build.
   * Hides everything in the scene except the tile meshes and water plane.
   * @param {Scene} mainScene
   * @param {Object3D[]} showMeshes - tile BatchedMeshes to render
   * @param {Mesh} [waterPlane] - water plane mesh (rendered as blue for water detection)
   */
  render(mainScene, showMeshes = [], waterPlane = null) {
    const { renderer, _sceneCam, _rtA, _rtB, _blurCam } = this

    // ---- Step 1: render tiles + blue water plane top-down to rtA ----
    const savedBackground = mainScene.background
    const savedClearColor = renderer.getClearColor(new Color())
    const savedClearAlpha = renderer.getClearAlpha()

    mainScene.background = null

    // Temporarily swap water plane material to solid blue
    let savedWaterMat = null
    if (waterPlane) {
      savedWaterMat = waterPlane.material
      waterPlane.material = this._blueMat
    }

    // Hide everything, then show only tile meshes + water plane
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

    // Restore scene state
    mainScene.background = savedBackground
    for (const [obj, vis] of savedVis) obj.visible = vis
    if (waterPlane && savedWaterMat) waterPlane.material = savedWaterMat

    // ---- Step 2: Dilation (classify + expand land) ----
    // Reads rtA (PBR render), blue → black (water), non-blue bright → white (land)
    // Max-filter expands white into water areas
    // 1 H+V pair, radius 16 → ~16px expansion ≈ 1.4 WU per side
    this._dilateTexNode.value = _rtA.texture
    this._dilateDir.value.set(1, 0)
    renderer.setRenderTarget(_rtB)
    renderer.render(this._dilateScene, _blurCam)

    this._dilateTexNode.value = _rtB.texture
    this._dilateDir.value.set(0, 1)
    renderer.setRenderTarget(_rtA)
    renderer.render(this._dilateScene, _blurCam)

    // ---- Step 3: Blur (smooth into coast distance gradient) ----
    // 2 H+V pairs, radius 12 → less smooth, tighter gradient
    for (let i = 0; i < 2; i++) {
      this._blurTexNode.value = _rtA.texture
      this._blurDir.value.set(1, 0)
      renderer.setRenderTarget(_rtB)
      renderer.render(this._blurScene, _blurCam)

      this._blurTexNode.value = _rtB.texture
      this._blurDir.value.set(0, 1)
      renderer.setRenderTarget(_rtA)
      renderer.render(this._blurScene, _blurCam)
    }

    // Result in rtA — this.texture already points to _rtA.texture
    renderer.setRenderTarget(null)
    renderer.setClearColor(savedClearColor, savedClearAlpha)
  }

  /** Render waves mask RT to a small debug viewport in bottom-left corner */
  renderDebug() {
    const { renderer, _blurCam, _debugScene } = this
    const vp = new Vector4()
    renderer.getViewport(vp)
    const savedAutoClear = renderer.autoClear

    renderer.setRenderTarget(null)
    renderer.autoClear = false
    const y = window.innerHeight - 256
    renderer.setViewport(0, y, 256, 256)
    renderer.setScissor(0, y, 256, 256)
    renderer.setScissorTest(true)
    renderer.render(_debugScene, _blurCam)
    renderer.setScissorTest(false)
    renderer.autoClear = savedAutoClear
    renderer.setViewport(vp)
  }
}
