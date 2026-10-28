// Version 1 envelope validation; semantic payload validation lives in MapSnapshot.
export const RENDER_FORMAT = 'hex-map-wfc-render'
export const RESOURCES_FORMAT = 'hex-map-wfc-resources'
export const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function validateEnvelope(value, format) {
  if (!value || value.format !== format || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
      !isSha256(value.revision) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.generatorCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.generatorCommit)) {
    throw new Error('Invalid paired export envelope')
  }
}
export function validateAssetManifest(manifest) {
  if (manifest?.version !== 1 || !isSha256(manifest.release) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid asset manifest')
  const paths = new Set()
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !file.path.startsWith(`assets/releases/${manifest.release}/`) ||
        file.path.includes('..') || file.path.includes('\\') || paths.has(file.path) || !isSha256(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error('Invalid asset manifest file')
    paths.add(file.path)
  }
  for (const role of ['catalog', 'models', 'textures']) {
    if (!manifest.files.some(file => file.role === role)) throw new Error(`Missing asset role: ${role}`)
  }
}
