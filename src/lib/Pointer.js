import { Raycaster, Vector2, Vector3 } from 'three/webgpu'
import { uniform } from 'three/tsl'

/**
 * Helper class to handle pointer position and "down" with output exposed in vector3 and uniforms
 */
export class Pointer {
  constructor(renderer, camera, plane) {
    this.camera = camera
    this.renderer = renderer
    this.rayCaster = new Raycaster()
    this.initPlane = plane
    this.iPlane = plane.clone()
    this.clientPointer = new Vector2()
    this.pointer = new Vector2()
    this.scenePointer = new Vector3()
    this.pointerDown = false
    this.uPointerDown = uniform(0)
    this.uPointer = uniform(new Vector3())

    // Raycast targets for hover detection
    this.raycastTargets = []
    this.onHoverCallback = null

    renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this))
    renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this))
    window.addEventListener('pointermove', this.onPointerMove.bind(this))
    renderer.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this))
  }

  setRaycastTargets(targets, callbacks) {
    this.raycastTargets = targets
    this.onHoverCallback = callbacks.onHover
    this.onPointerDownCallback = callbacks.onPointerDown
    this.onPointerUpCallback = callbacks.onPointerUp
    this.onPointerMoveCallback = callbacks.onPointerMove
    this.onRightClickCallback = callbacks.onRightClick
  }

  onPointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button === 0) {
      this.pointerDown = true
      this.uPointerDown.value = 1
      this.isTouch = e.pointerType === 'touch'

      // Raycast for click detection
      if (this.onPointerDownCallback) {
        this.clientPointer.set(e.clientX, e.clientY)
        this.pointer.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1
        )
        this.rayCaster.setFromCamera(this.pointer, this.camera)
        const intersects = this.raycastTargets.length > 0
          ? this.rayCaster.intersectObjects(this.raycastTargets, false)
          : []
        const intersection = intersects.length > 0 ? intersects[0] : null

        // For touch, store intersection for later use on pointerup
        // For mouse, call callback immediately
        if (this.isTouch) {
          this.pendingTouchIntersection = intersection
        } else {
          const handled = this.onPointerDownCallback(intersection, e.clientX, e.clientY, false)
          // Stop propagation if callback handled the event
          if (handled) {
            e.stopPropagation()
          }
        }
      }
    }
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)
  }

  onPointerUp(e) {
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)

    if (this.pointerDown && this.onPointerUpCallback) {
      // For touch, pass the stored intersection so Map can handle tap
      if (this.isTouch && this.pendingTouchIntersection !== undefined) {
        this.onPointerUpCallback(this.isTouch, this.pendingTouchIntersection)
        this.pendingTouchIntersection = undefined
      } else {
        this.onPointerUpCallback(this.isTouch)
      }
    }

    this.pointerDown = false
    this.uPointerDown.value = 0
  }

  onPointerMove(e) {
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)

    // Notify callback of pointer move (for hover detection and drag)
    if (this.onPointerMoveCallback) {
      this.onPointerMoveCallback(e.clientX, e.clientY)
    }
  }

  updateScreenPointer(e) {
    if (e == null || e == undefined) {
      e = { clientX: this.clientPointer.x, clientY: this.clientPointer.y }
    }
    this.pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    )
    this.rayCaster.setFromCamera(this.pointer, this.camera)
    this.rayCaster.ray.intersectPlane(this.iPlane, this.scenePointer)
    this.uPointer.value.x = this.scenePointer.x
    this.uPointer.value.y = this.scenePointer.y
    this.uPointer.value.z = this.scenePointer.z

    // Raycast for hover detection
    if (this.raycastTargets.length > 0 && this.onHoverCallback) {
      const intersects = this.rayCaster.intersectObjects(this.raycastTargets, false)
      this.onHoverCallback(intersects.length > 0 ? intersects[0] : null)
    }
  }

  onContextMenu(e) {
    e.preventDefault()

    // Raycast for right-click detection
    if (this.raycastTargets.length > 0 && this.onRightClickCallback) {
      this.pointer.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      )
      this.rayCaster.setFromCamera(this.pointer, this.camera)
      const intersects = this.rayCaster.intersectObjects(this.raycastTargets, false)
      if (intersects.length > 0) {
        this.onRightClickCallback(intersects[0])
        // Block the subsequent touch tap (long press triggers contextmenu then pointerup)
        this.pendingTouchIntersection = undefined
      }
    }
  }

  update(dt, elapsed) {
    this.iPlane.normal.copy(this.initPlane.normal).applyEuler(this.camera.rotation)
    this.updateScreenPointer()
  }
}
