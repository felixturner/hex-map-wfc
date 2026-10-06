import { BufferGeometry, Float32BufferAttribute, CylinderGeometry, IcosahedronGeometry } from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Asset variation uses a private generator: loading assets must not change WFC seeds.
export function assetRandom(name) {
  let state = 2166136261
  for (const c of name) state = Math.imul(state ^ c.charCodeAt(0), 16777619)
  return () => {
    state = Math.imul(state ^ state >>> 15, 1 | state)
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state)
    return ((state ^ state >>> 14) >>> 0) / 4294967296
  }
}

const hexRadius = (x, z) => Math.max(Math.abs(x), Math.abs(x) * 0.5 + Math.abs(z) * Math.sqrt(3) / 2)

// Relax welded vertices together so UV seams cannot open cracks. Tile boundaries
// and undersides stay fixed; only the interior silhouette is rounded.
function roundTerrain(positions) {
  const vertices = [], ids = [], lookup = new Map()
  for (let i = 0; i < positions.length; i += 3) {
    const point = positions.slice(i, i + 3)
    const key = point.map(v => v.toFixed(5)).join(',')
    if (!lookup.has(key)) {
      lookup.set(key, vertices.length)
      vertices.push({ point, neighbors: new Set(), fixed: hexRadius(point[0], point[2]) > 0.985 || point[1] < 0.96 })
    }
    ids.push(lookup.get(key))
  }
  for (let i = 0; i < ids.length; i += 3) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (ids[i + a] !== ids[i + b]) vertices[ids[i + a]].neighbors.add(ids[i + b])
    }
  }
  for (let pass = 0; pass < 5; pass++) {
    const next = vertices.map(({ point, neighbors, fixed }) => {
      if (fixed || !neighbors.size) return point
      const average = [0, 0, 0]
      for (const id of neighbors) for (let axis = 0; axis < 3; axis++) average[axis] += vertices[id].point[axis] / neighbors.size
      return point.map((v, axis) => v + (average[axis] - v) * 0.45)
    })
    vertices.forEach((v, i) => { v.point = next[i] })
  }
  ids.forEach((id, i) => vertices[id].point.forEach((v, axis) => { positions[i * 3 + axis] = v }))
}

// Subdivide authored triangles without changing their UV islands or connections.
// Coincident vertices use the same displacement, including across hard normals.
export function detailTerrain(source, name, { riverRise = 0.5 } = {}) {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  const p = geometry.attributes.position, uv = geometry.attributes.uv
  const positions = [], uvs = []
  const terrainRelief = /sloped|cliff/.test(name) && !/road|river|coast/.test(name)
  const riverDrop = /river_slope/.test(name)
  const rockRelief = /mountain|hill|rock/.test(name)
  const emit = (a, b, c, depth) => {
    if (depth > 0) {
      const mid = (v, w) => v.map((x, i) => (x + w[i]) / 2)
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      emit(a, ab, ca, depth - 1); emit(ab, b, bc, depth - 1)
      emit(ca, bc, c, depth - 1); emit(ab, bc, ca, depth - 1)
      return
    }
    for (const v of [a, b, c]) {
      let [x, y, z, u, w] = v
      const radius = hexRadius(x, z)
      // Narrow the inset bevel, keeping the outer connection vertices untouched.
      if (!rockRelief && radius > 0.93 && radius < 0.98 && y > 0.8) {
        const scale = (radius + (1 - radius) * 0.82) / radius
        x *= scale; z *= scale
      }
      if (terrainRelief && y > 0.95 && radius < 0.93) {
        const edgeFade = Math.min(1, Math.max(0, (0.93 - radius) / 0.28))
        const ridge = 0.5 + 0.25 * Math.sin(x * 5 + z * 3) + 0.25 * Math.sin(z * 7 - x * 3)
        y += ridge * edgeFade * 0.09
      }
      if (rockRelief && y > 0.06) {
        const amount = Math.min(y, 0.17)
        const crag = Math.sin(x * 19 + z * 11 + y * 7) * Math.sin(z * 23 - y * 13)
        x += crag * amount * 0.22
        z += Math.sin(x * 21 + y * 17) * amount * 0.22
        y += crag * amount * 0.5
      }
      if (riverDrop) {
        // Preserve channel depth and bank height when building the two-level variant.
        y += (riverRise - 0.5) * Math.min(1, Math.max(0, x + 1)) * Math.min(1, Math.max(0, y / 0.9))
      }
      if (riverDrop && x > -1 && x < 0 && radius < 0.9999) {
        // The authored river rises from x=-1 to x=0. Compress its middle
        // horizontally into a falling curtain, preserving both end levels and
        // reshaping the banks with the water. Larger authored rises yield taller falls.
        const t = x * 2 + 1
        const cascadeX = -0.5 + 0.5 * t * t * t
        const inset = Math.min(1, (1 - radius) / 0.12)
        x += (cascadeX - x) * inset
      }
      positions.push(x, y, z); uvs.push(u, w)
    }
  }
  for (let i = 0; i < p.count; i += 3) {
    const vertex = j => [p.getX(j), p.getY(j), p.getZ(j), uv.getX(j), uv.getY(j)]
    emit(vertex(i), vertex(i + 1), vertex(i + 2), riverDrop ? 3 : terrainRelief ? 3 : rockRelief ? 2 : 0)
  }
  geometry.dispose()
  if (terrainRelief) roundTerrain(positions)
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  // All geometries in a BatchedMesh must use the same indexed layout.
  result.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i))
  result.computeVertexNormals()
  if (terrainRelief || rockRelief || riverDrop) {
    // UV islands duplicate vertices. Average by position so material boundaries
    // do not turn subdivided slopes into a patchwork of independently lit faces.
    const normals = result.attributes.normal
    const faceNormals = normals.array.slice()
    const shared = new Map()
    const keys = []
    for (let i = 0; i < positions.length; i += 3) {
      const key = positions.slice(i, i + 3).map(v => v.toFixed(5)).join(',')
      keys.push(key)
      const faces = shared.get(key) || []
      faces.push([normals.getX(i / 3), normals.getY(i / 3), normals.getZ(i / 3)])
      shared.set(key, faces)
    }
    for (let i = 0; i < keys.length; i++) {
      // Preserve the channel end normals: rounding the connection bevel would
      // create a reflective white seam across otherwise continuous water.
      if (riverDrop && (positions[i * 3] < -0.85 || positions[i * 3] > -0.15)) continue
      const sum = [0, 0, 0]
      for (const n of shared.get(keys[i])) {
        // Keep cliff faces and top surfaces distinct; averaging through a hard
        // edge incorrectly paints a wide rocky ring around each plateau.
        const dot = n[0] * faceNormals[i * 3] + n[1] * faceNormals[i * 3 + 1] + n[2] * faceNormals[i * 3 + 2]
        if (dot < 0.65) continue
        sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2]
      }
      const length = Math.hypot(...sum) || 1
      normals.setXYZ(i, sum[0] / length, sum[1] / length, sum[2] / length)
    }
  }
  return result
}

