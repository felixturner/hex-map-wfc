import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BufferGeometry, BufferAttribute } from 'three/webgpu'
import { detailTerrain, createTreeGeometry } from '../src/hexmap/NaturalGeometry.js'
import { TILE_LIST } from '../src/hexmap/HexTileData.js'
import { TreeMeshNames } from '../src/hexmap/DecorationDefs.js'
import { setSeed, random } from '../src/SeededRandom.js'

// Read the actual shipped asset buffers without requiring a browser image loader.
const glb = readFileSync(new URL('../public/assets/models/hex-terrain.glb', import.meta.url))
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength))
const binaryOffset = 28 + jsonLength
function attribute(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView]
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type]
  const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[accessor.componentType]
  assert.equal(view.byteStride, undefined, 'fixture reader expects tightly packed GLB buffers')
  const values = new Type(glb.buffer, glb.byteOffset + binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0), accessor.count * size)
  return new BufferAttribute(values.slice(), size)
}
function geometry(name) {
  const node = gltf.nodes.find(n => n.name === name)
  const primitive = gltf.meshes[node.mesh].primitives[0]
  const result = new BufferGeometry()
  result.setAttribute('position', attribute(primitive.attributes.POSITION))
  result.setAttribute('normal', attribute(primitive.attributes.NORMAL))
  result.setAttribute('uv', attribute(primitive.attributes.TEXCOORD_0))
  result.setIndex(attribute(primitive.indices))
  result.translate(0, 1, 0)
  return result
}
const key = (p, i) => [p.getX(i), p.getY(i), p.getZ(i)].map(n => n.toFixed(5)).join(',')
const onBoundary = (p, i) => Math.max(Math.abs(p.getX(i)), Math.abs(p.getX(i)) * 0.5 + Math.abs(p.getZ(i)) * Math.sqrt(3) / 2) > 0.9999

test('every modular tile keeps its authored connection vertices and dimensions', () => {
  for (const name of new Set([...TILE_LIST.map(t => t.mesh), 'hex_grass_bottom'])) {
    const source = geometry(name), result = detailTerrain(source, name)
    const p = source.attributes.position, q = result.attributes.position
    const candidate = new Set(Array.from({ length: q.count }, (_, i) => key(q, i)))
    for (let i = 0; i < p.count; i++) if (onBoundary(p, i)) assert.ok(candidate.has(key(p, i)), `${name}: changed connection ${key(p, i)}`)
    for (const attr of Object.values(result.attributes)) assert.ok(attr.array.every(Number.isFinite), `${name}: nonfinite attribute`)
    source.computeBoundingBox(); result.computeBoundingBox()
    assert.equal(result.boundingBox.min.x, source.boundingBox.min.x, name)
    assert.equal(result.boundingBox.max.x, source.boundingBox.max.x, name)
    assert.equal(result.boundingBox.min.z, source.boundingBox.min.z, name)
    assert.equal(result.boundingBox.max.z, source.boundingBox.max.z, name)
    assert.ok(result.index, `${name}: must remain compatible with indexed batching`)
    source.dispose(); result.dispose()
  }
})

test('replacement tree assets are repeatable, bounded, and do not consume the map RNG', () => {
  setSeed(174); const expected = random(); setSeed(174)
  for (const name of TreeMeshNames) {
    const a = createTreeGeometry(name), b = createTreeGeometry(name)
    assert.deepEqual(a.attributes.position.array, b.attributes.position.array, name)
    assert.ok(a.boundingBox.min.y >= -1e-6, name)
    assert.ok(a.boundingBox.max.y < 1.6, name)
    assert.ok(a.boundingBox.min.x >= -1 && a.boundingBox.max.x <= 1, name)
    assert.ok(a.boundingBox.min.z >= -1.15 && a.boundingBox.max.z <= 1.15, name)
    assert.deepEqual(Object.keys(a.attributes).sort(), ['normal', 'position', 'uv'])
    assert.ok(a.index)
    a.dispose(); b.dispose()
  }
  assert.equal(random(), expected)
})
