/**
 * Inspect GLB file — lists all nodes, meshes, and materials
 * No Three.js needed, parses raw GLTF JSON from the GLB binary
 *
 * Run: node tools/inspect-glb.js [filter]
 * Examples:
 *   node tools/inspect-glb.js            — show all meshes
 *   node tools/inspect-glb.js river      — only nodes/meshes matching "river"
 */

import fs from 'fs'
const path = './public/assets/models/hex-terrain.glb'

const filter = process.argv[2]?.toLowerCase()

const buf = fs.readFileSync(path)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))

const nodes = json.nodes || []
const meshes = json.meshes || []
const materials = json.materials || []
const accessors = json.accessors || []

console.log(`GLB: ${path}`)
console.log(`Nodes: ${nodes.length}, Meshes: ${meshes.length}, Materials: ${materials.length}`)
console.log()

// Show all mesh nodes
console.log('MESH NODES:')
console.log('-'.repeat(80))

for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i]
  if (node.mesh === undefined) continue
  if (filter && !node.name.toLowerCase().includes(filter)) continue

  const mesh = meshes[node.mesh]
  const prims = mesh.primitives.length
  const meshName = mesh.name

  // Count vertices from first primitive
  let verts = '?'
  if (mesh.primitives[0]?.attributes?.POSITION !== undefined) {
    const acc = accessors[mesh.primitives[0].attributes.POSITION]
    verts = acc?.count ?? '?'
  }

  // Material names
  const matNames = mesh.primitives.map(p =>
    p.material !== undefined ? (materials[p.material]?.name || `mat_${p.material}`) : 'none'
  )

  // Check attributes
  const attrs = Object.keys(mesh.primitives[0]?.attributes || {})
  const hasColors = attrs.some(a => a.startsWith('COLOR'))
  const hasUVs = attrs.some(a => a.startsWith('TEXCOORD'))

  const nameMatch = node.name === meshName ? '' : ` (mesh data: "${meshName}")`
  const primsStr = prims > 1 ? ` [${prims} primitives!]` : ''

  console.log(`  ${node.name}${nameMatch}${primsStr}`)
  console.log(`    verts: ${verts}, materials: ${matNames.join(', ')}, colors: ${hasColors}, uvs: ${hasUVs}`)
}

console.log()
console.log(`Total mesh nodes: ${nodes.filter(n => n.mesh !== undefined).length}`)
