import gsap from 'gsap'
import { TILE_LIST } from './HexTileData.js'
import { HexTileGeometry } from './HexTiles.js'
import { LEVEL_HEIGHT, TILE_SURFACE } from './DecorationDefs.js'

const DROP_HEIGHT = 5
const ANIM_DURATION = 0.4
const DEC_DROP_HEIGHT = 4
const DEC_ANIM_DURATION = 0.3
const DEC_DELAY = 400

/**
 * Hide all tile and decoration instances (for animation start)
 */
export function hideAllInstances(grid) {
  const dummy = grid.dummy
  dummy.scale.setScalar(0)
  dummy.updateMatrix()

  for (const tile of grid.hexTiles) {
    if (tile.instanceId !== null) {
      grid.hexMesh.setMatrixAt(tile.instanceId, dummy.matrix)
    }
  }

  if (grid.decorations) {
    const pairs = [
      [grid.decorations.trees, grid.decorations.treeMesh],
      [grid.decorations.buildings, grid.decorations.staticMesh],
      [grid.decorations.bridges, grid.decorations.staticMesh],
      [grid.decorations.waterlilies, grid.decorations.staticMesh],
      [grid.decorations.flowers, grid.decorations.treeMesh],
      [grid.decorations.rocks, grid.decorations.staticMesh],
      [grid.decorations.hills, grid.decorations.staticMesh],
      [grid.decorations.mountains, grid.decorations.staticMesh],
    ]
    for (const [items, mesh] of pairs) {
      for (const item of items) mesh.setMatrixAt(item.instanceId, dummy.matrix)
    }
  }

  for (const fillId of grid.bottomFills.values()) {
    grid.hexMesh.setMatrixAt(fillId, dummy.matrix)
  }

}

/**
 * Animate a single tile dropping in from above (reused by click-resolve)
 */
export function animateTileDrop(grid, tile) {
  if (!tile || tile.instanceId === null) return

  const dummy = grid.dummy
  const pos = HexTileGeometry.getWorldPosition(
    tile.gridX - grid.gridRadius,
    tile.gridZ - grid.gridRadius
  )
  const targetY = tile.level * LEVEL_HEIGHT
  const rotationY = -tile.rotation * Math.PI / 3
  const fillId = grid.bottomFills.get(`${tile.gridX},${tile.gridZ}`)
  const anim = { y: targetY + DROP_HEIGHT, scale: 1 }
  tile._anim = anim
  gsap.to(anim, {
    y: targetY,
    duration: ANIM_DURATION,
    ease: 'power1.out',
    onUpdate: () => {
      if (!grid.hexMesh) return
      dummy.position.set(pos.x, anim.y, pos.z)
      dummy.rotation.y = rotationY
      dummy.scale.setScalar(anim.scale)
      dummy.updateMatrix()
      grid.hexMesh.setMatrixAt(tile.instanceId, dummy.matrix)

      if (fillId !== undefined) {
        const tileY = tile.level * LEVEL_HEIGHT
        dummy.position.set(pos.x, anim.y, pos.z)
        dummy.rotation.y = 0
        dummy.scale.set(anim.scale, tileY, anim.scale)
        dummy.updateMatrix()
        grid.hexMesh.setMatrixAt(fillId, dummy.matrix)
      }

    }
  })
}

/**
 * Build a map of tile position -> decorations on that tile
 */
function buildDecorationMap(grid) {
  const map = new Map()
  if (!grid.decorations) return map

  const decs = grid.decorations
  const radius = grid.gridRadius

  const addItems = (items, mesh, getEntry) => {
    for (const item of items) {
      const key = `${item.tile.gridX},${item.tile.gridZ}`
      if (!map.has(key)) map.set(key, [])
      const pos = HexTileGeometry.getWorldPosition(item.tile.gridX - radius, item.tile.gridZ - radius)
      map.get(key).push({ mesh, instanceId: item.instanceId, ...getEntry(item, pos) })
    }
  }

  addItems(decs.trees, decs.treeMesh, (t, pos) => ({
    x: pos.x + (t.ox ?? 0), y: t.tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: pos.z + (t.oz ?? 0),
    rotationY: t.rotationY ?? 0
  }))

  // Build windmill fan lookup
  const fanByInstanceId = new Map()
  for (const fan of decs.windmillFans) fanByInstanceId.set(fan.instanceId, fan)

  addItems(decs.buildings, decs.staticMesh, (b, pos) => {
    const entry = {
      x: pos.x + (b.ox ?? 0), y: b.tile.level * LEVEL_HEIGHT + TILE_SURFACE + (b.oy ?? 0), z: pos.z + (b.oz ?? 0),
      rotationY: b.rotationY ?? 0
    }
    const fan = fanByInstanceId.get(b.instanceId)
    if (fan) entry.fan = fan
    return entry
  })

  addItems(decs.bridges, decs.staticMesh, (b, pos) => ({
    x: pos.x, y: b.tile.level * LEVEL_HEIGHT, z: pos.z,
    rotationY: -b.tile.rotation * Math.PI / 3
  }))

  addItems(decs.waterlilies, decs.staticMesh, (l, pos) => {
    const name = TILE_LIST[l.tile.type]?.name || ''
    const dip = (name.startsWith('COAST_') || name === 'OCEAN') ? -0.2 : 0
    return {
      x: pos.x + (l.ox ?? 0), y: l.tile.level * LEVEL_HEIGHT + TILE_SURFACE + dip, z: pos.z + (l.oz ?? 0),
      rotationY: l.rotationY ?? 0, scale: 2
    }
  })

  addItems(decs.flowers, decs.treeMesh, (f, pos) => ({
    x: pos.x + (f.ox ?? 0), y: f.tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: pos.z + (f.oz ?? 0),
    rotationY: f.rotationY ?? 0, scale: 2
  }))

  addItems(decs.rocks, decs.staticMesh, (r, pos) => {
    const name = TILE_LIST[r.tile.type]?.name || ''
    const dip = name === 'OCEAN' ? -0.2 : (name.startsWith('COAST_') || name.startsWith('RIVER_')) ? -0.1 : 0
    return {
      x: pos.x + (r.ox ?? 0), y: r.tile.level * LEVEL_HEIGHT + TILE_SURFACE + dip, z: pos.z + (r.oz ?? 0),
      rotationY: r.rotationY ?? 0
    }
  })

  addItems(decs.hills, decs.staticMesh, (h, pos) => {
    const isRiverEnd = TILE_LIST[h.tile.type]?.name === 'RIVER_END'
    return {
      x: pos.x, y: h.tile.level * LEVEL_HEIGHT + TILE_SURFACE + (isRiverEnd ? -0.1 : 0), z: pos.z,
      rotationY: h.rotationY ?? 0
    }
  })

  addItems(decs.mountains, decs.staticMesh, (m, pos) => ({
    x: pos.x, y: m.tile.level * LEVEL_HEIGHT + TILE_SURFACE, z: pos.z,
    rotationY: m.rotationY ?? 0
  }))

  return map
}

