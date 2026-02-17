import { TILE_LIST, HexDir, HexOpposite, rotateHexEdges, LEVELS_COUNT } from './HexTileData.js'
import { CUBE_DIRS, cubeKey, parseCubeKey, cubeToOffset, getEdgeLevel, edgesCompatible, globalToLocalGrid } from './HexWFCCore.js'
import { shuffle } from '../SeededRandom.js'

/**
 * ConflictResolver — conflict detection and fixed-cell replacement logic.
 * Receives shared Maps/Sets by reference (mutations visible to HexMap).
 */
export class ConflictResolver {
  constructor(globalCells, grids, replacedCells) {
    this.globalCells = globalCells
    this.grids = grids
    this.replacedCells = replacedCells
    this.hexWfcRules = null
  }

  /** Called after WFCManager init to receive the rules reference */
  setWfcRules(rules) {
    this.hexWfcRules = rules
  }

  /**
   * Find replacement tiles for a fixed cell that preserve compatibility with its neighbors in globalCells
   * @param {number} q - Cell cube q
   * @param {number} r - Cell cube r
   * @param {number} s - Cell cube s
   * @param {number} currentType - Current tile type
   * @param {number} currentRotation - Current rotation
   * @param {number} currentLevel - Current level
   * @returns {Array} Shuffled replacement candidates [{ type, rotation, level }]
   */
  findReplacementTilesForCell(q, r, s, currentType, currentRotation, currentLevel) {
    const lockedEdges = {}
    for (let i = 0; i < 6; i++) {
      const dir = CUBE_DIRS[i]
      const nq = q + dir.dq
      const nr = r + dir.dr
      const ns = s + dir.ds
      const nKey = cubeKey(nq, nr, ns)
      const neighbor = this.globalCells.get(nKey)

      if (neighbor) {
        const neighborDef = TILE_LIST[neighbor.type]
        if (!neighborDef) continue
        const neighborEdges = rotateHexEdges(neighborDef.edges, neighbor.rotation)
        const oppositeDir = HexOpposite[HexDir[i]]
        const neighborEdgeType = neighborEdges[oppositeDir]
        const neighborEdgeLevel = getEdgeLevel(neighbor.type, neighbor.rotation, oppositeDir, neighbor.level ?? 0)

        if (neighborEdgeType === 'grass') {
          lockedEdges[HexDir[i]] = { type: neighborEdgeType, level: null }
        } else {
          lockedEdges[HexDir[i]] = { type: neighborEdgeType, level: neighborEdgeLevel }
        }
      }
    }

    const currentDef = TILE_LIST[currentType]
    const candidates = []

    for (let tileType = 0; tileType < TILE_LIST.length; tileType++) {
      const def = TILE_LIST[tileType]

      if (def.mesh === currentDef.mesh) continue

      const isSlope = def.highEdges?.length > 0
      if (isSlope) {
        const increment = def.levelIncrement ?? 1
        const maxBaseLevel = LEVELS_COUNT - 1 - increment
        if (currentLevel > maxBaseLevel) continue
      }

      for (let rot = 0; rot < 6; rot++) {
        const edges = rotateHexEdges(def.edges, rot)

        let matchesLocked = true
        for (const [dir, required] of Object.entries(lockedEdges)) {
          const edgeType = edges[dir]
          const edgeLevel = getEdgeLevel(tileType, rot, dir, currentLevel)
          if (edgeType !== required.type) {
            matchesLocked = false
            break
          }
          if (required.level !== null && edgeType !== 'grass' && edgeLevel !== required.level) {
            matchesLocked = false
            break
          }
        }

        if (matchesLocked) {
          candidates.push({ type: tileType, rotation: rot, level: currentLevel })
        }
      }
    }

    shuffle(candidates)
    return candidates
  }

