import { Demo } from './Demo.js'
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js'
// import { Sounds } from './lib/Sounds.js'

const loadingEl = document.getElementById('loading')
// const loaderGif = document.getElementById('loader-gif')
// const startBtn = document.getElementById('start-btn')
const canvas = document.getElementById('canvas')

let demo = null

async function init() {
  if (!WebGPU.isAvailable()) {
    loadingEl.innerHTML = '<p style="color:#fff">WebGPU is not available on your device or browser.</p>'
    return
  }

  demo = new Demo(canvas)
  await demo.init()

  // Go straight to rendering (no start button)
  start()

  // // WebGPU ready - hide loader gif, show start button
  // loaderGif.style.display = 'none'
  // startBtn.style.display = 'block'
}

function start() {
  // Hide loading overlay
  loadingEl.style.display = 'none'

  // Fade in scene
  demo.fadeIn(1000)

  // Start intro build animation
  demo.city.startIntroAnimation(demo.camera, demo.controls, 4)
}

// startBtn.addEventListener('click', start)
init()
