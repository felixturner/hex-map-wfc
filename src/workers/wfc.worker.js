/**
 * WFC Web Worker
 * Runs WFC solver in a separate thread to prevent UI freezing
 */

import {
  TILE_LIST,
  HexDir,
  HexOpposite,
  LEVELS_COUNT,
} from '../hexmap/HexTileData.js'
import { setSeed, random } from '../SeededRandom.js'
import {
  HexWFCCell,
  HexWFCAdjacencyRules,
  CUBE_DIRS,
  cubeKey,
  parseCubeKey,
  cubeToOffset,
} from '../hexmap/HexWFCCore.js'

// ============================================================================
// WFC Solver (cube-coordinate based)
// ============================================================================

class HexWFCSolver {
  constructor(rules, options = {}) {
    this.rules = rules
    this.options = {
      maxRestarts: options.maxRestarts ?? 10,
      tileTypes: options.tileTypes ?? null,
      log: options.log ?? (() => {}),
      attemptNum: options.attemptNum ?? 0,
      gridId: options.gridId ?? '',
      quiet: options.quiet ?? false,
    }
    this.log = this.options.log
    // Map<cubeKey, HexWFCCell> — cells to solve
    this.cells = new Map()
    // Map<cubeKey, {type, rotation, level}> — collapsed neighbors (read-only constraints)
    this.fixedCells = new Map()
    // Map<cubeKey, [{key, dir, returnDir}]> — precomputed neighbors
    this.neighbors = new Map()
    this.propagationStack = []
    this.restartCount = 0
    this.lastContradiction = null
    this.neighborContradiction = null
    this.collapseOrder = []
    // Backtracking state (trail-based — records only changes, not full copies)
    this.trail = []       // { key, stateKey } — each possibility removed during propagation
    this.decisions = []   // stack of { targetKey, prevPossibilities, trailStart, collapseOrderLen, triedStates }
    this.maxBacktracks = 500
    this.backtracks = 0
    // Neighbor cell data: cells that CAN be unfixed on neighbor contradiction
    this.neighborData = new Map()     // cubeKey → { q,r,s, anchors: [...], original: {type,rotation,level} }
    this.neighborOriginals = new Map() // cubeKey → { q,r,s, type, rotation, level } — preserved after unfixing
    this.unfixedKeys = []              // cubeKeys of neighbor cells that were converted to solve cells
    this.changedFixedCells = []        // neighbor cells that ended up with different tiles
  }

  init(solveCells, fixedCells) {
    this.collapseOrder = []
    const types = this.options.tileTypes ?? TILE_LIST.map((_, i) => i)

    const allStates = []
    for (const type of types) {
      const def = TILE_LIST[type]
      if (!def) continue

      const isSlope = def.highEdges && def.highEdges.length > 0

      for (let rotation = 0; rotation < 6; rotation++) {
        if (isSlope) {
          const increment = def.levelIncrement ?? 1
          const maxBaseLevel = LEVELS_COUNT - 1 - increment
          for (let level = 0; level <= maxBaseLevel; level++) {
            allStates.push({ type, rotation, level })
          }
        } else {
          for (let level = 0; level < LEVELS_COUNT; level++) {
            allStates.push({ type, rotation, level })
          }
        }
      }
    }

    // Create solve cells with full possibility space
    this.cells = new Map()
    for (const { q, r, s } of solveCells) {
      const key = cubeKey(q, r, s)
      this.cells.set(key, new HexWFCCell(allStates))
    }

    // Store fixed cells
    this.fixedCells = new Map()
    for (const fc of fixedCells) {
      const key = cubeKey(fc.q, fc.r, fc.s)
      this.fixedCells.set(key, { type: fc.type, rotation: fc.rotation, level: fc.level })
    }

    // Precompute neighbors for all solve cells
    this.neighbors = new Map()
    for (const { q, r, s } of solveCells) {
      const key = cubeKey(q, r, s)
      const nbrs = []
      for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRS[i]
        const nq = q + dir.dq
        const nr = r + dir.dr
        const ns = s + dir.ds
        const nKey = cubeKey(nq, nr, ns)
        // Neighbor can be in cells (constrainable) or fixedCells (read-only) or absent (open)
        if (this.cells.has(nKey) || this.fixedCells.has(nKey)) {
          nbrs.push({ key: nKey, dir: HexDir[i], returnDir: HexOpposite[HexDir[i]] })
        }
      }
      this.neighbors.set(key, nbrs)
    }