  /**
   * Filter fixed cells that conflict with each other (incompatible adjacent edges)
   * @param {Array} fixedCells - [{q,r,s,type,rotation,level}]
   * @returns {Object} { validCells, conflicts }
   */
  filterConflictingFixedCells(fixedCells) {
    if (fixedCells.length <= 1) return { validCells: fixedCells, conflicts: [] }

    const cellMap = new Map()
    const validCells = []
    const conflicts = []

    for (const cell of fixedCells) {
      const key = cubeKey(cell.q, cell.r, cell.s)

      let hasConflict = false
      let conflictInfo = null
      for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRS[i]
        const nq = cell.q + dir.dq
        const nr = cell.r + dir.dr
        const ns = cell.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)
        const neighborCell = cellMap.get(nKey)

        if (neighborCell) {
          const cellEdges = rotateHexEdges(TILE_LIST[cell.type]?.edges || {}, cell.rotation)
          const neighborEdges = rotateHexEdges(TILE_LIST[neighborCell.type]?.edges || {}, neighborCell.rotation)

          const cellEdge = cellEdges[HexDir[i]]
          const neighborEdge = neighborEdges[HexOpposite[HexDir[i]]]

          const cellEdgeLevel = getEdgeLevel(cell.type, cell.rotation, HexDir[i], cell.level ?? 0)
          const neighborEdgeLevel = getEdgeLevel(neighborCell.type, neighborCell.rotation, HexOpposite[HexDir[i]], neighborCell.level ?? 0)

          if (!edgesCompatible(cellEdge, cellEdgeLevel, neighborEdge, neighborEdgeLevel)) {
            hasConflict = true
            const reason = cellEdge !== neighborEdge ? 'edge type' : 'edge level'
            conflictInfo = {
              cell,
              neighbor: neighborCell,
              dir: HexDir[i],
              cellEdge: `${cellEdge}@${cellEdgeLevel}`,
              neighborEdge: `${neighborEdge}@${neighborEdgeLevel}`,
              reason,
            }
            break
          }
        }
      }

