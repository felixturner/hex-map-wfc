import { PostProcessing, RenderTarget, RGBAFormat, Color } from 'three/webgpu'
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
  vec3,
  sub,
  texture,
} from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera

    this.postProcessing = new PostProcessing(renderer)

    // Effect toggle uniforms
    this.aoEnabled = uniform(1)
    this.vignetteEnabled = uniform(1)

    // Debug view: 0=final, 1=color, 2=depth, 3=normal, 4=AO, 5=overlay, 6=effects
    this.debugView = uniform(0)

    // AO parameters
    this.aoBlurAmount = uniform(1)
    this.aoIntensity = uniform(1)

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

    this._buildPipeline()
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

    // GTAO pass
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
    const withAO = mix(scenePassColor, scenePassColor.mul(blendedAO), this.aoEnabled)

    // Effects texture (depth-tested against scene, no AO)
    const effectsTexture = texture(this.effectsTarget.texture)
    const withEffects = withAO.add(effectsTexture.rgb.mul(effectsTexture.a))

    // Overlay texture (no depth test, no AO)
    const overlayTexture = texture(this.overlayTarget.texture)
    const withOverlay = withEffects.add(overlayTexture.rgb.mul(overlayTexture.a))

    // Vignette: darken edges toward black
    const vignetteFactor = float(1).sub(
      clamp(viewportUV.sub(0.5).length().mul(1.4), 0.0, 1.0).pow(1.5)
    )
    const vignetteMultiplier = mix(float(1), vignetteFactor, this.vignetteEnabled)
    const withVignette = mix(vec3(0, 0, 0), withOverlay, vignetteMultiplier)

    // Fade to black pass (final effect in chain)
    const fadeColor = vec3(0, 0, 0)
    const finalOutput = mix(fadeColor, withVignette, this.fadeOpacity)

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
