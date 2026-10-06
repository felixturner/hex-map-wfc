// An inspection tool for the generator, with no city or collection mechanics.
export function showResourcePreview(resources) {
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-label', 'Map resources')
  dialog.style.cssText = 'width:min(760px,90vw);max-height:90vh;overflow:auto;background:#17221e;color:#f2f5ed;border:1px solid #6f8678;border-radius:12px;padding:20px;font:14px system-ui;'
  dialog.innerHTML = `<h2 style="margin-top:0">Map resources</h2>
    <p>Top-down view. Brighter cells produce more. Hover or tap to inspect a cell.</p>
    <label>Show <select aria-label="Resource layer"><option value="4">Wood</option><option value="5">Minerals</option><option value="6">Food</option><option value="2">Elevation</option></select></label>
    <span class="legend"></span>
    <canvas aria-label="Resource heatmap" style="display:block;height:auto;image-rendering:pixelated;margin:12px auto;background:#0b1210"></canvas>
    <p class="details" style="min-height:3em" aria-live="polite">Select a cell to see all three yields.</p>
    <p class="totals"></p><button type="button">Close</button>`
  const canvas = dialog.querySelector('canvas'), select = dialog.querySelector('select')
  canvas.width = resources.width; canvas.height = resources.height
  // Fit both axes without letterboxing, keeping pointer coordinates exact.
  canvas.style.width = `min(100%, ${55 * resources.width / resources.height}vh)`
  const lookup = new Map(resources.cells.map(cell => [cell[1] * resources.width + cell[0], cell]))
  const totals = [4, 5, 6].map(index => resources.cells.reduce((sum, cell) => sum + cell[index], 0))
  dialog.querySelector('.totals').textContent = `${resources.cells.length.toLocaleString()} cells · ${resources.cellSize.toFixed(3)} world units per side. Total yields per tick: wood ${totals[0].toFixed(2)}, minerals ${totals[1].toFixed(2)}, food ${totals[2].toFixed(2)}.`
  const draw = () => {
    const channel = Number(select.value), ctx = canvas.getContext('2d')
    const pixels = ctx.createImageData(resources.width, resources.height)
    let max = 0
    for (const cell of resources.cells) max = Math.max(max, cell[channel])
    const color = channel === 4 ? [97, 211, 125] : channel === 5 ? [183, 175, 225] : channel === 6 ? [250, 207, 86] : [210, 228, 238]
    for (const cell of resources.cells) {
      const offset = (cell[1] * resources.width + cell[0]) * 4
      const strength = max ? Math.max(0, cell[channel]) / max : 0
      for (let c = 0; c < 3; c++) pixels.data[offset + c] = 20 + strength * (color[c] - 20)
      pixels.data[offset + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
    dialog.querySelector('.legend').textContent = ` · Dark: 0 · Bright: ${max.toFixed(4)} ${channel === 2 ? 'world units' : 'per cell per tick'}`
  }
  const inspect = event => {
    const rect = canvas.getBoundingClientRect()
    const col = Math.floor((event.clientX - rect.left) / rect.width * resources.width)
    const row = Math.floor((event.clientY - rect.top) / rect.height * resources.height)
    const cell = lookup.get(row * resources.width + col)
    dialog.querySelector('.details').textContent = cell
      ? `Cell (${col}, ${row}) · Wood ${cell[4]} · Minerals ${cell[5]} · Food ${cell[6]} per tick. Elevation ${cell[2]}, slope ${cell[3].toFixed(1)}°, map coverage ${cell[7] * 100}%.`
      : 'Outside the map.'
  }
  canvas.addEventListener('pointermove', inspect)
  canvas.addEventListener('pointerdown', inspect)
  select.addEventListener('change', draw)
  dialog.querySelector('button').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => dialog.remove())
  for (const event of ['pointerdown', 'pointerup', 'click', 'wheel']) dialog.addEventListener(event, e => e.stopPropagation())
  document.body.append(dialog)
  draw(); dialog.showModal()
}
