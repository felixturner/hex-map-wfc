# TODO

- create new repo called hex-map-threejs, inside other folder for working trees
- push to git push live demo


- water effect (currently basic sparkle plane at Y=0.92 with value noise, MeshPhysicalNodeMaterial emissive, no masking)
  - use emissive channel in GLB to mask sparkle (paint white on water faces in Blender, sample as mask)
  - render water channel top down to a texture
  - use SDF to animate ripples coming out from coast
- coast ripples shader like disney map / bad north
- improve color maps textures for 2 levels. keep rivers/roads the same color on both
- add wind trails like zelda
- click tile to randomly replace it with a wfc candidate.
- add walls as wfc tiles w grass

- Add new TILES to help WFC: 
  - River dead-end, 
  - 4x road slope dead-ends (low/high). 
  - river slopes? 
  - coast slopes. 
  - branching bridges?.
  - rivers into coasts?r

- use bigger world noise fields for water, mountains + forests, cities?
  - create world noise map as circle. white for land. smaller blobs for mountains/ forests / towns
- Consider manual compositing passes instead of MRT (fixes transparency, enables half-res AO for perf)
- Post - add subtle tilt shift, bleach,grain, LUT
- Consider preventing road slopes up/down from meeting
- Edge biasing for coast/ocean - Pre-seed boundary cells with water before solving, or use position-based weights to boost ocean/coast near edges and grass near center
- remove baked shadoews from blender file?
- paint big noise color fileds over grasss for more variation
- add boats + carts?
- add birds + clouds?
- add dungeon mouth
- add forg in distance
- Update to latest threejs
- commision kaykit to add some tiles or hire 3d modeler - send him live link
  - add bushes like bad north
  - find/make simpler house models
  - add extra tile with just 1 small bit of hill to fill jagged gaps in cliffs?(like coast)


- snow: lock snow area to cam view so more snow visible. do weather scaling to lock min/max sizes on zoom.

- fix tree rotation with wind sway (currently rotation disabled — positionNode runs pre-batch so displacement gets rotated per-instance. need to counter-rotate using batch color channel or similar)
- fix HDR rotation (scene.backgroundRotation doesn't work through PostProcessing pass() node, scene.environmentRotation is WebGL-only. Custom envNode via material.envNode changes colors because it bypasses EnvironmentNode's radiance/irradiance pipeline. Possible fixes: override setupEnvironment to inject rotation into createRadianceContext/createIrradianceContext getUV, or update to newer three.js that may support environmentRotation in WebGPU)
- fix build order UI to dissallow surrounding a tile (harder for WFC)
- add a little minifig meeple have his hex outline lit up. control him to walk around.
- day/night (cross fade skybox)
- add animated fires
- smoke from chimneys as meshes or puffs that fade
- add sound effects birds wind sounds. ticking build sound for wfc
- fix lillies can get cropped by coast
