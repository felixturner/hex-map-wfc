import { TreeMeshNames, RockMeshNames, HillMeshNames, MountainMeshNames } from '../hexmap/DecorationDefs.js'
import { RESOURCE_COLUMNS, RESOURCE_RULES } from './ResourceGrid.js'
import { offsetToCube } from '../hexmap/HexWFCCore.js'

const meshKinds = { trees: TreeMeshNames, rocks: RockMeshNames, hills: HillMeshNames, mountains: MountainMeshNames }
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max
const integer = (n, min, max) => Number.isInteger(n) && finite(n, min, max)

export function validateMapResources(snapshot) {
  const fail = message => { throw new Error(`Invalid saved map: ${message}`) }
  validateLandscape(snapshot)
  validateResourceGrid(snapshot.resources)
}

export function validateLandscape(snapshot) {
  const fail = message => { throw new Error(`Invalid saved map: ${message}`) }
  const landscape = snapshot.landscape
  if (landscape?.version !== 1 || landscape.assetVersion !== 1 || landscape.matrixConvention !== 'three-column-major-local-to-grid' ||
      !Array.isArray(landscape.grids) || landscape.grids.length !== snapshot.grids.length) fail('invalid landscape')
  const expected = new Set(snapshot.grids.map(g => `${g.x},${g.z}`))
  for (const grid of landscape.grids) {
    if (!grid || !expected.delete(`${grid.x},${grid.z}`) || !grid.offset ||
        !finite(grid.offset.x, -100000, 100000) || !finite(grid.offset.z, -100000, 100000) ||
        !Array.isArray(grid.instances) || grid.instances.length > 193) fail('invalid landscape grid')
    for (const item of grid.instances) {
      if (!item || !Object.hasOwn(meshKinds, item.kind) || !meshKinds[item.kind].includes(item.mesh) ||
          !item.tile || !integer(item.tile.x, 0, snapshot.radius * 2) || !integer(item.tile.z, 0, snapshot.radius * 2)) fail('invalid landscape instance')
      const c = offsetToCube(item.tile.x - snapshot.radius, item.tile.z - snapshot.radius)
      if (Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s)) > snapshot.radius) fail('landscape tile outside grid')
      const m = item.matrix
      if (!Array.isArray(m) || m.length !== 16 || !m.every(n => finite(n, -100, 100)) ||
          m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1 ||
          m[1] !== 0 || m[4] !== 0 || m[6] !== 0 || m[9] !== 0 || !finite(m[5], 0.1, 3) ||
          Math.abs(m[0] - m[10]) > 1e-6 || Math.abs(m[2] + m[8]) > 1e-6 ||
          Math.abs(Math.hypot(m[0], m[2]) - m[5]) > 1e-6) fail('invalid landscape transform')
    }
  }
}

export function validateResourceGrid(resource) {
  const fail = message => { throw new Error(`Invalid saved map: ${message}`) }
  if (resource?.version !== 1 || resource.coordinates !== 'world-xz-y-up' || resource.yieldUnits !== 'per-cell-per-tick' ||
      resource.samplesPerCell !== 4 || !finite(resource.cellSize, 0.125, 2) ||
      !integer(resource.width, 1, 10000) || !integer(resource.height, 1, 10000) || resource.width * resource.height > 1000000 ||
      !resource.origin || !finite(resource.origin.x, -100000, 100000) || !finite(resource.origin.z, -100000, 100000) ||
      JSON.stringify(resource.columns) !== JSON.stringify(RESOURCE_COLUMNS) ||
      !resource.rules || Object.keys(RESOURCE_RULES).some(k => !finite(resource.rules[k], 0, 10000)) ||
      !Array.isArray(resource.cells) || !resource.cells.length || resource.cells.length > resource.width * resource.height) fail('invalid resource grid')
  let previous = -1
  for (const cell of resource.cells) {
    if (!Array.isArray(cell) || cell.length !== RESOURCE_COLUMNS.length ||
        !integer(cell[0], 0, resource.width - 1) || !integer(cell[1], 0, resource.height - 1) ||
        !finite(cell[2], -100, 100) || !finite(cell[3], 0, 90) ||
        !cell.slice(4, 7).every(n => finite(n, 0, 40000)) || ![0.25, 0.5, 0.75, 1].includes(cell[7])) fail('invalid resource cell')
    const index = cell[1] * resource.width + cell[0]
    if (index <= previous) fail('resource cells must be unique and ordered')
    previous = index
  }
}
