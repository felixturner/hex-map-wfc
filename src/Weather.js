import {
  InstancedMesh, InstancedBufferAttribute, PlaneGeometry, Object3D,
  Group, DoubleSide, MeshBasicNodeMaterial, InstancedPointsNodeMaterial
} from 'three/webgpu'
import InstancedPointsGeometry from 'three/examples/jsm/geometries/InstancedPointsGeometry.js'
import InstancedPoints from 'three/examples/jsm/objects/InstancedPoints.js'
import {
  uniform, attribute, vec3, float, uv, time,
  sin, cos, clamp, fract, step, floor, positionLocal, PI
} from 'three/tsl'

const RAIN_COUNT = 10000
const SNOW_COUNT = 10000
const RAIN_RADIUS = 80  // Covers full 19-grid map
const SNOW_RADIUS = 80  // Covers full 19-grid map
const RAIN_VOLUME_Y = 10
const SNOW_VOLUME_Y = 10

function randomInCircle(radius) {
  const angle = Math.random() * Math.PI * 2
  const r = radius * Math.sqrt(Math.random())
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r }
}

export class Weather {
  constructor() {
    this.group = new Group()
    this._intensity = uniform(0.1)
    this._wind = uniform(0)
    this._opacity = uniform(0.8)
    this._speed = uniform(0.4)
    this._wobble = 0.5
    this._snowSize = 5
    this._intensityValue = 0.1
    this._windValue = 0
    this._rainMesh = null
    this._snowMesh = null
    this._snowBasePos = null
    this._snowRandoms = null
    this._snowYOffsets = null
    this._rainPositions = null
    this._mode = 'none'
  }

  init() {
    this._createRain()
    this._createSnow()
    this.setMode('snow')
  }

  _createRain() {
    // Tall fixed strips — drop animation done entirely in fragment shader
    const geo = new PlaneGeometry(0.06, RAIN_VOLUME_Y)
    const count = RAIN_COUNT

    this._rainPositions = []
    const randoms = new Float32Array(count)
    const angles = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const { x, z } = randomInCircle(RAIN_RADIUS)
      this._rainPositions.push({ x, z })
      randoms[i] = Math.random()
      angles[i] = Math.random() * Math.PI
    }
    geo.setAttribute('aRandom', new InstancedBufferAttribute(randoms, 1))
    geo.setAttribute('aAngle', new InstancedBufferAttribute(angles, 1))

    const mat = new MeshBasicNodeMaterial()
    mat.transparent = true
    mat.depthWrite = false
    mat.side = DoubleSide

    const aRandom = attribute('aRandom')
    const aAngle = attribute('aAngle')
    const wind = this._wind

    // Y-rotate first (random facing), then tilt (consistent world lean)
    const lx = positionLocal.x
    const ly = positionLocal.y
    const cosA = cos(aAngle)
    const sinA = sin(aAngle)
    const rotX = lx.mul(cosA)
    const rotZ = lx.mul(sinA)

    // Wind tilt in world space — all strips lean the same direction
    const tiltAngle = wind.mul(0.3)
    const cosT = cos(tiltAngle)
    const sinT = sin(tiltAngle)
    const tiltedX = rotX.mul(cosT).sub(ly.mul(sinT))
    const tiltedY = rotX.mul(sinT).add(ly.mul(cosT))

    mat.positionNode = vec3(tiltedX, tiltedY, rotZ)

    // Fragment: multiple drops per strip via scrolling hash pattern
    const uvY = uv().y
    const numCells = float(8)
    const scrollSpeed = float(4).add(aRandom.mul(3)).mul(this._speed)

    // Scrolling coordinate — unique per instance via aRandom phase
    const scrollCoord = uvY.mul(numCells).add(time.mul(scrollSpeed)).add(aRandom.mul(100))
    const cellFrac = fract(scrollCoord)
    const cellIdx = floor(scrollCoord)

    // Per-cell hash — determines if this cell has a visible drop
    const cellSeed = cellIdx.add(aRandom.mul(1000))
    const cellHash = fract(sin(cellSeed.mul(127.1)).mul(43758.5453))
    const cellActive = step(float(0.5), cellHash) // ~50% of cells show a drop

    // Drop shape: 20% fade in, 60% opaque, 20% fade out
    const dropLen = float(0.4)
    const fadeZone = float(0.08) // 20% of dropLen
    const fadeIn = clamp(cellFrac.div(fadeZone), 0, 1)
    const fadeOut = clamp(dropLen.sub(cellFrac).div(fadeZone), 0, 1)
    const dropShape = fadeIn.mul(fadeOut)

    // Fade at strip edges so tops/bottoms aren't hard-cut
    const tipFade = sin(uvY.mul(PI))

    // Intensity controls number of visible strips
    const visible = step(aRandom, this._intensity)
    mat.opacityNode = dropShape.mul(cellActive).mul(tipFade).mul(this._opacity).mul(visible)
    mat.colorNode = vec3(0.7, 0.7, 0.8)

    const mesh = new InstancedMesh(geo, mat, count)
    mesh.frustumCulled = false

