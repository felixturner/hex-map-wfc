import { CSS2DObject } from 'three/examples/jsm/Addons.js'
import { offsetToCube, cubeToOffset } from './HexWFCCore.js'
import { TILE_LIST } from './HexTileData.js'
import { HexTile, HexTileGeometry, isInHexRadius } from './HexTiles.js'
import { HexGridState } from './HexGrid.js'

const LEVEL_HEIGHT = 0.5
const TILE_SURFACE = 1

/**
 * HexMapDebug — debug overlays, labels, visibility toggles, and overlay collection.
 * Constructor receives reference to parent HexMap for access to grids, failedCells, etc.
 */
export class HexMapDebug {
  constructor(hexMap) {
    this.hexMap = hexMap
  }

  clearTileLabels() {
    const labels = this.hexMap.tileLabels
    while (labels.children.length > 0) {
      const label = labels.children[0]
      labels.remove(label)
      if (label.element) label.element.remove()
    }
  }

  createTileLabels() {
    this.clearTileLabels()
    const hm = this.hexMap
    for (const [key, grid] of hm.grids) {
      const gridRadius = grid.gridRadius
      const { x: offsetX, z: offsetZ } = grid.worldOffset
      const globalCenterCube = grid.globalCenterCube ?? { q: 0, r: 0, s: 0 }

      if (grid.state === HexGridState.POPULATED) {
        for (const tile of grid.hexTiles) {
          const pos = HexTileGeometry.getWorldPosition(
            tile.gridX - gridRadius,
            tile.gridZ - gridRadius
          )

          const def = TILE_LIST[tile.type]
          const isSlope = def?.highEdges?.length > 0
          const baseLevel = tile.level ?? 0

          const localOffsetCol = tile.gridX - gridRadius
          const localOffsetRow = tile.gridZ - gridRadius
          const localCube = offsetToCube(localOffsetCol, localOffsetRow)
          const globalCube = {
            q: localCube.q + globalCenterCube.q,
            r: localCube.r + globalCenterCube.r,
            s: localCube.s + globalCenterCube.s
          }
          const globalOffset = cubeToOffset(globalCube.q, globalCube.r, globalCube.s)

          const div = document.createElement('div')
          div.className = 'tile-label'
          div.textContent = hm.tileLabelMode === 'levels' ? `${baseLevel}` : `${globalOffset.col},${globalOffset.row}`
          const globalKey = `${globalOffset.col},${globalOffset.row}`
          const isFailed = hm.failedCells.has(globalKey)
          const isDropped = hm.droppedCells.has(globalKey)
          const isReplaced = hm.replacedCells.has(globalKey)
          const isSeeded = hm.seededCells.has(globalKey)
          const bgColor = isFailed ? 'rgba(150,50,200,0.9)'
            : isDropped ? 'rgba(200,50,50,0.9)'
            : isReplaced ? 'rgba(220,140,20,0.9)'
            : isSeeded ? 'rgba(0,200,200,0.9)'
            : 'rgba(0,0,0,0.5)'
          div.style.cssText = `
            color: white;
            font-family: monospace;
            font-size: 9px;
            background: ${bgColor};
            padding: 2px 4px;
            border-radius: 2px;
            white-space: pre;
            text-align: center;
            line-height: 1.2;
          `

          const label = new CSS2DObject(div)
          const slopeOffset = isSlope ? 0.5 : 0
          label.position.set(
            pos.x + offsetX,
            baseLevel * LEVEL_HEIGHT + TILE_SURFACE + slopeOffset,
            pos.z + offsetZ
          )
          hm.tileLabels.add(label)
        }
      } else {
        const size = gridRadius * 2 + 1
        for (let col = 0; col < size; col++) {
          for (let row = 0; row < size; row++) {
            const offsetCol = col - gridRadius
            const offsetRow = row - gridRadius
            if (!isInHexRadius(offsetCol, offsetRow, gridRadius)) continue

            const pos = HexTileGeometry.getWorldPosition(offsetCol, offsetRow)
            const localCube = offsetToCube(offsetCol, offsetRow)
            const globalCube = {
              q: localCube.q + globalCenterCube.q,
              r: localCube.r + globalCenterCube.r,
              s: localCube.s + globalCenterCube.s
            }
            const globalOffset = cubeToOffset(globalCube.q, globalCube.r, globalCube.s)

            const div = document.createElement('div')
            div.className = 'tile-label'
            div.textContent = hm.tileLabelMode === 'levels' ? `-` : `${globalOffset.col},${globalOffset.row}`
            const globalKey = `${globalOffset.col},${globalOffset.row}`
            const isFailed = hm.failedCells.has(globalKey)
            const isDropped = hm.droppedCells.has(globalKey)
            const isReplaced = hm.replacedCells.has(globalKey)
            const isSeeded = hm.seededCells.has(globalKey)
            const isHighlighted = isFailed || isDropped || isReplaced || isSeeded
            const bgColor = isFailed ? 'rgba(150,50,200,0.9)'
              : isDropped ? 'rgba(200,50,50,0.9)'
              : isReplaced ? 'rgba(220,140,20,0.9)'
              : isSeeded ? 'rgba(0,200,200,0.9)'
              : 'rgba(0,0,0,0.3)'
            div.style.cssText = `
              color: ${isHighlighted ? 'white' : 'rgba(255,255,255,0.6)'};
              font-family: monospace;
              font-size: 9px;
              background: ${bgColor};
              padding: 2px 4px;
              border-radius: 2px;
              white-space: pre;
              text-align: center;
              line-height: 1.2;
            `

            const label = new CSS2DObject(div)
            label.position.set(
              pos.x + offsetX,
              TILE_SURFACE,
              pos.z + offsetZ
            )
            hm.tileLabels.add(label)
          }
        }
      }
    }
  }

