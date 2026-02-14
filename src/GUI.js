import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import {
  NoToneMapping, LinearToneMapping, ReinhardToneMapping,
  CineonToneMapping, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping,
} from 'three/webgpu'
import { Sounds } from './lib/Sounds.js'
import { TileGeometry } from './Tiles.js'
import { setTreeNoiseFrequency, setTreeThreshold } from './Decorations.js'
import { HexTile } from './HexTiles.js'

export class GUIManager {
  constructor(demo) {
    this.demo = demo
    this.gui = null
    this.fovController = null
  }

  // Default params - single source of truth
  static defaultParams = {
    camera: {
      perspective: true,
      fov: 20,
    },
    scene: {
      noiseScale: 0.015,
      noiseSubtract: 0.15,
      noiseHeight: 27,
      randHeight: 5,
      randHeightPower: 6.5,
      centerFalloff: 1,
      skipChance: 0.1,
    },
    lighting: {
      exposure: 1,
      toneMapping: 'None',
      envIntensity: 0.95,
      hdr: 'venice_sunset_1k.hdr',
      dirLight: 2.15,
      hemiLight: 0.25,
      shadowIntensity: 1.0,
      lightX: 35,
      lightY: 50,
      lightZ: 45,
      showHelper: false,
      hdrRotation: 191,
    },
    material: {
      color: '#ffffff',
      roughness: 1,
      metalness: 0.03,
      clearcoat: 0.53,
      clearcoatRoughness: 0,
      iridescence: 0.21,
      useBlenderTexture: true,
    },
    fx: {
      ao: true,
      aoScale: 2.7,
      aoRadius: 1,
      aoBlur: 0.3,
      aoIntensity: 0.95,
      vignette: true,
      dots: true,
      debris: true,
      dof: true,
      dofAperture: 0.33,
      dofMaxblur: 0.018,
      bleach: false,
      bleachAmount: 0.3,
      lut: true,
      lutStyle: 'etikate',
      lutAmount: 0.1,
      grain: true,
      grainStrength: 0.04,
      grainFPS: 16,
    },
    debug: {
      view: 'final',
      originHelper: false,
      debugCam: true,
      hexGrid: false,
      tileLabels: false,
      tileLabelMode: 'coords',
      floor: true,
      levelColors: false,
      whiteMode: false,
      blendNoiseScale: 0.03,
      blendOffset: 0.0,
    },
    renderer: {
      dpr: 1, // Will be set dynamically based on device
    },
    roads: {
      cumulativeWeights: false,
      maxTiles: 150,
      layers: 1,
      useWFC: true,
      useHex: true,
      hexGridRadius: 6,
      animateWFC: true,
      animateDelay: 6,
      useLevels: true,
      showOutlines: true,
    },
    decoration: {
      treeNoiseFreq: 0.05,
      treeThreshold: 0.5,
      windStrength: 0.0375,
      windSpeed: 1.46,
      windFreq: 0.902,
    },
    water: {
      y: 0.92,
      opacity: 0.25,
      speed: 1.1,
      freq: 4.4,
    },
    weather: {
      mode: 'none',
      intensity: 0.1,
      opacity: 0.8,
      speed: 0.4,
      wind: 0,
      wobble: 0.5,
      snowSize: 5,
    },
  }

