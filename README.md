# Hex Map WFC

Procedural medieval island worlds from 4,100 hex tiles, built with WebGPU and a lot of backtracking.

[Live Demo](https://felixturner.github.io/hex-map-wfc/) | [Read the Article](https://felixturner.github.io/hex-map-wfc/article/)

![Screenshot](docs/article/img/hero.jpg)

## Features

- **Modular Wave Function Collapse** — 19 hexagonal grids solved independently with cross-grid constraint matching
- **Layered Recovery System** — unfixing, Local-WFC, and mountain fallbacks for 100% solve rate
- **30 Hex Tile Types** — 6 rotations and 5 elevation levels each (900 states per cell)
- **WebGPU Rendering** — Three.js with TSL shaders for all custom visual effects
- **BatchedMesh Optimization** — 4,100+ cells in ~38 draw calls, 60fps on desktop and mobile
- **Post-Processing Stack** — GTAO ambient occlusion, depth of field, vignette, and film grain
- **Dynamic Shadow Maps** — frustum fitted to camera view for crisp shadows at any zoom
- **Animated Water** — caustic sparkles and coastal waves with cove-aware thinning
- **Noise-Based Placement** — Perlin noise for organic tree, building, and decoration clustering
- **Seeded RNG** — deterministic, reproducible maps from any seed

## Getting Started

The modular natural-terrain upgrade and its before/after preview are documented
in [Natural terrain](docs/natural-look/README.md).

```bash
npm install
npm run dev
npm run build
```

## License

[MIT](LICENSE)

## Credits

- [KayKit Medieval Hexagon Pack](https://kaylousberg.itch.io/kaykit-medieval-hexagon) — tile assets
- [Maxim Gumin's WFC](https://github.com/mxgmn/WaveFunctionCollapse) — original Wave Function Collapse
- [Red Blob Games — Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) — hex grid reference

## Saved maps

Successful full-map solves are automatically saved to IndexedDB in the current
browser, before their visuals are built. Reloading (including Vite reloads after
code edits) opens the last saved/opened map without running WFC again.

Use the **Saved maps** controls at the bottom right:

- Select a map and click **Open** to revisit it.
- **Save current** creates a separate snapshot of the currently populated grids.
- **Export JSON** downloads the selected save; **Import JSON** opens and saves a
  copy of an exported map. Export maps you want to keep as durable backups.
- **New map** attempts a fresh generation and retains previous saves if it fails.

Saves contain versioned terrain data (tile names, coordinates, rotations,
elevations, grid layout, and seed), independent of materials and geometry.
Loading still builds meshes and decorations using the current graphical code,
but skips the expensive constraint solver. Visual settings and camera position
are not saved; procedural decorations are rebuilt and may change with code or
settings. Failed or incomplete full-map solves do not replace saved maps.

Browser saves belong to the exact site address, including its port, and are lost
if site data is cleared. Use JSON export/import to move maps between addresses,
browsers, or machines. If browser storage fails, the controls report the problem
and keep the solved map available for export for the current session.