  setTileLabelsVisible(visible) {
    if (visible) {
      this.createTileLabels()
    } else {
      this.clearTileLabels()
    }
    this.hexMap.tileLabels.visible = visible

    for (const grid of this.hexMap.grids.values()) {
      grid.setGridLabelVisible(visible)
    }
  }

  setHelpersVisible(visible) {
    this.hexMap.helpersVisible = visible
    for (const grid of this.hexMap.grids.values()) {
      grid.setHelperVisible(visible)
    }
  }

  setAxesHelpersVisible(visible) {
    this.hexMap.axesHelpersVisible = visible
    for (const grid of this.hexMap.grids.values()) {
      if (grid.axesHelper) {
        grid.axesHelper.visible = visible
      }
    }
  }

  setOutlinesVisible(visible) {
    for (const grid of this.hexMap.grids.values()) {
      if (grid.outline) {
        grid.outline.visible = visible
      }
    }
  }

  repopulateDecorations() {
    for (const grid of this.hexMap.grids.values()) {
      if (grid.state === HexGridState.POPULATED) {
        grid.populateDecorations()
      }
    }
  }

  setWhiteMode(enabled) {
    this.hexMap._whiteMode = enabled
    this._updateColorNode()
  }

  _updateColorNode() {
    const hm = this.hexMap
    if (!hm._colorMode) return
    if (hm._whiteMode) {
      hm._colorMode.value = 2
    } else if (HexTile.debugLevelColors) {
      hm._colorMode.value = 1
    } else {
      hm._colorMode.value = 0
    }
  }

  updateTileColors() {
    this._updateColorNode()
    for (const grid of this.hexMap.grids.values()) {
      if (grid.state === HexGridState.POPULATED) {
        grid.updateTileColors()
      }
    }
  }

  getOverlayObjects() {
    const hm = this.hexMap
    if (hm.isRegenerating) return []

    const overlays = []
    for (const grid of hm.grids.values()) {
      if (grid.placeholder?.group) {
        overlays.push(grid.placeholder.group)
      }
      if (grid.gridHelper?.group) {
        overlays.push(grid.gridHelper.group)
      }
      if (grid.outline) {
        overlays.push(grid.outline)
      }
      if (grid.axesHelper) {
        overlays.push(grid.axesHelper)
      }
    }
    if (hm.interaction?.hoverHighlight) {
      overlays.push(hm.interaction.hoverHighlight)
    }
    if (hm.interaction?.hoverFill) {
      overlays.push(hm.interaction.hoverFill)
    }
    // Fallback: check hexMap directly (before interaction is extracted)
    if (hm.hoverHighlight) {
      overlays.push(hm.hoverHighlight)
    }
    if (hm.hoverFill) {
      overlays.push(hm.hoverFill)
    }
    return overlays
  }

  getEffectsObjects() {
    if (this.hexMap.isRegenerating) return []
    const effects = []
    if (this.hexMap.weather) effects.push(this.hexMap.weather.group)
    return effects
  }
}
