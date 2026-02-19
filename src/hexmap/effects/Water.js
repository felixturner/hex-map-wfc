import {
  MeshPhysicalNodeMaterial,
  PlaneGeometry,
  Mesh,
  TextureLoader,
  DataTexture,
  LinearFilter,
  Color,
} from 'three/webgpu'
import { uniform, vec3, vec2, texture, positionWorld, mx_noise_float, float, clamp, time as tslTime, sin, cos, mix } from 'three/tsl'

/**
 * Water plane with caustic sparkles and coast wave bands.
 * Rendered to a separate RT in PostFX and masked to blue water areas.
 */
export class Water {
  constructor(scene, coastMaskTexture) {
    this.scene = scene
    this.coastMaskTexture = coastMaskTexture
    this.mesh = null
  }

  init() {
    const geometry = new PlaneGeometry(296, 296)
    geometry.rotateX(-Math.PI / 2)

    // Sparkle uniforms
    this._waterOpacity = uniform(0)
    this._waterSpeed = uniform(0.3)
    this._waterFreq = uniform(0.9)
    this._waterAngle = uniform(0)          // drift direction in radians
    this._waterBrightness = uniform(0.29)  // threshold cutoff (lower = more sparkle)
    this._waterContrast = uniform(17.5)    // sharpness multiplier after threshold

    // Wave uniforms
    this._waveSpeed = uniform(2)
    this._waveCount = uniform(4)
    this._waveOpacity = uniform(0.5)
    this._waveNoiseBreak = uniform(0.135)
    this._waveWidth = uniform(0.61)
    this._waveOffset = uniform(0.3)
    this._waveGradientOpacity = uniform(0.1)
    this._waveGradientColor = uniform(new Color(0.8, 0.7, 0.2))
    this._waveMaskStrength = uniform(1)

    // Coast gradient texture — pre-blurred RT from WavesMask (set before init)
    this._coastGradNode = texture(this.coastMaskTexture || new DataTexture(new Uint8Array(4), 1, 1))

    // Caustic texture — tileable grayscale, replaces expensive Worley noise
    const causticLoader = new TextureLoader()
    const causticTex = causticLoader.load('./assets/caustic.jpg')
    causticTex.wrapS = causticTex.wrapT = 1000 // RepeatWrapping
    causticTex.minFilter = LinearFilter
    causticTex.magFilter = LinearFilter
    const causticNode = texture(causticTex)

    const material = new MeshPhysicalNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
    })

    // ---- Sparkles: scrolling caustic texture with directional drift ----
    const driftX = cos(this._waterAngle).mul(this._waterSpeed).mul(0.015)
    const driftZ = sin(this._waterAngle).mul(this._waterSpeed).mul(0.015)
    const waterUV = vec2(
      positionWorld.x.mul(this._waterFreq).mul(0.1).add(tslTime.mul(driftX)),
      positionWorld.z.mul(this._waterFreq).mul(0.1).add(tslTime.mul(driftZ))
    )
    const causticVal = causticNode.sample(waterUV).r
    const sparkle = clamp(causticVal.sub(this._waterBrightness).mul(this._waterContrast), 0.0, 1.0)
    const waterColor = vec3(sparkle, sparkle, sparkle)
    const totalAlpha = sparkle.mul(this._waterOpacity)

    // ---- Waves: coast wave bands ----
    const PI2 = float(Math.PI * 2)
    const coastUV = vec2(
      positionWorld.x.div(180).add(0.5),
      positionWorld.z.div(180).add(0.5)
    )
    const cs = this._coastGradNode.sample(coastUV)
    const gradSample = cs.r.mul(0.2126).add(cs.g.mul(0.7152)).add(cs.b.mul(0.0722))

    // outwardDist: 0 at coastline, 1 at far open water
    const outwardDist = clamp(float(1).sub(gradSample), 0, 1)

    // Wave band zone: offset to offset+0.6
    const waveStart = this._waveOffset
    const waveEnd = this._waveOffset.add(0.6)
    const localDist = clamp(outwardDist.sub(waveStart).div(float(0.6)), 0, 1)
    const inRange = clamp(outwardDist.sub(waveStart).mul(20.0), 0, 1)
      .mul(clamp(waveEnd.sub(outwardDist).mul(20.0), 0, 1))

    // Sine bands emanating outward
    const wavePhase = sin(localDist.mul(this._waveCount).mul(PI2).sub(tslTime.mul(this._waveSpeed)))
      .mul(0.5).add(0.5)
    const waveThreshold = mix(this._waveWidth, float(0.99), localDist)
    const waveBand = clamp(wavePhase.sub(waveThreshold).mul(40.0), 0, 1)

    // Multi-scale animated breaks along the wave lines
    // High freq: small gaps (~0.3 WU)
    const breakNoiseHi = mx_noise_float(vec3(
      positionWorld.x.mul(3.0),
      positionWorld.z.mul(3.0),
      tslTime.mul(0.15)
    ))
    // Low freq: large gaps (~1.5 WU) for variation
    const breakNoiseLo = mx_noise_float(vec3(
      positionWorld.x.mul(0.6),
      positionWorld.z.mul(0.6),
      tslTime.mul(0.08)
    ))
    // Combine: min of both so either scale can create a break
    const breakNoiseCombined = breakNoiseHi.mul(0.6).add(breakNoiseLo.mul(0.4))
    const noiseVal = breakNoiseCombined.mul(0.5).add(0.5)
    const breakMask = clamp(noiseVal.sub(this._waveNoiseBreak.mul(3.0)).mul(20.0), 0, 1)
    const broken = waveBand.mul(breakMask)

    // Fades
    const fadeIn = clamp(localDist.mul(8.0), 0, 1)
    const fadeOut = clamp(float(1).sub(localDist).mul(5.0), 0, 1)
    const nearCoast = clamp(gradSample.mul(3.0), 0, 1)
    const waveAlpha = broken.mul(fadeIn).mul(fadeOut).mul(inRange).mul(nearCoast).mul(this._waveOpacity)

    // Alt: deep water only — sparkles fade in where outwardDist > 0.75
    // const deepWaterFade = clamp(outwardDist.sub(0.75).mul(4.0), 0, 1)
    // const sparkleWithBreaks = waterColor.mul(totalAlpha).mul(deepWaterFade).mul(breakMask)

    // U-shaped mask — sparkles near coast (rivers) + deep water, suppressed in wave zone
    const uMask = clamp(outwardDist.sub(0.5).abs().sub(0.3).mul(10.0), 0, 1)
    const sparkleMask = mix(float(1), uMask, this._waveMaskStrength)
    const sparkleWithBreaks = waterColor.mul(totalAlpha).mul(sparkleMask).mul(breakMask)

    // Additive compositing in PostFX — caustic water + coast waves + gradient tint
    const gradientColor = vec3(this._waveGradientColor)
    const waveWhite = vec3(waveAlpha, waveAlpha, waveAlpha)
    material.colorNode = vec3(0, 0, 0)
    material.emissiveNode = sparkleWithBreaks.add(waveWhite).add(gradientColor.mul(gradSample).mul(this._waveGradientOpacity))
    material.opacityNode = float(1)

    this.mesh = new Mesh(geometry, material)
    this.mesh.position.y = 0.92
    this.scene.add(this.mesh)
  }
}
