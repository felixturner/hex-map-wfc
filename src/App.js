import {
  Clock,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Scene,
  NoToneMapping,
  Plane,
  WebGPURenderer,
  PCFSoftShadowMap,
  AxesHelper,
  MeshBasicNodeMaterial,
} from 'three/webgpu'
import { OrbitControls, CSS2DRenderer } from 'three/examples/jsm/Addons.js'
import Stats from 'three/addons/libs/stats.module.js'
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js'
import { Pointer } from './lib/Pointer.js'
import { GUIManager } from './GUI.js'
import { HexMap } from './hexmap/HexMap.js'
import { Lighting } from './Lighting.js'
import { PostFX } from './PostFX.js'
import { WavesMask } from './hexmap/effects/WavesMask.js'
import { setSeed } from './SeededRandom.js'
import { LEVELS_COUNT } from './hexmap/HexTileData.js'
import { vec3 } from 'three/tsl'
import gsap from 'gsap'

// Global status update function
export function setStatus(text) {
  if (App.instance?.statusElement) {
    App.instance.statusElement.textContent = text
  }
}

// Set status and yield to browser so the paint is visible
export function setStatusAsync(text) {
  setStatus(text)
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
}

// Log to both console and status bar
export function log(text, style = '') {
  if (style) {
    console.log(`%c${text}`, style)
  } else {
    console.log(text)
  }
  setStatus(text, style)
}

export class App {
  static instance = null

  constructor(canvas) {
    this.canvas = canvas
    this.renderer = null
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
    this.perspCamera = new PerspectiveCamera(30, 1, 1, 1000)
    this.camera = this.perspCamera
    this.controls = null
    this.postFX = null
    this.scene = new Scene()
    this.pointerHandler = null
    this.clock = new Clock(false)
    this.targetFPS = 60
    this.frameInterval = 1 / 60
    this.lastFrameTime = 0
    this.resizeTimeout = null

    // Module instances
    this.gui = null
    this.city = null
    this.lighting = null
    this.params = null
    this.cssRenderer = null  // CSS2DRenderer for debug labels
    this.buildMode = false  // false = Move (camera only), true = Build (click to WFC)

    if (App.instance != null) {
      console.warn('App instance already exists')
      return null
    }
    App.instance = this
    window.app = this  // Expose for console debugging
  }

