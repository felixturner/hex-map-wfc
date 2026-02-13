import { Box2, Color, Object3D, Vector2, MathUtils } from 'three/webgpu'
import gsap from 'gsap'
import { BlockGeometry } from './lib/BlockGeometry.js'
import { Sounds } from './lib/Sounds.js'

/**
 * Tower class - represents a building/stack of blocks
 * Contains a top block (roof) and multiple base blocks (floors)
 */
export class Tower {

  static COLORS = [
    new Color(0x777777),
    new Color(0x888888),
    new Color(0x999999),
    new Color(0xbbbbbb),
    new Color(0xcccccc),
  ]

  static ID = 0
  static BASE_COLOR = new Color(0x666666)

  constructor() {
    this.id = Tower.ID++
    this.typeBottom = 0 // Base block geometry type
    this.typeTop = 0    // Top block geometry type
    this.box = new Box2()
    this.numFloors = 0  // Primary height variable (integer floor count)
    this.rotation = 0
    this.topColorIndex = 0
    this.topColor = Tower.COLORS[this.topColorIndex]
    this.baseColor = Tower.BASE_COLOR
    // For dynamic height recalculation
    this.cityNoiseVal = 0
    this.randFactor = 0
    this.skipFactor = 0 // For realtime visibility toggle
    this.colorIndex = 0 // Hover color index
    this.visible = true


    // Instance IDs for BatchedMesh
    this.floorInstances = [] // Base block instance IDs
    this.roofInstance = null // Top block instance ID

    // Animation state
    this.hoverTween = null
    this.floorTween = null
    this.roofTween = null // Separate tween for roof Y position (persists across clicks)
    // Persistent roof animation state (so GSAP can tween from current values)
    this.roofAnim = { y: 0, tiltX: 0, tiltY: 0, tiltZ: 0 }
    // Persistent dummy for roof animation (avoids stale closures)
    this.roofDummy = new Object3D()
    // Flag to prevent external matrix updates from overwriting animated roof
    this.roofAnimating = false
  }

  setTopColorIndex(index) {
    this.topColorIndex = index
    this.topColor = Tower.COLORS[this.topColorIndex]
  }

