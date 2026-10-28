import { readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

// The release ID describes the assets, so a later HEAD must not rewrite their provenance.
export async function preserveReleaseManifest(path, manifest) {
  try {
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
    return manifest
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const existing = JSON.parse(await readFile(path, 'utf8'))
  if (!isDeepStrictEqual(existing.assets, manifest.assets)) throw new Error(`Immutable manifest collision: ${path}`)
  return existing
}
