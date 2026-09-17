# Modular natural terrain

[Before and after, same map and camera](before-after.jpg) — original on the left,
updated on the right.

## What changed

- The existing GLB tile names, WFC rules, rotations, elevation levels, and outer
  connection vertices are preserved. `NaturalGeometry.js` narrows interior
  bevels and adds relief inside grass slope/cliff tiles. Roads and rivers keep
  their authored connections. Flat ground stays flat for buildings and picking.
- Grass and stone use generated photographic color textures, world-space detail,
  surface bump, and roughness. Snow blends by elevation, slope, and broad noise.
  Faint surface hex lines retain the grid's readability.
- The named tree assets are replaced by deterministic, reusable branch-cluster
  geometries. They use the existing opaque decoration batch and cast shadows.
- Rocks and mountain meshes have more relief. Mountain meshes retain their full
  authored height, and unoccupied highest-level grass tiles receive more peaks.
- Water shading runs on the existing river triangles, including raised rivers:
  animated ripples, shallow color variation, and broken shoreline foam.
- The minimal runtime now applies the shared sunlight/environment settings.
  The optional full-effects coast pass reads the canonical land/water mask,
  independent of the new material colors.

Assets: `public/assets/textures/natural/meadow.png` and `rock.png`. Both were
created with the built-in ImageGen tool; the exact prompts are recorded in
[the asset notes](../../public/assets/textures/natural/README.md).

## Validation

- `npm test`: checks every shipped tile type for unchanged connection vertices
  and horizontal bounds, finite geometry, indexed batch compatibility, and
  deterministic bounded tree assets that do not consume the map RNG.
- `npm run build`: passes. Existing warnings remain for the large bundle and
  mixed static/dynamic imports of `Sounds.js`.
- Chrome/WebGPU on Apple M1 Pro, 1440×1000 viewport, renderer DPR 2: seed 6410,
  4,123 cells. Original and final canonical tile arrays are byte-for-byte equal.
  Final generation completed in approximately 38 seconds.
- Inspected close, detail, and overview PNGs. Final default runtime produced no
  console warnings/errors; center-screen raycasting returned a valid batch ID.
- The full-effects pipeline was separately exercised on the saved map, calling
  the existing `fadeIn(0)` helper to complete its intro fade. No console errors;
  valid tile picking. The production runtime profile remains unchanged.
- Short two-second desktop frame-submission samples were approximately 60 FPS
  in minimal mode and 59 FPS with full effects. These are smoke checks, not a
  mobile or sustained performance guarantee. Submitted triangles (including
  shadow passes) increased from about 3.40M to 6.62M in the overview.
- Screenshot comparison found more surface detail and a darker natural palette.
  The candidate is closer to the requested direction; matching the old image was
  not the acceptance criterion.

## Independent review

Pi ran read-only using its configured default provider/model because the skill's
preferred `opencode-go/gpt-5.6-luna` provider was unavailable. Findings were checked
against the implementation:

- Taller mountains: intentional art change; they are no longer sunk 0.5 units.
- Foliage allegedly sampling white water-mask pixels: dismissed. The atlas is
  loaded with `flipY = false`; direct pixel sampling at all generated foliage UVs
  `(0.18, 0.56…0.66)` returns black (0), while actual river UVs return white (255).
  Retaining black decoration occluders also prevents waves drawing over bridges.
- Allegedly unreachable shoreline foam: dismissed. The `.5… .75` UV band only
  classifies grass, foliage, stone, and roads. Water uses its independent atlas
  mask; an authored river-edge UV is `(0.161, 0.273)`, where the foam factor is
  nonzero. The reviewer had conflated the two atlas regions.

## Limits

This is a modular visual upgrade, not an exact reproduction of the reference.
The original buildings and bridges retain their silhouettes, tile boundaries
remain visible, and the terrain still follows the original modular profiles.
Closer photographic fidelity would benefit from artist-authored mountain,
building, and foliage assets. The new color textures add about 7.3 MB of source
PNG data. No external asset service or new runtime dependency is required.
