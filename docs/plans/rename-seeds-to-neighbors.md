# Rename WFC "seeds" and "soft cells" to "neighbors"

## Goal
Replace confusing WFC "seed" and "soft fixed cell" terminology with "neighbor" throughout the codebase. Use US spelling: **neighbor**.

## What to rename
- `seedingContradiction` → `neighborContradiction`
- `seedConflict` → `neighborConflict`
- `isSeedConflict` → `isNeighborConflict`
- `seedingOk` → `neighborPropagationOk` or similar
- `softFixedData` → `neighborData`
- `softFixedCells` → `neighborCells` (or similar)
- `softFixedOriginals` → `neighborOriginals`
- `unfixSoftCell` → `unfixNeighborCell`
- `findAdjacentSoftFixed` → `findAdjacentNeighbors`
- `activeSoftFixed` → `activeNeighbors`
- Log messages: "Seed conflict" → "Neighbor conflict", "soft cell" → "neighbor cell"
- Comments referencing "seed" in the WFC/neighbor context

## What NOT to rename
- RNG seed: `setSeed`, `getSeed`, `SeededRandom`, `seed: 9162`, etc.
- Ocean seeds: `addWaterEdgeSeeds`, `getMapCornerOceanSeeds`, `initialCollapses`
- `seededCells` (tracks ocean seeds for debug labels, not WFC neighbors)

## Files
- `src/workers/wfc.worker.js` — bulk of the renames
- `src/hexmap/WFCManager.js` — `seedingContradiction`, `seedConflict`
- `src/hexmap/HexMap.js` — `isSeedConflict`, `seedConflict`, log messages
- `docs/NOTES.md` — update terminology in docs

## Also
- Use US spelling: "neighbor" not "neighbour" everywhere (includes existing log messages and NOTES.md)
