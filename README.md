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

## Map workshop

Use **Map workshop** at the top right to configure the next generation. Changing
controls leaves the displayed map untouched until you click **Generate**.

- Choose **Player count / map size**: 12 players use 19 regions (4,123 tiles),
  6 players use 10 regions (2,170 tiles), 3 players use 6 regions (1,302 tiles),
  and 2 players use 4 regions (868 tiles). Sizes round to complete regions.
- Six- and three-player maps default to a triangle and also offer a compact shape.
  Two-player maps default to a compact diamond and also offer a clipped triangle.
  The twelve-player footprint is a hexagon. Smaller maps solve only their
  selected regions; terrain, scenery, saves and resource exports use that footprint.
- Adjust lakes/coasts, elevation preference, slopes/cliffs, roads, rivers,
  trees, structures, mountain peaks, hills, rocks, flowers/bushes, and water plants.
- Amounts are relative to the original defaults (100%); **Off** excludes that
  category. Terrain constraints and per-region decoration limits still apply.
- Forest and settlement patch sizes control clustering independently of amount.
- **All structures: Off** removes buildings, windmills, rare structures and
  bridges, and excludes river-crossing tiles that would require bridges.
- **New seed** changes the pending seed without generating. Keeping the same
  seed and settings reproduces a generated map with the same version of the code.
- Mountains occupy eligible high ground and cliffs; raise elevation/ruggedness
  as well as peak amount for a more mountainous map. Trees and structures compete
  with peaks for space.

### Saving and reopening

Generated maps are **unsaved previews**. Enter a name and choose **Save as copy**
to keep one, or **Save changes** to replace the saved map you opened. You can
continue experimenting without adding every attempt to the library. A failed
generation restores the previous preview when one exists.

Saves contain the terrain, seed and the generation settings actually used for
the displayed map. Pending slider edits are never saved as that map’s recipe.
**Open** restores the saved map without solving again and restores its controls.
Reload opens the last saved/opened map; with no saves, choose settings and click
Generate to start. Older version-1 saves remain readable but have no recipe;
the workshop identifies them and offers defaults for subsequent generation.

**Export JSON** downloads the displayed map and its applied recipe. **Import
JSON** opens an unsaved preview; use Save as copy to keep it in the library.

Browser saves use IndexedDB and belong to the exact site address, including its
port. Clearing site data removes them. Export JSON for durable backups or to move
maps between browsers or machines. Storage errors keep the map in memory for
export. Camera, lighting and post-processing settings are not part of the recipe.
New version-3 saves preserve exact tree, rock, hill and mountain placements and
fine-grained wood, minerals, food, elevation and slope data. Use **Resources** in
the workshop to inspect the heatmaps. See [Resource export](docs/resource-export.md)
for the JSON schema, coordinate system and yield rules. Structures and other
non-resource decorations are still rebuilt from the seed and recipe; future
changes to graphical assets can change their appearance. Manual Build-mode edits preserve
terrain snapshots but are not reproduced by generating from the original recipe.

## Paired map exports

Export terrain/scenery and server-side resources as two paired JSON files. See
[the v1 contract, migration commands, assets and coordinate helpers](docs/paired-export-v1.md).