function paletteUV(geometry, u, v) {
  const uv = geometry.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v)
  return geometry
}

// Opaque branch clusters keep shadows and distant silhouettes stable without
// thousands of alpha-blended foliage cards. Built once per named modular asset.
export function createTreeGeometry(name) {
  const random = assetRandom(name)
  const count = name.includes('large') ? 8 : name.includes('medium') ? 5 : name.includes('small') ? 3 : 1
  const broadleaf = /_B|tree_D|tree_E/.test(name)
  const pieces = []
  const add = geometry => {
    const unindexed = geometry.index ? geometry.toNonIndexed() : geometry
    if (unindexed !== geometry) geometry.dispose()
    pieces.push(unindexed)
  }
  for (let tree = 0; tree < count; tree++) {
    const angle = tree * 2.399963
    const radius = count === 1 ? 0 : Math.sqrt(tree / count) * 0.77
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius
    const height = (count === 1 ? 1.05 : 0.72) * (0.8 + random() * 0.48)
    const trunk = paletteUV(new CylinderGeometry(0.016, 0.04, height * 0.8, 5), 0.34, 0.4)
    trunk.translate(x, height * 0.4, z); add(trunk)
    const layers = broadleaf ? 4 : 7
    for (let layer = 0; layer < layers; layer++) {
      const t = layer / layers
      const crownRadius = broadleaf ? height * (0.19 + Math.sin(t * Math.PI) * 0.12) : height * (1 - t) * 0.29
      const branches = broadleaf ? 5 : 6
      for (let branch = 0; branch < branches; branch++) {
        const a = branch * Math.PI * 2 / branches + layer * 1.8 + random() * 0.35
        const reach = crownRadius * (0.5 + random() * 0.28)
        const leaf = new IcosahedronGeometry(1, 0)
        const leafPositions = leaf.attributes.position, leafNormals = leaf.attributes.normal
        for (let i = 0; i < leafPositions.count; i++) {
          const lx = leafPositions.getX(i), ly = leafPositions.getY(i), lz = leafPositions.getZ(i)
          const length = Math.hypot(lx, ly, lz)
          leafNormals.setXYZ(i, lx / length, ly / length, lz / length)
        }
        // Geometry is already non-indexed, with UVs, matching the imported assets.
        paletteUV(leaf, 0.18, 0.56 + random() * 0.1)
        leaf.scale(crownRadius * 0.66, height * (broadleaf ? 0.14 : 0.09), crownRadius * 0.56)
        leaf.rotateY(a)
        leaf.translate(x + Math.cos(a) * reach, height * (0.27 + t * 0.67), z + Math.sin(a) * reach)
        add(leaf)
      }
    }
    const tip = paletteUV(new IcosahedronGeometry(1, 0), 0.18, 0.56)
    tip.scale(height * 0.055, height * 0.13, height * 0.055)
    tip.translate(x, height * 0.95, z); add(tip)
  }
  const merged = mergeGeometries(pieces)
  for (const piece of pieces) piece.dispose()
  merged.setIndex(Array.from({ length: merged.attributes.position.count }, (_, i) => i))
  merged.computeBoundingBox(); merged.computeBoundingSphere()
  return merged
}
