import {
  MeshBasicNodeMaterial,
  Mesh,
  Raycaster,
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicNodeMaterial,
} from 'three/webgpu'
import { cubeKey, cubeCoordsInRadius, offsetToCube, cubeToOffset, localToGlobalCoords } from './HexWFCCore.js'
import { TILE_LIST } from './HexTileData.js'
import { HexGridState } from './HexGrid.js'
import { log, App } from '../App.js'
import { Sounds } from '../lib/Sounds.js'

/**
 * HexMapInteraction — hover highlight and pointer event handling.
 * Constructor receives reference to parent HexMap.
 */
export class HexMapInteraction {
  constructor(hexMap) {
    this.hexMap = hexMap
    this.raycaster = new Raycaster()
    this.hoveredGrid = null
    this.hoveredCubeKey = null
    this.hoverHighlight = null
    this.hoverFill = null
  }

  initHoverHighlight() {
    const scene = this.hexMap.scene
    const hexRadius = 2 / Math.sqrt(3)
    const maxVerts = 19 * 6 * 2 * 3
    const positions = new Float32Array(maxVerts)
    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geom.setDrawRange(0, 0)

    const mat = new LineBasicNodeMaterial({ color: 0xffffff })
    mat.depthTest = false
    mat.depthWrite = false
    mat.transparent = true
    mat.blending = AdditiveBlending

    this.hoverHighlight = new LineSegments(geom, mat)
    this.hoverHighlight.renderOrder = 999
    this.hoverHighlight.frustumCulled = false
    this.hoverHighlight.visible = false
    scene.add(this.hoverHighlight)

    const fillPositions = new Float32Array(19 * 6 * 3 * 3)
    const fillGeom = new BufferGeometry()
    fillGeom.setAttribute('position', new Float32BufferAttribute(fillPositions, 3))
    fillGeom.setDrawRange(0, 0)

    const fillMat = new MeshBasicNodeMaterial({ color: 0xffffff })
    fillMat.depthTest = false
    fillMat.depthWrite = false
    fillMat.transparent = true
    fillMat.opacity = 0.3
    fillMat.side = 2

    this.hoverFill = new Mesh(fillGeom, fillMat)
    this.hoverFill.renderOrder = 998
    this.hoverFill.frustumCulled = false
    this.hoverFill.visible = false
    scene.add(this.hoverFill)
  }

  updateHoverHighlight(cq, cr, cs) {
    const key = cubeKey(cq, cr, cs)
    if (key === this.hoveredCubeKey) return
    this.hoveredCubeKey = key

    const hexWidth = 2
    const hexHeight = 2 / Math.sqrt(3) * 2
    const hexRadius = 2 / Math.sqrt(3)

    const cells = cubeCoordsInRadius(cq, cr, cs, 2)
      .filter(c => this.hexMap.globalCells.has(cubeKey(c.q, c.r, c.s)))

    const positions = this.hoverHighlight.geometry.attributes.position.array
    const fillPositions = this.hoverFill.geometry.attributes.position.array
    let idx = 0
    let fIdx = 0

    for (const { q, r, s } of cells) {
      const offset = cubeToOffset(q, r, s)
      const cx = offset.col * hexWidth + (Math.abs(offset.row) % 2) * hexWidth * 0.5
      const cz = offset.row * hexHeight * 0.75

      for (let i = 0; i < 6; i++) {
        const a1 = i * Math.PI / 3
        const a2 = ((i + 1) % 6) * Math.PI / 3
        const x1 = cx + Math.sin(a1) * hexRadius
        const z1 = cz + Math.cos(a1) * hexRadius
        const x2 = cx + Math.sin(a2) * hexRadius
        const z2 = cz + Math.cos(a2) * hexRadius

        positions[idx++] = x1; positions[idx++] = 1; positions[idx++] = z1
        positions[idx++] = x2; positions[idx++] = 1; positions[idx++] = z2

        fillPositions[fIdx++] = cx; fillPositions[fIdx++] = 1; fillPositions[fIdx++] = cz
        fillPositions[fIdx++] = x1; fillPositions[fIdx++] = 1; fillPositions[fIdx++] = z1
        fillPositions[fIdx++] = x2; fillPositions[fIdx++] = 1; fillPositions[fIdx++] = z2
      }
    }

    this.hoverHighlight.geometry.attributes.position.needsUpdate = true
    this.hoverHighlight.geometry.setDrawRange(0, idx / 3)
    this.hoverHighlight.visible = true

    this.hoverFill.geometry.attributes.position.needsUpdate = true
    this.hoverFill.geometry.setDrawRange(0, fIdx / 3)
    this.hoverFill.visible = true
  }