  /**
   * Lighten a color by increasing its HSL lightness
   */
  static lightenColor(color, amount = 0.15) {
    const hsl = {}
    color.getHSL(hsl)
    return new Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + amount))
  }

  /**
   * Animate tower color to/from hover state using a single tween
   * @param {BatchedMesh} mesh - The batched mesh containing this tower's instances
   * @param {boolean} isHovering - True to lighten colors, false to restore original
   * @param {number} floorHeight - Height of each floor for calculating visible floors
   */
  animateHoverColor(mesh, isHovering) {
    // Kill any existing hover tween
    if (this.hoverTween) {
      this.hoverTween.kill()
    }

    const numFloors = this.numFloors
    const floorInstances = this.floorInstances
    const roofInstance = this.roofInstance

    // Get current colors from first floor and roof
    const currentFloorColor = new Color()
    const currentRoofColor = new Color()
    mesh.getColorAt(floorInstances[0], currentFloorColor)
    mesh.getColorAt(roofInstance, currentRoofColor)

    // Target colors - lighten current colors when hovering, restore original otherwise
    let toFloorColor, toRoofColor
    if (isHovering) {
      // Lighten the base colors for hover effect
      const baseFloor = this.isLit && this.litColor ? this.litColor : this.baseColor
      const baseRoof = this.isLit && this.litColor ? this.litColor : this.topColor
      toFloorColor = Tower.lightenColor(baseFloor)
      toRoofColor = Tower.lightenColor(baseRoof)
    } else if (this.isLit && this.litColor) {
      // Lit towers stay at their lit color
      toFloorColor = this.litColor.clone()
      toRoofColor = this.litColor.clone()
    } else {
      toFloorColor = this.baseColor
      toRoofColor = this.topColor
    }

    // Interpolation colors
    const floorColor = currentFloorColor.clone()
    const roofColor = currentRoofColor.clone()

    // Animation state object
    const anim = { t: 0 }

    // Single tween that updates all blocks
    this.hoverTween = gsap.to(anim, {
      t: 1,
      duration: 0.3,
      onUpdate: () => {
        // Interpolate colors
        floorColor.copy(currentFloorColor).lerp(toFloorColor, anim.t)
        roofColor.copy(currentRoofColor).lerp(toRoofColor, anim.t)

        // Apply to all visible floors
        for (let f = 0; f < numFloors; f++) {
          mesh.setColorAt(floorInstances[f], floorColor)
        }
        // Apply to roof
        mesh.setColorAt(roofInstance, roofColor)
      }
    })
  }

  /**
   * Animate tower vertical offset (for press down effect)
   * @param {BatchedMesh} mesh - The batched mesh
   * @param {number} floorHeight - Height of each floor
   * @param {number} maxFloors - Maximum number of floors
   * @param {number} offset - Target Y offset
   * @param {number} duration - Animation duration
   * @param {Function} onComplete - Callback when animation completes
   */
  animateOffset(mesh, floorHeight, maxFloors, offset, duration, onComplete) {
    // Use local dummy to avoid conflicts with other animations
    const dummy = new Object3D()
    const center = this.box.getCenter(new Vector2())
    const size = this.box.getSize(new Vector2())
    const numFloors = this.numFloors

    // Half-heights for centered geometries
    const floorHalfHeight = floorHeight / 2
    const roofHalfHeight = BlockGeometry.halfHeights[this.typeTop]

    // Animate all floor instances
    const anim = { offset: 0 }
    const self = this
    gsap.to(anim, {
      offset: offset,
      duration: duration,
      ease: 'power2.out',
      onUpdate: () => {
        for (let f = 0; f < numFloors; f++) {
          const idx = this.floorInstances[f]
          dummy.position.set(center.x, f * floorHeight + floorHalfHeight + anim.offset, center.y)
          dummy.scale.set(size.x, floorHeight, size.y)
          dummy.rotation.set(0, this.rotation, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(idx, dummy.matrix)
        }
        // Only update roof if not being animated separately
        if (!self.roofAnimating) {
          dummy.position.set(center.x, numFloors * floorHeight + roofHalfHeight + anim.offset, center.y)
          dummy.scale.set(size.x, 1, size.y)
          dummy.rotation.set(0, this.rotation, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(this.roofInstance, dummy.matrix)
        }
      },
      onComplete: onComplete
    })
  }

  /**
   * Animate adding a new floor with roof pop-off effect
   */
  animateNewFloor(mesh, floorHeight, oldNumFloors, hoverColor, onComplete, onFloorPop) {
    const dummy = new Object3D()
    const center = this.box.getCenter(new Vector2())
    const size = this.box.getSize(new Vector2())

    if (this.floorTween?.isActive()) this.floorTween.kill()

    const floorHalfHeight = floorHeight / 2
    const roofHalfHeight = BlockGeometry.halfHeights[this.typeTop]
    const newFloorIdx = this.floorInstances[oldNumFloors]
    const newFloorY = oldNumFloors * floorHeight + floorHalfHeight
    const finalRoofY = (oldNumFloors + 1) * floorHeight + roofHalfHeight

    // Initialize roofAnim.y on first click
    if (this.roofAnim.y === 0) {
      this.roofAnim.y = oldNumFloors * floorHeight + roofHalfHeight + floorHeight * 0.2
    }

    // Use hover color directly for new floors
    mesh.setColorAt(newFloorIdx, hoverColor)

    const anim = {
      scale: 0.1,
      yOffset: 0,
      tiltX: 0, tiltY: 0, tiltZ: 0,
      baseOffset: floorHeight * 0.2
    }
    const tiltTarget = {
      x: MathUtils.randFloatSpread(0.2),
      y: MathUtils.randFloatSpread(0.4),
      z: MathUtils.randFloatSpread(0.2)
    }

    const updateFloor = () => {
      dummy.position.set(center.x, newFloorY + anim.yOffset, center.y)
      dummy.scale.set(size.x * anim.scale, floorHeight * anim.scale, size.y * anim.scale)
      dummy.rotation.set(anim.tiltX, this.rotation + anim.tiltY, anim.tiltZ)
      dummy.updateMatrix()
      mesh.setMatrixAt(newFloorIdx, dummy.matrix)
    }

    const tl = gsap.timeline({
      onComplete: () => { this.floorTween = null; onComplete?.() }
    })
    this.floorTween = tl
    tl.timeScale(0.5)

    // Existing floors settle down
    tl.to(anim, {
      baseOffset: 0,
      duration: 0.12,
      ease: 'power2.out',
      onUpdate: () => {
        for (let f = 0; f < oldNumFloors; f++) {
          dummy.position.set(center.x, f * floorHeight + floorHalfHeight + anim.baseOffset, center.y)
          dummy.scale.set(size.x, floorHeight, size.y)
          dummy.rotation.set(0, this.rotation, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(this.floorInstances[f], dummy.matrix)
        }
      }
    }, 0)

    // New floor scales in + pops up
    tl.to(anim, {
      scale: 1,
      yOffset: floorHeight * 0.5,
      tiltX: tiltTarget.x, tiltY: tiltTarget.y, tiltZ: tiltTarget.z,
      duration: 0.1,
      ease: 'power2.out',
      onStart: () => mesh.setVisibleAt(newFloorIdx, true),
      onUpdate: updateFloor,
      onComplete: onFloorPop
    }, 0)

    // New floor settles down
    tl.to(anim, {
      yOffset: 0, tiltX: 0, tiltY: 0, tiltZ: 0,
      duration: 0.07,
      ease: 'bounce.out',
      onUpdate: updateFloor
    }, 0.11)

    // Roof animation (separate)
    this.startRoofAnimation(mesh, center, size, floorHeight, finalRoofY)
  }

  /**
   * Animate roof pop-off (separate from floor timeline for fast-click support)
   */
  startRoofAnimation(mesh, center, size, floorHeight, finalRoofY) {
    if (this.roofTween) this.roofTween.kill()
    this.roofAnimating = true

    const maxTilt = 0.5

    // Pop up above final position (not current position, to prevent stacking on fast clicks)
    const popUpY = finalRoofY + floorHeight * 1.5
    const tiltX = MathUtils.clamp(this.roofAnim.tiltX + MathUtils.randFloatSpread(0.6), -maxTilt, maxTilt)
    const tiltY = MathUtils.clamp(this.roofAnim.tiltY + MathUtils.randFloatSpread(0.96), -maxTilt, maxTilt)
    const tiltZ = MathUtils.clamp(this.roofAnim.tiltZ + MathUtils.randFloatSpread(0.6), -maxTilt, maxTilt)

    const self = this
    const render = () => {
      self.roofDummy.position.set(center.x, self.roofAnim.y, center.y)
      self.roofDummy.scale.set(size.x, 1, size.y)
      self.roofDummy.rotation.set(self.roofAnim.tiltX, self.rotation + self.roofAnim.tiltY, self.roofAnim.tiltZ)
      self.roofDummy.updateMatrix()
      mesh.setMatrixAt(self.roofInstance, self.roofDummy.matrix)
    }

    // Render immediately at current position
    render()

    // Timeline: pop up, then bounce down
    const tl = gsap.timeline({
      onComplete: () => { self.roofAnimating = false; self.roofTween = null }
    })
    this.roofTween = tl

    tl.to(this.roofAnim, {
      y: popUpY, tiltX, tiltY, tiltZ,
      duration: 0.16,
      ease: 'power2.out',
      onUpdate: render
    })
    tl.to(this.roofAnim, {
      y: finalRoofY, tiltX: 0, tiltY: 0, tiltZ: 0,
      duration: 0.5,
      ease: 'bounce.out',
      onUpdate: render
    }, 0.18)

    // Play sound when roof lands
    tl.call(() => Sounds.play('stone', 1.0, 0.4, 0.4), null, 0.35)
  }

  /**
   * Animate deleting all floors except the base floor
   * Pop off roof, stagger-delete floors top-down, drop roof back
   */
  animateDelete(mesh, floorHeight, numFloors, onComplete) {
    if (this.floorTween?.isActive()) this.floorTween.kill()
    if (this.roofTween) this.roofTween.kill()

    const dummy = new Object3D()
    const center = this.box.getCenter(new Vector2())
    const size = this.box.getSize(new Vector2())

    const floorHalfHeight = floorHeight / 2
    const roofHalfHeight = BlockGeometry.halfHeights[this.typeTop]

    // Current roof Y position (or calculate from numFloors)
    const currentRoofY = this.roofAnim.y > 0 ? this.roofAnim.y : numFloors * floorHeight + roofHalfHeight
    const finalRoofY = roofHalfHeight // At ground level (no floors)
    const popUpY = currentRoofY + floorHeight * 2 // Pop up high

    this.roofAnimating = true

    const self = this
    const renderRoof = () => {
      self.roofDummy.position.set(center.x, self.roofAnim.y, center.y)
      self.roofDummy.scale.set(size.x, 1, size.y)
      self.roofDummy.rotation.set(self.roofAnim.tiltX, self.rotation + self.roofAnim.tiltY, self.roofAnim.tiltZ)
      self.roofDummy.updateMatrix()
      mesh.setMatrixAt(self.roofInstance, self.roofDummy.matrix)
    }

    // Animation state for each floor (to be deleted - all floors including floor 0)
    const floorAnims = []
    for (let f = 0; f < numFloors; f++) {
      floorAnims.push({
        floorIdx: f,
        scale: 1,
        yOffset: 0,
        tiltX: 0, tiltY: 0, tiltZ: 0
      })
    }

    const tl = gsap.timeline({
      onComplete: () => {
        self.floorTween = null
        self.roofAnimating = false
        self.roofTween = null
        onComplete?.()
      }
    })
    this.floorTween = tl

    // Phase 1: Pop roof up with tilt
    const tiltX = MathUtils.randFloatSpread(0.4)
    const tiltY = MathUtils.randFloatSpread(0.6)
    const tiltZ = MathUtils.randFloatSpread(0.4)

    tl.to(this.roofAnim, {
      y: popUpY, tiltX, tiltY, tiltZ,
      duration: 0.15,
      ease: 'power2.out',
      onUpdate: renderRoof
    })

    // Phase 2: Stagger-delete floors from top to bottom
    const staggerDelay = 0.06
    for (let i = floorAnims.length - 1; i >= 0; i--) {
      const anim = floorAnims[i]
      const floorY = anim.floorIdx * floorHeight + floorHalfHeight
      const instanceIdx = this.floorInstances[anim.floorIdx]
      // Pitch decreases as floors go down (high pitch at top, low at bottom)
      const pitch = 0.8 + (anim.floorIdx / numFloors) * 1.2
      const updateFloor = () => {
        dummy.position.set(center.x, floorY + anim.yOffset, center.y)
        dummy.scale.set(size.x * anim.scale, floorHeight * anim.scale, size.y * anim.scale)
        dummy.rotation.set(anim.tiltX, this.rotation + anim.tiltY, anim.tiltZ)
        dummy.updateMatrix()
        mesh.setMatrixAt(instanceIdx, dummy.matrix)
      }

      // Shrink and fall with random tilt
      const delay = 0.15 + (floorAnims.length - 1 - i) * staggerDelay
      tl.to(anim, {
        scale: 0,
        yOffset: -floorHeight * 0.5,
        tiltX: MathUtils.randFloatSpread(0.3),
        tiltY: MathUtils.randFloatSpread(0.5),
        tiltZ: MathUtils.randFloatSpread(0.3),
        duration: 0.12,
        ease: 'power2.in',
        onUpdate: updateFloor,
        onComplete: () => {
          mesh.setVisibleAt(instanceIdx, false)
          Sounds.play('tick', pitch, 0.4, 1.0)
        }
      }, delay)
    }

    // Phase 3: Drop roof back down after floors are deleted
    const dropDelay = 0.15 + floorAnims.length * staggerDelay + 0.1
    tl.to(this.roofAnim, {
      y: finalRoofY, tiltX: 0, tiltY: 0, tiltZ: 0,
      duration: 0.4,
      ease: 'bounce.out',
      onUpdate: renderRoof
    }, dropDelay)

    // Play sound when roof lands
    const roofLandDelay = dropDelay + 0.2
    tl.call(() => Sounds.play('stone', 1.0, 0.4, 0.4), null, roofLandDelay)
  }

  /**
   * Handle click on tower - add a floor with animation and sounds
   * @param {Map} map - The map instance (for towerMesh and gridToWorld)
   * @param {number} floorHeight - Height of each floor
   * @param {number} maxFloors - Maximum number of floors
   * @param {Debris} debris - Debris system for spawning particles
   * @param {Tower[]} allTowers - All towers for debris collision
   * @param {Function} onComplete - Called when animation completes
   */
  handleClick(city, floorHeight, maxFloors, debris, allTowers, onComplete) {
    const mesh = city.towerMesh
    const numFloors = this.numFloors

    // Check if we can add another floor
    if (numFloors >= maxFloors) {
      return
    }

    // Play tick sound and push down animation, then release
    Sounds.play('tick', 1.0, 0)

    const pushAmount = floorHeight * 0.25
    this.animateOffset(mesh, floorHeight, maxFloors, -pushAmount, 0.1, () => {
      // Increment floor count
      this.numFloors = numFloors + 1

      // Pitch increases with floor height (0.8 at ground, 2.0 at top)
      const pitch = 0.8 + (numFloors / maxFloors) * 1.2
      Sounds.play('pop', pitch, 0.15)

      // Animate the tower back up with the new floor emerging
      this._animateNewFloorWithDebris(city, floorHeight, numFloors, debris, allTowers, onComplete)
    })
  }

  /**
   * Handle right-click on tower - delete all floors
   * @param {Map} map - The map instance (for towerMesh and gridToWorld)
   * @param {number} floorHeight - Height of each floor
   * @param {Debris} debris - Debris system for spawning particles
   * @param {Tower[]} allTowers - All towers for debris collision
   * @param {Function} onComplete - Called when animation completes
   */
  handleRightClick(city, floorHeight, debris, allTowers, onComplete) {
    const mesh = city.towerMesh
    const numFloors = this.numFloors

    // Only delete if tower has at least 1 floor
    if (numFloors < 1) return

    // Get tower info for debris - convert grid coords to world coords
    const baseColor = this.isLit && this.litColor ? this.litColor : this.baseColor
    const debrisColor = Tower.lightenColor(baseColor)
    const center = this.box.getCenter(new Vector2())
    const world = city.gridToWorld(center.x, center.y)
    const size = this.box.getSize(new Vector2())
    const radius = Math.max(size.x, size.y) / 2

    // Spawn debris immediately
    debris.setupNearbyCollisions(this, allTowers, floorHeight, city)
    debris.spawn(world.x, numFloors * floorHeight, world.z, radius, debrisColor)

    // Animate the deletion
    this.animateDelete(mesh, floorHeight, numFloors, () => {
      this.numFloors = 0 // No floors, just roof
      onComplete?.()
    })
  }

  /**
   * Internal: Animate new floor with debris spawning
   */
  _animateNewFloorWithDebris(city, floorHeight, oldNumFloors, debris, allTowers, onComplete) {
    const mesh = city.towerMesh
    // Use lightened version of tower's base color for new floor and debris
    const baseColor = this.isLit && this.litColor ? this.litColor : this.baseColor
    const newFloorColor = Tower.lightenColor(baseColor)
    const debrisColor = newFloorColor.clone()
    const center = this.box.getCenter(new Vector2())
    const newFloorY = (oldNumFloors + 1) * floorHeight

    // Convert grid coords to world coords
    const world = city.gridToWorld(center.x, center.y)

    // Get tower size for debris spawn radius
    const size = this.box.getSize(new Vector2())
    const radius = Math.max(size.x, size.y) / 2

    // Callback to spawn debris when floor reaches max scale
    const onFloorPop = () => {
      debris.setupNearbyCollisions(this, allTowers, floorHeight, city)
      debris.spawn(world.x, newFloorY, world.z, radius, debrisColor)
    }

    this.animateNewFloor(mesh, floorHeight, oldNumFloors, newFloorColor, onComplete, onFloorPop)
  }
}
