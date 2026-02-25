# Notes

## WFC (Wave Function Collapse) Implementation

### Core Algorithm
1. Initialization: All cells start with ALL possible states (tile × 6 rotations × levels)
2. Collapse: Pick cell with lowest entropy (log(possibilities) + noise), randomly select weighted state
3. Propagate: Remove incompatible states from neighbors via edge matching
4. Repeat: Until all cells collapsed or contradiction detected
5. Recovery: On contradiction, backtrack (undo decisions and try alternative states)

### Edge Matching System
Each tile defines 6 edges (NE, E, SE, SW, W, NW) with types: `grass | road | river | ocean | coast`. Adjacent edges must match type AND level (except grass which allows any level). Slopes have `highEdges` array — edges facing uphill have `baseLevel + levelIncrement`.

All solved tiles are stored in a global `Map<cubeKey, cell>` (`HexMap.globalCells`). When expanding to a new grid, boundary matching uses soft fixed cells:

- **Fixed cells**: Solved tiles from neighboring grids used as read-only constraints
- **Soft fixed cells**: Fixed cells adjacent to the solve region that CAN be unfixed if they cause seeding contradictions. Each soft cell stores its original tile data and a list of anchor neighbors
- **Anchors**: When a soft cell is unfixed, its neighbors outside the solve set become new fixed cells, preserving compatibility with the original grid

### Backtracking
Trail-based delta backtracking (no full state copies):
- **Trail**: Array of `{ key, stateKey }` — records each possibility removed during propagation
- **Decision stack**: Each entry stores the collapsed cell, its previous possibilities, trail position, and tried states
- On contradiction: `undoLastDecision()` rewinds the trail, restores the cell, then retries with an excluded state
- If all states exhausted for a cell, pops the decision and backtracks further up the stack
- `maxBacktracks = 500`, full restart as fallback

### Soft Fixed Cells
When initial propagation from fixed cells causes a seeding contradiction:
1. Find soft fixed cells adjacent to the failed cell
2. Unfix the first candidate — remove from fixed, add to solve cells, add its anchors as new fixed cells
3. Full re-init with updated solve/fixed arrays, re-seed, re-propagate
4. Loop until seeding succeeds or no more soft cells to unfix
5. After WFC succeeds, compare unfixed cells against originals — changed tiles are sent back as `changedFixedCells` and updated in their source grids via `replaceTile()`

### Pre-WFC Validation (Disabled)
Previously checked fixed cells for conflicts before WFC. Disabled because it found false positives that caused cascading issues. The soft cell unfixing system handles these cases better.

### Persisted Unfixed Cells
When WFC fails and soft cells were unfixed during that attempt, those cells are persisted across retries:
- Removed from fixed cells, added to solve cells WITH their anchors as new fixed cells
- Ensures edge compatibility (either WFC succeeds with matching cells, or fails cleanly)
- After success, persisted-unfixed cells are compared against originals — changed tiles update source grids (orange labels)

### Retry Logic (Two Levels)

**Inner loop** (WFC worker, `wfc.worker.js`): Runs the core solve with backtracking (max 500 backtracks). On backtrack limit, does a full restart (re-init from scratch). `maxRestarts` controls restart count (currently 1 for grids with neighbors, 10 for first grid). Also handles soft fixed cell unfixing during seeding. Returns success or failure with two possible failure modes:
- **Neighbor contradiction**: Propagation from fixed/soft cells empties a cell's possibilities before the solve even starts
- **Backtrack limit**: Solver exhausted max backtracks during the main collapse loop

**Outer loop** (`_runWfcWithRecovery` in `HexMap.js`): When the inner loop fails, three recovery phases run in sequence. Each phase modifies neighbor grid tiles via a local mini-WFC or drops cells, then retries the main grid:

1. **Local-WFC — seed conflict** (max 3 attempts): Only triggers when the failure is a neighbor contradiction with a known source cell (`isSeedConflict && sourceKey`). Centers the mini-WFC on the specific neighbor cell that caused the contradiction. Same center is retried each attempt since the local-WFC changes the surrounding region.
2. **Local-WFC — general** (max 5 attempts): Triggers for any failure type. Centers the mini-WFC on the nearest fixed cell to the failure point. Each attempt tries the next nearest fixed cell not yet attempted.
3. **Drop phase** (unbounded): Last resort fallback. Drops fixed cells one by one nearest the failure point, placing mountains to hide mismatches.

