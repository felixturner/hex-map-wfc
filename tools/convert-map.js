import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { splitMapSnapshot, validateExportPair } from '../src/maps/PairedExport.js'
const [input, output, releasePath = 'src/maps/AssetRelease.json'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node tools/convert-map.js combined-v3.json output-directory [matching-release.json]')
const snapshot = JSON.parse(await readFile(input, 'utf8'))
const release = JSON.parse(await readFile(releasePath, 'utf8'))
const pair = await splitMapSnapshot(snapshot, release)
await validateExportPair(pair.renderText, pair.resourcesText)
await mkdir(output, { recursive: true })
for (const [filename, text] of [[pair.renderFilename, pair.renderText], [pair.resourcesFilename, pair.resourcesText]]) {
  await writeFile(join(output, filename), text, { flag: 'wx' })
  console.log(resolve(output, filename))
}
