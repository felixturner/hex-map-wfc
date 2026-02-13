import {
  Mesh,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Group,
} from 'three/webgpu'
import gsap from 'gsap'

/**
 * Placeholder - Visual representation for an unmapped HexGrid
 * Shows a clickable button where a new grid can be created
 * Triangle indicators show which directions have populated neighbor grids
 */
export class Placeholder {
  constructor(gridRadius, hexWidth, hexHeight) {
    this.gridRadius = gridRadius
    this.hexWidth = hexWidth
    this.hexHeight = hexHeight

    this.group = new Group()
    this.button = null
    this.triangles = []  // Triangle meshes for neighbor indicators
    this.onClick = null
    this.spinTween = null  // GSAP tween for spinning animation
    this._fadeTimer = null

    this.createButton()
  }

  /**
   * Create the clickable button
   */
  createButton() {
    const buttonRadius = this.gridRadius * this.hexWidth * 0.24

    // Create flat hexagon geometry (6 triangles from center)
    const vertices = []
    for (let i = 0; i < 6; i++) {
      const angle1 = (i * Math.PI) / 3
      const angle2 = ((i + 1) * Math.PI) / 3
      // Center vertex
      vertices.push(0, 0, 0)
      // First outer vertex
      vertices.push(Math.cos(angle1) * buttonRadius, 0, Math.sin(angle1) * buttonRadius)
      // Second outer vertex
      vertices.push(Math.cos(angle2) * buttonRadius, 0, Math.sin(angle2) * buttonRadius)
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()

    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })

    this.button = new Mesh(geometry, material)
    this.button.position.y = 1
    this.button.renderOrder = 100
    this.button.userData.isPlaceholder = true
    this.button.userData.owner = this
    this.group.add(this.button)
  }

  /**
   * Create triangle indicators pointing from neighbor edges toward center
   * @param {number[]} directions - Array of directions (0-5) that have populated neighbors
   *   0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
   */
  setNeighborDirections(directions) {
    // Clear existing triangles
    for (const tri of this.triangles) {
      this.group.remove(tri)
      tri.geometry?.dispose()
      // Material is shared with button, don't dispose
    }
    this.triangles = []

    if (!directions || directions.length === 0) return

    // Triangle size and position
    const triSize = this.gridRadius * this.hexWidth * 0.16  // Triangle size (2x larger)
    const triDistance = this.gridRadius * this.hexWidth * 0.7

    for (const dir of directions) {
      // Angle for this direction (flat-top hex: 0=N points to -Z)
      // Direction 0 (N) = -90° = -PI/2, then +60° for each direction
      const angle = -Math.PI / 2 + dir * Math.PI / 3

      // Position at the edge
      const x = Math.cos(angle) * triDistance
      const z = Math.sin(angle) * triDistance

      // Create triangle pointing toward center (opposite of angle)
      const tri = this.createTriangle(triSize)
      tri.position.set(x, 1, z)
      // Rotate so it points toward center (rotate around Y axis)
      // The triangle base geometry points in +Z (angle PI/2)
      // To point toward center, rotate by: (angle + PI) - PI/2 = angle + PI/2
      tri.rotation.y = angle + Math.PI / 2

      tri.userData.isPlaceholder = true
      tri.userData.owner = this
      this.group.add(tri)
      this.triangles.push(tri)
    }
  }

  /**
   * Create a single triangle mesh pointing in +Z direction
   * Uses same material as button (shared for consistent appearance and no AO)
   */
  createTriangle(size) {
    // Equilateral triangle vertices (pointing in +Z)
    const h = size * Math.sqrt(3) / 2  // Height of equilateral triangle
    const vertices = new Float32Array([
      0, 0, h * 0.6,           // Tip (pointing +Z)
      -size / 2, 0, -h * 0.4,  // Bottom left
      size / 2, 0, -h * 0.4,   // Bottom right
    ])

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()

    // Use same material as button (no AO since depthWrite: false)
    const mesh = new Mesh(geometry, this.button.material)
    mesh.renderOrder = 100
    return mesh
  }

  /**
   * Set hover state
   * Triangles share button's material, so updating it affects all
   */
  setHover(isHovered) {
    if (this.button?.material) {
      this.button.material.opacity = isHovered ? 0.9 : 0.5
    }
  }

  /**
   * Start spinning animation (called when WFC starts)
   */
  startSpinning() {
    if (!this.button) return
    this.spinTween = gsap.to(this.button.rotation, {
      y: Math.PI * 2,
      duration: 1,
      repeat: -1,
      ease: 'none'
    })
  }

  /**
   * Stop spinning animation (called when WFC completes)
   */
  stopSpinning() {
    if (this.spinTween) {
      this.spinTween.kill()
      this.spinTween = null
    }
    if (this.button) {
      this.button.rotation.y = 0
    }
  }

  /**
   * Fade in the placeholder from invisible
   * @param {number} delay - ms to wait before starting fade
   */
  fadeIn(delay = 0) {
    clearTimeout(this._fadeTimer)
    gsap.killTweensOf(this._anim)
    this.group.visible = false
    this._anim = { opacity: 0 }
    this._fadeTimer = setTimeout(() => {
      this.group.visible = true
      this.button.material.opacity = 0
      gsap.to(this._anim, {
        opacity: 0.5,
        duration: 0.3,
        ease: 'power2.out',
        onUpdate: () => { this.button.material.opacity = this._anim.opacity },
      })
    }, delay)
  }

  /**
   * Fade out the placeholder then hide
   */
  fadeOut() {
    clearTimeout(this._fadeTimer)
    gsap.killTweensOf(this._anim)
    this.group.visible = true
    this._anim = { opacity: this.button.material.opacity }
    gsap.to(this._anim, {
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onUpdate: () => { this.button.material.opacity = this._anim.opacity },
      onComplete: () => { this.group.visible = false },
    })
  }

  /**
   * Show placeholder
   */
  show() {
    this.group.visible = true
  }

  /**
   * Hide placeholder
   */
  hide() {
    this.group.visible = false
  }

  /**
   * Get the button mesh for raycasting
   */
  getButton() {
    return this.button
  }

  /**
   * Get all clickable meshes (button + triangles only) for raycasting
   */
  getClickables() {
    return [this.button, ...this.triangles].filter(Boolean)
  }

  /**
   * Dispose of resources
   */
  dispose() {
    // Stop any running animation
    this.stopSpinning()

    // Dispose triangles first (geometry only - material is shared with button)
    for (const tri of this.triangles) {
      tri.geometry?.dispose()
    }
    this.triangles = []

    // Dispose button
    if (this.button) {
      this.button.geometry?.dispose()
      this.button.material?.dispose()
    }
  }
}