  init() {
    const { demo } = this
    const gui = new GUI()
    this.gui = gui

    // Store params on demo for single source of truth
    const allParams = demo.params = JSON.parse(JSON.stringify(GUIManager.defaultParams))

    // DPR dropdown (default 1)
    allParams.renderer.dpr = 1
    gui.add(allParams.renderer, 'dpr', [1, 1.5, 2]).name('DPR').onChange((v) => {
      demo.renderer.setPixelRatio(v)
      demo.onResize()
    })

    // Top-level controls (no folder)
    gui.add(allParams.camera, 'perspective').name('Perspective Cam').onChange((v) => {
      demo.switchCamera(v)
    })
    this.fovController = gui.add(allParams.camera, 'fov', 20, 90, 1).name('FOV').onChange((v) => {
      demo.perspCamera.fov = v
      demo.perspCamera.updateProjectionMatrix()
    })

    // Debug view
    const viewMap = { final: 0, color: 1, depth: 2, normal: 3, ao: 4, overlay: 5, effects: 6 }
    gui.add(allParams.debug, 'view', Object.keys(viewMap)).name('Debug View').onChange((v) => {
      demo.debugView.value = viewMap[v]
    })

    // Visual toggles at top level
    gui.add(allParams.debug, 'originHelper').name('Axes Helpers').onChange((v) => {
      if (demo.axesHelper) demo.axesHelper.visible = v
      demo.city.setAxesHelpersVisible(v)
    })
    gui.add(allParams.debug, 'debugCam').name('Debug Cam').onChange((v) => {
      demo.controls.maxPolarAngle = v ? Math.PI : 1.44
      demo.controls.minDistance = v ? 0 : 40
      demo.controls.maxDistance = v ? Infinity : 125
    })
    gui.add(allParams.debug, 'hexGrid').name('Hex Helper').onChange((v) => {
      demo.city.setHelpersVisible(v)
    })
    gui.add(allParams.roads, 'showOutlines').name('Show Outlines').onChange((v) => {
      demo.city?.setOutlinesVisible(v)
    })
    gui.add(allParams.debug, 'tileLabels').name('Tile Labels').onChange((v) => {
      demo.city.setTileLabelsVisible(v)
    })
    gui.add(allParams.debug, 'tileLabelMode', ['coords', 'levels']).name('Label Mode').onChange((v) => {
      demo.city.tileLabelMode = v
      if (allParams.debug.tileLabels) demo.city.createTileLabels()
    })
    gui.add(allParams.debug, 'levelColors').name('Level Colors').onChange((v) => {
      HexTile.debugLevelColors = v
      demo.city.updateTileColors()
    })
    gui.add(allParams.debug, 'whiteMode').name('White Mode').onChange((v) => {
      demo.city.setWhiteMode(v)
    })

    // Biome texture pickers + level bias
    const biomeOptions = {
      'moody': './assets/textures/moody.png',
      'summer': './assets/textures/summer.png',
      'fall': './assets/textures/fall.png',
      'winter': './assets/textures/winter.png',
      'default': './assets/textures/default.png',
    }
    allParams.debug.biomeLo = 'moody'
    allParams.debug.biomeHi = 'winter'
    allParams.debug.levelBias = -0.3
    gui.add(allParams.debug, 'biomeLo', Object.keys(biomeOptions)).name('Biome Lo').onChange((v) => {
      demo.city.swapBiomeTexture('lo', biomeOptions[v])
    })
    gui.add(allParams.debug, 'biomeHi', Object.keys(biomeOptions)).name('Biome Hi').onChange((v) => {
      demo.city.swapBiomeTexture('hi', biomeOptions[v])
    })
    gui.add(allParams.debug, 'levelBias', -1, 1, 0.05).name('Level Bias').onChange((v) => {
      if (demo.city._levelBias) demo.city._levelBias.value = v
    })

    // Action buttons
    gui.add({ regen: () => {
      demo.city.regenerate({
        animate: allParams.roads.animateWFC,
        animateDelay: allParams.roads.animateDelay,
      })
      // Restore hex helper visibility from GUI state
      demo.city.setHelpersVisible(allParams.debug.hexGrid)
    } }, 'regen').name('Regen')
    gui.add({ exportPNG: () => demo.exportPNG() }, 'exportPNG').name('Export PNG')
    gui.add({ autoBuild: () => demo.city.autoExpand([
      [0,0],[0,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,-2],[2,-1],[-1,1],[0,2],[1,1],[2,0],[2,1],[1,0],[0,-2],[-1,-2],[-2,-1],[-2,0],[-2,1]
    ]) }, 'autoBuild').name('Build Sequentially')
    gui.add({ buildAll: () => {
      import('./lib/Sounds.js').then(({ Sounds }) => Sounds.play('pop', 1.0, 0, 0.3))
      demo.city.populateAllGrids([
        [0,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,-2],[2,-1],[-1,1],[0,2],[1,1],[2,0],[2,1],[1,0],[0,-2],[-1,-2],[-2,-1],[-2,0],[-2,1]
      ])
    } }, 'buildAll').name('Build All')

    gui.add({
      copyState: () => {
        const exportData = {
          ...allParams,
          cameraState: {
            position: { x: demo.camera.position.x, y: demo.camera.position.y, z: demo.camera.position.z },
            target: { x: demo.controls.target.x, y: demo.controls.target.y, z: demo.controls.target.z },
          }
        }
        const json = JSON.stringify(exportData, null, 2)
        navigator.clipboard.writeText(json)
        console.log('GUI State copied:\n', json)
      }
    }, 'copyState').name('Copy GUI State')
    gui.add({
      logControls: () => {
        const c = demo.controls
        const cam = demo.camera
        console.log('OrbitControls State:')
        console.log('  camera.position:', cam.position.x.toFixed(3), cam.position.y.toFixed(3), cam.position.z.toFixed(3))
        console.log('  target:', c.target.x.toFixed(3), c.target.y.toFixed(3), c.target.z.toFixed(3))
        console.log('  distance:', cam.position.distanceTo(c.target).toFixed(3))
        console.log('  polar angle (vertical):', c.getPolarAngle().toFixed(3), 'rad =', (c.getPolarAngle() * 180 / Math.PI).toFixed(1) + '°')
        console.log('  azimuth angle (horizontal):', c.getAzimuthalAngle().toFixed(3), 'rad =', (c.getAzimuthalAngle() * 180 / Math.PI).toFixed(1) + '°')
      }
    }, 'logControls').name('Log Orbit State')

    // Roads folder
    const mapFolder = gui.addFolder('Map').close()
    mapFolder.add(allParams.roads, 'animateWFC').name('Animate WFC')


    // Decoration folder
    const decorationFolder = gui.addFolder('Decoration').close()
    decorationFolder.add(allParams.decoration, 'treeNoiseFreq', 0.01, 0.2, 0.01).name('Tree Noise Freq').onChange((v) => {
      setTreeNoiseFrequency(v)
      demo.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'treeThreshold', 0, 1, 0.05).name('Tree Threshold').onChange((v) => {
      setTreeThreshold(v)
      demo.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'windStrength', 0, 0.15).name('Wind Strength').onChange((v) => {
      if (demo.city._windStrength) demo.city._windStrength.value = v
    })
    decorationFolder.add(allParams.decoration, 'windSpeed', 0, 2.0).name('Wind Speed').onChange((v) => {
      if (demo.city._windSpeed) demo.city._windSpeed.value = v
    })
    decorationFolder.add(allParams.decoration, 'windFreq', 0, 1.0).name('Wind Noise Freq').onChange((v) => {
      if (demo.city._windFreq) demo.city._windFreq.value = v
    })

    // Water folder
    const waterFolder = gui.addFolder('Water').close()
    waterFolder.add(allParams.water, 'y', 0.7, 1.0, 0.01).name('Y Height').onChange((v) => {
      if (demo.city.waterPlane) demo.city.waterPlane.position.y = v
    })
    waterFolder.add(allParams.water, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      if (demo.city._waterOpacity) demo.city._waterOpacity.value = v
    })
    waterFolder.add(allParams.water, 'speed', 0, 5, 0.1).name('Speed').onChange((v) => {
      if (demo.city._waterSpeed) demo.city._waterSpeed.value = v
    })
    waterFolder.add(allParams.water, 'freq', 0.1, 5, 0.1).name('Frequency').onChange((v) => {
      if (demo.city._waterFreq) demo.city._waterFreq.value = v
    })

    // Weather folder
    const weatherFolder = gui.addFolder('Weather').close()
    weatherFolder.add(allParams.weather, 'mode', ['none', 'rain', 'snow']).name('Mode').onChange((v) => {
      demo.city.weather?.setMode(v)
    })
    weatherFolder.add(allParams.weather, 'intensity', 0, 1, 0.05).name('Intensity').onChange((v) => {
      demo.city.weather?.setIntensity(v)
    })
    weatherFolder.add(allParams.weather, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      demo.city.weather?.setOpacity(v)
    })
    weatherFolder.add(allParams.weather, 'speed', 0, 2, 0.05).name('Speed').onChange((v) => {
      demo.city.weather?.setSpeed(v)
    })
    weatherFolder.add(allParams.weather, 'wind', -1, 1, 0.05).name('Wind').onChange((v) => {
      demo.city.weather?.setWind(v)
    })
    weatherFolder.add(allParams.weather, 'wobble', 0, 5, 0.1).name('Wobble').onChange((v) => {
      demo.city.weather?.setWobble(v)
    })
    weatherFolder.add(allParams.weather, 'snowSize', 1, 20, 0.5).name('Snow Size').onChange((v) => {
      demo.city.weather?.setSnowSize(v)
    })

    // Lights folder
    const lightsFolder = gui.addFolder('Lights').close()
    const hdrOptions = [
      'studio_small_05_2k.hdr',
      'studio_small_08_2k.hdr',
      'photo_studio_01_1k.hdr',
      'royal_esplanade_1k.hdr',
      'solitude_interior_1k.hdr',
      'venice_sunset_1k.hdr',
      'kloofendal_48d_partly_cloudy_puresky_1k.hdr',
      'overcast_soil_puresky_1k.hdr',
      'simons_town_rocks_1k.hdr',
      'tiber_island_1k.hdr',
    ]
    lightsFolder.add(allParams.lighting, 'hdr', hdrOptions).name('HDR').onChange((v) => {
      demo.lighting.loadHDR(v)
    })
    // HDR rotation disabled — see TODO.md for details
    // lightsFolder.add(allParams.lighting, 'hdrRotation', 0, 360, 1).name('HDR Rotation')
    lightsFolder.add(allParams.lighting, 'exposure', 0, 2, 0.05).name('Exposure').onChange((v) => {
      demo.renderer.toneMappingExposure = v
    })
    const toneMappingMap = {
      'None': NoToneMapping,
      'Linear': LinearToneMapping,
      'Reinhard': ReinhardToneMapping,
      'Cineon': CineonToneMapping,
      'ACES': ACESFilmicToneMapping,
      'AgX': AgXToneMapping,
      'Neutral': NeutralToneMapping,
    }
    lightsFolder.add(allParams.lighting, 'toneMapping', Object.keys(toneMappingMap)).name('Tone Mapping').onChange((v) => {
      demo.renderer.toneMapping = toneMappingMap[v]
      if (demo.postFX) demo.postFX.postProcessing.needsUpdate = true
    })
    lightsFolder.add(allParams.lighting, 'envIntensity', 0, 2, 0.05).name('Env Intensity').onChange((v) => {
      demo.scene.environmentIntensity = v
    })
    lightsFolder.add(allParams.lighting, 'dirLight', 0, 5, 0.05).name('Dir Light').onChange((v) => {
      if (demo.lighting.dirLight) demo.lighting.dirLight.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'hemiLight', 0, 5, 0.05).name('Hemi Light').onChange((v) => {
      if (demo.lighting.hemiLight) demo.lighting.hemiLight.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'shadowIntensity', 0, 1, 0.05).name('Shadow Intensity').onChange((v) => {
      if (demo.lighting.dirLight) demo.lighting.dirLight.shadow.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'lightX', -100, 100, 5).name('Light X').onChange((v) => {
      if (demo.lighting.dirLightOffset) {
        demo.lighting.dirLightOffset.x = v
        demo.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightY', 20, 200, 5).name('Light Y').onChange((v) => {
      if (demo.lighting.dirLightOffset) {
        demo.lighting.dirLightOffset.y = v
        demo.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightZ', -100, 100, 5).name('Light Z').onChange((v) => {
      if (demo.lighting.dirLightOffset) {
        demo.lighting.dirLightOffset.z = v
        demo.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'showHelper').name('Show Helper').onChange((v) => {
      if (demo.lighting.dirLightHelper) demo.lighting.dirLightHelper.visible = v
    })

    // Material folder removed - using GLB material directly for hex tiles

    // Effects folder
    const fxFolder = gui.addFolder('Post Processing').close()
    fxFolder.add(allParams.fx, 'ao').name('AO').onChange((v) => {
      demo.aoEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'aoScale', 0, 5, 0.1).name('AO Scale').onChange((v) => {
      if (demo.aoPass) demo.aoPass.scale.value = v
    })
    fxFolder.add(allParams.fx, 'aoRadius', 0.01, 2, 0.01).name('AO Radius').onChange((v) => {
      if (demo.aoPass) demo.aoPass.radius.value = v
    })
    fxFolder.add(allParams.fx, 'aoBlur', 0, 0.5, 0.01).name('AO Blur').onChange((v) => {
      if (demo.aoBlurAmount) demo.aoBlurAmount.value = v
    })
    fxFolder.add(allParams.fx, 'aoIntensity', 0, 1, 0.05).name('AO Intensity').onChange((v) => {
      demo.aoIntensity.value = v
    })
    fxFolder.add(allParams.fx, 'vignette').name('Vignette').onChange((v) => {
      demo.vignetteEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dof').name('DOF').onChange((v) => {
      demo.dofEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dofAperture', 0, 1, 0.01).name('DOF Aperture').onChange((v) => {
      demo.dofAperture.value = v / 1000
    })
    fxFolder.add(allParams.fx, 'dofMaxblur', 0.001, 0.05, 0.001).name('DOF Max Blur').onChange((v) => {
      demo.dofMaxblur.value = v
    })
    fxFolder.add(allParams.fx, 'bleach').name('Bleach Bypass').onChange((v) => {
      demo.bleachEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'bleachAmount', 0, 0.3, 0.05).name('Bleach Amount').onChange((v) => {
      demo.bleachAmount.value = v
    })
    fxFolder.add(allParams.fx, 'lut').name('LUT').onChange((v) => {
      demo.lutEnabled.value = v ? 1 : 0
    })
    const lutOptions = [
      'amatorka', 'brannan', 'earlybird', 'etikate', 'gotham', 'hefe',
      'inkwell', 'kelvin', 'lofi', 'lookup', 'nashville', 'sutro',
      'toaster', 'walden', 'xpro',
    ]
    fxFolder.add(allParams.fx, 'lutStyle', lutOptions).name('LUT Style').onChange((v) => {
      demo.postFX.swapLut(`./assets/lut/${v}.png`)
    })
    fxFolder.add(allParams.fx, 'lutAmount', 0, 1, 0.05).name('LUT Amount').onChange((v) => {
      demo.lutAmount.value = v
    })
    fxFolder.add(allParams.fx, 'grain').name('Grain').onChange((v) => {
      demo.grainEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'grainStrength', 0, 0.2, 0.005).name('Grain Strength').onChange((v) => {
      demo.grainStrength.value = v
    })
    fxFolder.add(allParams.fx, 'grainFPS', 1, 60, 1).name('Grain FPS')

    return allParams
  }

  // Apply all GUI params to scene objects (called after init)
  applyParams() {
    const { demo } = this
    const { params } = demo

    // Lighting
    const toneMappingMap = {
      'None': NoToneMapping, 'Linear': LinearToneMapping, 'Reinhard': ReinhardToneMapping,
      'Cineon': CineonToneMapping, 'ACES': ACESFilmicToneMapping,
      'AgX': AgXToneMapping, 'Neutral': NeutralToneMapping,
    }
    demo.renderer.toneMapping = toneMappingMap[params.lighting.toneMapping] || NoToneMapping
    demo.renderer.toneMappingExposure = params.lighting.exposure
    demo.scene.environmentIntensity = params.lighting.envIntensity
    if (demo.lighting.dirLight) {
      demo.lighting.dirLight.intensity = params.lighting.dirLight
      demo.lighting.dirLight.shadow.intensity = params.lighting.shadowIntensity
    }
    if (demo.lighting.hemiLight) demo.lighting.hemiLight.intensity = params.lighting.hemiLight
    if (demo.lighting.dirLightOffset) {
      demo.lighting.dirLightOffset.x = params.lighting.lightX
      demo.lighting.dirLightOffset.y = params.lighting.lightY
      demo.lighting.dirLightOffset.z = params.lighting.lightZ
      demo.lighting.updateShadowFrustum()
    }
    if (demo.lighting.dirLightHelper) demo.lighting.dirLightHelper.visible = params.lighting.showHelper
    // Material override removed - using GLB material directly for hex tiles

    // Post processing
    demo.aoEnabled.value = params.fx.ao ? 1 : 0
    if (demo.aoPass) {
      demo.aoPass.scale.value = params.fx.aoScale
      demo.aoPass.radius.value = params.fx.aoRadius
    }
    if (demo.aoBlurAmount) demo.aoBlurAmount.value = params.fx.aoBlur
    demo.aoIntensity.value = params.fx.aoIntensity
    demo.vignetteEnabled.value = params.fx.vignette ? 1 : 0
    demo.dofEnabled.value = params.fx.dof ? 1 : 0
    demo.dofAperture.value = params.fx.dofAperture / 1000
    demo.dofMaxblur.value = params.fx.dofMaxblur
    demo.bleachEnabled.value = params.fx.bleach ? 1 : 0
    demo.bleachAmount.value = params.fx.bleachAmount
    demo.lutEnabled.value = params.fx.lut ? 1 : 0
    demo.lutAmount.value = params.fx.lutAmount
    demo.grainEnabled.value = params.fx.grain ? 1 : 0
    demo.grainStrength.value = params.fx.grainStrength

    // Camera
    demo.perspCamera.fov = params.camera.fov
    demo.perspCamera.updateProjectionMatrix()
    demo.controls.maxPolarAngle = params.debug.debugCam ? Math.PI : 1.44
    demo.controls.minDistance = params.debug.debugCam ? 0 : 40
    demo.controls.maxDistance = params.debug.debugCam ? Infinity : 125
    if (demo.axesHelper) demo.axesHelper.visible = params.debug.originHelper
    demo.city.setAxesHelpersVisible(params.debug.originHelper)

    // Hex helper visibility
    demo.city.setHelpersVisible(params.debug.hexGrid)

    // Weather
    if (demo.city.weather) {
      demo.city.weather.setMode(params.weather.mode)
      demo.city.weather.setIntensity(params.weather.intensity)
      demo.city.weather.setOpacity(params.weather.opacity)
      demo.city.weather.setSpeed(params.weather.speed)
      demo.city.weather.setWind(params.weather.wind)
      demo.city.weather.setWobble(params.weather.wobble)
      demo.city.weather.setSnowSize(params.weather.snowSize)
    }

    // Level bias
    if (demo.city._levelBias) demo.city._levelBias.value = params.debug.levelBias

    // Renderer
    demo.renderer.setPixelRatio(params.renderer.dpr)
  }
}
