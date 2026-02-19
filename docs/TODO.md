# TODO

- send link to KAY. ask for feedback and new tiles?


- fix weather
  - fix rain looks like poles
  - diff speed for rain/snow
  - do weather scaling to lock min/max rain/snow sizes on zoom.

- fade out water effect at distance

- WORLD FEATURES
  - use bigger world noise fields for water, mountains + forests, cities? WIP
  - create world noise map as circle. white for land. smaller blobs for mountains/ forests / towns
  - Edge biasing for coast/ocean - Pre-seed boundary cells with water before solving, or use position-based weights to boost ocean/coast near edges and grass near center
  - use just seed some map edges with ocean/ mountains?


# NEW TILES
- Add new TILES to help WFC: (claculate tiles needed for Sub-Complete Tileset)
  - 4x road slope dead-ends (low/high). 
  - branching bridges?.
  - add extra tile with just 1 small bit of hill to fill jagged gaps in cliffs?(like coast)

- need new meshes for:
  - RIVER_END 
  - COAST_SLOPE_A_LOW
  - COAST_SLOPE_A_HIGH                                                                
  - RIVER_A_SLOPE_LOW
  - RIVER_INTO_COAST       

- commision kaykit to add some tiles or hire 3d modeler - send him live link
  - add bushes like bad north
  - find/make simpler more minimal building models


# MORE DEC
- boats and ports
- add a little minifig meeple have his hex outline lit up. control him to walk around.
- day/night (cross fade skybox)
- add animated fires
- smoke from chimneys as meshes or puffs that fade
- add sound effects birds wind sounds. ticking build sound for wfc
- add village furniture - barrels, water troghs, carts etc


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



- fix build order UI to dissallow surrounding a tile (harder for WFC)
- fix lillies can get cropped by coast
- prebake AO in blender?
- smooth cam zoom
- animate rotate tiles in like railway board

- fix waves in coves too fat. Try JFA distance field for WavesMask — replaces blur-based gradient so coves get uniform wave thickness. Attempted but TSL multi-pass ping-pong with HalfFloat RTs didn't work (JFA output was wrong). Needs debugging — possibly texture node .value swaps don't update correctly across passes, or HalfFloat precision issue. Plan saved in plans/polished-exploring-dongarra.md

- fix HDR rotation (scene.backgroundRotation doesn't work through PostProcessing pass() node, scene.environmentRotation is WebGL-only. Custom envNode via material.envNode changes colors because it bypasses EnvironmentNode's radiance/irradiance pipeline. Possible fixes: override setupEnvironment to inject rotation into createRadianceContext/createIrradianceContext getUV, or update to newer three.js that may support environmentRotation in WebGPU)
