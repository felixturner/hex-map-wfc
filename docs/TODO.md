# TODO

- rather than do drop on wfc fail try a exta wfc
- add flyhtrough button

- make intro screen? audio? start btn wait for audio
- figure out ui? for more fun interaction? click one tile to flip to a new tile? (show avaiable tiles?)
- dial in AO 
- clean up old assets

- figure out why build all is failing more now? 

- push. record video. 

- send link to codrops

####

# MORE DEC
- boats
- add a little minifig meeple have his hex outline lit up. control him to walk around.
- day/night (cross fade skybox)
- add animated fires
- smoke from chimneys as meshes or puffs that fade
- add sound effects birds wind sounds. ticking build sound for wfc
- add village furniture - barrels, water troghs, carts etc
- add bushes like bad north
- find/make simpler more minimal building models


# LATER
- add icon to hex btn? add finger pointer
- Consider preventing road slopes up/down from meeting
- remove baked shadoews from blender file?
- paint big noise color fileds over grasss for more variation
- add boats + carts?
- add birds + clouds?
- add wind trails like zelda
- add dungeon mouth buildings
- Update to latest threejs
- allow inifinite grow grids - will break water mask???

- WORLD FEATURES
  - use bigger world noise fields for water, mountains + forests, cities? WIP
  - create world noise map as circle. white for land. smaller blobs for mountains/ forests / towns
  - Edge biasing for coast/ocean - Pre-seed boundary cells with water before solving, or use position-based weights to boost ocean/coast near edges and grass near center
  - use just seed some map edges with ocean/ mountains?
  - biome noise for texture colors?

- WEATHER
  - fix rain looks like poles
  - diff speed for rain/snow
  - do weather scaling to lock min/max rain/snow sizes on zoom.

- fix build order UI to dissallow surrounding a tile (harder for WFC)
- fix lillies can get cropped by coast
- smooth cam zoom


- fix waves in coves too fat. Try JFA distance field for WavesMask — replaces blur-based gradient so coves get uniform wave thickness. Attempted but TSL multi-pass ping-pong with HalfFloat RTs didn't work (JFA output was wrong). Needs debugging — possibly texture node .value swaps don't update correctly across passes, or HalfFloat precision issue. Plan saved in plans/polished-exploring-dongarra.md

- fix HDR rotation (scene.backgroundRotation doesn't work through PostProcessing pass() node, scene.environmentRotation is WebGL-only. Custom envNode via material.envNode changes colors because it bypasses EnvironmentNode's radiance/irradiance pipeline. Possible fixes: override setupEnvironment to inject rotation into createRadianceContext/createIrradianceContext getUV, or update to newer three.js that may support environmentRotation in WebGPU)

- more new TILES?
  - 4x road slope dead-ends (low/high). 
  - branching bridges?.
  - more coasts
  - 1 corner of hill to fill jagged gaps in cliffs?(like coast)

# DONE / FAILED

- Sub-Complete Tileset — [N-WFC paper](https://ar5iv.labs.arxiv.org/html/2308.07307). Design tileset so any valid edge config on one side guarantees a matching tile regardless of other 5 edges. Tried, too many edge combos for hex grids.
- Driven WFC (Noise-Based Pre-Constraints) — [Townscaper-style](https://www.boristhebrave.com/2021/06/06/driven-wavefunctioncollapse/). Use noise fields to pre-determine tile categories before WFC. Tried, didn't eliminate cross-grid boundary issues as hoped.