  clearHoverHighlight() {
    if (this.hoveredCubeKey !== null) {
      this.hoveredCubeKey = null
      this.hoverHighlight.visible = false
      this.hoverFill.visible = false
    }
  }

  onPointerMove(pointer, camera) {
    const hm = this.hexMap
    this.raycaster.setFromCamera(pointer, camera)

    const placeholderClickables = []
    for (const grid of hm.grids.values()) {
      if (grid.state === HexGridState.PLACEHOLDER) {
        placeholderClickables.push(...grid.getPlaceholderClickables())
      }
    }

    this.raycaster.setFromCamera(pointer, camera)

    let newHovered = null
    if (placeholderClickables.length > 0) {
      const intersects = this.raycaster.intersectObjects(placeholderClickables)
      if (intersects.length > 0) {
        const clickable = intersects[0].object
        if (clickable.userData.isPlaceholder) {
          newHovered = clickable.userData.owner?.group?.userData?.hexGrid ?? null
        }
      }
    }

    if (newHovered !== this.hoveredGrid) {
      if (this.hoveredGrid) {
        this.hoveredGrid.setHover(false)
      }
      this.hoveredGrid = newHovered
      if (newHovered) {
        newHovered.setHover(true)
        Sounds.play('roll', 1.0, 0.2, 0.5)
        document.body.style.cursor = 'pointer'
      } else {
        document.body.style.cursor = ''
      }
    }

    if ('ontouchstart' in window || !App.instance?.buildMode) {
      this.clearHoverHighlight()
      return
    }
    const hexMeshes = []
    const meshToGrid = new Map()
    for (const grid of hm.grids.values()) {
      if (grid.state === HexGridState.POPULATED && grid.hexMesh) {
        hexMeshes.push(grid.hexMesh)
        meshToGrid.set(grid.hexMesh, grid)
      }
    }

    if (hexMeshes.length > 0) {
      const intersects = this.raycaster.intersectObjects(hexMeshes)
      if (intersects.length > 0) {
        const hit = intersects[0]
        const grid = meshToGrid.get(hit.object)
        const batchId = hit.batchId ?? hit.instanceId
        if (grid && batchId !== undefined) {
          const tile = grid.hexTiles.find(t => t.instanceId === batchId)
          if (tile) {
            const globalCube = grid.globalCenterCube ?? { q: 0, r: 0, s: 0 }
            const global = localToGlobalCoords(tile.gridX, tile.gridZ, grid.gridRadius, globalCube)
            const globalCubeCoords = offsetToCube(global.col, global.row)
            this.updateHoverHighlight(globalCubeCoords.q, globalCubeCoords.r, globalCubeCoords.s)
            return
          }
        }
      }
    }

    this.clearHoverHighlight()
  }

