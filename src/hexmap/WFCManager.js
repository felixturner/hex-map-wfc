import WFCWorker from '../workers/wfc.worker.js?worker'
import { HexWFCAdjacencyRules, CUBE_DIRS, cubeKey, parseCubeKey } from './HexWFCCore.js'
import { TILE_LIST, HexDir, HexOpposite, rotateHexEdges, LEVELS_COUNT } from './HexTileData.js'
import { log } from '../App.js'
import { getSeed } from '../SeededRandom.js'

/**
 * WFCManager — owns the WFC Web Worker and adjacency rules.
 * Receives `globalCells` (shared Map) by reference.
 */
export class WFCManager {
  constructor(globalCells) {
    this.globalCells = globalCells

    this.hexWfcRules = null
    this.wfcWorker = null
    this.wfcPendingResolvers = new Map()
    this.wfcRequestId = 0
  }

  /** Initialize shared WFC rules */
  initWfcRules() {
    const tileTypes = this.getDefaultTileTypes()
    this.hexWfcRules = HexWFCAdjacencyRules.fromTileDefinitions(tileTypes)
  }

  /** Initialize WFC Web Worker */
  initWfcWorker() {
    try {
      this.wfcWorker = new WFCWorker()
      this.wfcWorker.postMessage({ type: 'init', seed: getSeed() })
      this.wfcWorker.onmessage = (e) => this.handleWfcMessage(e)
      this.wfcWorker.onerror = (e) => {
        console.error('WFC Worker error:', e)
        for (const [id, resolve] of this.wfcPendingResolvers) {
          resolve({ success: false, tiles: null, collapseOrder: [] })
        }
        this.wfcPendingResolvers.clear()
      }
    } catch (e) {
      console.warn('Failed to create WFC worker, will use sync solver:', e)
      this.wfcWorker = null
    }
  }

  /** Handle messages from WFC worker */
  handleWfcMessage(e) {
    const { type, id, message, success, tiles, collapseOrder } = e.data

    if (type === 'log') {
      log(e.data.message, `color: ${e.data.color || 'black'}`)
    } else if (type === 'result') {
      const resolve = this.wfcPendingResolvers.get(id)
      if (resolve) {
        const { seedingContradiction, lastContradiction, changedFixedCells, unfixedKeys, backtracks, restarts } = e.data
        resolve({ success, tiles, collapseOrder, seedingContradiction, lastContradiction, changedFixedCells, unfixedKeys, backtracks, restarts })
        this.wfcPendingResolvers.delete(id)
      }
    }
  }

  /**
   * Solve WFC using Web Worker (async, cube-coordinate based)
   * @param {Array} solveCells - [{q,r,s}] cells to solve
   * @param {Array} fixedCells - [{q,r,s,type,rotation,level}] collapsed neighbor constraints
   * @param {Object} options - WFC options
   * @returns {Promise<{success, tiles, collapseOrder}>}
   */
  solveWfcAsync(solveCells, fixedCells, options) {
    return new Promise((resolve) => {
      if (!this.wfcWorker) {
        resolve({ success: false, tiles: null, collapseOrder: [] })
        return
      }

      const id = `wfc_${++this.wfcRequestId}`

      this.wfcPendingResolvers.set(id, (result) => {
        resolve(result)
      })

      this.wfcWorker.postMessage({
        type: 'solve',
        id,
        solveCells,
        fixedCells,
        options
      })
    })
  }

  /**
   * Add solved tiles to the global cell map
   * @param {string} gridKey - Grid key for tracking
   * @param {Array} tiles - [{q,r,s,type,rotation,level}] solved tiles
   */
  addToGlobalCells(gridKey, tiles) {
    for (const tile of tiles) {
      const key = cubeKey(tile.q, tile.r, tile.s)
      const existing = this.globalCells.get(key)
      if (existing) {
        existing.type = tile.type
        existing.rotation = tile.rotation
        existing.level = tile.level
      } else {
        this.globalCells.set(key, {
          q: tile.q, r: tile.r, s: tile.s,
          type: tile.type, rotation: tile.rotation, level: tile.level,
          gridKey
        })
      }
    }
  }

  /**
   * Get fixed cells (collapsed neighbors) for a set of solve cells
   * @param {Array} solveCells - [{q,r,s}] cells to solve
   * @returns {Array} [{q,r,s,type,rotation,level}] unique fixed cells
   */
  getFixedCellsForRegion(solveCells) {
    const solveSet = new Set(solveCells.map(c => cubeKey(c.q, c.r, c.s)))
    const fixedMap = new Map()

    for (const { q, r, s } of solveCells) {
      for (const dir of CUBE_DIRS) {
        const nq = q + dir.dq
        const nr = r + dir.dr
        const ns = s + dir.ds
        const nKey = cubeKey(nq, nr, ns)

        if (solveSet.has(nKey)) continue
        if (fixedMap.has(nKey)) continue

        const existing = this.globalCells.get(nKey)
        if (existing) {
          fixedMap.set(nKey, {
            q: nq, r: nr, s: ns,
            type: existing.type, rotation: existing.rotation, level: existing.level
          })
        }
      }
    }

    return [...fixedMap.values()]
  }