/**
 * Animate tile placements with GSAP drop-in (tiles already placed but hidden)
 * Each decoration drops after its tile
 */
export function animatePlacements(grid, collapseOrder, delay, onComplete) {
  if (collapseOrder.length === 0) {
    onComplete?.()
    return
  }

  const dummy = grid.dummy
  const decsByTile = buildDecorationMap(grid)
  const fillsByTile = grid.bottomFills
  const lastIndex = collapseOrder.length - 1

  let i = 0
  const step = () => {
    if (i >= collapseOrder.length || !grid.hexMesh) return

    const isLast = i === lastIndex
    const placement = collapseOrder[i]
    const tile = grid.hexGrid?.[placement.gridX]?.[placement.gridZ]

    if (tile && tile.instanceId !== null) {
      const pos = HexTileGeometry.getWorldPosition(
        tile.gridX - grid.gridRadius,
        tile.gridZ - grid.gridRadius
      )
      const targetY = tile.level * LEVEL_HEIGHT
      const rotationY = -tile.rotation * Math.PI / 3
      const fillId = fillsByTile.get(`${tile.gridX},${tile.gridZ}`)
      const anim = { y: targetY + DROP_HEIGHT, scale: 1 }
      tile._anim = anim
      const tileKey = `${tile.gridX},${tile.gridZ}`
      const decs = decsByTile.get(tileKey)

      gsap.to(anim, {
        y: targetY,
        duration: ANIM_DURATION,
        ease: 'power1.out',
        onUpdate: () => {
          if (!grid.hexMesh) return
          dummy.position.set(pos.x, anim.y, pos.z)
          dummy.rotation.y = rotationY
          dummy.scale.setScalar(anim.scale)
          dummy.updateMatrix()
          grid.hexMesh.setMatrixAt(tile.instanceId, dummy.matrix)

          if (fillId !== undefined) {
            const tileY = tile.level * LEVEL_HEIGHT
            dummy.position.set(pos.x, anim.y, pos.z)
            dummy.rotation.y = 0
            dummy.scale.set(anim.scale, tileY, anim.scale)
            dummy.updateMatrix()
            grid.hexMesh.setMatrixAt(fillId, dummy.matrix)
          }

        },
        onComplete: (isLast && !decs) ? onComplete : undefined
      })

      if (decs) {
        const decComplete = isLast ? onComplete : null
        setTimeout(() => animateDecoration(grid, decs, decComplete), DEC_DELAY)
      }
    } else if (isLast) {
      onComplete?.()
    }

    i++
    setTimeout(step, delay)
  }
  step()
}

/**
 * Animate a single decoration or array of decorations dropping in
 */
export function animateDecoration(grid, items, onAllComplete) {
  const dummy = grid.dummy
  const list = Array.isArray(items) ? items : [items]
  const lastIdx = list.length - 1

  for (let j = 0; j < list.length; j++) {
    const item = list[j]
    const targetScale = item.scale ?? 1
    const anim = { y: item.y + DEC_DROP_HEIGHT, scale: targetScale * 0.5 }
    gsap.to(anim, {
      y: item.y,
      scale: targetScale,
      duration: DEC_ANIM_DURATION,
      ease: 'power1.out',
      onUpdate: () => {
        try {
          dummy.position.set(item.x, anim.y, item.z)
          dummy.rotation.y = item.rotationY
          dummy.scale.setScalar(anim.scale)
          dummy.updateMatrix()
          item.mesh.setMatrixAt(item.instanceId, dummy.matrix)
        } catch (_) {
          // Instance may have been deleted by decoration repopulation
        }
      },
      onComplete: () => {
        if (item.fan) item.fan.tween?.resume()
        if (j === lastIdx) onAllComplete?.()
      }
    })
  }
}
