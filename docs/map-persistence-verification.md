# Map persistence verification

The persistence changes were checked with seven passing Node tests and a passing
Vite production build. The build still reports its existing large-bundle and
mixed static/dynamic Sounds import warnings.

A temporary Playwright check used an existing solved 4,123-tile fixture in Chrome
with WebGPU. It supplied that fixture at the solver boundary rather than spending
minutes solving a new world. It verified automatic IndexedDB saving, page reload
without another solver call, exact canonical tile equality, manual snapshots,
JSON download/import, failed-generation preservation, reopening, simulated mesh
failure cleanup, and exclusion of competing reset/generation during restore.
Desktop and 390-pixel-wide mobile captures were inspected; controls fit within the
viewport and remained legible. Corrupt-storage recovery was also checked.

Pi reviewed the code and then reviewed the fixes. Its requested OpenCode Go
provider was unavailable, so both completed reviews used Pi's configured default.
Confirmed issues fixed: concurrent operations during restore, partial-scene
cleanup after restore failure, bounds checking imported grids, preserving ocean
side for later expansion, and filtering unreadable records before displaying the
library.

Two review suggestions were deliberately declined:

- Automatically generating after an unreadable save would impose the very long
  wait this feature avoids. Startup instead offers existing saves, import, and
  an explicit New map action; unreadable records are retained.
- Restoring the previous RNG state after a failed visual load has no preserved
  world to accompany it: failure clears the scene, opening another map reseeds
  from that map, and New map explicitly chooses a fresh seed. Exact continuation
  of the generator's random stream is outside the saved terrain contract.

Existing unrelated natural-terrain changes were preserved. No commit was made.
