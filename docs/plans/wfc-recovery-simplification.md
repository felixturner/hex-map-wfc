# WFC Recovery Simplification

## Current Recovery Architecture

**Inner loop** (wfc.worker.js — `solve()`):
- Collapse + backtrack (max 500 backtracks)
- On neighbor contradiction during seeding: unfix neighbor cells one at a time, re-propagate
- On backtrack limit: restart from scratch (maxRestarts: 1 for neighbor grids, 10 for first grid)
- Returns success or failure

**Outer loop** (HexMap.js — `_runWfcWithRecovery()`):
1. **Initial attempt** — run inner loop
2. **Local-WFC — neighbor conflict** (max 3) — only for neighbor contradictions with known source (`isNeighborConflict && sourceKey`). Mini-WFC radius-2 around sourceKey in neighbor grid
3. **Local-WFC — general** (max 5) — for any failure. Mini-WFC radius-2 around nearest fixed cell to failure point
4. **Drop phase** (unbounded) — last resort, drop fixed cells + place mountains

## Proposed Change: Merge the two Local-WFC phases

Phases 2 and 3 are nearly identical — both run a mini-WFC on a radius-2 region in a neighbor grid. Differences:
- Neighbor conflict phase centers on `sourceKey` (exact cell that caused contradiction)
- General phase centers on nearest fixed cell to `failedCell`
- For neighbor conflicts, these are usually the same or adjacent cells

Merge into a single Local-WFC phase (max 5-8 attempts). For neighbor conflicts where `sourceKey` is known, use that as the first center candidate. Otherwise (or after first attempt), use nearest fixed cell to failure point. Track attempted centers to avoid repeats.

### Recovery flow after simplification
1. Inner loop: collapse + backtrack + neighbor unfixing during seeding
2. If inner loop fails → Local-WFC (max N attempts, covers both neighbor conflicts and mid-solve failures)
3. If Local-WFC fails → Drop (last resort)

### Consider merging inner/outer unfixing
Inner loop unfixes individual neighbor cells during seeding (cheap, fast). Outer loop re-solves whole regions (expensive). These handle the same root cause (incompatible neighbors) at different scales. The inner unfixing is valuable because it's lightweight and handles easy cases without a separate WFC solve. Keep it but document the relationship clearly.

## Files
- `src/hexmap/HexMap.js` — merge two Local-WFC loops into one in `_runWfcWithRecovery()`
- `docs/NOTES.md` — update recovery section after merge