  async init() {
    if (WebGPU.isAvailable() === false) {
      return
    }

    const seed = Math.floor(Math.random() * 100000)
    setSeed(seed)
    console.log(`%c[SEED] ${seed}`, 'color: black')
    console.log(`%c[LEVELS] ${LEVELS_COUNT}`, 'color: black')
    this.seed = seed
    
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true })
    await this.renderer.init()
    // DPR 2 with half-res AO gives good quality/perf balance
    this.renderer.setPixelRatio(2)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.toneMapping = NoToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap

    window.addEventListener('resize', this.onResize.bind(this))

    // Initialize params from defaults before creating modules
    this.params = JSON.parse(JSON.stringify(GUIManager.defaultParams))

    this.initCamera()
    this.initPostProcessing()
    this.initStats()
    this.initCSSRenderer()
    this.initStatusOverlay()
    this.initModeButtons()

    this.seedElement.textContent = `seed: ${seed}`

    this.onResize()
    this.pointerHandler = new Pointer(
      this.renderer,
      this.camera,
      new Plane(new Vector3(0, 1, 0), 0)
    )

    // Initialize modules
    this.lighting = new Lighting(this.scene, this.renderer, this.params)
    this.city = new HexMap(this.scene, this.params)
    // Pass coast mask RT texture so water shader can sample it directly
    this.city.coastMaskTexture = this.wavesMask.texture
    this.city.coveMaskTexture = this.wavesMask.coveTexture

    await this.lighting.init()
    await this.city.init()

    // Water mask: swap tile materials to unlit B&W mask material for mask RT render
    this._whiteMat = new MeshBasicNodeMaterial()
    this._whiteMat.colorNode = vec3(1, 1, 1)
    this._savedMats = new Map()
    this.postFX.onWaterMaskRender = (enabled) => {
      if (enabled) {
        const maskMat = this.city.waterMaskMaterial
        for (const grid of this.city.grids.values()) {
          if (grid.hexMesh) {
            this._savedMats.set(grid.hexMesh, grid.hexMesh.material)
            grid.hexMesh.material = maskMat
          }
          if (grid.decorations?.treeMesh) {
            this._savedMats.set(grid.decorations.treeMesh, grid.decorations.treeMesh.material)
            grid.decorations.treeMesh.material = maskMat
          }
          if (grid.decorations?.staticMesh) {
            this._savedMats.set(grid.decorations.staticMesh, grid.decorations.staticMesh.material)
            grid.decorations.staticMesh.material = maskMat
          }
        }
      } else {
        for (const [mesh, mat] of this._savedMats) mesh.material = mat
        this._savedMats.clear()
      }
    }

    // Shared tween target for wave uniforms — gsap.to overwrites previous tweens automatically
    this._waveFade = { opacity: 0, gradOpacity: 0, mask: 0 }

    // Fade out waves immediately when a new grid starts building
    this.city.onBeforeTilesChanged = () => {
      if (this.city._autoBuilding) return
      const opacity = this.city._waveOpacity
      if (!opacity || opacity.value === 0) return

      // Cancel any pending mask render from a previous build
      if (this._pendingMaskRender) {
        this._pendingMaskRender.cancelled = true
        this._pendingMaskRender = null
      }

      // Sync tween target with current uniform values
      this._waveFade.opacity = opacity.value
      this._waveFade.gradOpacity = this.city._waveGradientOpacity?.value ?? 0
      this._waveFade.mask = this.city._waveMaskStrength?.value ?? 1

      gsap.to(this._waveFade, {
        opacity: 0, gradOpacity: 0, mask: 0,
        duration: 0.5, overwrite: true,
        onUpdate: () => {
          opacity.value = this._waveFade.opacity
          if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = this._waveFade.gradOpacity
          if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = this._waveFade.mask
        },
      })
    }

    // After tiles drop, re-render mask and fade waves back in
    this._pendingMaskRender = null
    this.city.onTilesChanged = (animDonePromise) => {
      if (this.city._autoBuilding) return
      const opacity = this.city._waveOpacity
      if (!opacity) return

      // Kill previous pending mask render (e.g. during rapid sequential builds)
      if (this._pendingMaskRender) {
        this._pendingMaskRender.cancelled = true
        this._pendingMaskRender = null
      }

      const token = { cancelled: false }
      this._pendingMaskRender = token

      const renderMask = () => {
        if (token.cancelled) return

        // Fade in sparkles on first grid build
        const sparkleOpacity = this.city._waterOpacity
        if (sparkleOpacity && sparkleOpacity.value === 0) {
          gsap.to(sparkleOpacity, {
            value: this.params.water.opacity,
            duration: 2, delay: 1,
          })
        }

        opacity.value = 0
        if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = 0
        if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = 0
        this._waveFade.opacity = 0
        this._waveFade.gradOpacity = 0
        this._waveFade.mask = 0

        const tileMeshes = []
        for (const grid of this.city.grids.values()) {
          if (grid.hexMesh) tileMeshes.push(grid.hexMesh)
        }
        this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells)

        gsap.to(this._waveFade, {
          opacity: this.params.waves.opacity,
          gradOpacity: this.params.waves.gradientOpacity,
          mask: 1,
          duration: 2, delay: 1, overwrite: true,
          onUpdate: () => {
            opacity.value = this._waveFade.opacity
            if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = this._waveFade.gradOpacity
            if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = this._waveFade.mask
          },
        })
      }

      // Wait for drop animation to finish, then render mask
      const promise = animDonePromise || Promise.resolve()
      promise.then(renderMask)
    }

    // Set up hover and click detection on hex tiles and placeholders
    this.pointerHandler.setRaycastTargets(
      [],  // Dynamic targets - we'll handle raycasting in callbacks
      {
        onHover: (intersection) => this.city.onHover(intersection),
        onPointerDown: (intersection, clientX, clientY, isTouch) => {
          // Convert client coords to normalized device coordinates
          const pointer = new Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
          )
          // Check placeholders
          if (this.city.onPointerDown(pointer, this.camera)) {
            return true  // Placeholder was clicked
          }
          return false
        },
        onPointerUp: (isTouch, touchIntersection) => this.city.onPointerUp(isTouch, touchIntersection),
        onPointerMove: (clientX, clientY) => {
          // Convert client coords to normalized device coordinates
          const pointer = new Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
          )
          // Update placeholder hover state
          this.city.onPointerMove(pointer, this.camera)
        },
        onRightClick: (intersection) => this.city.onRightClick(intersection)
      }
    )

    // Origin helper (hidden by default, toggled via GUI)
    this.axesHelper = new AxesHelper(5)
    this.axesHelper.position.set(0, 2, 0)
    this.axesHelper.visible = false
    this.scene.add(this.axesHelper)


    // Initialize GUI after modules are ready
    this.gui = new GUIManager(this)
    this.gui.init()
    this.gui.applyParams()

    // Pre-render full pipeline to compile GPU shaders while screen is still black
    // BatchedMeshes already have a dummy instance from initMeshes()
    const tileMeshes = []
    for (const grid of this.city.grids.values()) {
      if (grid.hexMesh) tileMeshes.push(grid.hexMesh)
    }
    this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells)
    this.postFX.setOverlayObjects(this.city.getOverlayObjects())
    this.postFX.setEffectsObjects(this.city.getEffectsObjects())
    this.postFX.setWaterObjects(this.city.getWaterObjects())
    this.postFX.render()

    this.clock.start()

    // Frame rate limiting with drift compensation
    const targetFPS = 60
    const frameInterval = 1000 / targetFPS
    let lastFrameTime = 0

    const loop = (currentTime) => {
      requestAnimationFrame(loop)
      const delta = currentTime - lastFrameTime
      if (delta >= frameInterval) {
        lastFrameTime = currentTime - (delta % frameInterval)
        this.animate()
      }
    }
    requestAnimationFrame(loop)
  }

  initCamera() {
    // Isometric camera setup
    const isoAngle = Math.PI / 4 // 45 degrees
    const isoDist = 150

    const camPos = new Vector3(
      Math.cos(isoAngle) * isoDist,
      isoDist * 0.8,
      Math.sin(isoAngle) * isoDist
    )

    // Set up orthographic camera
    this.orthoCamera.position.copy(camPos)
    this.updateOrthoFrustum()

    // Set up perspective camera - top-down view of hex map
    this.perspCamera.position.set(0.903, 100.036, 59.610)
    this.perspCamera.fov = 20
    this.updatePerspFrustum()

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.enableRotate = true
    // Swap mouse buttons: left=pan, right=rotate (like Townscaper)
    this.controls.mouseButtons = {
      LEFT: 2,  // PAN
      MIDDLE: 1, // DOLLY
      RIGHT: 0   // ROTATE
    }
    // Touch: 1 finger=rotate, 2 fingers=pan+zoom (OrbitControls default)
    // TOUCH constants: ROTATE=0, PAN=1, DOLLY_PAN=2, DOLLY_ROTATE=3
    this.controls.touches = {
      ONE: 0,  // TOUCH.ROTATE
      TWO: 2   // TOUCH.DOLLY_PAN
    }
    // Zoom/rotation limits - defaults allow unlimited (debugCam: true)
    this.controls.minDistance = 25
    this.controls.maxDistance = 410
    this.controls.maxPolarAngle = 1.1
    // Pan parallel to ground plane instead of screen
    this.controls.screenSpacePanning = false
    this.controls.target.set(0.903, 1, 1.168)
    this.controls.update()
  }

  updateOrthoFrustum() {
    const frustumSize = 100
    const aspect = window.innerWidth / window.innerHeight
    this.orthoCamera.left = -frustumSize * aspect / 2
    this.orthoCamera.right = frustumSize * aspect / 2
    this.orthoCamera.top = frustumSize / 2
    this.orthoCamera.bottom = -frustumSize / 2
    this.orthoCamera.updateProjectionMatrix()
  }

  updatePerspFrustum() {
    this.perspCamera.aspect = window.innerWidth / window.innerHeight
    this.perspCamera.updateProjectionMatrix()
  }

  initPostProcessing() {
    this.postFX = new PostFX(this.renderer, this.scene, this.camera)
    this.postFX.fadeOpacity.value = 0 // Start black
    this.wavesMask = new WavesMask(this.renderer)

    // Expose uniforms for GUI access (aliased from PostFX)
    this.aoEnabled = this.postFX.aoEnabled
    this.vignetteEnabled = this.postFX.vignetteEnabled
    this.debugView = this.postFX.debugView
    this.aoBlurAmount = this.postFX.aoBlurAmount
    this.aoIntensity = this.postFX.aoIntensity
    this.aoPass = this.postFX.aoPass
    this.dofEnabled = this.postFX.dofEnabled
    this.dofFocus = this.postFX.dofFocus
    this.dofAperture = this.postFX.dofAperture
    this.dofMaxblur = this.postFX.dofMaxblur
    this.bleachEnabled = this.postFX.bleachEnabled
    this.bleachAmount = this.postFX.bleachAmount
    this.lutEnabled = this.postFX.lutEnabled
    this.lutAmount = this.postFX.lutAmount
    this.grainEnabled = this.postFX.grainEnabled
    this.grainStrength = this.postFX.grainStrength
  }

  initStats() {
    this.stats = new Stats()
    this.stats.showPanel(0) // 0: fps, 1: ms, 2: mb
    document.body.appendChild(this.stats.dom)
  }

  initCSSRenderer() {
    this.cssRenderer = new CSS2DRenderer()
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight)
    this.cssRenderer.domElement.style.position = 'absolute'
    this.cssRenderer.domElement.style.top = '0'
    this.cssRenderer.domElement.style.left = '0'
    this.cssRenderer.domElement.style.pointerEvents = 'none'
    this.cssRenderer.domElement.style.zIndex = '1'  // Below GUI (lil-gui uses z-index 9999)
    document.body.appendChild(this.cssRenderer.domElement)
  }

  initStatusOverlay() {
    this.statusElement = document.createElement('div')
    this.statusElement.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      color: white;
      font-family: monospace;
      font-size: 12px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      pointer-events: none;
      z-index: 1000;
    `
    document.body.appendChild(this.statusElement)

    // Seed display (bottom-right)
    this.seedElement = document.createElement('div')
    this.seedElement.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      color: white;
      font-family: monospace;
      font-size: 12px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      pointer-events: none;
      z-index: 1000;
    `
    document.body.appendChild(this.seedElement)
  }

  initModeButtons() {
    const container = document.createElement('div')
    container.style.cssText = `
      position: fixed;
      top: 56px;
      left: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 1000;
    `
    document.body.appendChild(container)

    const modes = [
      { key: 'move', label: 'Move' },
      { key: 'build', label: 'Rebuild' },
    ]
    const buttons = []

    for (const { key, label } of modes) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        width: 60px;
        height: 60px;
        border-radius: 12px;
        border: 2px solid rgba(255,255,255,0.3);
        background: rgba(0,0,0,0.4);
        color: white;
        font-family: monospace;
        font-size: 11px;
        cursor: pointer;
        backdrop-filter: blur(4px);
      `
      btn.addEventListener('pointerdown', (e) => e.stopPropagation())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.buildMode = key === 'build'
        for (const b of buttons) {
          b.style.borderColor = 'rgba(255,255,255,0.3)'
        }
        btn.style.borderColor = 'white'
      })
      container.appendChild(btn)
      buttons.push(btn)
      if (key === 'move') btn.style.borderColor = 'white'
    }
  }

  onResize(_e, toSize) {
    const { renderer, cssRenderer, postFX } = this
    const size = new Vector2(window.innerWidth, window.innerHeight)
    if (toSize) size.copy(toSize)

    this.updateOrthoFrustum()
    this.updatePerspFrustum()

    renderer.setSize(size.x, size.y)
    renderer.domElement.style.width = `${size.x}px`
    renderer.domElement.style.height = `${size.y}px`

    if (cssRenderer) {
      cssRenderer.setSize(size.x, size.y)
    }

    // Resize overlay render target
    if (postFX) {
      postFX.resize()
    }
  }

  animate() {
    this.stats.begin()

    const { controls, clock, postFX } = this

    const dt = clock.getDelta()

    controls.update(dt)
    // Clamp target Y to prevent panning under the city
    if (controls.target.y < 0) controls.target.y = 0
    this.lighting.updateShadowCamera(this.controls.target, this.camera, this.orthoCamera, this.perspCamera)

    // Auto-focus DOF on orbit target (center of screen on ground)
    postFX.dofFocus.value = this.camera.position.distanceTo(controls.target)

    // Fade out DOF when looking straight down (polar angle near 0)
    const polar = controls.getPolarAngle() // 0 = top-down, PI/2 = horizon
    const dofFade = Math.min(Math.max((polar - 0.3) / 0.5, 0), 1) // ramp 0.3..0.8 rad
    postFX.dofAperture.value = (this.params.fx.dofAperture / 1000) * dofFade

    // Animate grain noise — quantize to noiseFPS for film-like grain (0 = static)
    const noiseFPS = this.params.fx.grainFPS
    if (noiseFPS > 0) {
      postFX.grainTime.value = Math.floor(clock.elapsedTime * noiseFPS) / noiseFPS
    }

    // Update debris physics
    this.city.update(dt)

    // Update render layers
    const maskObjects = []
    for (const grid of this.city.grids.values()) {
      if (grid.hexMesh) maskObjects.push(grid.hexMesh)
      if (grid.decorations?.treeMesh) maskObjects.push(grid.decorations.treeMesh)
      if (grid.decorations?.staticMesh) maskObjects.push(grid.decorations.staticMesh)
    }
    postFX.setWaterMaskObjects(maskObjects)
    postFX.setOverlayObjects(this.city.getOverlayObjects())
    postFX.setEffectsObjects(this.city.getEffectsObjects())
    postFX.setWaterObjects(this.city.getWaterObjects())

    postFX.render()

    // Debug: show coast mask RT in bottom-left corner
    if (this.wavesMask?.showDebug) this.wavesMask.renderDebug()

    // Always render CSS labels (individual label.visible controls what shows)
    if (this.cssRenderer) {
      this.cssRenderer.render(this.scene, this.camera)
    }

    this.stats.end()
  }

  exportPNG() {
    // Render one frame to ensure canvas is up to date
    this.postFX.render()

    // Get canvas data
    const canvas = this.renderer.domElement
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `city-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  fadeIn(duration = 1000) {
    gsap.to(this.postFX.fadeOpacity, { value: 1, duration: duration / 1000 })
  }
}
