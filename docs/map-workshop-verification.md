# Map workshop verification

The workshop edits a pending recipe. The displayed map changes only when Generate
is clicked. A save or export captures the displayed terrain and its applied recipe,
not pending controls. New generations and imports are unsaved previews. Opening a
save restores its recipe; Save changes replaces that opened save, while Save as
copy creates a new record. Startup opens the last save or waits for Generate.

The first version includes relative amounts for water/coasts, roads, rivers,
slopes/cliffs, trees, all structures, peaks, hills, rocks, flowers/bushes and water
plants, plus elevation preference, forest/settlement patch sizes, ocean-side
seeding and seed selection. Terrain constraints and existing decoration budgets
remain in effect. The optional live sample tile is deferred as requested.

## Automated verification

- `npm test`: 15 passing tests, including real worker solves, reproducibility,
  road/river/coast/cliff exclusion, bridge-crossing exclusion with structures off,
  embedded-tree exclusions, recipe validation and version-1 compatibility.
- `npm run build`: passes. Existing large-bundle and mixed Sounds import warnings
  remain.
- `git diff --check`: passes.

## Browser verification

A temporary Playwright script (`/private/tmp/hex-look/workshop-test.mjs`) runs
Chrome with WebGPU against the local Vite app using isolated browser storage.

For save/open and decoration tests it supplies the existing 4,123-tile terrain
fixture at the solver boundary. For full-map exclusion and repeatability checks
it runs the real worker on 4,123 cells with flat terrain and optional elements off.
It checks:

- No generation on empty-storage startup; no autosave after Generate.
- Changing sliders leaves terrain, decorations and the applied recipe unchanged.
- Saving with pending changes records the applied recipe.
- Named copies and replacement saves retain the expected record counts.
- Exact terrain and decoration equality after Open and after reload without a solve.
- JSON export/import round trips and imports remaining unsaved until selected.
- Real full-map exclusion and repeatability with all optional elements off.
- Failed generation restores the previous preview and its recipe.
- Non-default decoration recipes restore exactly, with selectors synchronized.
- Simulated storage failure leaves the map exportable with a memory-only notice.
- No uncaught browser errors.

On the same fixture, baseline settings produced 599 tree instances, 138 building
instances and 21 mountain instances. Doubling tree amount and forest patch size
with structures off produced 883 tree instances and no buildings. Turning trees
and structures off and setting peaks to 300% produced 97 mountain instances.
These are controlled fixture observations, not promised counts for arbitrary maps.

The visual target is a readable, collapsible workshop over an inspectable map,
with no horizontal overflow or controls extending beyond the viewport. Desktop
(1440×1000) and mobile (390×844) screenshots were inspected; panel bounds passed
viewport checks, labels and slider outputs remain readable, and the body scrolls
to reach save controls. Captures are in `/private/tmp/hex-look/workshop-desktop.png`
and `/private/tmp/hex-look/workshop-mobile.png`.

## Independent review

Pi's requested OpenCode Go provider had no configured API key, so review used Pi's
configured default. It raised two seed concerns, both dismissed after inspecting
the code and adding targeted browser checks:

- Ocean-side RNG consumption cannot shift restored decorations: full generation
  explicitly calls `setSeed(getSeed())` immediately before rebuilding noise,
  just as restore reseeds before rebuilding noise. Ocean-edge recipe generation,
  saving and reopening reproduced every decoration in the targeted check.
- A failed attempt cannot change the displayed seed label: that assignment occurs
  only after success. A failed attempt using a different pending seed preserved
  the previous label and restored the previous map, while retaining the pending
  seed for another attempt.

No commit or deployment was performed.