    // Translation only — Y rotation and tilt handled in positionNode
    const dummy = new Object3D()
    for (let i = 0; i < count; i++) {
      dummy.position.set(this._rainPositions[i].x, RAIN_VOLUME_Y / 2, this._rainPositions[i].z)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    this._rainMesh = mesh
    this.group.add(mesh)
  }

  _createSnow() {
    const count = SNOW_COUNT
    const geo = new InstancedPointsGeometry()

    // Store base positions and per-particle params for CPU animation
    this._snowBasePos = new Float32Array(count * 3)
    this._snowRandoms = new Float32Array(count)
    this._snowYOffsets = new Float32Array(count)
    this._snowSizeFactors = new Float32Array(count)
    const positions = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const { x, z } = randomInCircle(SNOW_RADIUS)
      this._snowBasePos[i * 3] = x
      this._snowBasePos[i * 3 + 1] = 0
      this._snowBasePos[i * 3 + 2] = z
      positions[i * 3] = x
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = z
      this._snowRandoms[i] = Math.random()
      this._snowYOffsets[i] = Math.random() * SNOW_VOLUME_Y
      this._snowSizeFactors[i] = 1 + Math.random() * 2 // 1-3x
    }
    geo.setPositions(positions)

    // Per-instance size (random 1-3x) and color (for distance fade)
    const sizes = new Float32Array(count)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      sizes[i] = this._snowSize * this._snowSizeFactors[i]
      colors[i * 3] = 1
      colors[i * 3 + 1] = 1
      colors[i * 3 + 2] = 1
    }
    geo.setAttribute('instanceSize', new InstancedBufferAttribute(sizes, 1))
    geo.setColors(colors)

    const mat = new InstancedPointsNodeMaterial({
      vertexColors: true,
    })
    mat.transparent = true
    mat.depthWrite = false
    mat.pointWidthNode = attribute('instanceSize')
    mat.opacity = 0.8

    const mesh = new InstancedPoints(geo, mat)
    mesh.frustumCulled = false

    this._snowMesh = mesh
    this.group.add(mesh)
  }

  update(dt, cameraTarget, camera) {
    if (this._snowMesh && this._mode === 'snow' && this._snowBasePos) {
      const t = performance.now() / 1000
      const geo = this._snowMesh.geometry
      const posAttr = geo.attributes.instancePosition
      const sizeAttr = geo.attributes.instanceSize
      const colorAttr = geo.attributes.instanceColor
      const posArr = posAttr.array
      const sizeArr = sizeAttr.array
      const colorArr = colorAttr.array
      const wind = this._windValue
      const speed = this._speed.value
      const wobble = this._wobble
      const intensity = this._intensityValue
      const snowSize = this._snowSize
      const fadeStart = SNOW_RADIUS * 0.6
      const fadeRange = SNOW_RADIUS * 0.4

      for (let i = 0; i < SNOW_COUNT; i++) {
        const rand = this._snowRandoms[i]

        // Intensity hides particles by moving off-screen
        if (rand > intensity) {
          posArr[i * 3 + 1] = -1000
          continue
        }

        const bx = this._snowBasePos[i * 3]
        const bz = this._snowBasePos[i * 3 + 2]
        const yOff = this._snowYOffsets[i]
        const spd = (3 + rand * 2) * speed
        const y = (((yOff / SNOW_VOLUME_Y - t * spd / SNOW_VOLUME_Y) % 1) + 1) % 1 * SNOW_VOLUME_Y
        const phase = rand * 100
        const wx = Math.sin(t * 1.5 + phase) * wobble
        const wz = Math.cos(t * 1.2 + phase) * wobble

        posArr[i * 3] = bx + wx + t * wind * 3
        posArr[i * 3 + 1] = y
        posArr[i * 3 + 2] = bz + wz

        // Size from random factor
        sizeArr[i] = snowSize * this._snowSizeFactors[i]

        // Distance fade — darken particles near edge (fades in additive overlay)
        const dist = Math.sqrt(bx * bx + bz * bz)
        const fade = Math.max(0, Math.min(1, 1 - (dist - fadeStart) / fadeRange))
        colorArr[i * 3] = fade
        colorArr[i * 3 + 1] = fade
        colorArr[i * 3 + 2] = fade
      }
      posAttr.needsUpdate = true
      sizeAttr.needsUpdate = true
      colorAttr.needsUpdate = true
    }
  }

  setMode(mode) {
    this._mode = mode
    if (this._rainMesh) this._rainMesh.visible = mode === 'rain'
    if (this._snowMesh) this._snowMesh.visible = mode === 'snow'
  }

  setIntensity(v) {
    this._intensity.value = v
    this._intensityValue = v
  }

  setWind(v) {
    this._wind.value = v
    this._windValue = v
  }

  setOpacity(v) {
    this._opacity.value = v
    if (this._snowMesh) this._snowMesh.material.opacity = v
  }

  setSpeed(v) {
    this._speed.value = v
  }

  setWobble(v) {
    this._wobble = v
  }

  setSnowSize(v) {
    this._snowSize = v
  }

  getOverlayObjects() {
    return [this.group]
  }
}
