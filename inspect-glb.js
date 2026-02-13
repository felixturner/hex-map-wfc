// Script to inspect GLB file contents
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import fs from 'fs'

// Read the GLB file
const glbPath = './public/assets/models/hex-terrain.glb'
const buffer = fs.readFileSync(glbPath)
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

// Parse using three.js GLTFLoader
const loader = new GLTFLoader()
loader.parse(arrayBuffer, '', (gltf) => {
  console.log('=== GLB Contents ===\n')
  console.log(`File: ${glbPath}\n`)

  const meshes = []
  const materialMap = new Map()

  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      const geo = child.geometry
      geo.computeBoundingBox()
      const box = geo.boundingBox
      const size = {
        x: (box.max.x - box.min.x).toFixed(3),
        y: (box.max.y - box.min.y).toFixed(3),
        z: (box.max.z - box.min.z).toFixed(3)
      }

      // Check geometry attributes
      const attributes = Object.keys(geo.attributes)
      const hasVertexColors = attributes.includes('color')
      const hasUVs = attributes.includes('uv')

      meshes.push({
        name: child.name,
        vertices: geo.attributes.position.count,
        size: size,
        material: child.material?.name || 'unnamed',
        hasVertexColors,
        hasUVs,
        attributes
      })

      // Collect material details
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach(mat => {
        if (mat && !materialMap.has(mat.name || 'unnamed')) {
          materialMap.set(mat.name || 'unnamed', mat)
        }
      })
    }
  })

  console.log('MESHES:')
  console.log('-------')
  meshes.forEach(m => {
    console.log(`  ${m.name}`)
    console.log(`    size: ${m.size.x} x ${m.size.y} x ${m.size.z}`)
    console.log(`    vertices: ${m.vertices}`)
    console.log(`    material: ${m.material}`)
    console.log(`    hasVertexColors: ${m.hasVertexColors}`)
    console.log(`    hasUVs: ${m.hasUVs}`)
    console.log(`    attributes: ${m.attributes.join(', ')}`)
    console.log('')
  })

  console.log('\nMATERIALS:')
  console.log('----------')
  materialMap.forEach((mat, name) => {
    console.log(`\n  ${name} (${mat.type})`)
    console.log(`    color: ${mat.color ? '#' + mat.color.getHexString() : 'none'}`)
    console.log(`    vertexColors: ${mat.vertexColors}`)

    // Check all texture maps
    const textureMaps = [
      'map', 'normalMap', 'aoMap', 'emissiveMap', 'metalnessMap',
      'roughnessMap', 'bumpMap', 'displacementMap', 'alphaMap'
    ]

    const foundTextures = []
    textureMaps.forEach(mapName => {
      if (mat[mapName]) {
        const tex = mat[mapName]
        foundTextures.push({
          name: mapName,
          image: tex.image ? `${tex.image.width}x${tex.image.height}` : 'no image',
          uuid: tex.uuid?.slice(0, 8)
        })
      }
    })

    if (foundTextures.length > 0) {
      console.log(`    textures:`)
      foundTextures.forEach(t => {
        console.log(`      - ${t.name}: ${t.image} (${t.uuid})`)
      })
    } else {
      console.log(`    textures: none`)
    }

    // PBR properties
    if (mat.metalness !== undefined) console.log(`    metalness: ${mat.metalness}`)
    if (mat.roughness !== undefined) console.log(`    roughness: ${mat.roughness}`)
    if (mat.aoMapIntensity !== undefined && mat.aoMap) console.log(`    aoMapIntensity: ${mat.aoMapIntensity}`)
  })

  console.log(`\n\nTotal meshes: ${meshes.length}`)
  console.log(`Total materials: ${materialMap.size}`)
}, (error) => {
  console.error('Error parsing GLB:', error)
})