  onPointerDown(pointer, camera) {
    const hm = this.hexMap
    const placeholderClickables = []
    for (const grid of hm.grids.values()) {
      if (grid.state === HexGridState.PLACEHOLDER) {
        placeholderClickables.push(...grid.getPlaceholderClickables())
      }
    }

    this.raycaster.setFromCamera(pointer, camera)

    if (placeholderClickables.length > 0) {
      const intersects = this.raycaster.intersectObjects(placeholderClickables)
      if (intersects.length > 0) {
        const clickable = intersects[0].object
        if (clickable.userData.isPlaceholder) {
          const ownerGrid = clickable.userData.owner?.group?.userData?.hexGrid
          if (ownerGrid && ownerGrid.onClick) {
            Sounds.play('pop', 1.0, 0.2, 0.7)
            ownerGrid.onClick()
            return true
          }
        }
      }
    }

    if (!App.instance?.buildMode) return false

    const hexMeshes = []
    const meshToGrid = new Map()
    for (const grid of hm.grids.values()) {
      if (grid.state === HexGridState.POPULATED && grid.hexMesh) {
        hexMeshes.push(grid.hexMesh)
        meshToGrid.set(grid.hexMesh, grid)
      }
    }
    if (hexMeshes.length > 0) {
      const intersects = this.raycaster.intersectObjects(hexMeshes)
      if (intersects.length > 0) {
        const hit = intersects[0]
        const grid = meshToGrid.get(hit.object)
        const batchId = hit.batchId ?? hit.instanceId
        if (grid && batchId !== undefined) {
          const tile = grid.hexTiles.find(t => t.instanceId === batchId)
          if (tile) {
            const def = TILE_LIST[tile.type]
            const globalCube = grid.globalCenterCube ?? { q: 0, r: 0, s: 0 }
            const global = localToGlobalCoords(tile.gridX, tile.gridZ, grid.gridRadius, globalCube)
            const globalCubeCoords = offsetToCube(global.col, global.row)

            log(`[TILE CLICK] (${global.col},${global.row}) ${def?.name || '?'} type=${tile.type} rot=${tile.rotation} — mini WFC solve`, 'color: blue')

            const solveCells = cubeCoordsInRadius(
              globalCubeCoords.q, globalCubeCoords.r, globalCubeCoords.s, 2
            ).filter(c => hm.globalCells.has(cubeKey(c.q, c.r, c.s)))

            const fixedCells = hm.getFixedCellsForRegion(solveCells)
            const tileTypes = hm.getDefaultTileTypes()

            hm.solveWfcAsync(solveCells, fixedCells, {
              tileTypes,
              maxRestarts: 5,
            }).then(result => {
              if (result.success && result.tiles) {
                const changedTilesPerGrid = hm.applyTileResultsToGrids(result.tiles)

                const TILE_STAGGER = 60
                const DEC_DELAY = 400
                const DEC_STAGGER = 40
                for (const [g, tiles] of changedTilesPerGrid) {
                  tiles.forEach((t, i) => {
                    setTimeout(() => g.animateTileDrop(t), i * TILE_STAGGER)
                  })
                  const newDecs = g.decorations?.repopulateTilesAt(tiles, g.gridRadius, g.hexGrid)
                  if (newDecs && newDecs.length > 0) {
                    const decStart = tiles.length * TILE_STAGGER + DEC_DELAY
                    newDecs.forEach((dec, j) => {
                      setTimeout(() => g.animateDecoration(dec), decStart + j * DEC_STAGGER)
                    })
                  }
                }

                hm.addToGlobalCells('click-resolve', result.tiles)
                const animDuration = changedTilesPerGrid.size > 0
                  ? Math.max(...[...changedTilesPerGrid.values()].map(t => t.length)) * TILE_STAGGER
                  : 0
                hm.onTilesChanged?.(animDuration)

                log(`[TILE RESOLVE] (${global.col},${global.row}) solved ${result.tiles.length} tiles`, 'color: green')
                import('../lib/Sounds.js').then(({ Sounds }) => Sounds.play('pop', 1.0, 0.15))
              } else {
                log(`[TILE CLICK] (${global.col},${global.row}) ${def?.name || '?'} — mini WFC failed`, 'color: red')
                import('../lib/Sounds.js').then(({ Sounds }) => Sounds.play('incorrect'))
              }
            })
          }
        }
      }
    }

    return false
  }
}
