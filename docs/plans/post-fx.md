# Post-Processing Effects Plan

## Context

Adding four post-processing effects to the hex-map city scene: depth-of-field, bleach bypass, LUT color grading, and film grain. The goal is a stylized miniature/film look. All effects are built on the existing Three.js TSL (WebGPU) post-processing pipeline in `PostFX.js`.

## Effects

### 1. DOF (Depth of Field)

Use the built-in `dof()` from `three/addons/tsl/display/DepthOfFieldNode.js`.

- Takes `(textureNode, viewZNode, focus, aperture, maxblur)`
- Apply to scene pass color texture, before AO compositing
- The scene pass already outputs depth — use `scenePass.getTextureNode('depth')` for viewZ
- GUI: focus distance, aperture, maxblur sliders + enable toggle

Note: DOF needs a texture to sample at offset UVs for the blur kernel. It must operate on the scene pass texture directly (not a computed node like `withAO`). Applying DOF before AO is correct — AO should be computed from real geometry depth/normals, not blurred ones.

### 2. Bleach Bypass

Use the built-in `bleach()` from `three/addons/tsl/display/BleachBypass.js`. It's the same Nvidia reference implementation as the GLSL shader from photomosh.

- Takes `(color, opacity)` — opacity controls blend strength
- Apply after overlay compositing, before vignette
- GUI: amount slider (0-1) + enable toggle

### 3. LUT Color Grading

Custom TSL implementation — the built-in `Lut3DNode` uses 3D textures, but our LUTs are 2D strip format (512x512, 8x8 grid of 64 tiles).

Port the GLSL logic to TSL using `Fn()`:
- Blue channel selects two adjacent 64x64 tiles in the 8x8 grid
- R/G channels index within each tile
- Lerp between the two samples based on `fract(blue * 63)`
- Mix with original based on amount uniform

LUT textures are already in `public/assets/lut/` (15 styles). Load default on init, swap via GUI dropdown.

- GUI: style dropdown (etikate, amatorka, etc.) + amount slider (0-1) + enable toggle

### 4. Grain (Sensor Noise)

Port the static RGB sensor noise from `tsl-gradient-pills/src/PostFX.js`.

- Three separate sin/fract hashes per channel with different seeds
- Additive offset centered at 0: `(noise - 0.5) * strength`
- Static (no time input) — sensor noise, not animated film grain
- Apply after fade (visible on black, same as gradient-pills)
- GUI: strength slider (0-0.2) + enable toggle

## Pipeline Order

```
Scene Pass → color, depth, normals
  ↓
DOF (on scene color texture, using depth)
  ↓
AO (GTAO on DOF'd color)
  ↓
Effects layer compositing (weather, water)
  ↓
Overlay layer compositing (UI)
  ↓
Bleach bypass
  ↓
LUT color grading
  ↓
Vignette
  ↓
Fade to black
  ↓
Grain (after fade, visible on black)
  ↓
Debug view selector
```

## Files to Modify

- **`src/PostFX.js`** — Add DOF, bleach, LUT, grain to `_buildPipeline()`. Add uniforms, LUT texture loading, LUT swap method.
- **`src/Demo.js`** — Expose new PostFX uniforms in `initPostProcessing()`.
- **`src/GUI.js`** — Add controls to the Post Processing folder: DOF (focus/aperture/maxblur/enable), bleach (amount/enable), LUT (style/amount/enable), grain (strength/enable). Add new defaults to `defaultParams.fx`. Wire `applyParams()`.

## New Imports

In `PostFX.js`:
```js
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { bleach } from 'three/addons/tsl/display/BleachBypass.js'
import { TextureLoader, SRGBColorSpace, NearestFilter, LinearFilter } from 'three/webgpu'
import { Fn, mul, add, sin, fract } from 'three/tsl'  // add to existing imports
```

## Verification

- Toggle each effect on/off in the GUI and confirm visual change
- Check that DOF blurs based on distance from focus point (not screen-space)
- Cycle through LUT styles and confirm color shifts
- Confirm grain is static (doesn't animate between frames)
- Check debug views still work
- Confirm no performance regression (check FPS counter)
