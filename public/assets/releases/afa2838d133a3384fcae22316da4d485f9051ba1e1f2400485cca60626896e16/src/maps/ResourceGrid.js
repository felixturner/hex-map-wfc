import { Vector3 } from 'three'

export const RESOURCE_COLUMNS = ['column', 'row', 'elevation', 'slope', 'wood', 'minerals', 'food', 'coverage']
export const RESOURCE_RULES = Object.freeze({ wood: 1, minerals: 1, farming: 1, fishing: 0.6, minimumFishingArea: 12 })
const round = n => Math.round(n * 1e6) / 1e6
const clamp = n => Math.max(0, Math.min(1, n))

// Atlas semantics match NaturalMaterial. Roads deliberately count as grass.
export function surfaceType(u, v, water = false) {
  if (water) return 'water'
  if (v > 0.5 && v < 0.75) {
    if (u < 0.125 || (u > 0.375 && u < 0.5)) return 'grass'
    if (u < 0.25) return 'foliage'
    if (u < 0.375) return 'stone'
  }
  return 'other'
}

// CPU rasterization uses a fixed world-space lattice, independent of cameras,
// lighting and animation. Four samples per cell approximate mixed coverage.
export function buildResourceGrid(surfaces, { cellSize = 0.25, rules = RESOURCE_RULES, waterAtUV = () => false } = {}) {
  rules = { ...RESOURCE_RULES, ...rules }
  if (!Number.isFinite(cellSize) || cellSize < 0.125 || cellSize > 2) throw new Error('Unsupported resource cell size')
  if (!surfaces.length) throw new Error('Cannot sample an empty map')
  for (const value of Object.values(rules)) if (!Number.isFinite(value) || value < 0) throw new Error('Invalid resource rule')
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  const point = new Vector3()
  for (const { geometry, matrix, kind } of surfaces) {
    if (kind !== 'terrain') continue
    const p = geometry.attributes.position
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(matrix)
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z)
    }
  }
  const origin = { x: Math.floor(minX / cellSize) * cellSize, z: Math.floor(minZ / cellSize) * cellSize }
  const width = Math.ceil((maxX - origin.x) / cellSize), height = Math.ceil((maxZ - origin.z) / cellSize)
  if (!Number.isSafeInteger(width * height) || width * height < 1 || width * height > 1000000) throw new Error('Resource grid exceeds supported bounds')
  const sw = width * 2, sh = height * 2, count = sw * sh, step = cellSize / 2
  const elevation = new Float64Array(count).fill(-Infinity)
  const treeHeight = new Float64Array(count).fill(-Infinity)
  const slope = new Float32Array(count)
  const material = new Uint8Array(count) // 1 grass, 2 stone, 3 water, 4 other
  const valid = new Uint8Array(count)
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const ab = new Vector3(), ac = new Vector3(), normal = new Vector3()
  // Terrain first establishes the footprint. Decorations cannot extend the map.
  for (const surface of [...surfaces.filter(s => s.kind === 'terrain'), ...surfaces.filter(s => s.kind !== 'terrain')]) {
    const { geometry, matrix, kind } = surface
    if (!['terrain', 'trees', 'rocks', 'hills', 'mountains'].includes(kind)) continue
    const p = geometry.attributes.position, uv = geometry.attributes.uv, indices = geometry.index
    const length = indices?.count ?? p.count
    for (let t = 0; t < length; t += 3) {
      const ia = indices ? indices.getX(t) : t, ib = indices ? indices.getX(t + 1) : t + 1, ic = indices ? indices.getX(t + 2) : t + 2
      a.fromBufferAttribute(p, ia).applyMatrix4(matrix)
      b.fromBufferAttribute(p, ib).applyMatrix4(matrix)
      c.fromBufferAttribute(p, ic).applyMatrix4(matrix)
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
      if (normal.y <= 0.00001) continue // undersides and vertical walls have no plan area
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
      const x0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - origin.x) / step - 0.5))
      const x1 = Math.min(sw - 1, Math.floor((Math.max(a.x, b.x, c.x) - origin.x) / step - 0.5))
      const z0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - origin.z) / step - 0.5))
      const z1 = Math.min(sh - 1, Math.floor((Math.max(a.z, b.z, c.z) - origin.z) / step - 0.5))
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const wx = origin.x + (x + 0.5) * step, wz = origin.z + (z + 0.5) * step
        const wa = ((b.z - c.z) * (wx - c.x) + (c.x - b.x) * (wz - c.z)) / den
        const wb = ((c.z - a.z) * (wx - c.x) + (a.x - c.x) * (wz - c.z)) / den
        const wc = 1 - wa - wb
        if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) continue
        const i = z * sw + x
        if (kind !== 'terrain' && !valid[i]) continue
        const y = wa * a.y + wb * b.y + wc * c.y
        const u = uv ? wa * uv.getX(ia) + wb * uv.getX(ib) + wc * uv.getX(ic) : 0
        const v = uv ? wa * uv.getY(ia) + wb * uv.getY(ib) + wc * uv.getY(ic) : 0.6
        const type = surfaceType(u, v, kind === 'terrain' && waterAtUV(u, v))
        if (kind === 'trees' || type === 'foliage') {
          treeHeight[i] = Math.max(treeHeight[i], y)
          continue
        }
        if (y < elevation[i]) continue
        if (kind === 'terrain') valid[i] = 1
        elevation[i] = y
        slope[i] = Math.acos(clamp(normal.y)) * 180 / Math.PI
        material[i] = type === 'water' ? 3 : type === 'grass' ? 1 : (type === 'stone' || kind === 'rocks' || kind === 'mountains') ? 2 : 4
      }
    }
  }
  // Flood fill at sample resolution so coast cells can contain both land and water.
  const visited = new Uint8Array(count), fishing = new Uint8Array(count), queue = new Int32Array(count)
  for (let start = 0; start < count; start++) {
    if (visited[start] || material[start] !== 3) continue
    let head = 0, tail = 1
    queue[0] = start; visited[start] = 1
    while (head < tail) {
      const i = queue[head++], x = i % sw
      for (const next of [x ? i - 1 : -1, x < sw - 1 ? i + 1 : -1, i - sw, i + sw]) {
        if (next < 0 || next >= count || visited[next] || material[next] !== 3) continue
        visited[next] = 1; queue[tail++] = next
      }
    }
    if (tail * step * step >= rules.minimumFishingArea) for (let j = 0; j < tail; j++) fishing[queue[j]] = 1
  }
  const cells = [], sampleArea = step * step
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    let n = 0, y = 0, degrees = 0, wood = 0, minerals = 0, food = 0
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const i = (row * 2 + dz) * sw + col * 2 + dx
      if (!valid[i]) continue
      n++; y += elevation[i]; degrees += slope[i]
      const forest = treeHeight[i] > elevation[i] + 0.01 && material[i] !== 3
      const rock = material[i] === 2 ? 1 : material[i] === 1 ? clamp((slope[i] - 16) / 30) : 0
      wood += forest ? rules.wood * sampleArea : 0
      minerals += rock * rules.minerals * sampleArea
      if (material[i] === 3) food += fishing[i] * rules.fishing * sampleArea
      else if (material[i] === 1 && !forest) food += (1 - rock) * clamp(1 - slope[i] / 45) * rules.farming * sampleArea
    }
    if (n) cells.push([col, row, round(y / n), round(degrees / n), round(wood), round(minerals), round(food), n / 4])
  }
  return { version: 1, coordinates: 'world-xz-y-up', cellSize, origin, width, height, samplesPerCell: 4,
    yieldUnits: 'per-cell-per-tick', rules: { ...rules }, columns: [...RESOURCE_COLUMNS], cells }
}
