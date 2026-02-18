# Coastal Waves Implementation Plan

## Context
Animated coastal waves — white broken lines emanating outward from coastlines, getting thinner further out. Requires a coast distance gradient texture.

The coastline shape is organic — defined by mesh vertices within each tile, NOT by hex edges. Coast tiles have wavy sand/beach edges that blend from grass → sand → rocks → water.

## Key Dimensions
- HEX_WIDTH = 2 WU, HEX_HEIGHT ≈ 2.309 WU
- Map radius ≈ 84 WU (42 cells × 2 WU)
- Tile surface: land=1.0, river/coast=0.9, ocean=0.8 WU above base
- Target wave reach: 2 tiles = 4 WU from coastline

## Architecture

### Land-only tile meshes
Use the existing mesh variants with the blue water part deleted (already exist in Blender). These are the PRIMARY tile meshes — no water geometry in the BatchedMesh at all.

This solves the core masking problem: only land geometry exists in the tiles, so rendering them top-down gives a clean land/water mask without needing to distinguish tile types.

### Coast mask render (pure white)
Add a `maskMode` uniform to the tile's PBR material:
- `maskMode = 0`: normal PBR rendering
- `maskMode = 1`: output `vec3(1,1,1)` (pure white)

This avoids material swapping (~1 second penalty). Both code paths compile into the same shader. Toggling the uniform is instant.

Mask render steps:
1. Set `maskMode = 1`
2. Hide decorations, overlays, weather, water plane
3. Render tiles top-down (ortho camera) to RT → land = white, clear = black
4. Set `maskMode = 0`
5. Dilation + blur passes → coast distance gradient

### Water plane
The blurred coast gradient is rendered to a water plane mesh positioned at the right height (just under coast Y, ~0.85 WU). This plane IS the water surface — it uses the gradient for:
- Wave bands (sine, taper, noise break)
- Distance-from-coast shading
- Sparkle/effects

The water plane replaces the blue water faces that were removed from the tile meshes.

### PostFX water masking
Currently PostFX detects blue pixels in the scene render to mask the water RT. With land-only meshes, the blue comes from the water plane instead of tile geometry. May need to adjust the blue detection thresholds or use the coast mask directly for masking.

## GPU Blur Pipeline
- Texture: 2048x2048, ortho camera ±90 WU
- 1px ≈ 0.088 WU, 1 tile ≈ 22.8px, 2 tiles ≈ 45px
- Dilation: radius 3, 1 H+V pair (clean tile edges)
- Blur: radius 12, 4 H+V pairs → 48px reach ≈ 2.1 tiles
- Ping-pong between rtA and rtB, result in rtA
- Runs once after grid build (not per frame)

## Implementation Steps

### Step 1: Land-only meshes (Blender)
- Export GLB with land-only variants for coast/river tiles
- Update tile loading to use land-only geometries

### Step 2: maskMode uniform
- Add `maskMode` uniform to tile PBR material in HexGrid.js
- Wire TSL: `select(maskMode > 0.5, vec3(1), normalPBROutput)`

### Step 3: Coast mask render
- CoastMask.js: set maskMode=1, render tiles top-down, set maskMode=0
- Dilation + blur → gradient in rtA
- Already built: debug viewport, ping-pong infrastructure

### Step 4: Water plane
- Position at ~0.85 WU (just under coast Y)
- Sample coast gradient for wave bands
- Already built: wave shader (sine bands, taper, noise break, fade)

### Step 5: PostFX integration
- Verify or adjust water masking (blue detection or coast-mask-based)
- Ensure water plane renders correctly through the water RT pass

## Current Code State
- `src/CoastMask.js` — RT render, dilation + blur (disabled for debug), debug viewport
- `src/HexMap.js` — water shader with gradient sampling, wave bands, debug red output
- `src/Demo.js` — wiring: onTilesChanged → delayed coastMask.render()
- `src/GUI.js` — wave control sliders
- `src/PostFX.js` — clean, no coast code

## Open Questions
- Does the existing water plane need to become opaque blue as a base, or does the wave shader handle the full water visual?
- How to handle the PostFX water masking without blue tile faces?
