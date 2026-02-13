import {
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicNodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  AdditiveBlending,
  Color,
  Group,
} from 'three/webgpu'
import { vec3, uv, step, min, max, float } from 'three/tsl'

/**
 * HexGridHelper - Debug visualization overlay for a hex grid
 * Manages grid lines and dots (outline and axes are on HexGrid itself)
 */
export class HexGridHelper {
  constructor(gridRadius, hexWidth = 2, hexHeight = null) {
    this.gridRadius = gridRadius
    this.hexWidth = hexWidth
    this.hexHeight = hexHeight || (2 / Math.sqrt(3) * 2)
    this.hexRadius = 2 / Math.sqrt(3)

    this.group = new Group()
    this.hexGridLines = null
    this.hexGridDots = null

    this.color = new Color(0xffffff)
  }

  /**
   * Create grid lines and dots visualization
   */
  create() {
    this.createGridLines()
    this.createGridDots()
  }

  /**
   * Show the helper
   */
  show() {
    this.group.visible = true
  }

  /**
   * Hide the helper
   */
  hide() {
    this.group.visible = false
  }

  /**
   * Create hex grid line overlay for this grid
   */
  createGridLines() {
    const { gridRadius, hexWidth, hexHeight, hexRadius } = this

    const allHexVerts = []

    for (let q = -gridRadius; q <= gridRadius; q++) {
      const r1 = Math.max(-gridRadius, -q - gridRadius)
      const r2 = Math.min(gridRadius, -q + gridRadius)
      for (let r = r1; r <= r2; r++) {
        const col = q + Math.floor(r / 2)
        const row = r
        const localX = col * hexWidth + (Math.abs(row) % 2) * hexWidth * 0.5
        const localZ = row * hexHeight * 0.75

        const hexVerts = []
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3
          const vx = localX + Math.sin(angle) * hexRadius
          const vz = localZ + Math.cos(angle) * hexRadius
          hexVerts.push(vx, 1, vz)
        }

        for (let i = 0; i < 6; i++) {
          const j = (i + 1) % 6
          allHexVerts.push(hexVerts[i * 3], hexVerts[i * 3 + 1], hexVerts[i * 3 + 2])
          allHexVerts.push(hexVerts[j * 3], hexVerts[j * 3 + 1], hexVerts[j * 3 + 2])
        }
      }
    }

    const hexLineGeom = new BufferGeometry()
    hexLineGeom.setAttribute('position', new Float32BufferAttribute(allHexVerts, 3))
    const hexLineMat = new LineBasicNodeMaterial({ color: this.color })
    hexLineMat.depthTest = false
    hexLineMat.depthWrite = false
    hexLineMat.transparent = true
    hexLineMat.blending = AdditiveBlending

    this.hexGridLines = new LineSegments(hexLineGeom, hexLineMat)
    this.hexGridLines.renderOrder = 999
    this.group.add(this.hexGridLines)
  }

  /**
   * Create hex grid dots at vertices using TSL shader
   */
  createGridDots() {
    const { gridRadius, hexWidth, hexHeight, hexRadius } = this

    const planeSize = gridRadius * 2 * hexWidth + hexWidth
    const hexDotPlaneGeom = new PlaneGeometry(planeSize, planeSize)
    hexDotPlaneGeom.rotateX(-Math.PI / 2)

    const hexDotMat = new MeshBasicNodeMaterial()
    hexDotMat.transparent = true
    hexDotMat.alphaTest = 0.5
    hexDotMat.side = 2
    hexDotMat.depthTest = false

    const worldPos = uv().sub(0.5).mul(planeSize)
    const wx = worldPos.x
    const wz = worldPos.y

    const hWidth = float(hexWidth)
    const hHeight = float(hexHeight)
    const hRadius = float(hexRadius)

    const rowF = wz.div(hHeight.mul(0.75))
    const row = rowF.round()
    const rowMod = row.mod(2).abs()
    const colOffset = rowMod.mul(hWidth.mul(0.5))
    const colF = wx.sub(colOffset).div(hWidth)
    const col = colF.round()

    const hexCenterX = col.mul(hWidth).add(colOffset)
    const hexCenterZ = row.mul(hHeight.mul(0.75))

    // Check if hex is within grid radius (hex distance from center)
    // Convert offset coords to axial: q = col - floor(row / 2), r = row
    const q = col.sub(row.div(2).floor())
    const r = row
    const s = q.add(r).negate()
    const hexDist = max(max(q.abs(), r.abs()), s.abs())
    const inRadius = step(hexDist, float(gridRadius))

    const dotRadius = float(0.04)
    let dotMask = float(0)
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3
      const vx = hexCenterX.add(float(Math.sin(angle)).mul(hRadius))
      const vz = hexCenterZ.add(float(Math.cos(angle)).mul(hRadius))
      const dx = wx.sub(vx)
      const dz = wz.sub(vz)
      const dist = dx.mul(dx).add(dz.mul(dz)).sqrt()
      dotMask = dotMask.add(float(1).sub(step(dotRadius, dist)))
    }
    dotMask = min(dotMask.mul(inRadius), float(1))

    // Use the grid's random bright color
    const dotColor = vec3(this.color.r, this.color.g, this.color.b)
    hexDotMat.colorNode = dotColor
    hexDotMat.opacityNode = dotMask
    hexDotMat.blending = AdditiveBlending
    hexDotMat.depthWrite = false

    this.hexGridDots = new Mesh(hexDotPlaneGeom, hexDotMat)
    this.hexGridDots.position.set(0, 1, 0)
    this.hexGridDots.renderOrder = 998
    this.group.add(this.hexGridDots)
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    if (this.hexGridLines) {
      this.hexGridLines.geometry?.dispose()
      this.hexGridLines.material?.dispose()
      this.hexGridLines = null
    }

    if (this.hexGridDots) {
      this.hexGridDots.geometry?.dispose()
      this.hexGridDots.material?.dispose()
      this.hexGridDots = null
    }
  }
}
