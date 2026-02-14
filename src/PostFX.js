import { PostProcessing, RenderTarget, RGBAFormat, Color, TextureLoader, LinearFilter } from 'three/webgpu'
import {
  pass,
  output,
  mrt,
  normalView,
  viewportUV,
  clamp,
  uniform,
  select,
  mix,
  float,
  vec2,
  vec3,
  vec4,
  sub,
  texture,
} from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { bleach } from 'three/addons/tsl/display/BleachBypass.js'

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera

    this.postProcessing = new PostProcessing(renderer)

    // Effect toggle uniforms
    this.aoEnabled = uniform(1)
    this.vignetteEnabled = uniform(1)
    this.dofEnabled = uniform(0)
    this.bleachEnabled = uniform(0)
    this.lutEnabled = uniform(0)
    this.grainEnabled = uniform(0)

    // Debug view: 0=final, 1=color, 2=depth, 3=normal, 4=AO, 5=overlay, 6=effects
    this.debugView = uniform(0)

    // AO parameters
    this.aoBlurAmount = uniform(1)
    this.aoIntensity = uniform(1)

    // DOF parameters
    this.dofFocus = uniform(100)
    this.dofAperture = uniform(0.025)
    this.dofMaxblur = uniform(0.01)

    // Bleach bypass parameters
    this.bleachAmount = uniform(0.5)

    // LUT parameters
    this.lutAmount = uniform(1)

    // Grain parameters
    this.grainStrength = uniform(0.1)
    this.grainTime = uniform(0)

    // Fade to black (0 = black, 1 = fully visible)
    this.fadeOpacity = uniform(1)

    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth * dpr
    const h = window.innerHeight * dpr

    // Overlay render target (UI elements — no depth test, no AO)
    this.overlayTarget = new RenderTarget(w, h, { samples: 1 })
    this.overlayTarget.texture.format = RGBAFormat

    // Effects render target (weather, water — depth-tested against scene, no AO)
    this.effectsTarget = new RenderTarget(w, h, { samples: 1 })
    this.effectsTarget.texture.format = RGBAFormat

    // Object lists (set externally each frame)
    this.overlayObjects = []
    this.effectsObjects = []

    // Load default LUT texture
    this._loadLutTexture('./assets/lut/etikate.png')

    this._buildPipeline()
  }

  _loadLutTexture(path) {
    const loader = new TextureLoader()
    this.lutTexture = loader.load(path)
    this.lutTexture.minFilter = LinearFilter
    this.lutTexture.magFilter = LinearFilter
    this.lutTexture.generateMipmaps = false
    this.lutTexture.flipY = false
  }

  swapLut(path) {
    const loader = new TextureLoader()
    loader.load(path, (tex) => {
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      tex.generateMipmaps = false
      tex.flipY = false
      if (this._lutTexNode) this._lutTexNode.value = tex
      if (this.lutTexture) this.lutTexture.dispose()
      this.lutTexture = tex
    })
  }

  _buildPipeline() {
    const { scene, camera } = this

    // Scene pass with MRT for normal output
    const scenePass = pass(scene, camera)
    scenePass.setMRT(
      mrt({
        output: output,
        normal: normalView,
      })
    )
    this._scenePass = scenePass

    const scenePassColor = scenePass.getTextureNode('output')
    const scenePassNormal = scenePass.getTextureNode('normal')
    const scenePassDepth = scenePass.getTextureNode('depth')
    const scenePassViewZ = scenePass.getViewZNode()

    // ---- DOF (on scene color texture, before AO) ----
    const dofResult = dof(scenePassColor, scenePassViewZ, this.dofFocus, this.dofAperture, this.dofMaxblur)
    const afterDof = mix(scenePassColor, dofResult, this.dofEnabled)

    // ---- GTAO pass (uses depth/normals from scene, not affected by DOF) ----
    this.aoPass = ao(scenePassDepth, scenePassNormal, camera)
    this.aoPass.resolutionScale = 0.5 // Half-res AO for performance
    this.aoPass.distanceExponent.value = 1
    this.aoPass.distanceFallOff.value = 0.1
    this.aoPass.radius.value = 1.0
    this.aoPass.scale.value = 1.5
    this.aoPass.thickness.value = 1

    // AO texture for debug view
    const aoTexture = this.aoPass.getTextureNode()

    // Blur the AO to reduce banding artifacts
    const blurredAO = gaussianBlur(aoTexture, this.aoBlurAmount, 4) // sigma, radius

    // Soften AO: raise to power < 1 to reduce harshness, then blend
    const softenedAO = blurredAO.pow(0.5) // Square root makes it softer
    const blendedAO = mix(float(1), softenedAO, this.aoIntensity)
    const withAO = mix(afterDof, afterDof.mul(blendedAO), this.aoEnabled)

    // ---- Effects layer compositing (weather, water) ----
    const effectsTexture = texture(this.effectsTarget.texture)
    const withEffects = withAO.add(effectsTexture.rgb.mul(effectsTexture.a))

    // ---- Overlay layer compositing (UI) ----
    const overlayTexture = texture(this.overlayTarget.texture)
    const withOverlay = withEffects.add(overlayTexture.rgb.mul(overlayTexture.a))

    // ---- Bleach bypass (after overlay, before LUT) ----
    const bleachedColor = bleach(withOverlay, this.bleachAmount)
    const afterBleach = mix(withOverlay.rgb, bleachedColor.rgb, this.bleachEnabled)

    // ---- LUT color grading (after bleach, before vignette) ----
    const lutTexNode = texture(this.lutTexture)
    this._lutTexNode = lutTexNode

    // Clamp input to [0,1] for safe LUT indexing
    const lutInput = afterBleach.clamp(0, 1)
    const blue = lutInput.b.mul(63.0)
    const blueIdx = blue.floor()
    const nextIdx = blueIdx.add(1.0).min(63.0)

    // Tile positions in 8x8 grid
    const tile1y = blueIdx.div(8.0).floor()
    const tile1x = blueIdx.sub(tile1y.mul(8.0))
    const tile2y = nextIdx.div(8.0).floor()
    const tile2x = nextIdx.sub(tile2y.mul(8.0))

    // UV coordinates within each tile (64x64 in 512x512 texture)
    const tileSize = float(0.125) // 64/512
    const halfTexel = float(0.5 / 512.0)
    const innerScale = float(63.0 / 512.0)

    const uv1 = vec2(
      tile1x.mul(tileSize).add(halfTexel).add(lutInput.r.mul(innerScale)),
      tile1y.mul(tileSize).add(halfTexel).add(lutInput.g.mul(innerScale))
    )
    const uv2 = vec2(
      tile2x.mul(tileSize).add(halfTexel).add(lutInput.r.mul(innerScale)),
      tile2y.mul(tileSize).add(halfTexel).add(lutInput.g.mul(innerScale))
    )

    const lutSample1 = lutTexNode.sample(uv1).rgb
    const lutSample2 = lutTexNode.sample(uv2).rgb
    const lutColor = mix(lutSample1, lutSample2, blue.fract())
    const afterLut = mix(afterBleach, lutColor, this.lutEnabled.mul(this.lutAmount))

    // ---- Vignette: darken edges toward black ----
    const vignetteFactor = float(1).sub(
      clamp(viewportUV.sub(0.5).length().mul(1.4), 0.0, 1.0).pow(1.5)
    )
    const vignetteMultiplier = mix(float(1), vignetteFactor, this.vignetteEnabled)
    const withVignette = mix(vec3(0, 0, 0), afterLut, vignetteMultiplier)

    // ---- Fade to black ----
    const fadeColor = vec3(0, 0, 0)
    const afterFade = mix(fadeColor, withVignette, this.fadeOpacity)

    // ---- Grain: Worley noise for soft dot-like film grain ----
    // Worley = distance to nearest random point → soft circular dots
    // Monochrome (like real film grain), centered at 0 for additive blend
    // // Perlin noise approach (kept for reference):
    // const grainPos = vec3(viewportUV.mul(this.grainScale), this.grainTime.mul(this.grainSpeed))
    // const grainNoise = mx_noise_vec3(grainPos).mul(this.grainStrength)
    // ---- Grain: per-pixel RGB hash noise, FPS-throttled ----
    // // Worley/Perlin approaches (kept for reference):
    // const grainPos = vec3(viewportUV.mul(grainScale), grainTime.mul(grainSpeed))
    // const grainNoise = mx_noise_vec3(grainPos).mul(grainStrength)
    // const grainDots = float(1).sub(mx_worley_noise_float(grainPos)).sub(threshold).div(float(1).sub(threshold)).clamp(0,1)
    const grainSeed1 = viewportUV.x.mul(12.9898).add(viewportUV.y.mul(78.233)).add(this.grainTime)
    const grainSeed2 = viewportUV.x.mul(93.9898).add(viewportUV.y.mul(67.345)).add(this.grainTime)
    const grainSeed3 = viewportUV.x.mul(43.332).add(viewportUV.y.mul(93.532)).add(this.grainTime)
    const noiseR = grainSeed1.sin().mul(43758.5453).fract()
    const noiseG = grainSeed2.sin().mul(43758.5453).fract()
    const noiseB = grainSeed3.sin().mul(43758.5453).fract()
    const grainNoise = vec3(noiseR, noiseG, noiseB).sub(0.5).mul(this.grainStrength)
    const finalOutput = afterFade.add(grainNoise.mul(this.grainEnabled))

    // Debug views
    const depthViz = vec3(scenePassDepth)
    const normalViz = scenePassNormal.mul(0.5).add(0.5)
    const aoViz = vec3(blurredAO)
    const overlayViz = overlayTexture.rgb
    const effectsViz = effectsTexture.rgb

    // Select output based on debug view
    const debugOutput = select(
      this.debugView.lessThan(0.5),
      finalOutput,
      select(
        this.debugView.lessThan(1.5),
        scenePassColor,
        select(
          this.debugView.lessThan(2.5),
          depthViz,
          select(
            this.debugView.lessThan(3.5),
            normalViz,
            select(
              this.debugView.lessThan(4.5),
              aoViz,
              select(this.debugView.lessThan(5.5), overlayViz, effectsViz)
            )
          )
        )
      )
    )

    this.postProcessing.outputNode = debugOutput
  }

  // Rebuild pipeline with new camera (e.g., after camera switch)
  setCamera(camera) {
    this.camera = camera
    this._buildPipeline()
  }

  /**
   * Resize render targets
   */
  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth * dpr
    const h = window.innerHeight * dpr
    this.overlayTarget.setSize(w, h)
    this.effectsTarget.setSize(w, h)
  }

  setOverlayObjects(objects) {
    this.overlayObjects = objects
  }

  setEffectsObjects(objects) {
    this.effectsObjects = objects
  }

  render() {
    const { renderer, scene, camera, overlayObjects, overlayTarget, effectsObjects, effectsTarget } = this

    const savedClearColor = renderer.getClearColor(new Color())
    const savedClearAlpha = renderer.getClearAlpha()
    const savedBackground = scene.background
    const savedEnvironment = scene.environment

    // ---- Overlay pass ----
    scene.background = null
    scene.environment = null

    renderer.setRenderTarget(overlayTarget)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()

    const savedVisibility = new Map()
    scene.traverse((child) => {
      if (!child.isMesh && !child.isLine && !child.isLineSegments && !child.isPoints) return
      const isOverlay = overlayObjects.some(o => o === child || o.getObjectById?.(child.id))
      if (!isOverlay) {
        savedVisibility.set(child, child.visible)
        child.visible = false
      }
    })

    renderer.render(scene, camera)

    for (const [obj, visible] of savedVisibility) {
      obj.visible = visible
    }

    // ---- Effects pass: render before main so texture binding is fresh when sampled ----
    renderer.setRenderTarget(effectsTarget)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()

    if (effectsObjects.length > 0) {
      const savedEffVis = new Map()
      scene.traverse((child) => {
        if (!child.isMesh && !child.isLine && !child.isLineSegments && !child.isPoints) return
        const isEffect = effectsObjects.some(o => o === child || o.getObjectById?.(child.id))
        if (!isEffect) {
          savedEffVis.set(child, child.visible)
          child.visible = false
        }
      })

      renderer.render(scene, camera)

      for (const [child, vis] of savedEffVis) child.visible = vis
    }

    scene.background = savedBackground
    scene.environment = savedEnvironment
    renderer.setRenderTarget(null)
    renderer.setClearColor(savedClearColor, savedClearAlpha)

    // ---- Main pass: hide effects + overlay, render with AO ----
    const savedMainVis = new Map()
    for (const obj of effectsObjects) {
      savedMainVis.set(obj, obj.visible)
      obj.visible = false
    }
    for (const obj of overlayObjects) {
      savedMainVis.set(obj, obj.visible)
      obj.visible = false
    }

    this.postProcessing.render()

    for (const [obj, visible] of savedMainVis) {
      obj.visible = visible
    }
  }
}
