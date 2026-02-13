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

### Failure Fallback
If WFC fails after soft cell unfixing:
1. **Replace phase** (max 5 attempts): Try `tryReplaceFixedCell` on cells nearest the failure point (grass-any-level matching). Skipped if failure was a seed conflict. If a seed conflict occurs during replace phase, falls through to drop.
2. **Drop phase**: Drop fixed cells one by one sorted by proximity to failure point, re-running WFC after each drop. Re-sorts when failure point changes. Mountains are placed on dropped cells to hide edge mismatches.

### Build All
`populateAllGrids()` creates all 19 grids upfront, collects all cells, and runs a single WFC pass with zero fixed cells. No soft cells or fallbacks needed — just one big solve relying on backtracking.

### Future Improvements

#### Sub-Complete Tileset
From the [N-WFC paper](https://ar5iv.labs.arxiv.org/html/2308.07307). Design the tileset so that for any valid edge configuration on one side of a cell, at least one tile exists that satisfies it regardless of what the other 5 edges require. This guarantees WFC never contradicts. Requires auditing every edge type at boundaries (road, river, coast, ocean, grass at each level) and adding "bridge" or "transition" tiles where gaps exist. Harder for hex grids (6 edges) than square grids.

#### Driven WFC (Noise-Based Pre-Constraints)
[Townscaper-style](https://www.boristhebrave.com/2021/06/06/driven-wavefunctioncollapse/). Use continuous world noise fields to pre-determine tile categories (water, mountain, flat grass, etc.) before WFC runs. WFC only picks among variants within that category. Cross-grid boundaries become trivial because noise is continuous and doesn't care about grid edges. WFC becomes more of a detail pass than a generator.

#### Localized Re-Solve
Instead of dropping cells at conflict points, create a small WFC solve zone (half-grid radius) centered on the conflict cell. The zone can span multiple grids — perimeter cells become fixed constraints from `globalCells`, interior cells are re-solved. After solving, update affected source grids via `replaceTile()`. Uses existing infrastructure: `cubeCoordsInRadius`, `solveWfcAsync`, global cell map.

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
- Purple = Seed conflict (0 possibilities during initial propagation from fixed cells)
- Orange = Replaced fixed cell (soft cell change or persisted-unfixed cell change)
- Red = Dropped fixed cell (mountain placed to hide mismatch)

## References

- [Red Blob Games - Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/)
- [mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)
- [Boris the Brave - MiB](https://www.boristhebrave.com/2021/10/26/model-synthesis-and-modifying-in-blocks/)
- [Boris the Brave - Infinite MiB](https://www.boristhebrave.com/2021/11/08/infinite-modifying-in-blocks/)
- https://observablehq.com/@sanderevers/hexagon-tiling-of-an-hexagonal-grid
- Dorf Romantik, Bad North (style refs)