      if (!hasConflict) {
        validCells.push(cell)
        cellMap.set(key, cell)
      } else if (conflictInfo) {
        conflictInfo.cellObj = cell
        conflicts.push(conflictInfo)
      }
    }

    return { validCells, conflicts }
  }

  /**
   * Validate that fixed cells don't create unsolvable constraints for solve cells between them
   * @param {Array} solveCells - [{q,r,s}] cells to solve
   * @param {Array} fixedCells - [{q,r,s,type,rotation,level}] fixed constraints
   * @returns {Object} { valid, conflicts }
   */
  validateFixedCellConflicts(solveCells, fixedCells) {
    if (fixedCells.length <= 1) return { valid: true, conflicts: [] }

    const fixedMap = new Map()
    for (const fc of fixedCells) {
      fixedMap.set(cubeKey(fc.q, fc.r, fc.s), fc)
    }

    const solveSet = new Set(solveCells.map(c => cubeKey(c.q, c.r, c.s)))

    const cellNeighbors = new Map()
    for (const fc of fixedCells) {
      for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRS[i]
        const nq = fc.q + dir.dq
        const nr = fc.r + dir.dr
        const ns = fc.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)

        if (!solveSet.has(nKey)) continue
        if (fixedMap.has(nKey)) continue

        if (!cellNeighbors.has(nKey)) {
          cellNeighbors.set(nKey, [])
        }
        cellNeighbors.get(nKey).push({ fixedCell: fc, dir: HexOpposite[HexDir[i]] })
      }
    }

    const conflicts = []

    for (const [cellKey, neighbors] of cellNeighbors) {
      if (neighbors.length < 2) continue

      const requirements = neighbors.map(({ fixedCell, dir }) => {
        const fcEdges = rotateHexEdges(TILE_LIST[fixedCell.type]?.edges || {}, fixedCell.rotation)
        const edgeType = fcEdges[HexOpposite[dir]]
        const edgeLevel = getEdgeLevel(fixedCell.type, fixedCell.rotation, HexOpposite[dir], fixedCell.level ?? 0)
        return { edgeType, edgeLevel, dir, fixedCell }
      })

      let compatible = null
      for (const { edgeType, edgeLevel, dir } of requirements) {
        const matches = this.hexWfcRules.getByEdge(edgeType, dir, edgeLevel)
        if (compatible === null) {
          compatible = new Set(matches)
        } else {
          const filtered = new Set()
          for (const k of compatible) {
            if (matches.has(k)) filtered.add(k)
          }
          compatible = filtered
        }
        if (compatible.size === 0) break
      }

      if (!compatible || compatible.size === 0) {
        const { q, r, s } = parseCubeKey(cellKey)
        const co = cubeToOffset(q, r, s)
        conflicts.push({
          cell: { q, r, s, global: `${co.col},${co.row}` },
          fixedCells: neighbors.map(({ fixedCell }) => {
            const fo = cubeToOffset(fixedCell.q, fixedCell.r, fixedCell.s)
            return {
              q: fixedCell.q, r: fixedCell.r, s: fixedCell.s,
              global: `${fo.col},${fo.row}`,
              type: TILE_LIST[fixedCell.type]?.name || fixedCell.type,
              rotation: fixedCell.rotation,
              level: fixedCell.level ?? 0,
            }
          }),
          requirements: requirements.map(r => `${r.dir}=${r.edgeType}@${r.edgeLevel}`),
        })
      }
    }

    return { valid: conflicts.length === 0, conflicts }
  }

  /**
   * Try to replace a fixed cell with a compatible alternative
   * Updates both globalCells and the rendered tile in the source grid
   * @param {Object} fixedCell - {q,r,s,type,rotation,level} the cell to replace
   * @param {Array} fixedCells - Current list of fixed cells (for adjacency checks)
   * @param {Set} replacedKeys - Already-replaced cell keys (avoid replacing twice)
   * @returns {boolean} True if replacement was found and applied
   */
  tryReplaceFixedCell(fixedCell, fixedCells, replacedKeys) {
    const key = cubeKey(fixedCell.q, fixedCell.r, fixedCell.s)
    if (replacedKeys.has(key)) return false

    const candidates = this.findReplacementTilesForCell(
      fixedCell.q, fixedCell.r, fixedCell.s,
      fixedCell.type, fixedCell.rotation, fixedCell.level
    )
    if (candidates.length === 0) return false

    const fixedMap = new Map()
    for (const fc of fixedCells) {
      if (fc !== fixedCell) {
        fixedMap.set(cubeKey(fc.q, fc.r, fc.s), fc)
      }
    }

    for (const replacement of candidates) {
      const replacementEdges = rotateHexEdges(TILE_LIST[replacement.type]?.edges || {}, replacement.rotation)
      let compatibleWithFixed = true

      for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRS[i]
        const nq = fixedCell.q + dir.dq
        const nr = fixedCell.r + dir.dr
        const ns = fixedCell.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)
        const adjacentFixed = fixedMap.get(nKey)

        if (adjacentFixed) {
          const myEdge = replacementEdges[HexDir[i]]
          const myLevel = getEdgeLevel(replacement.type, replacement.rotation, HexDir[i], replacement.level)
          const adjacentEdges = rotateHexEdges(TILE_LIST[adjacentFixed.type]?.edges || {}, adjacentFixed.rotation)
          const theirEdge = adjacentEdges[HexOpposite[HexDir[i]]]
          const theirLevel = getEdgeLevel(adjacentFixed.type, adjacentFixed.rotation, HexOpposite[HexDir[i]], adjacentFixed.level ?? 0)

          if (!edgesCompatible(myEdge, myLevel, theirEdge, theirLevel)) {
            compatibleWithFixed = false
            break
          }
        }
      }

      if (compatibleWithFixed) {
        const existing = this.globalCells.get(key)
        if (existing) {
          existing.type = replacement.type
          existing.rotation = replacement.rotation
          existing.level = replacement.level

          const sourceGrid = this.grids.get(existing.gridKey)
          if (sourceGrid) {
            const { gridX, gridZ } = globalToLocalGrid(fixedCell, sourceGrid.globalCenterCube, sourceGrid.gridRadius)
            sourceGrid.replaceTile(gridX, gridZ, replacement.type, replacement.rotation, replacement.level)
          }
        }

        fixedCell.type = replacement.type
        fixedCell.rotation = replacement.rotation
        fixedCell.level = replacement.level
        replacedKeys.add(key)
        const rco = cubeToOffset(fixedCell.q, fixedCell.r, fixedCell.s)
        this.replacedCells.add(`${rco.col},${rco.row}`)
        return true
      }
    }

    return false
  }

  /**
   * Apply WFC tile results to their source grids (replace tiles + collect changed tiles)
   * @param {Array} tiles - [{q,r,s,type,rotation,level}] solved tiles
   * @returns {Map<HexGrid, HexTile[]>} Changed tiles per grid
   */
  applyTileResultsToGrids(tiles) {
    const changedTilesPerGrid = new Map()
    for (const t of tiles) {
      const key = cubeKey(t.q, t.r, t.s)
      const existing = this.globalCells.get(key)
      if (!existing) continue
      const sourceGrid = this.grids.get(existing.gridKey)
      if (!sourceGrid) continue
      const { gridX, gridZ } = globalToLocalGrid(t, sourceGrid.globalCenterCube, sourceGrid.gridRadius)
      sourceGrid.replaceTile(gridX, gridZ, t.type, t.rotation, t.level)
      const replacedTile = sourceGrid.hexGrid[gridX]?.[gridZ]
      if (replacedTile) {
        if (!changedTilesPerGrid.has(sourceGrid)) changedTilesPerGrid.set(sourceGrid, [])
        changedTilesPerGrid.get(sourceGrid).push(replacedTile)
      }
    }
    return changedTilesPerGrid
  }
}
