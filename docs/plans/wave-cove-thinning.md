# Wave Cove Thinning

## Problem
Wave bands in concave coves are too thick compared to straight coastlines. The blurred coast gradient (from WavesMask) maps the same gradient range over a wider physical area in coves, making sine wave bands appear fatter.

## Approaches Tried (this session)

### 1. fwidth (screen-space derivatives)
- Measured `fwidth(outwardDist)` — how fast the gradient changes per screen pixel
- Used it to thin waves where gradient is shallow (coves)
- **Result**: Partially worked at a given zoom level, but values shift with zoom/resolution. Not robust.
- Code: still in Water.js (commented out)

### 2. Texture-space gradient magnitude (coastSharpness)
- Sample coast gradient texture at neighboring texels to compute gradient magnitude in texture space
- Normalize by `gradSample` to get `coastSharpness = gradMag / gradSample`
- Idea: straight coasts have high magnitude (steep directional gradient), coves have low (opposing edges cancel)
- **Result**: Only detects very tight channels/rivers where gradients truly cancel. In actual problem coves (2-4 tiles wide), the gradient still has a clear directional slope — coastSharpness is uniformly high. The signal doesn't differentiate coves from straight coasts in the wave zone.
- Debug viz confirmed: red (low coastSharpness) only appears in narrow rivers, not in the coves where waves are actually fat.
- Added GUI sliders (Thin Ref, Low Grad Cut, Cove Radius, Cove Fade Rate) but they can't selectively target coves — they either do nothing or affect all waves equally.
- Code: active in Water.js with toggle checkbox "Cove Thinning"

### 3. Extra dilation pass (discussed, not implemented)
- Heavier dilation would fill tight coves (land from opposite sides meets in middle)
- Could store in second channel as cove detector
- **Issue**: would also elevate values near straight coasts, making clean separation difficult. Only helps for very tight coves.

## Root Cause
All approaches manipulate the same blur-based gradient data. The blur encodes "how much land is nearby" but NOT "how far is the nearest coast edge." These are fundamentally different questions. No amount of post-processing the blur can extract true distance information.

In a cove, the gradient profile is wider (shallower slope over more world units) but at any given point the local gradient looks normal — it's just stretched. Local analysis (derivatives, magnitude) can't detect this stretching.

## Solution: JFA Distance Field

A Jump Flood Algorithm distance field would give true Euclidean distance per pixel to the nearest coast edge. Wave bands mapped to true distance would be uniform thickness everywhere — straight coasts, coves, channels, everything.

### Previous JFA Attempt
- Tried TSL multi-pass ping-pong with HalfFloat RTs
- JFA output was wrong
- Suspected issues: texture node `.value` swaps don't update correctly across passes, or HalfFloat precision issue
- See TODO.md line 61

### Recommended Approach
Don't try to do ping-pong inside a TSL node graph. Use standard `renderer.setRenderTarget()` with separate render calls:

```
rtA, rtB = two RenderTargets (try R16G16 SNorm or RGBAFloat)

Seed pass:
  - Render coast edges into rtA (Sobel on the dilated mask, or just use the dilation boundary)
  - Encode pixel position in RG channels, -1 for non-seeds

JFA passes (log2(2048) ≈ 11 iterations):
  for step = 1024, 512, 256, ... 1:
    read = rtA or rtB (alternating)
    write = the other one
    jfaMaterial.colorNode = JFA shader sampling 3x3 at step offset
    jfaMaterial.uniforms.inputTexture = read.texture  // swap at JS level
    renderer.setRenderTarget(write)
    renderer.render(quadScene, orthoCamera)

Final: compute distance from stored nearest-seed position
```

Key points from bgolus article (https://gist.github.com/bgolus/a18c1a3fc9af2d73cc19169a809eb195):
- Store seed POSITIONS (not distances) in ping-pong — distance computed at the end
- R16G16 SNorm format worked well (not HalfFloat)
- Separable axis variant (H then V per step) reduces samples from 9 to 3
- Sobel edge detection for sub-pixel seed accuracy

### Integration
The JFA output texture replaces `this.texture` in WavesMask. The wave shader in Water.js would use true distance instead of the blurred gradient for `outwardDist`. Everything else (sine bands, breaks, fades) stays the same but with uniform spacing.


### JFA Status
- Seed pass confirmed working (thin white coastline edges, correct shape)
- Propagation step produces garbage — same result regardless of:
  - `select` chains vs `Fn`/`If`/`toVar`/`assign`
  - UV-space vs pixel-space coordinates
  - Single material with `.value` swap vs two materials
  - `fragmentNode` vs `colorNode`
- Suspected: TSL texture sampling from FloatType RTs may not return raw float values, or `.value` swap doesn't work with `fragmentNode`
- Next test: verify R,G values (pixel coords) read back correctly from seed output, then try single JFA iteration

### JFA Refs
- https://github.com/bzztbomb/three_js_outline
- https://bgolus.medium.com/the-quest-for-very-wide-outlines-ba82ed442cd9

## Fallback: Hex Directional Land Probe

If JFA can't be made to work in TSL, a simpler CPU-side approach:

For each water cell, probe outward along the 6 hex directions up to N cells. Count how many directions hit land within that radius. Cells with 3+ directions blocked are "in a cove."

- **Pros**: simple JS, no GPU passes, ~20 lines of code, works at cell granularity
- **Cons**: discrete per-cell (not smooth pixel gradient), binary cove/not-cove rather than continuous thinning, need to feather edges
- **Integration**: store cove strength as a per-cell value, write to a data texture, sample in Water.js wave shader to suppress or thin wave bands in coves
- **Resolution**: one value per hex (~2 WU), coarser than JFA but may be sufficient since wave bands are already ~2 WU wide