  /**
   * Get anchor cells for a fixed cell — neighbors in globalCells that are NOT
   * in the solve set and NOT already a fixed cell.
   */
  getAnchorsForCell(fc, solveSet, fixedSet) {
    const anchors = []
    for (const dir of CUBE_DIRS) {
      const nq = fc.q + dir.dq
      const nr = fc.r + dir.dr
      const ns = fc.s + dir.ds
      const nKey = cubeKey(nq, nr, ns)

      if (solveSet.has(nKey)) continue
      if (fixedSet.has(nKey)) continue

      const existing = this.globalCells.get(nKey)
      if (existing) {
        anchors.push({
          q: nq, r: nr, s: ns,
          type: existing.type, rotation: existing.rotation, level: existing.level
        })
      }
    }
    return anchors
  }

  /**
   * Run a single WFC attempt using the populate context.
   * Handles persisted-unfixed cells, soft fixed cell construction, and failure tracking.
   * @param {Object} ctx - Populate context from HexMap._setupPopulateContext
   * @returns {Object} { success, tiles?, collapseOrder?, changedFixedCells?, unfixedKeys?, seedConflict?, failedCell?, sourceKey?, seedingContradiction?, lastContradiction? }
   */
  async runWfcAttempt(ctx) {
    ctx.attempt++
    let activeFixed = ctx.fixedCells.filter(fc => !fc.dropped)

    // For persisted-unfixed cells: move to solve, add anchors as fixed
    let activeSolveCells = ctx.solveCells
    if (ctx.persistedUnfixedKeys.size > 0) {
      const anchorFixed = []
      const anchorKeys = new Set()
      activeSolveCells = [...ctx.solveCells]
      const solveKeySet = new Set(ctx.solveCells.map(c => cubeKey(c.q, c.r, c.s)))
      const fixedKeySet = new Set(activeFixed.map(fc => cubeKey(fc.q, fc.r, fc.s)))

      for (const uk of ctx.persistedUnfixedKeys) {
        const { q, r, s } = parseCubeKey(uk)
        if (!solveKeySet.has(uk)) {
          activeSolveCells.push({ q, r, s })
          solveKeySet.add(uk)
        }

        const anchors = ctx.anchorMap.get(uk) || []
        for (const anchor of anchors) {
          const ak = cubeKey(anchor.q, anchor.r, anchor.s)
          if (!fixedKeySet.has(ak) && !solveKeySet.has(ak) && !anchorKeys.has(ak)) {
            anchorFixed.push(anchor)
            anchorKeys.add(ak)
          }
        }
      }

      activeFixed = activeFixed.filter(fc => !ctx.persistedUnfixedKeys.has(cubeKey(fc.q, fc.r, fc.s)))
      activeFixed = [...activeFixed, ...anchorFixed]
    }

    // Build soft fixed cells, excluding already-unfixed cells from previous attempts
    const activeSoftFixed = activeFixed
      .filter(fc => !ctx.persistedUnfixedKeys.has(cubeKey(fc.q, fc.r, fc.s)))
      .map(fc => ({
        q: fc.q, r: fc.r, s: fc.s,
        type: fc.type, rotation: fc.rotation, level: fc.level,
        anchors: ctx.anchorMap.get(cubeKey(fc.q, fc.r, fc.s)) || []
      }))

    const wfcResult = await this.solveWfcAsync(activeSolveCells, activeFixed, {
      tileTypes: ctx.tileTypes,
      weights: ctx.options.weights ?? {},
      maxRestarts: ctx.initialFixedCount === 0 ? 10 : 1,
      initialCollapses: ctx.initialCollapses,
      gridId: ctx.gridKey,
      attemptNum: ctx.attempt,
      softFixedCells: activeSoftFixed,
    })

    if (wfcResult.success) {
      return {
        success: true,
        tiles: wfcResult.tiles,
        collapseOrder: wfcResult.collapseOrder || [],
        changedFixedCells: wfcResult.changedFixedCells || [],
        unfixedKeys: wfcResult.unfixedKeys || [],
      }
    }

    // Persist unfixed keys from this failed attempt
    const failedUnfixed = wfcResult.unfixedKeys || []
    for (const uk of failedUnfixed) {
      if (!ctx.persistedUnfixedKeys.has(uk)) {
        ctx.persistedUnfixedKeys.add(uk)
        const fc = ctx.fixedCells.find(f => cubeKey(f.q, f.r, f.s) === uk)
        if (fc) ctx.persistedUnfixedOriginals.set(uk, { q: fc.q, r: fc.r, s: fc.s, type: fc.type, rotation: fc.rotation, level: fc.level })
      }
    }

    const failedInfo = wfcResult.seedingContradiction || wfcResult.lastContradiction
    return {
      success: false,
      seedConflict: !!wfcResult.seedingContradiction,
      failedCell: failedInfo ? { q: failedInfo.failedQ, r: failedInfo.failedR, s: failedInfo.failedS } : null,
      sourceKey: failedInfo?.sourceKey ?? null,
      seedingContradiction: wfcResult.seedingContradiction,
      lastContradiction: wfcResult.lastContradiction,
    }
  }

  /** Get default tile types for WFC */
  getDefaultTileTypes() {
    return TILE_LIST.map((_, i) => i)
  }
}
