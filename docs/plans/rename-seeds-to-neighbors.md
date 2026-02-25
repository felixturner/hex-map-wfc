# Rename WFC "seeds" and "soft cells" to "neighbors" — DONE

## Goal
Replace confusing WFC "seed" and "soft fixed cell" terminology with "neighbor" throughout the codebase. Use US spelling: **neighbor**.

## Renames applied
- `seedingContradiction` → `neighborContradiction`
- `seedConflict` → `neighborConflict`
- `isSeedConflict` → `isNeighborConflict`
- `seedingOk` → `neighborSeedingOk`
- `softFixedData` → `neighborData`
- `softFixedCells` → `neighborCells`
- `softFixedOriginals` → `neighborOriginals`
- `unfixSoftCell` → `unfixNeighbor`
- `findAdjacentSoftFixed` → `findAdjacentNeighbors`
- `initSoftFixedData` → `initNeighborData`
- `activeSoftFixed` → `activeNeighborCells`
- Comments/prose: "soft fixed cell" → "neighbor cell", "seed conflict" → "neighbor conflict", etc.

## NOT renamed
- RNG seed: `setSeed`, `getSeed`, `SeededRandom`, `seed: 9162`, etc.
- Ocean seeds: `addWaterEdgeSeeds`, `getMapCornerOceanSeeds`, `initialCollapses`
- `seededCells` (tracks ocean seeds for debug labels, not WFC neighbors)

## Files changed
- `src/workers/wfc.worker.js` — bulk of the renames
- `src/hexmap/WFCManager.js` — `neighborContradiction`, `neighborConflict`, `neighborCells`, `activeNeighborCells`
- `src/hexmap/HexMap.js` — `isNeighborConflict`, `neighborConflict`, `neighborContradiction`
- `src/hexmap/HexGrid.js` — comment update
- `docs/NOTES.md` — updated terminology throughout
