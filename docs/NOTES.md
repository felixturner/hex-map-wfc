# Notes

## WFC (Wave Function Collapse) Implementation

### Core Algorithm
1. Initialization: All cells start with ALL possible states (tile × 6 rotations × levels)
2. Collapse: Pick cell with lowest entropy (log(possibilities) + noise), randomly select weighted state
3. Propagate: Remove incompatible states from neighbors via edge matching
4. Repeat: Until all cells collapsed or conflict detected
5. Recovery: On conflict, backtrack (undo decisions and try alternative states)

### Edge Matching System
Each tile defines 6 edges (NE, E, SE, SW, W, NW) with types: `grass | road | river | ocean | coast`. Adjacent edges must match type AND level (except grass which allows any level). Slopes have `highEdges` array — edges facing uphill have `baseLevel + levelIncrement`.

All solved tiles are stored in a global `Map<cubeKey, cell>` (`HexMap.globalCells`). When expanding to a new grid, boundary matching uses neighbor cells:

- **Fixed cells**: Solved tiles from neighboring grids used as read-only constraints
- **Neighbor cells**: Fixed cells adjacent to the solve region that CAN be unfixed if they cause neighbor conflicts. Each neighbor cell stores its original tile data and a list of anchor neighbors
- **Anchors**: When a neighbor cell is unfixed, its neighbors outside the solve set become new fixed cells, preserving compatibility with the original grid

### Backtracking
Trail-based delta backtracking (no full state copies):
- **Trail**: Array of `{ key, stateKey }` — records each possibility removed during propagation
- **Decision stack**: Each entry stores the collapsed cell, its previous possibilities, trail position, and tried states
- On conflict: `undoLastDecision()` rewinds the trail, restores the cell, then retries with an excluded state
- If all states exhausted for a cell, pops the decision and backtracks further up the stack
- `maxBacktracks = 500`, full restart as fallback

### Neighbor Cells
When initial propagation from fixed cells causes a neighbor conflict:
1. Find neighbor cells adjacent to the failed cell
2. Unfix the first candidate — remove from fixed, add to solve cells, add its anchors as new fixed cells
3. Full re-init with updated solve/fixed arrays, re-propagate from fixed cells
4. Loop until seeding succeeds or no more neighbor cells to unfix
5. After WFC succeeds, compare unfixed cells against originals — changed tiles are sent back as `changedFixedCells` and updated in their source grids via `replaceTile()`

### Persisted Unfixed Cells
When WFC fails and neighbor cells were unfixed during that attempt, those cells are persisted across retries:
- Removed from fixed cells, added to solve cells WITH their anchors as new fixed cells
- Ensures edge compatibility (either WFC succeeds with matching cells, or fails cleanly)
- After success, persisted-unfixed cells are compared against originals — changed tiles update source grids (orange labels)

### Retry Logic (Two Levels)

**Inner loop** (WFC worker, `wfc.worker.js`): Runs the core solve with backtracking (max 500 backtracks). On backtrack limit, does a full restart (re-init from scratch). `maxTries` controls how many times the solver attempts from scratch (2 for grid solves, 5 for local-WFC, rebuild-wfc, and Build All). Also handles neighbor cell unfixing during initial propagation from fixed/neighbor cells. Returns success or failure with two possible failure modes:
- **Neighbor conflict** (`neighborConflict`): Propagation from fixed/neighbor cells empties a cell's possibilities during initial propagation from fixed/neighbor cells, before the main collapse loop starts. Reports the failed cell and the `sourceKey` of the fixed cell whose propagation caused it.
- **Solve conflict** (`lastConflict`): Solver exhausted max backtracks during the main collapse loop. Reports the failed cell and source cell from the final conflict.

Both failure types provide `failedCell` and `sourceKey` to the outer loop. `WFCManager.runWfcAttempt()` sets `isNeighborConflict: true` for neighbor conflicts so the outer loop can distinguish them.

**Outer loop** (`_runWfcWithRecovery` in `HexMap.js`): When the inner loop fails, two recovery phases run in sequence. Each phase modifies neighbor grid tiles via a local mini-WFC or drops cells, then retries the main grid:

1. **Local-WFC** (max 8 attempts): Runs a mini-WFC solve on a radius-2 region around a center cell in a neighbor grid (`maxRestarts: 5`, `quiet: true`). Center selection depends on failure type:
   - **Neighbor conflict** (first attempt): centers on `sourceKey` — the specific fixed cell that caused the conflict
   - **All other attempts**: picks the nearest fixed cell to `failedCell` not yet tried (via `resolvedRegions` set)
   Applies results to source grids via `applyTileResultsToGrids()`, updates `globalCells`, rebuilds the main grid's fixed cells and anchor map, clears persisted unfixed state, then retries the main grid solve. On local-WFC failure, continues to the next candidate center.
2. **Drop phase** (unbounded): Last resort fallback. Drops fixed cells one by one nearest the failure point, placing mountains to hide mismatches.

### Build All
`populateAllGrids()` creates all 19 grids upfront, collects all cells, and runs a single WFC pass with zero fixed cells. No neighbor cells or fallbacks needed — just one big solve relying on backtracking.

## Seeded RNG

`SeededRandom.js` exposes `setSeed(n)` and `random()`. A single seed is set once at startup in `Demo.js`. After that, every call to `random()` returns the next number in the deterministic sequence — there is no re-seeding.

The WFC worker runs in a separate thread with its own copy of `SeededRandom.js` (Web Workers have independent module scope). The seed is passed to the worker once via `{ type: 'init', seed }` message in `initWfcWorker()`. After that, the worker's RNG advances naturally across all solves.

**Never re-seed the worker per solve** — that resets the sequence to position 0 and causes identical random choices across solves, making retries and rebuild-wfc produce the same output.

## Naming Conventions

### Hex Grid System
- HexMap — The entire world, manages multiple Grids (`src/HexMap.js`)
- HexGrid — A hexagonal grid of hex cells, one WFC solve = one Grid (`src/HexGrid.js`)
- GridHelper — Visual overlay (lines + dots) for a grid (`src/HexGridHelper.js`)
- Placeholder — Clickable hexagonal button to expand into adjacent grid slot (`src/Placeholder.js`)
- Cell — A position in the grid that can hold a Tile
- Tile — The actual mesh placed in a Cell (`src/HexTiles.js`)
- Fixed Cell — A solved tile from a neighboring grid used as a read-only constraint during WFC
- Neighbor Cell — A fixed cell adjacent to the solve region that can be unfixed if it causes a neighbor conflict
- Anchor — A neighbor of a neighbor cell that becomes a new fixed constraint when the neighbor cell is unfixed
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
- Purple = Neighbor conflict (0 possibilities during initial propagation from fixed/neighbor cells)
- Orange = Replaced fixed cell (neighbor cell change or persisted-unfixed cell change)
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
