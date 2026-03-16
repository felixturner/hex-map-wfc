# Hex Map WFC

Procedural medieval island worlds from 4,100 hex tiles, built with WebGPU and a lot of backtracking.

[Live Demo](https://felixturner.github.io/hex-map-wfc/) | [Read the Article](https://felixturner.github.io/hex-map-wfc/article/)

![Screenshot](docs/article/img/hero.jpg)

## Features

- **Modular Wave Function Collapse** — 19 hexagonal grids solved independently with cross-grid constraint matching
- **Layered Recovery System** — unfixing, Local-WFC, and mountain fallbacks for 100% solve rate
- **30 Hex Tile Types** — 6 rotations and 5 elevation levels each (900 states per cell)
- **WebGPU Rendering** — Three.js with TSL shaders for all custom visual effects
- **BatchedMesh Optimization** — 4,100+ cells in ~38 draw calls, 60fps on desktop and mobile
- **Post-Processing Stack** — GTAO ambient occlusion, depth of field, vignette, and film grain
- **Dynamic Shadow Maps** — frustum fitted to camera view for crisp shadows at any zoom
- **Animated Water** — caustic sparkles and coastal waves with cove-aware thinning
- **Noise-Based Placement** — Perlin noise for organic tree, building, and decoration clustering
- **Seeded RNG** — deterministic, reproducible maps from any seed

## Getting Started

```bash
npm install
npm run dev
npm run build
```

## HexPlatformEngine (N++ Ninja Physics Module)

`src/hexmap/HexPlatformEngine.js` is a reusable ES module that adds N++-style
ninja platformer physics to hex grid worlds. It provides:

- **NinjaEntity** — position, velocity, state machine (idle/running/jumping/falling/wallSlide/dead)
- **HexPlatformEngine** — game loop update with collision callbacks, event hooks
- **NINJA_PHYSICS** — exported constants for tuning (dual gravity, additive jump, wall mechanics)
- **InputState** — abstracted input for keyboard/gamepad integration

Key physics features: additive jump (N++ signature), dual gravity (rise vs fall),
apex hang, variable jump height, wall slide/jump with lockout, fall damage,
landing momentum transfer, coyote time, jump buffering.

This module is used by [N-Scale](https://github.com/aquasolnursery/onehtml/tree/main/NScale),
a hex ninja platformer in the FreewareArcade.com platform.

## License

[MIT](LICENSE)

## Credits

- [KayKit Medieval Hexagon Pack](https://kaylousberg.itch.io/kaykit-medieval-hexagon) — tile assets
- [Maxim Gumin's WFC](https://github.com/mxgmn/WaveFunctionCollapse) — original Wave Function Collapse
- [Red Blob Games — Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) — hex grid reference
