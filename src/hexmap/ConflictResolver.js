import { TILE_LIST, HexDir, HexOpposite, rotateHexEdges } from './HexTileData.js'
import { CUBE_DIRS, cubeKey, parseCubeKey, cubeToOffset, getEdgeLevel, edgesCompatible, globalToLocalGrid } from './HexWFCCore.js'

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
