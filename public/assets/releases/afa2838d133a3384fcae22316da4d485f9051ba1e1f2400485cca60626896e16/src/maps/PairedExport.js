import { decodeMapSnapshot } from './MapSnapshot.js'
import { validateResourceGrid } from './ResourceValidation.js'
import { RENDER_FORMAT, RESOURCES_FORMAT, validateEnvelope, validateAssetManifest } from './ExportContract.js'

export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`
}
export async function sha256(bytes) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('')
}
const renderFields = ['name', 'seed', 'radius', 'grids', 'waterSideIndex', 'generationSettings', 'tiles', 'landscape']
function payload(snapshot, assets) {
  return { ...Object.fromEntries(renderFields.map(key => [key, snapshot[key]])), assets }
}

// Clone before the first await: both documents always represent one resolved snapshot.
export async function splitMapSnapshot(snapshot, { assets, generatorCommit }) {
  const source = structuredClone(snapshot)
  const manifest = structuredClone(assets)
  if (source.format !== 'hex-map-wfc' || source.version !== 3) throw new Error('Lossless conversion requires a resolved version-3 combined map')
  decodeMapSnapshot(source)
  validateAssetManifest(manifest)
  const visual = payload(source, manifest)
  const revision = await sha256(canonicalJSON({ id: source.id, createdAt: source.createdAt, visual, resources: source.resources, generatorCommit }))
  const common = { id: source.id, revision, createdAt: source.createdAt, generatorCommit }
  const render = { format: RENDER_FORMAT, version: 1, ...common, ...visual }
  validateEnvelope(render, RENDER_FORMAT)
  const renderText = JSON.stringify(render)
  const resources = { format: RESOURCES_FORMAT, version: 1, ...common, renderSha256: await sha256(renderText), resources: source.resources }
  const resourcesText = JSON.stringify(resources)
  const basename = `map-${source.id}-${revision}`
  return { render, resources, renderText, resourcesText, renderFilename: `${basename}.render.json`, resourcesFilename: `${basename}.resources.json` }
}

// Pass original bytes, never JSON.stringify(JSON.parse(bytes)): whitespace is hashed.
export async function validateExportPair(renderBytes, resourcesBytes) {
  const decode = bytes => JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const render = decode(renderBytes), resources = decode(resourcesBytes)
  decodeMapSnapshot(render)
  validateEnvelope(resources, RESOURCES_FORMAT)
  const allowed = new Set(['format', 'version', 'id', 'revision', 'createdAt', 'generatorCommit', 'renderSha256', 'resources'])
  if (Object.keys(resources).some(key => !allowed.has(key))) throw new Error('Unexpected resources envelope field')
  for (const key of ['id', 'revision', 'createdAt', 'generatorCommit']) {
    if (render[key] !== resources[key]) throw new Error(`Export pair mismatch: ${key}`)
  }
  if (await sha256(renderBytes) !== resources.renderSha256) throw new Error('Render SHA-256 mismatch')
  validateResourceGrid(resources.resources)
  const revision = await sha256(canonicalJSON({ id: render.id, createdAt: render.createdAt, visual: payload(render, render.assets), resources: resources.resources, generatorCommit: render.generatorCommit }))
  if (revision !== render.revision) throw new Error('Export revision mismatch')
  return { render, resources }
}
export async function combineExportPair(renderBytes, resourcesBytes) {
  const { render, resources } = await validateExportPair(renderBytes, resourcesBytes)
  const { assets, revision, generatorCommit, ...snapshot } = render
  return { ...snapshot, format: 'hex-map-wfc', version: 3, resources: resources.resources }
}