    // Also build neighbor entries for fixed cells (pointing to solve cells only)
    // so propagation FROM fixed cells can constrain adjacent solve cells
    for (const fc of fixedCells) {
      const key = cubeKey(fc.q, fc.r, fc.s)
      const nbrs = []
      for (let i = 0; i < 6; i++) {
        const dir = CUBE_DIRS[i]
        const nq = fc.q + dir.dq
        const nr = fc.r + dir.dr
        const ns = fc.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)
        if (this.cells.has(nKey)) {
          nbrs.push({ key: nKey, dir: HexDir[i], returnDir: HexOpposite[HexDir[i]] })
        }
      }
      this.neighbors.set(key, nbrs)
    }

    this.propagationStack = []

    // Precompute set of tile types that prevent self-adjacency
    this.noChainTypes = new Set()
    for (const type of types) {
      if (TILE_LIST[type]?.preventChaining) {
        this.noChainTypes.add(type)
      }
    }

    // Prune chaining from fixed cells into adjacent solve cells
    for (const fc of fixedCells) {
      if (this.noChainTypes.has(fc.type)) {
        const key = cubeKey(fc.q, fc.r, fc.s)
        this._pruneChaining(key, fc.type)
      }
    }
  }

  findLowestEntropyCell() {
    let minEntropy = Infinity
    let minKey = null

    for (const [key, cell] of this.cells) {
      if (!cell.collapsed && cell.possibilities.size > 0) {
        const entropy = cell.entropy
        if (entropy < minEntropy) {
          minEntropy = entropy
          minKey = key
        }
      }
    }

    return minKey
  }

  collapse(key) {
    const cell = this.cells.get(key)
    if (!cell || cell.collapsed || cell.possibilities.size === 0) return false

    const possArray = Array.from(cell.possibilities)
    const weights = possArray.map(k => {
      const state = HexWFCCell.parseKey(k)
      return TILE_LIST[state.type]?.weight ?? 1
    })
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let r = random() * totalWeight
    let selectedKey = possArray[0]
    for (let i = 0; i < possArray.length; i++) {
      r -= weights[i]
      if (r <= 0) {
        selectedKey = possArray[i]
        break
      }
    }

    const state = HexWFCCell.parseKey(selectedKey)
    cell.collapse(state)
    this.propagationStack.push(key)
    const { q, r: cr, s } = parseCubeKey(key)
    this.collapseOrder.push({ q, r: cr, s, type: state.type, rotation: state.rotation, level: state.level })

    // Prevent chaining: remove same tile type from all neighbors
    if (this.noChainTypes.has(state.type)) {
      this._pruneChaining(key, state.type)
    }

    return true
  }

  /**
   * Remove all states of the given tile type from neighbors of key
   */
  _pruneChaining(key, type) {
    const nbrs = this.neighbors.get(key)
    if (!nbrs) return
    const prefix = `${type}_`
    for (const { key: nKey } of nbrs) {
      const neighbor = this.cells.get(nKey)
      if (!neighbor || neighbor.collapsed) continue
      for (const stateKey of [...neighbor.possibilities]) {
        if (stateKey.startsWith(prefix)) {
          neighbor.possibilities.delete(stateKey)
        }
      }
      if (neighbor.possibilities.size > 0) {
        this.propagationStack.push(nKey)
      }
    }
  }

  saveDecision(targetKey) {
    const cell = this.cells.get(targetKey)
    this.decisions.push({
      targetKey,
      prevPossibilities: new Set(cell.possibilities),
      trailStart: this.trail.length,
      collapseOrderLen: this.collapseOrder.length,
      triedStates: new Set(),
    })
  }

  undoLastDecision() {
    const decision = this.decisions[this.decisions.length - 1]
    if (!decision) return null

    // Undo propagation: re-add all removed possibilities
    for (let i = this.trail.length - 1; i >= decision.trailStart; i--) {
      const { key, stateKey } = this.trail[i]
      this.cells.get(key).possibilities.add(stateKey)
    }
    this.trail.length = decision.trailStart

    // Restore the collapsed cell
    const cell = this.cells.get(decision.targetKey)
    cell.possibilities = new Set(decision.prevPossibilities)
    cell.collapsed = false
    cell.tile = null

    // Restore collapseOrder
    this.collapseOrder.length = decision.collapseOrderLen
    this.propagationStack = []
    return decision
  }

  collapseWithExclusions(key, excludeSet) {
    const cell = this.cells.get(key)
    const available = [...cell.possibilities].filter(k => !excludeSet.has(k))
    if (available.length === 0) return false

    const weights = available.map(k => {
      const state = HexWFCCell.parseKey(k)
      return TILE_LIST[state.type]?.weight ?? 1
    })
    const total = weights.reduce((a, b) => a + b, 0)
    let r = random() * total
    let selectedKey = available[0]
    for (let i = 0; i < available.length; i++) {
      r -= weights[i]
      if (r <= 0) { selectedKey = available[i]; break }
    }

    excludeSet.add(selectedKey)

    const state = HexWFCCell.parseKey(selectedKey)
    cell.collapse(state)
    this.propagationStack.push(key)
    const { q, r: cr, s } = parseCubeKey(key)
    this.collapseOrder.push({ q, r: cr, s, type: state.type, rotation: state.rotation, level: state.level })

    // Prevent chaining: remove same tile type from all neighbors
    if (this.noChainTypes.has(state.type)) {
      this._pruneChaining(key, state.type)
    }

    return true
  }

  backtrack() {
    this.backtracks++
    if (this.backtracks >= this.maxBacktracks) {
      if (!this.options.quiet) this.log(`${this.options.gridId ? `[${this.options.gridId}] ` : ''}WFC FAIL [backtrack limit reached]`, 'red')
      return false
    }

    const decision = this.undoLastDecision()
    if (!decision) return false

    const cell = this.cells.get(decision.targetKey)
    const available = [...cell.possibilities].filter(k => !decision.triedStates.has(k))

    if (available.length === 0) {
      // All states exhausted for this cell — pop and backtrack further
      this.decisions.pop()
      return this.backtrack()
    }

    return true
  }

  /**
   * Get edge info for a given state at a given direction.
   * Works for both solve cells (by stateKey) and fixed cells (by stored data).
   */
  getFixedCellEdge(key, dir) {
    const fc = this.fixedCells.get(key)
    if (!fc) return null
    const stateKey = HexWFCCell.stateKey(fc)
    const edgeInfo = this.rules.stateEdges.get(stateKey)?.[dir]
    return edgeInfo
  }

  propagate() {
    while (this.propagationStack.length > 0) {
      const key = this.propagationStack.pop()

      // Determine if this is a solve cell or fixed cell
      const cell = this.cells.get(key)
      const isFixed = !cell
      let possibilities

      if (isFixed) {
        // Fixed cell: create a single-element set from its state
        const fc = this.fixedCells.get(key)
        if (!fc) continue
        possibilities = new Set([HexWFCCell.stateKey(fc)])
      } else {
        possibilities = cell.possibilities
      }

      const nbrs = this.neighbors.get(key)
      if (!nbrs) continue

      for (const { key: nKey, dir, returnDir } of nbrs) {
        const neighbor = this.cells.get(nKey)
        // Only constrain solve cells (never modify fixed cells)
        if (!neighbor || neighbor.collapsed) continue

        const allowedInNeighbor = new Set()
        const lookedUp = {}

        for (const stateKey of possibilities) {
          const edgeInfo = this.rules.stateEdges.get(stateKey)?.[dir]
          if (!edgeInfo) continue

          const typeCache = lookedUp[edgeInfo.type]
          if (typeCache?.[edgeInfo.level]) continue
          if (!typeCache) lookedUp[edgeInfo.type] = {}
          lookedUp[edgeInfo.type][edgeInfo.level] = true

          const matches = this.rules.getByEdge(edgeInfo.type, returnDir, edgeInfo.level)
          for (const k of matches) allowedInNeighbor.add(k)
        }

        let changed = false
        for (const neighborKey of [...neighbor.possibilities]) {
          if (!allowedInNeighbor.has(neighborKey)) {
            neighbor.possibilities.delete(neighborKey)
            this.trail.push({ key: nKey, stateKey: neighborKey })
            changed = true
          }
        }

        if (neighbor.possibilities.size === 0) {
          const { q, r, s } = parseCubeKey(nKey)
          const failedOffset = cubeToOffset(q, r, s)
          this.lastContradiction = {
            failedKey: nKey,
            failedQ: q, failedR: r, failedS: s,
            failedCol: failedOffset.col, failedRow: failedOffset.row,
            sourceKey: key,
            dir,
          }
          return false
        }

        if (changed) {
          this.propagationStack.push(nKey)
        }
      }
    }
    return true
  }

  /**
   * Store neighbor cell data for the solver
   * @param {Array} neighborCells - [{q,r,s,type,rotation,level, anchors:[{q,r,s,type,rotation,level}]}]
   */
  initNeighborData(neighborCells) {
    this.neighborData = new Map()
    this.neighborOriginals = new Map()
    this.unfixedKeys = []
    this.changedFixedCells = []
    if (!neighborCells) return
    for (const sfc of neighborCells) {
      const key = cubeKey(sfc.q, sfc.r, sfc.s)
      this.neighborData.set(key, {
        q: sfc.q, r: sfc.r, s: sfc.s,
        original: { type: sfc.type, rotation: sfc.rotation, level: sfc.level },
        anchors: sfc.anchors || [],
      })
      this.neighborOriginals.set(key, {
        q: sfc.q, r: sfc.r, s: sfc.s,
        type: sfc.type, rotation: sfc.rotation, level: sfc.level,
      })
    }
  }

  /**
   * Find neighbor cells adjacent to a contradiction cell
   * @param {string} failedKey - cubeKey of the cell that reached 0 possibilities
   * @param {string} sourceKey - cubeKey of the cell that caused the contradiction
   * @returns {string[]} cubeKeys of adjacent neighbor cells
   */
  findAdjacentNeighbors(failedKey, sourceKey) {
    const candidates = []
    // Check if the source of the contradiction was a fixed cell
    if (sourceKey && this.fixedCells.has(sourceKey) && this.neighborData.has(sourceKey)) {
      candidates.push(sourceKey)
    }
    // Also check all fixed neighbors of the failed cell
    const { q, r, s } = parseCubeKey(failedKey)
    for (let i = 0; i < 6; i++) {
      const dir = CUBE_DIRS[i]
      const nKey = cubeKey(q + dir.dq, r + dir.dr, s + dir.ds)
      if (nKey !== sourceKey && this.fixedCells.has(nKey) && this.neighborData.has(nKey)) {
        candidates.push(nKey)
      }
    }
    return candidates
  }

  /**
   * Unfix a neighbor cell: remove from fixedCells, add as a solve cell
   * Its anchors become new fixed cells to maintain compatibility with the original grid.
   * @param {string} key - cubeKey of the neighbor cell to unfix
   * @param {Array} solveCells - mutable array of solve cells to add to
   * @param {Array} fixedCells - mutable array of fixed cells to modify
   */
  unfixNeighbor(key, solveCells, fixedCells) {
    const softData = this.neighborData.get(key)
    if (!softData) return

    const { q, r, s } = parseCubeKey(key)

    // Remove from fixed cells array
    const fixedIdx = fixedCells.findIndex(fc => cubeKey(fc.q, fc.r, fc.s) === key)
    if (fixedIdx !== -1) fixedCells.splice(fixedIdx, 1)

    // Add to solve cells (if not already there)
    const alreadySolve = solveCells.some(c => cubeKey(c.q, c.r, c.s) === key)
    if (!alreadySolve) solveCells.push({ q, r, s })

    // Add anchors as new fixed cells (if not already fixed or solve)
    for (const anchor of softData.anchors) {
      const aKey = cubeKey(anchor.q, anchor.r, anchor.s)
      const alreadyFixed = fixedCells.some(fc => cubeKey(fc.q, fc.r, fc.s) === aKey)
      const alreadySolveCell = solveCells.some(c => cubeKey(c.q, c.r, c.s) === aKey)
      if (!alreadyFixed && !alreadySolveCell) {
        fixedCells.push({
          q: anchor.q, r: anchor.r, s: anchor.s,
          type: anchor.type, rotation: anchor.rotation, level: anchor.level
        })
      }
    }

    // Remove from neighborData so it won't be unfixed again
    this.neighborData.delete(key)
    this.unfixedKeys.push(key)
  }

  solve(solveCells, fixedCells, initialCollapses = []) {
    // Work with mutable copies so unfixing can modify them
    let currentSolveCells = [...solveCells]
    let currentFixedCells = [...fixedCells]

    let totalBacktracks = 0
    for (let restart = 0; restart <= this.options.maxRestarts; restart++) {
      const baseAttempt = this.options.attemptNum || 0
      const tryNum = baseAttempt + restart
      if (!this.options.quiet) {
        const prefix = this.options.gridId ? `[${this.options.gridId}] ` : ''
        this.log(`${prefix}WFC START [try ${tryNum}]`, 'green')
      }

      this.init(currentSolveCells, currentFixedCells)
      this.trail = []
      this.decisions = []
      this.backtracks = 0

      // Apply initial collapses (e.g. center grass, water edge for first grid)
      for (const ic of initialCollapses) {
        const key = cubeKey(ic.q, ic.r, ic.s)
        const cell = this.cells.get(key)
        if (cell && !cell.collapsed) {
          const state = { type: ic.type, rotation: ic.rotation ?? 0, level: ic.level ?? 0 }
          cell.collapse(state)
          this.collapseOrder.push({ q: ic.q, r: ic.r, s: ic.s, type: state.type, rotation: state.rotation, level: state.level })
          this.propagationStack.push(key)
        }
      }

      // Propagate from fixed cells into adjacent solve cells
      for (const fc of currentFixedCells) {
        const key = cubeKey(fc.q, fc.r, fc.s)
        this.propagationStack.push(key)
      }

      // Neighbor propagation with neighbor cell unfixing loop
      let neighborSeedingOk = true
      if (currentFixedCells.length > 0 || initialCollapses.length > 0) {
        neighborSeedingOk = this.propagate()

        // On neighbor failure, try unfixing neighbor cells
        let maxUnfixes = this.neighborData.size
        const unfixedBefore = this.unfixedKeys.length
        while (!neighborSeedingOk && maxUnfixes > 0) {
          maxUnfixes--
          const contradiction = this.lastContradiction
          if (!contradiction) break

          // Find neighbor cells adjacent to the contradiction
          const softCandidates = this.findAdjacentNeighbors(contradiction.failedKey, contradiction.sourceKey)
          if (softCandidates.length === 0) break

          // Unfix the first candidate
          this.unfixNeighbor(softCandidates[0], currentSolveCells, currentFixedCells)

          // Full re-init with updated solve/fixed cells
          this.init(currentSolveCells, currentFixedCells)
          this.trail = []
          this.decisions = []
          this.backtracks = 0
          this.collapseOrder = []

          // Re-apply initial collapses
          for (const ic of initialCollapses) {
            const key = cubeKey(ic.q, ic.r, ic.s)
            const cell = this.cells.get(key)
            if (cell && !cell.collapsed) {
              const state = { type: ic.type, rotation: ic.rotation ?? 0, level: ic.level ?? 0 }
              cell.collapse(state)
              this.collapseOrder.push({ q: ic.q, r: ic.r, s: ic.s, type: state.type, rotation: state.rotation, level: state.level })
              this.propagationStack.push(key)
            }
          }

          // Re-seed from fixed cells
          for (const fc of currentFixedCells) {
            const key = cubeKey(fc.q, fc.r, fc.s)
            this.propagationStack.push(key)
          }

          neighborSeedingOk = this.propagate()
        }
        const unfixedCount = this.unfixedKeys.length - unfixedBefore
        if (unfixedCount > 0) {
          this.log(`Unfixed ${unfixedCount} neighbor(s)`)
        }
      }

      if (!neighborSeedingOk) {
        this.neighborContradiction = this.lastContradiction
        if (!this.options.quiet) {
          const c = this.lastContradiction
          const loc = c ? ` at (${c.failedCol},${c.failedRow})` : ''
          const prefix = this.options.gridId ? `[${this.options.gridId}] ` : ''
          this.log(`${prefix}WFC FAIL [neighbor contradiction${loc}]`, 'red')
        }
        return null
      }

      // Main solve loop with backtracking
      let solved = false
      let failed = false
      let collapseCount = 0
      const totalCells = this.cells.size

      while (true) {
        const targetKey = this.findLowestEntropyCell()

        if (!targetKey) {
          solved = true
          break
        }

        // Record decision point before collapsing
        this.saveDecision(targetKey)
        const decision = this.decisions[this.decisions.length - 1]

        // Collapse with weighted random selection (excluding tried states)
        if (!this.collapseWithExclusions(targetKey, decision.triedStates)) {
          // No untried states left for this cell — backtrack further
          if (!this.backtrack()) { failed = true; break }
          continue
        }

        collapseCount++

        if (!this.propagate()) {
          // Contradiction — backtrack
          if (!this.backtrack()) { failed = true; break }
        }
      }

      totalBacktracks += this.backtracks
      if (solved) {
        this.restartCount = restart
        this.backtracks = totalBacktracks
        return this.extractResult()
      }

      // Backtrack limit reached — full restart
      this.restartCount = restart
    }

    this.backtracks = totalBacktracks
    return null
  }

  extractResult() {
    const result = []
    for (const [key, cell] of this.cells) {
      if (cell.tile) {
        const { q, r, s } = parseCubeKey(key)
        result.push({
          q, r, s,
          type: cell.tile.type,
          rotation: cell.tile.rotation,
          level: cell.tile.level,
        })
      }
    }

    // Check which unfixed neighbor cells ended up with different tiles
    this.changedFixedCells = []
    for (const unfixedKey of this.unfixedKeys) {
      const cell = this.cells.get(unfixedKey)
      if (!cell?.tile) continue

      const original = this.neighborOriginals.get(unfixedKey)
      if (!original) continue

      if (cell.tile.type !== original.type ||
          cell.tile.rotation !== original.rotation ||
          cell.tile.level !== original.level) {
        this.changedFixedCells.push({
          q: original.q, r: original.r, s: original.s,
          type: cell.tile.type,
          rotation: cell.tile.rotation,
          level: cell.tile.level,
        })
      }
    }

    return result
  }
}