### Local-WFC Recovery
Both Local-WFC phases use the same pattern: run a mini-WFC solve on a radius-2 region around a center cell in a neighbor grid (`maxRestarts: 3-5`, `quiet: true`). Apply results to source grids via `applyTileResultsToGrids()`, update `globalCells`, rebuild the main grid's fixed cells and anchor map, clear persisted unfixed state, then retry the main grid solve. Falls through to the next phase if all attempts fail.

### Build All
`populateAllGrids()` creates all 19 grids upfront, collects all cells, and runs a single WFC pass with zero fixed cells. No soft cells or fallbacks needed — just one big solve relying on backtracking.

### Future Improvements

#### Sub-Complete Tileset
From the [N-WFC paper](https://ar5iv.labs.arxiv.org/html/2308.07307). Design the tileset so that for any valid edge configuration on one side of a cell, at least one tile exists that satisfies it regardless of what the other 5 edges require. This guarantees WFC never contradicts. Requires auditing every edge type at boundaries (road, river, coast, ocean, grass at each level) and adding "bridge" or "transition" tiles where gaps exist. Harder for hex grids (6 edges) than square grids.

#### Driven WFC (Noise-Based Pre-Constraints)
[Townscaper-style](https://www.boristhebrave.com/2021/06/06/driven-wavefunctioncollapse/). Use continuous world noise fields to pre-determine tile categories (water, mountain, flat grass, etc.) before WFC runs. WFC only picks among variants within that category. Cross-grid boundaries become trivial because noise is continuous and doesn't care about grid edges. WFC becomes more of a detail pass than a generator.

## Seeded RNG

`SeededRandom.js` exposes `setSeed(n)` and `random()`. A single seed is set once at startup in `Demo.js`. After that, every call to `random()` returns the next number in the deterministic sequence — there is no re-seeding.

The WFC worker runs in a separate thread with its own copy of `SeededRandom.js` (Web Workers have independent module scope). The seed is passed to the worker once via `{ type: 'init', seed }` message in `initWfcWorker()`. After that, the worker's RNG advances naturally across all solves.

**Never re-seed the worker per solve** — that resets the sequence to position 0 and causes identical random choices across solves, making retries and click-resolve produce the same output.

## Naming Conventions

### Hex Grid System
- HexMap — The entire world, manages multiple Grids (`src/HexMap.js`)
- HexGrid — A hexagonal grid of hex cells, one WFC solve = one Grid (`src/HexGrid.js`)
- GridHelper — Visual overlay (lines + dots) for a grid (`src/HexGridHelper.js`)
- Placeholder — Clickable hexagonal button to expand into adjacent grid slot (`src/Placeholder.js`)
- Cell — A position in the grid that can hold a Tile
- Tile — The actual mesh placed in a Cell (`src/HexTiles.js`)
- Fixed Cell — A solved tile from a neighboring grid used as a read-only constraint during WFC
- Soft Fixed Cell — A fixed cell adjacent to the solve region that can be unfixed if it causes a seeding contradiction
- Anchor — A neighbor of a soft fixed cell that becomes a new fixed constraint when the soft cell is unfixed
- RNG Seed — The number that initializes the random number generator (global)

## Map Dimensions

The hex map is 19 grids arranged in 2 rings around a central grid (hex radius 2).

Each grid is a hex with cell radius 8 → diameter 17 cells → **217 cells per grid**.
Total: 19 × 217 = **4,123 cells** (minus shared boundary cells used as fixed constraints).

Grid centers are spaced 17 cells apart in cube coords (2R+1). Max cell distance from map center: grid ring 2 center (34) + cell radius (8) = **42 cells** hex radius.

### World Units
- `HEX_WIDTH` = 2, `HEX_HEIGHT` = 2/√3 × 2 ≈ 2.309
- Map is hexagonal — radius ≈ 42 × 2 ≈ **84 WU** from center to edge

### Tile Surface Heights
- Land (grass, road, cliff): **1.0 WU** above tile base
- River / Coast: **0.9 WU** above tile base
- Ocean (WATER): **0.8 WU** above tile base

## Coordinate Systems

### Blender (Z-up)
- +X = East, +Y = North, +Z = Up

### Three.js / App (Y-up)
- +X = East, +Y = Up, +Z = South (-Z = North)

### glTF Export Transform ("+Y Up" checked)
| Blender | Three.js |
|---------|----------|
| +X | +X (East) |
| +Y | -Z (North) |
| +Z | +Y (Up) |

### Hex Orientation
- Cells/Tiles: Pointy-top (pointy vertices face ±Z North/South, flat edges face ±X East/West)
- HexGrids: Flat-top (flat edges face ±Z North/South, pointy vertices face ±X East/West)

### Hex Coordinate Systems

Cube/Axial Coordinates (q, r, s where s = -q-r) — PRIMARY
- Used for: WFC solver, global cell map, cross-grid references, distance/neighbor calculations
- Hex distance = max(|q|, |r|, |s|)
- Neighbors: addition via CUBE_DIRS (no row parity needed)

Offset Coordinates (col, row)
- Used for: rendering positions, local grid tile placement
- Row parity affects neighbor calculations

Conversion (pointy-top odd-row offset):
- Offset → Axial: `q = col - floor(row/2)`, `r = row`
- Axial → Offset: `col = q + floor(r/2)`, `row = r`

### Scale
- Blender: Tiles are 2m on X, 2.31m on Y, 1m on Z
- App: 1:1 scale, hex tile is 2 WU wide on X axis

## Debug Label Colors
- Purple = Neighbor contradiction (0 possibilities during initial propagation from fixed cells)
- Orange = Replaced fixed cell (soft cell change or persisted-unfixed cell change)
- Red = Dropped fixed cell (mountain placed to hide mismatch)

## Fragile Code

Code that depends on Three.js internals or specific behavior that could break on upgrades.

### Tree Wind Sway (`HexMap.js` — `setupPosition` override)
The tree material overrides `setupPosition()` and replicates Three.js `BatchNode` internals: reads `_indirectTexture` and `_matricesTexture` via `textureLoad` to reconstruct the per-instance `batchingMatrix`, applies the batch transform manually, then adds wind sway displacement in post-batch world space. This is necessary because `positionNode` runs pre-batch in local space — sway would rotate per-instance. If Three.js changes how `BatchedMesh` stores instance matrices (texture format, lookup logic, field names), this will break. ~30 lines of BatchNode replication.

### setupDiffuseColor Override (`HexMap.js`)
Both `roadMaterial` and `treeMaterial` override `setupDiffuseColor` to skip BatchedMesh's automatic instance color multiply into diffuse. We read `vBatchColor` ourselves for level data. If Three.js changes how batch colors are composited, the override may need updating.

### Water Mask Material (`HexMap.js` / `PostFX.js`)
The `waterMaskMaterial` (MeshBasicNodeMaterial) borrows the same `setupDiffuseColor` override. It's swapped onto BatchedMeshes each frame for the mask render pass. Depends on material swapping working correctly with BatchedMesh shader caching.

## References

### Tech / WFC
- [Red Blob Games - Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/)
- [mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)
- [Boris the Brave - MiB](https://www.boristhebrave.com/2021/10/26/model-synthesis-and-modifying-in-blocks/)
- [Boris the Brave - Infinite MiB](https://www.boristhebrave.com/2021/11/08/infinite-modifying-in-blocks/)
- https://observablehq.com/@sanderevers/hexagon-tiling-of-an-hexagonal-grid

### Game Refs
- Dorf Romantik, Bad North (style refs)
interactive like  https://robot.co/playground/grid
ui and walk around like:https://mesq.me/infinite-terrain/
Tiny Glade
dorfromantik 
https://www.youtube.com/watch?v=aYz2oHxCQrw&t=69s
https://www.youtube.com/watch?v=5Qs9i-y0vbE&t=61s

### Asset packs
https://www.cgtrader.com/3d-models/exterior/street-exterior/city-downtown-skyscraper-street-mountain-landscape-17-day
https://assetstore.unity.com/packages/3d/environments/urban/lowpoly-city-vol-2-skyscrapers-138089?srsltid=AfmBOoqo9jo8xKtAOXG_X7LR8p_yzlbXIr9ZzAeXuQebpOXL047mgD8Q
https://sketchfab.com/MRowa

### Misc
https://bsky.app/profile/d6learning.bsky.social/post/3mdic5ewwhs2r
https://x.com/5tr4n0/status/2014340948818358575
https://x.com/SamuelLundsten/status/2015772374348464286
https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/
https://github.com/ULuIQ12/codrops-batchedmesh?tab=readme-ov-file
https://x.com/creativedash/status/2014275193108410859
https://threejs.org/examples/webgpu_postprocessing_ao.html
https://sbcode.net/tsl/ambient-occlusion/
