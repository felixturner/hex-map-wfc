import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preserveReleaseManifest } from '../tools/release-manifest.js'

test('existing release manifests retain their original commit and reject collisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-manifest-'))
  const path = join(dir, 'manifest.json')
  const original = { generatorCommit: 'old', assets: { release: 'release-id', files: [] } }
  try {
    assert.deepEqual(await preserveReleaseManifest(path, original), original)
    const bytes = await readFile(path, 'utf8')
    assert.deepEqual(await preserveReleaseManifest(path, { ...original, generatorCommit: 'new' }), original)
    assert.equal(await readFile(path, 'utf8'), bytes)
    await assert.rejects(preserveReleaseManifest(path, { ...original, assets: { release: 'different', files: [] } }), /collision/)
    assert.equal(await readFile(path, 'utf8'), bytes)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
