# Resource data for the game

Browser saves use combined map format version **3**. JSON downloads now use the
[two-file export contract v1](paired-export-v1.md). They contain the solved
terrain, applied generation recipe, exact landscape placements, and a sampled
resource grid. Versions 1 and 2 still open; exporting an older map upgrades it
using its currently reconstructed landscape. Old files cannot recover original
placements that were never stored.

Use **Map workshop → Resources** to inspect wood, minerals, food or elevation.
Hover or tap a cell to see its values. This is a generator inspection tool;
city placement, influence circles, collection and overlapping city rules belong
in the consuming game.

## Resource grid

`resources` contains:

| Field | Meaning |
| --- | --- |
| `version` | Resource schema/rules algorithm version, currently 1 |
| `coordinates` | `world-xz-y-up`: horizontal X/Z, vertical Y |
| `origin` | `{x, z}` at the minimum corner of the grid |
| `cellSize` | Cell side length in scene world units; currently hex width / 8 (0.25) |
| `width`, `height` | Number of columns and rows in the bounding rectangle |
| `samplesPerCell` | 4, a 2×2 grid of sample centers within each cell |
| `yieldUnits` | `per-cell-per-tick` |
| `rules` | Yield densities and minimum fishing area used to generate this layer |
| `columns` | Names of the values in each cell row |
| `cells` | Sparse array of cell rows, ordered by row then column |

Cells use compact numeric rows to keep full-map exports practical:

```json
{
  "columns": ["column", "row", "elevation", "slope", "wood", "minerals", "food", "coverage"],
  "cells": [[42, 18, 1.4, 12.5, 0.03125, 0.015625, 0.011284, 1]]
}
```

The example is illustrative. Read `columns` rather than guessing array positions.
The center of a cell is:

```js
const x = resources.origin.x + (column + 0.5) * resources.cellSize
const z = resources.origin.z + (row + 0.5) * resources.cellSize
```

Elevation is the mean surface Y of valid samples, including rocks and mountains
but excluding tree canopy. Slope is the mean upward face angle in degrees (0 is
flat). Coverage is the fraction of the cell sampled inside the map: 0.25, 0.5,
0.75 or 1. Omitted cells are outside the sampled footprint, not empty farmland.

**Wood, minerals and food are already the entire cell's yield per game tick.**
Do not multiply them by cell area or coverage again. A game may multiply by the
fraction within a city's influence. The generator does not define tick duration,
depletion, ownership, seasons, building bonuses or shared-city collection rules.

## Landscape rules

- Tree canopy projection contributes wood and suppresses farming beneath it.
  Overlapping trees count once. Trees hidden below solid terrain do not contribute.
- Exposed stone contributes minerals. Steep grass faces transition to rocky
  ground between 16° and 46°, increasing minerals while reducing farming.
- Open grass contributes farming food, reduced by slope; farming reaches zero
  at 45°. Flat elevated plateaus can remain productive.
- Water is identified using the same authored mask as the rendered terrain.
  Connected water samples qualify for fishing at 12 square world units. A river
  connected to a qualifying lake or sea is part of that body; isolated smaller
  pools provide no fishing. The threshold considers only the exported map.
- Roads use equivalent unpaved terrain geometry. Buildings, bridges, flowers
  and water plants are excluded from sampling and do not reduce yields.
- Hills and mountains containing embedded trees use their surface materials to
  distinguish foliage, grass and stone.

Initial rates per square world unit per tick are wood 1, minerals 1, farming 1,
fishing 0.6. These are starter balance values in `RESOURCE_RULES`, not a claim of
gameplay balance. No minimum yield is guaranteed for individual regions.

Yields integrate four samples per cell and are rounded to six decimals. Finer
resolution improves boundary estimates without multiplying total yield; small
features below sample spacing may be missed. Vertical cliff faces have no
horizontal area, while sloped rock faces and mountain footprints do contribute.

## Exact landscape placements

`landscape` has `version: 1`, `assetVersion: 1` and
`matrixConvention: "three-column-major-local-to-grid"`. Each entry of
`landscape.grids` supplies the parent grid's `x`, `z`, world `offset: {x,z}`, and
an `instances` array. Each instance records:

- `kind`: trees, rocks, hills or mountains;
- `mesh`: the named geometry asset;
- `tile: {x,z}`: its owning tile's local grid indices;
- `matrix`: 16 numbers forming a column-major affine transform from asset
  coordinates into the parent grid's coordinates.

Transform an asset vertex by the matrix, then add the grid offset to X and Z.
Matrix indices 12, 13 and 14 contain local translation. Placements preserve scale,
rotation and position independently of animations or future random placement.
Restoring a version-3 save uses these placements and retains its exported yields.
Editing terrain or landscape invalidates the resource cache and rebuilds yields.

Geometry refers to this project's processed asset definitions, including the
procedural trees and detailed terrain—not necessarily the unmodified GLB meshes.
Port those definitions or bake their meshes for matching visuals in another
engine. Asset version 1 pins that interpretation; future incompatible geometry
changes must introduce an asset version/migration. Structures remain decorative
and are reconstructed by the existing seed/recipe mechanism.

Full-map exports use a sparse numeric grid to limit size. A checked 4,123-hex map
produced 229,074 resource cells, 980 landscape instances and an 8.6 MB JSON file.
The importer accepts files up to 64 MB and validates versions, dimensions,
numeric values, cell ordering, asset names and placement transforms before
mutating the scene.

## Verification

- All 26 Node tests pass, including mixed coverage, resolution-independent area
  yields, slope effects, connected-water fishing, road/building neutrality,
  negative coordinates, malformed imports, cache invalidation and placements
  independent of animation.
- The production build passes with the existing bundle-size and Sounds import
  warnings.
- Chrome/WebGPU checks on the full decorated fixture verified exact JSON
  export/import and IndexedDB save/reload, all 980 rendered placement matrices,
  canonical transforms through animation, and the shipped water mask's fishing
  output. No page errors or GPU validation warnings were observed.
- Desktop (1440×1000) and mobile (390×844) captures were inspected. Heatmaps,
  legends, totals and Close controls fit their dialogs. The first desktop pass
  clipped the lower controls; constraining the canvas while preserving its
  aspect ratio fixed that.
- Direct code review fixed legacy-version handling so unvalidated resource or
  landscape fields on version-1/2 documents are ignored. Independent Pi review
  was unavailable: the preferred provider had no configured model/key, and
  permission for the configured-default fallback was declined.
