import {
  Timer,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Scene,
  Plane,
  WebGPURenderer,
  PCFShadowMap,
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
import { setSeed, getSeed } from './SeededRandom.js'
import { MapLibrary } from './maps/MapLibrary.js'
import { LEVELS_COUNT } from './hexmap/HexTileData.js'
import gsap from 'gsap'
import { RUNTIME_MINIMAL, WARDOMES_MAP_PROFILE } from './runtimeConfig.js'

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
    this.timer = new Timer()
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
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true })
    await this.renderer.init()
    // DPR 2 with half-res AO gives good quality/perf balance
    this.renderer.setPixelRatio(2)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap

    window.addEventListener('resize', this.onResize.bind(this))

    // Initialize params from defaults before creating modules
    this.params = JSON.parse(JSON.stringify(GUIManager.defaultParams))

    this.initCamera()
    if (!RUNTIME_MINIMAL) {
      this.initPostProcessing()
      this.initStats()
      this.initCSSRenderer()
    }
    this.initStatusOverlay()
    if (!RUNTIME_MINIMAL) {
      this.initModeButtons()
    }

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
    if (!RUNTIME_MINIMAL) {
      this.city.coastMaskTexture = this.wavesMask.texture
      this.city.coveMaskTexture = this.wavesMask.coveTexture
    }

    await this.lighting.init()
    await this.city.init()

    this.mapLibrary = new MapLibrary(this)
    const savedMap = await this.mapLibrary.init()
    let restored = false
    if (savedMap) {
      try {
        await this.mapLibrary.open(savedMap)
        restored = true
      } catch (error) {
        this.mapLibrary.message(`Could not open saved map: ${error.message}. Import another map or choose New map.`)
      }
    }

    if (RUNTIME_MINIMAL) {
      // In wardomes mode we need a fully generated world immediately.
      // A broken save leaves the library available for recovery; do not silently
      // start another multi-minute solve when the user expected to open a map.
      if (!savedMap && !this.mapLibrary.hasStoredMaps) await this.city.populateAllGrids(null, {
        animate: false,
        animateDelay: 0,
        includeOceanSeeds: WARDOMES_MAP_PROFILE.includeOceanSeeds,
        wfcMaxTries: WARDOMES_MAP_PROFILE.wfcMaxTries,
        wfcMaxBacktracks: WARDOMES_MAP_PROFILE.wfcMaxBacktracks,
      })
      // Minimal mode skips coast-mask postfx; hiding this plane avoids visual artifacts.
      if (this.city.water?.mesh) this.city.water.mesh.visible = false
    }

    this.publishMap()

    if (!RUNTIME_MINIMAL) {
      // Water mask: swap tile materials to unlit B&W mask material for mask RT render
      this._savedMats = new Map()
      this.postFX.onWaterMaskRender = (enabled) => {
        if (enabled) {
          const maskMat = this.city.waterMaskMaterial
          for (const grid of this.city.grids.values()) {
            if (grid.hexMesh) {
              this._savedMats.set(grid.hexMesh, grid.hexMesh.material)
              grid.hexMesh.material = maskMat
            }
            if (grid.decorations?.mesh) {
              this._savedMats.set(grid.decorations.mesh, grid.decorations.mesh.material)
              grid.decorations.mesh.material = maskMat
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

        // Kill any running wave tweens and sync target with current uniforms
        gsap.killTweensOf(this._waveFade)
        this._waveFade.opacity = opacity.value
        this._waveFade.gradOpacity = this.city._waveGradientOpacity?.value ?? 0
        this._waveFade.mask = this.city._waveMaskStrength?.value ?? 1

        gsap.to(this._waveFade, {
          opacity: 0, gradOpacity: 0, mask: 0,
          duration: 0.5,
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

          // Kill any running wave tweens, snap to 0, render mask, fade back up
          gsap.killTweensOf(this._waveFade)
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
          this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells, this.city.landMaskMaterial)

          gsap.to(this._waveFade, {
            opacity: this.params.waves.opacity,
            gradOpacity: this.params.waves.gradientOpacity,
            mask: 1,
            duration: 2, delay: 1,
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

    if (!RUNTIME_MINIMAL) {
      // Initialize GUI after modules are ready
      this.gui = new GUIManager(this)
      this.gui.init()
      this.gui.gui.domElement.classList.add('gui-hidden')
      this.gui.applyParams()

      // Move FPS meter into GUI panel, above DPR
      this.stats.dom.style.display = ''
      this.stats.dom.style.position = 'relative'
      this.stats.dom.style.top = ''
      this.stats.dom.style.left = '106px'
      const guiChildren = this.gui.gui.domElement.querySelector('.children')
      const dprEl = guiChildren?.firstElementChild
      if (dprEl) guiChildren.insertBefore(this.stats.dom, dprEl)
      else this.gui.gui.domElement.prepend(this.stats.dom)

      // Pre-render full pipeline to compile GPU shaders while screen is still black
      // BatchedMeshes already have a dummy instance from initMeshes()
      const tileMeshes = []
      for (const grid of this.city.grids.values()) {
        if (grid.hexMesh) tileMeshes.push(grid.hexMesh)
      }
      this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells, this.city.landMaskMaterial)
      this.postFX.setOverlayObjects(this.city.getOverlayObjects())

      this.postFX.setWaterObjects(this.city.getWaterObjects())
      this.postFX.render()
      if (restored) this.fadeIn(0)
    }

    this.timer.connect(document)

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

  publishMap() {
    window.__WARDOMES_MAP__ = { seed: getSeed(), tiles: this.city.getCanonicalTiles() }
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
    this.perspCamera.position.set(0, 100, 58.5)
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
    this.controls.maxPolarAngle = 1.424
    // Pan parallel to ground plane instead of screen
    this.controls.screenSpacePanning = false
    this.controls.target.set(0, 1, 0)
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
    this.aoDenoiseRadius = this.postFX.aoDenoiseRadius
    this.aoIntensity = this.postFX.aoIntensity
    this.aoPass = this.postFX.aoPass
    this.dofEnabled = this.postFX.dofEnabled
    this.dofFocus = this.postFX.dofFocus
    this.dofFocalLength = this.postFX.dofFocalLength
    this.dofBokehScale = this.postFX.dofBokehScale
    this.grainEnabled = this.postFX.grainEnabled
    this.grainStrength = this.postFX.grainStrength
  }

  initStats() {
    this.stats = new Stats()
    this.stats.showPanel(0) // 0: fps, 1: ms, 2: mb
    this.stats.dom.style.display = 'none'
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
    this.statusElement = document.getElementById('status-text')
    this.seedElement = { textContent: '' } // no-op stub (seed hidden in HTML)
  }

  initModeButtons() {
    const addHover = (btn) => {
      btn.addEventListener('mouseenter', () => {
        if (!btn._noHoverBorder) btn.style.borderColor = 'rgba(255,255,255,0.7)'
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = btn._activeBorder || 'rgba(255,255,255,0.3)'
      })
    }

    const btnBase = `
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.3);
      background: transparent;
      color: rgba(255,255,255,0.8);
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(4px);
      padding: 8px 13px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.48);
    `

    // Buttons container (bottom-left)
    const container = document.createElement('div')
    container.id = 'ui-menu'
    container.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      display: flex;
      flex-direction: row;
      gap: 9px;
      z-index: 1000;
    `
    document.body.appendChild(container)

    // Mode toggle (Move | Build)
    const toggle = document.createElement('div')
    toggle.style.cssText = `
      display: flex;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.3);
      background: transparent;
      overflow: hidden;
      backdrop-filter: blur(4px);
    `
    const modeButtons = {}
    const setMode = (key) => {
      this.buildMode = key === 'build'
      for (const [k, btn] of Object.entries(modeButtons)) {
        btn.style.background = k === key ? 'rgba(255,255,255,0.3)' : 'transparent'
      }
    }
    for (const { key, label } of [{ key: 'move', label: 'Move' }, { key: 'build', label: 'Build' }]) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        padding: 8px 13px;
        border: none;
        background: ${key === 'move' ? 'rgba(255,255,255,0.3)' : 'transparent'};
        color: rgba(255,255,255,0.8);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        cursor: pointer;
        text-shadow: 0 1px 3px rgba(0,0,0,0.48);
      `
      btn.addEventListener('mouseenter', () => { toggle.style.borderColor = 'rgba(255,255,255,0.7)' })
      btn.addEventListener('mouseleave', () => { toggle.style.borderColor = 'rgba(255,255,255,0.3)' })
      btn.addEventListener('pointerdown', (e) => e.stopPropagation())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        setMode(key)
      })
      modeButtons[key] = btn
      toggle.appendChild(btn)
      if (key === 'move') {
        const divider = document.createElement('div')
        divider.style.cssText = 'width: 1px; background: rgba(255,255,255,0.3); align-self: stretch;'
        toggle.appendChild(divider)
      }
    }
    container.appendChild(toggle)

    // Action buttons
    const actions = [
      { label: 'Build All', action: () => {
        this.city.autoBuild([
          [0,0],[0,-1],[1,-1],[1,0],[0,1],[-1,0],[-1,-1],[-1,-2],[0,-2],[1,-2],[2,-1],[2,0],[2,1],[1,1],[0,2],[-1,1],[-2,1],[-2,0],[-2,-1]
        ])
      }},
      { label: 'Clear All', action: () => {
        this.city.reset()
        this.city.setHelpersVisible(this.params.debug.hexGrid)
        this.perspCamera.position.set(0, 100, 58.5)
        this.controls.target.set(0, 1, 0)
        this.controls.update()
      }},
    ]

    for (const { label, action } of actions) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = btnBase
      addHover(btn)
      btn.addEventListener('pointerdown', (e) => e.stopPropagation())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        action()
      })
      container.appendChild(btn)
    }

    // Settings toggle
    const guiBtn = document.createElement('button')
    guiBtn.textContent = 'Controls'
    guiBtn.style.cssText = btnBase
    let guiVisible = false
    const guiEl = this.gui?.gui?.domElement
    if (guiEl) guiEl.classList.add('gui-hidden')
    const updateGuiBtn = () => {
      guiBtn.style.background = guiVisible ? 'rgba(255,255,255,0.3)' : 'transparent'
    }
    updateGuiBtn()
    addHover(guiBtn)
    guiBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
    guiBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const guiEl = this.gui?.gui?.domElement
      if (!guiEl) return
      guiVisible = !guiVisible
      guiEl.classList.toggle('gui-hidden', !guiVisible)
      updateGuiBtn()
    })
    container.appendChild(guiBtn)
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
    if (this.stats) this.stats.begin()

    const { controls, timer } = this

    timer.update()
    const dt = timer.getDelta()

    controls.update(dt)
    // Clamp target Y to prevent panning under the city
    if (controls.target.y < 0) controls.target.y = 0
    this.lighting.updateShadowCamera(this.controls.target, this.camera, this.orthoCamera, this.perspCamera)

    if (!RUNTIME_MINIMAL && this.postFX) {
      // Auto-focus DOF on orbit target, scale focal length with zoom
      const dist = this.camera.position.distanceTo(controls.target)
      this.postFX.dofFocus.value = dist
      const t = Math.min(Math.max((dist - 25) / (410 - 25), 0), 1) // 0=zoomed in, 1=zoomed out
      this.postFX.dofFocalLength.value = 20 + t * 80 // 20 at close, 100 at far

      // Animate grain noise — quantize to noiseFPS for film-like grain (0 = static)
      const noiseFPS = this.params.fx.grainFPS
      if (noiseFPS > 0) {
        this.postFX.grainTime.value = Math.floor(timer.getElapsed() * noiseFPS) / noiseFPS
      }
    }

    // Update debris physics
    this.city.update(dt)

    if (!RUNTIME_MINIMAL && this.postFX) {
      // Update render layers
      const maskObjects = []
      for (const grid of this.city.grids.values()) {
        if (grid.hexMesh) maskObjects.push(grid.hexMesh)
        if (grid.decorations?.mesh) maskObjects.push(grid.decorations.mesh)
      }
      this.postFX.setWaterMaskObjects(maskObjects)
      this.postFX.setOverlayObjects(this.city.getOverlayObjects())
      this.postFX.setWaterObjects(this.city.getWaterObjects())

      this.postFX.render()

      // Debug: show coast mask RT in bottom-left corner
      if (this.wavesMask?.showDebug) this.wavesMask.renderDebug()
    } else {
      this.renderer.render(this.scene, this.camera)
    }

    // Always render CSS labels (individual label.visible controls what shows)
    if (this.cssRenderer) {
      this.cssRenderer.render(this.scene, this.camera)
    }

    if (this.stats) this.stats.end()
  }

  exportPNG({ format = 'image/jpeg', quality = 0.85, filename } = {}) {
    // Render one frame to ensure canvas is up to date
    if (this.postFX) this.postFX.render()
    else this.renderer.render(this.scene, this.camera)

    // Get canvas data
    const canvas = this.renderer.domElement
    const ext = format === 'image/png' ? 'png' : 'jpg'
    const name = filename || `city-${Date.now()}.${ext}`
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    }, format, quality)
  }

  fadeIn(duration = 1000) {
    if (this.postFX) {
      gsap.to(this.postFX.fadeOpacity, { value: 1, duration: duration / 1000 })
    }
  }
}