// ============================================================================
// Worker Message Handler
// ============================================================================

let currentRequestId = null

self.onmessage = function(e) {
  const { type, id } = e.data

  if (type === 'init') {
    if (e.data.seed != null) {
      setSeed(e.data.seed)
    }
    return
  }

  if (type === 'solve') {
    currentRequestId = id
    const { solveCells, fixedCells, options } = e.data

    const tileTypes = options?.tileTypes ?? null
    const rules = HexWFCAdjacencyRules.fromTileDefinitions(tileTypes)

    const solver = new HexWFCSolver(rules, {
      ...options,
      log: (message, color) => {
        if (currentRequestId === id) {
          self.postMessage({ type: 'log', id, message, color })
        }
      }
    })

    // Initialize neighbor cell data before solving
    solver.initNeighborData(options?.neighborCells)

    const result = solver.solve(
      solveCells,
      fixedCells,
      options?.initialCollapses ?? []
    )
    const collapseOrder = solver.collapseOrder || []
    const neighborContradiction = solver.neighborContradiction
    const lastContradiction = solver.lastContradiction

    self.postMessage({
      type: 'result',
      id,
      success: result !== null,
      tiles: result,
      collapseOrder,
      neighborContradiction,
      lastContradiction,
      changedFixedCells: solver.changedFixedCells || [],
      unfixedKeys: solver.unfixedKeys || [],
      backtracks: solver.backtracks || 0,
      restarts: solver.restartCount || 0,
    })
  }
}
