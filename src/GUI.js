import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import {
  NoToneMapping, LinearToneMapping, ReinhardToneMapping,
  CineonToneMapping, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping,
} from 'three/webgpu'
import { Sounds } from './lib/Sounds.js'
import { setTreeNoiseFrequency, setTreeThreshold } from './hexmap/Decorations.js'
import { HexTile } from './hexmap/HexTiles.js'

export class GUIManager {
  constructor(app) {
    this.app = app
    this.gui = null
    this.fovController = null
  }

  // Default params - single source of truth
  static defaultParams = {
    camera: {
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
      dofAperture: 0.21,
      dofMaxblur: 0.005,
      bleach: false,
      bleachAmount: 0.3,
      lut: true,
      lutStyle: 'etikate',
      lutAmount: 0.1,
      grain: true,
      grainStrength: 0.03,
      grainFPS: 0,
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
      y: 0.88,
      opacity: 0.1,
      speed: 1.3,
      freq: 1.5,
      angle: 0,
      brightness: 0.53,
      contrast: 17.5,
    },
    waves: {
      speed: 2,
      count: 4,
      opacity: 0.2,
      break: 0.135,
      width: 0.27,
      offset: 0.3,
      gradientOpacity: 0,
      gradientColor: '#ccb233',
      showMask: false,
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
    const { app } = this
    const gui = new GUI()
    this.gui = gui

    // Store params on app for single source of truth
    const allParams = app.params = JSON.parse(JSON.stringify(GUIManager.defaultParams))

    // DPR dropdown (default 1)
    allParams.renderer.dpr = 1
    gui.add(allParams.renderer, 'dpr', [1, 1.5, 2]).name('DPR').onChange((v) => {
      app.renderer.setPixelRatio(v)
      app.onResize()
    })

    // Top-level controls (no folder)
    this.fovController = gui.add(allParams.camera, 'fov', 20, 90, 1).name('FOV').onChange((v) => {
      app.perspCamera.fov = v
      app.perspCamera.updateProjectionMatrix()
    })

    // Debug view
    const viewMap = { final: 0, color: 1, normal: 3, ao: 4, overlay: 5, effects: 6, mask: 7 }
    gui.add(allParams.debug, 'view', Object.keys(viewMap)).name('Debug View').onChange((v) => {
      app.debugView.value = viewMap[v]
    })

    // Visual toggles at top level
    gui.add(allParams.debug, 'originHelper').name('Axes Helpers').onChange((v) => {
      if (app.axesHelper) app.axesHelper.visible = v
      app.city.setAxesHelpersVisible(v)
    })
    gui.add(allParams.debug, 'debugCam').name('Debug Cam').onChange((v) => {
      app.controls.maxPolarAngle = v ? Math.PI : 1.1
      app.controls.minDistance = v ? 0 : 25
      app.controls.maxDistance = v ? Infinity : 125
    })
    gui.add(allParams.debug, 'hexGrid').name('Hex Grid').onChange((v) => {
      app.city.setHelpersVisible(v)
    })
    gui.add(allParams.roads, 'showOutlines').name('Show Outlines').onChange((v) => {
      app.city?.setOutlinesVisible(v)
    })
    gui.add(allParams.debug, 'tileLabels').name('Tile Labels').onChange((v) => {
      app.city.setTileLabelsVisible(v)
    })
    gui.add(allParams.debug, 'tileLabelMode', ['coords', 'levels']).name('Label Mode').onChange((v) => {
      app.city.tileLabelMode = v
      if (allParams.debug.tileLabels) app.city.createTileLabels()
    })
    gui.add(allParams.debug, 'levelColors').name('Level Colors').onChange((v) => {
      HexTile.debugLevelColors = v
      app.city.updateTileColors()
    })
    gui.add(allParams.debug, 'whiteMode').name('White Mode').onChange((v) => {
      app.city.setWhiteMode(v)
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
      app.city.swapBiomeTexture('lo', biomeOptions[v])
    })
    gui.add(allParams.debug, 'biomeHi', Object.keys(biomeOptions)).name('Biome Hi').onChange((v) => {
      app.city.swapBiomeTexture('hi', biomeOptions[v])
    })
    gui.add(allParams.debug, 'levelBias', -1, 1, 0.05).name('Level Bias').onChange((v) => {
      if (app.city._levelBias) app.city._levelBias.value = v
    })

    gui.add(allParams.roads, 'animateWFC').name('Animate WFC')

    // Action buttons
    gui.add({ regen: () => {
      app.city.regenerate({
        animate: allParams.roads.animateWFC,
        animateDelay: allParams.roads.animateDelay,
      })
      // Restore hex helper visibility from GUI state
      app.city.setHelpersVisible(allParams.debug.hexGrid)
    } }, 'regen').name('Regen')
    gui.add({ exportPNG: () => app.exportPNG() }, 'exportPNG').name('Export PNG')
    gui.add({ autoBuild: () => app.city.autoExpand([
      [0,0],[0,-1],[1,-1],[1,0],[0,1],[-1,0],[-1,-1],[-1,-2],[0,-2],[1,-2],[2,-1],[2,0],[2,1],[1,1],[0,2],[-1,1],[-2,1],[-2,0],[-2,-1]
    ]) }, 'autoBuild').name('Build Sequentially')
    gui.add({ buildAll: () => {
      import('./lib/Sounds.js').then(({ Sounds }) => Sounds.play('pop', 1.0, 0, 0.3))
      app.city.populateAllGrids()
    } }, 'buildAll').name('Build All')

    gui.add({
      copyState: () => {
        const exportData = {
          ...allParams,
          cameraState: {
            position: { x: app.camera.position.x, y: app.camera.position.y, z: app.camera.position.z },
            target: { x: app.controls.target.x, y: app.controls.target.y, z: app.controls.target.z },
          }
        }
        const json = JSON.stringify(exportData, null, 2)
        navigator.clipboard.writeText(json)
        console.log('GUI State copied:\n', json)
      }
    }, 'copyState').name('Copy GUI State')
    gui.add({
      logControls: () => {
        const c = app.controls
        const cam = app.camera
        console.log('OrbitControls State:')
        console.log('  camera.position:', cam.position.x.toFixed(3), cam.position.y.toFixed(3), cam.position.z.toFixed(3))
        console.log('  target:', c.target.x.toFixed(3), c.target.y.toFixed(3), c.target.z.toFixed(3))
        console.log('  distance:', cam.position.distanceTo(c.target).toFixed(3))
        console.log('  polar angle (vertical):', c.getPolarAngle().toFixed(3), 'rad =', (c.getPolarAngle() * 180 / Math.PI).toFixed(1) + '°')
        console.log('  azimuth angle (horizontal):', c.getAzimuthalAngle().toFixed(3), 'rad =', (c.getAzimuthalAngle() * 180 / Math.PI).toFixed(1) + '°')
      }
    }, 'logControls').name('Log Orbit State')

    // Decoration folder
    const decorationFolder = gui.addFolder('Decoration').close()
    decorationFolder.add(allParams.decoration, 'treeNoiseFreq', 0.01, 0.2, 0.01).name('Tree Noise Freq').onChange((v) => {
      setTreeNoiseFrequency(v)
      app.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'treeThreshold', 0, 1, 0.05).name('Tree Threshold').onChange((v) => {
      setTreeThreshold(v)
      app.city.repopulateDecorations()
    })

    // Water folder
    const waterFolder = gui.addFolder('Water').close()
    waterFolder.add(allParams.water, 'y', 0.7, 1.0, 0.01).name('Y Height').onChange((v) => {
      if (app.city.waterPlane) app.city.waterPlane.position.y = v
    })
    waterFolder.add(allParams.water, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      if (app.city._waterOpacity) app.city._waterOpacity.value = v
    })
    waterFolder.add(allParams.water, 'speed', 0, 5, 0.05).name('Speed').onChange((v) => {
      if (app.city._waterSpeed) app.city._waterSpeed.value = v
    })
    waterFolder.add(allParams.water, 'freq', 0.1, 3, 0.05).name('Frequency').onChange((v) => {
      if (app.city._waterFreq) app.city._waterFreq.value = v
    })
    waterFolder.add(allParams.water, 'angle', 0, 360, 1).name('Angle').onChange((v) => {
      if (app.city._waterAngle) app.city._waterAngle.value = v * Math.PI / 180
    })
    waterFolder.add(allParams.water, 'brightness', 0.1, 0.9, 0.01).name('Brightness').onChange((v) => {
      if (app.city._waterBrightness) app.city._waterBrightness.value = v
    })
    waterFolder.add(allParams.water, 'contrast', 1, 40, 0.5).name('Contrast').onChange((v) => {
      if (app.city._waterContrast) app.city._waterContrast.value = v
    })
    // Waves folder
    const wavesFolder = gui.addFolder('Waves').close()
    wavesFolder.add(allParams.waves, 'speed', 0.1, 5.0, 0.05).name('Speed').onChange((v) => {
      if (app.city._waveSpeed) app.city._waveSpeed.value = v
    })
    wavesFolder.add(allParams.waves, 'count', 1, 20, 1).name('Count').onChange((v) => {
      if (app.city._waveCount) app.city._waveCount.value = v
    })
    wavesFolder.add(allParams.waves, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      if (app.city._waveOpacity) app.city._waveOpacity.value = v
    })
    wavesFolder.add(allParams.waves, 'break', 0, 0.5, 0.005).name('Break').onChange((v) => {
      if (app.city._waveNoiseBreak) app.city._waveNoiseBreak.value = v
    })
    wavesFolder.add(allParams.waves, 'width', 0.1, 0.98, 0.01).name('Width').onChange((v) => {
      if (app.city._waveWidth) app.city._waveWidth.value = 1 - v
    })
    wavesFolder.add(allParams.waves, 'offset', 0, 0.8, 0.01).name('Offset').onChange((v) => {
      if (app.city._waveOffset) app.city._waveOffset.value = v
    })
    wavesFolder.add(allParams.waves, 'gradientOpacity', 0, 1, 0.01).name('Gradient Opacity').onChange((v) => {
      if (app.city._waveGradientOpacity) app.city._waveGradientOpacity.value = v
    })
    wavesFolder.addColor(allParams.waves, 'gradientColor').name('Gradient Color').onChange((v) => {
      if (app.city._waveGradientColor) app.city._waveGradientColor.value.set(v)
    })
    wavesFolder.add(allParams.waves, 'showMask', false).name('Show Mask').onChange((v) => {
      if (app.wavesMask) app.wavesMask.showDebug = v
    })

    // Weather folder
    const weatherFolder = gui.addFolder('Weather').close()
    weatherFolder.add(allParams.weather, 'mode', ['none', 'rain', 'snow']).name('Mode').onChange((v) => {
      app.city.weather?.setMode(v)
    })
    weatherFolder.add(allParams.weather, 'intensity', 0, 1, 0.05).name('Intensity').onChange((v) => {
      app.city.weather?.setIntensity(v)
    })
    weatherFolder.add(allParams.weather, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      app.city.weather?.setOpacity(v)
    })
    weatherFolder.add(allParams.weather, 'speed', 0, 2, 0.05).name('Speed').onChange((v) => {
      app.city.weather?.setSpeed(v)
    })
    weatherFolder.add(allParams.weather, 'wind', -1, 1, 0.05).name('Wind').onChange((v) => {
      app.city.weather?.setWind(v)
    })
    weatherFolder.add(allParams.weather, 'wobble', 0, 5, 0.1).name('Wobble').onChange((v) => {
      app.city.weather?.setWobble(v)
    })
    weatherFolder.add(allParams.weather, 'snowSize', 1, 20, 0.5).name('Snow Size').onChange((v) => {
      app.city.weather?.setSnowSize(v)
    })
    weatherFolder.add(allParams.decoration, 'windStrength', 0, 0.15).name('Wind Strength').onChange((v) => {
      if (app.city._windStrength) app.city._windStrength.value = v
    })
    weatherFolder.add(allParams.decoration, 'windSpeed', 0, 2.0).name('Wind Speed').onChange((v) => {
      if (app.city._windSpeed) app.city._windSpeed.value = v
    })
    weatherFolder.add(allParams.decoration, 'windFreq', 0, 1.0).name('Wind Noise Freq').onChange((v) => {
      if (app.city._windFreq) app.city._windFreq.value = v
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
      app.lighting.loadHDR(v)
    })
    // HDR rotation disabled — see TODO.md for details
    // lightsFolder.add(allParams.lighting, 'hdrRotation', 0, 360, 1).name('HDR Rotation')
    lightsFolder.add(allParams.lighting, 'exposure', 0, 2, 0.05).name('Exposure').onChange((v) => {
      app.renderer.toneMappingExposure = v
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
      app.renderer.toneMapping = toneMappingMap[v]
      if (app.postFX) app.postFX.postProcessing.needsUpdate = true
    })
    lightsFolder.add(allParams.lighting, 'envIntensity', 0, 2, 0.05).name('Env Intensity').onChange((v) => {
      app.scene.environmentIntensity = v
    })
    lightsFolder.add(allParams.lighting, 'dirLight', 0, 5, 0.05).name('Dir Light').onChange((v) => {
      if (app.lighting.dirLight) app.lighting.dirLight.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'hemiLight', 0, 5, 0.05).name('Hemi Light').onChange((v) => {
      if (app.lighting.hemiLight) app.lighting.hemiLight.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'shadowIntensity', 0, 1, 0.05).name('Shadow Intensity').onChange((v) => {
      if (app.lighting.dirLight) app.lighting.dirLight.shadow.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'lightX', -100, 100, 5).name('Light X').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.x = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightY', 20, 200, 5).name('Light Y').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.y = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightZ', -100, 100, 5).name('Light Z').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.z = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'showHelper').name('Show Helper').onChange((v) => {
      if (app.lighting.dirLightHelper) app.lighting.dirLightHelper.visible = v
    })

    // Material folder removed - using GLB material directly for hex tiles

    // Effects folder
    const fxFolder = gui.addFolder('Post Processing').close()
    fxFolder.add(allParams.fx, 'ao').name('AO').onChange((v) => {
      app.aoEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'aoScale', 0, 5, 0.1).name('AO Scale').onChange((v) => {
      if (app.aoPass) app.aoPass.scale.value = v
    })
    fxFolder.add(allParams.fx, 'aoRadius', 0.01, 2, 0.01).name('AO Radius').onChange((v) => {
      if (app.aoPass) app.aoPass.radius.value = v
    })
    fxFolder.add(allParams.fx, 'aoBlur', 0, 0.5, 0.01).name('AO Blur').onChange((v) => {
      if (app.aoBlurAmount) app.aoBlurAmount.value = v
    })
    fxFolder.add(allParams.fx, 'aoIntensity', 0, 1, 0.05).name('AO Intensity').onChange((v) => {
      app.aoIntensity.value = v
    })
    fxFolder.add(allParams.fx, 'vignette').name('Vignette').onChange((v) => {
      app.vignetteEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dof').name('DOF').onChange((v) => {
      app.dofEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dofAperture', 0, 1, 0.01).name('DOF Aperture').onChange((v) => {
      app.dofAperture.value = v / 1000
    })
    fxFolder.add(allParams.fx, 'dofMaxblur', 0.001, 0.02, 0.001).name('DOF Max Blur').onChange((v) => {
      app.dofMaxblur.value = v
    })
    fxFolder.add(allParams.fx, 'bleach').name('Bleach Bypass').onChange((v) => {
      app.bleachEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'bleachAmount', 0, 0.3, 0.05).name('Bleach Amount').onChange((v) => {
      app.bleachAmount.value = v
    })
    fxFolder.add(allParams.fx, 'lut').name('LUT').onChange((v) => {
      app.lutEnabled.value = v ? 1 : 0
    })
    const lutOptions = [
      'amatorka', 'brannan', 'earlybird', 'etikate', 'gotham', 'hefe',
      'inkwell', 'kelvin', 'lofi', 'lookup', 'nashville', 'sutro',
      'toaster', 'walden', 'xpro',
    ]
    fxFolder.add(allParams.fx, 'lutStyle', lutOptions).name('LUT Style').onChange((v) => {
      app.postFX.swapLut(`./assets/lut/${v}.png`)
    })
    fxFolder.add(allParams.fx, 'lutAmount', 0, 1, 0.05).name('LUT Amount').onChange((v) => {
      app.lutAmount.value = v
    })
    fxFolder.add(allParams.fx, 'grain').name('Grain').onChange((v) => {
      app.grainEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'grainStrength', 0, 0.2, 0.005).name('Grain Strength').onChange((v) => {
      app.grainStrength.value = v
    })
    fxFolder.add(allParams.fx, 'grainFPS', 0, 60, 1).name('Grain FPS')

    return allParams
  }

  // Apply all GUI params to scene objects (called after init)
  applyParams() {
    const { app } = this
    const { params } = app

    // Lighting
    const toneMappingMap = {
      'None': NoToneMapping, 'Linear': LinearToneMapping, 'Reinhard': ReinhardToneMapping,
      'Cineon': CineonToneMapping, 'ACES': ACESFilmicToneMapping,
      'AgX': AgXToneMapping, 'Neutral': NeutralToneMapping,
    }
    app.renderer.toneMapping = toneMappingMap[params.lighting.toneMapping] || NoToneMapping
    app.renderer.toneMappingExposure = params.lighting.exposure
    app.scene.environmentIntensity = params.lighting.envIntensity
    if (app.lighting.dirLight) {
      app.lighting.dirLight.intensity = params.lighting.dirLight
      app.lighting.dirLight.shadow.intensity = params.lighting.shadowIntensity
    }
    if (app.lighting.hemiLight) app.lighting.hemiLight.intensity = params.lighting.hemiLight
    if (app.lighting.dirLightOffset) {
      app.lighting.dirLightOffset.x = params.lighting.lightX
      app.lighting.dirLightOffset.y = params.lighting.lightY
      app.lighting.dirLightOffset.z = params.lighting.lightZ
      app.lighting.updateShadowFrustum()
    }
    if (app.lighting.dirLightHelper) app.lighting.dirLightHelper.visible = params.lighting.showHelper
    // Material override removed - using GLB material directly for hex tiles

    // Post processing
    app.aoEnabled.value = params.fx.ao ? 1 : 0
    if (app.aoPass) {
      app.aoPass.scale.value = params.fx.aoScale
      app.aoPass.radius.value = params.fx.aoRadius
    }
    if (app.aoBlurAmount) app.aoBlurAmount.value = params.fx.aoBlur
    app.aoIntensity.value = params.fx.aoIntensity
    app.vignetteEnabled.value = params.fx.vignette ? 1 : 0
    app.dofEnabled.value = params.fx.dof ? 1 : 0
    app.dofAperture.value = params.fx.dofAperture / 1000
    app.dofMaxblur.value = params.fx.dofMaxblur
    app.bleachEnabled.value = params.fx.bleach ? 1 : 0
    app.bleachAmount.value = params.fx.bleachAmount
    app.lutEnabled.value = params.fx.lut ? 1 : 0
    app.lutAmount.value = params.fx.lutAmount
    app.grainEnabled.value = params.fx.grain ? 1 : 0
    app.grainStrength.value = params.fx.grainStrength

    // Camera
    app.perspCamera.fov = params.camera.fov
    app.perspCamera.updateProjectionMatrix()
    app.controls.maxPolarAngle = params.debug.debugCam ? Math.PI : 1.1
    app.controls.minDistance = params.debug.debugCam ? 0 : 25
    app.controls.maxDistance = params.debug.debugCam ? Infinity : 125
    if (app.axesHelper) app.axesHelper.visible = params.debug.originHelper
    app.city.setAxesHelpersVisible(params.debug.originHelper)

    // Hex helper visibility
    app.city.setHelpersVisible(params.debug.hexGrid)

    // Weather
    if (app.city.weather) {
      app.city.weather.setMode(params.weather.mode)
      app.city.weather.setIntensity(params.weather.intensity)
      app.city.weather.setOpacity(params.weather.opacity)
      app.city.weather.setSpeed(params.weather.speed)
      app.city.weather.setWind(params.weather.wind)
      app.city.weather.setWobble(params.weather.wobble)
      app.city.weather.setSnowSize(params.weather.snowSize)
    }

    // Level bias
    if (app.city._levelBias) app.city._levelBias.value = params.debug.levelBias

    // Water
    if (app.city.waterPlane) app.city.waterPlane.position.y = params.water.y
    // Don't set _waterOpacity here — starts at 0 and fades in with waves after first grid
    if (app.city._waterSpeed) app.city._waterSpeed.value = params.water.speed
    if (app.city._waterFreq) app.city._waterFreq.value = params.water.freq
    if (app.city._waterAngle) app.city._waterAngle.value = params.water.angle * Math.PI / 180
    if (app.city._waterBrightness) app.city._waterBrightness.value = params.water.brightness
    if (app.city._waterContrast) app.city._waterContrast.value = params.water.contrast
    // Waves
    if (app.city._waveSpeed) app.city._waveSpeed.value = params.waves.speed
    if (app.city._waveCount) app.city._waveCount.value = params.waves.count
    if (app.city._waveOpacity) app.city._waveOpacity.value = params.waves.opacity
    if (app.city._waveGradientOpacity) app.city._waveGradientOpacity.value = params.waves.gradientOpacity
    if (app.city._waveNoiseBreak) app.city._waveNoiseBreak.value = params.waves.break
    if (app.city._waveWidth) app.city._waveWidth.value = 1 - params.waves.width
    if (app.city._waveOffset) app.city._waveOffset.value = params.waves.offset
    if (app.city._waveGradientColor) app.city._waveGradientColor.value.set(params.waves.gradientColor)

    // Renderer
    app.renderer.setPixelRatio(params.renderer.dpr)
  }
}
