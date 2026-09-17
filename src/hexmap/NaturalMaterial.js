import { DataTexture, RGBAFormat, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter, TextureLoader, SRGBColorSpace } from 'three/webgpu'
import { vec2, vec3, float, texture, uv, mix, select, positionWorld, normalWorldGeometry, normalViewGeometry, bumpMap, uniform, sin, max, materialRoughness } from 'three/tsl'

// One repeatable texture holds broad soil variation, fine grain, and rock strata.
// Generated once; mipmaps suppress distant shimmer. No external asset requests.
function createDetailTexture() {
  const size = 512, data = new Uint8Array(size * size * 4)
  const hash = (x, y) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
    n = Math.imul(n ^ n >>> 13, 1274126177)
    return ((n ^ n >>> 16) >>> 0) / 4294967295
  }
  const noise = (x, y, period) => {
    x *= period; y *= period
    const ix = Math.floor(x), iy = Math.floor(y)
    let fx = x - ix, fy = y - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    const a = hash(ix % period, iy % period), b = hash((ix + 1) % period, iy % period)
    const c = hash(ix % period, (iy + 1) % period), d = hash((ix + 1) % period, (iy + 1) % period)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4
    const broad = noise(u, v, 4) * 0.5 + noise(u, v, 16) * 0.3 + noise(u, v, 64) * 0.2
    const grain = noise(u, v, 32) * 0.35 + noise(u, v, 128) * 0.4 + hash(x, y) * 0.25
    const veins = Math.abs(noise(u, v, 16) - 0.5) * 2
    data[i] = Math.round(broad * 255)
    data[i + 1] = Math.round(grain * 255)
    data[i + 2] = Math.round(veins * 255)
    data[i + 3] = 255
  }
  const result = new DataTexture(data, size, size, RGBAFormat)
  result.wrapS = result.wrapT = RepeatWrapping
  result.magFilter = LinearFilter
  result.minFilter = LinearMipmapLinearFilter
  result.generateMipmaps = true
  result.anisotropy = 4
  result.needsUpdate = true
  return result
}

// Uses the existing KayKit atlas islands as semantic masks. These ranges are
// independent of the selected seasonal palette and remain valid after rotation.
export async function createNaturalSurface({ summer, winter, blended, elevation, isDecoration, localPosition, waterMask, debugMode }) {
  const detailTexture = createDetailTexture()
  const loader = new TextureLoader()
  const [meadowTexture, rockTexture] = await Promise.all([
    loader.loadAsync('./assets/textures/natural/meadow.png'),
    loader.loadAsync('./assets/textures/natural/rock.png'),
  ])
  for (const map of [meadowTexture, rockTexture]) {
    map.colorSpace = SRGBColorSpace
    map.wrapS = map.wrapT = RepeatWrapping
    map.anisotropy = 8
    map.needsUpdate = true
  }
  const clock = uniform(0)
  const texUV = uv()
  const inBand = texUV.y.greaterThan(0.5).and(texUV.y.lessThan(0.75))
  const grass = texUV.x.lessThan(0.125).and(inBand)
  const foliage = texUV.x.greaterThan(0.125).and(texUV.x.lessThan(0.25)).and(inBand)
  const stone = texUV.x.greaterThan(0.25).and(texUV.x.lessThan(0.375)).and(inBand)
  const road = texUV.x.greaterThan(0.375).and(texUV.x.lessThan(0.5)).and(inBand).and(isDecoration.not())
  const water = waterMask.greaterThan(0.5).and(isDecoration.not())
  const p = positionWorld
  const up = normalWorldGeometry.y.clamp(0, 1)
  const macro = texture(detailTexture, p.xz.mul(0.075))
  const groundDetail = texture(detailTexture, p.xz.mul(0.8))
  const rockX = texture(rockTexture, p.zy.mul(0.65))
  const rockY = texture(rockTexture, p.xz.mul(0.65))
  const rockZ = texture(rockTexture, p.xy.mul(0.65))
  const weights = normalWorldGeometry.abs().pow(4)
  const rockDetail = rockX.mul(weights.x).add(rockY.mul(weights.y)).add(rockZ.mul(weights.z)).div(weights.x.add(weights.y).add(weights.z).max(0.001))
  const rockySlope = float(1).sub(up.smoothstep(0.72, 0.96))
  const grassPhoto = texture(meadowTexture, p.xz.mul(0.32)).rgb
  const grassColor = grassPhoto.mul(mix(vec3(0.65, 0.82, 0.52), vec3(1.18, 1.22, 0.83), macro.r))
  // Retain some of the seasonal palette when users change biomes in the GUI.
  const meadow = mix(grassColor, summer.rgb.mul(vec3(0.65, 0.85, 0.5)), 0.18)
  const rock = rockDetail.rgb.mul(macro.r.mul(0.5).add(0.6))
  const snowAmount = elevation.add(macro.r.sub(0.5).mul(0.5)).sub(rockySlope.mul(0.36)).smoothstep(0.55, 0.93)
  const snowColor = mix(vec3(0.66, 0.73, 0.76), winter.rgb, 0.4).mul(groundDetail.g.mul(0.15).add(0.9))
  const terrain = mix(mix(meadow, rock, rockySlope), snowColor, snowAmount)
  const stoneColor = mix(rock, snowColor, snowAmount.mul(up.smoothstep(0.4, 0.85)))
  const leafColor = mix(vec3(0.012, 0.034, 0.012), vec3(0.075, 0.12, 0.025), macro.r)
    .mul(groundDetail.g.mul(0.65).add(0.65))
  const leaves = mix(leafColor, snowColor, snowAmount.mul(up.smoothstep(0.1, 0.75)).mul(0.8))
  const generic = blended.rgb.mul(groundDetail.g.mul(0.3).add(0.82))
  let color = select(grass, terrain, select(stone, stoneColor, select(foliage, leaves, generic)))
  const roadColor = mix(vec3(0.24, 0.20, 0.14), vec3(0.42, 0.36, 0.27), groundDetail.g).mul(macro.r.mul(0.22).add(0.88))
  color = select(road, roadColor, color)

  // Thin surface grid, using local hex distance (invariant under 60° rotations).
  const radius = max(localPosition.x.abs(), localPosition.x.abs().mul(0.5).add(localPosition.z.abs().mul(Math.sqrt(3) / 2)))
  const grid = radius.smoothstep(0.984, 0.998).mul(up.smoothstep(0.65, 0.95)).mul(select(isDecoration, 0, 0.16))
  color = mix(color, color.mul(1.3).add(0.025), grid.mul(select(grass, 1, 0)))

  // Shade the actual authored river triangles: no extra floating water plane,
  // and depth/shadows remain correct at every elevation and under bridges.
  const rippleUV = p.xz.mul(vec2(0.9, 2.8)).add(vec2(clock.mul(0.017), clock.mul(-0.028)))
  const ripple = texture(detailTexture, rippleUV)
  const wave = sin(p.x.mul(21).add(p.z.mul(11)).add(ripple.r.mul(9)).sub(clock.mul(1.3))).mul(0.5).add(0.5)
  const shallows = summer.b.sub(summer.r).mul(3).clamp(0, 1)
  const shore = float(0.30).sub(texUV.y).smoothstep(0, 0.028)
  const foam = shore.mul(ripple.r.smoothstep(0.51, 0.7)).mul(0.18)
  const waterColor = mix(vec3(0.016, 0.059, 0.073), vec3(0.042, 0.135, 0.14), shallows)
    .add(vec3(0.10, 0.16, 0.16).mul(wave.pow(18)).mul(ripple.g.smoothstep(0.52, 0.73)).mul(0.4))
    .add(vec3(0.6, 0.68, 0.66).mul(foam))
  color = select(water, waterColor, color)
  const normal = bumpMap(select(water, ripple.g, select(stone.or(grass.and(up.lessThan(0.85))), rockDetail.g, grassPhoto.g)), select(water, 0.13, select(foliage, 0.008, 0.045)))
  const roughness = select(water, float(0.27).add(ripple.r.mul(0.08)), select(foliage, 0.93, float(0.82).add(groundDetail.g.mul(0.16))))
  return {
    color,
    normal: select(debugMode.equal(0), normal, normalViewGeometry),
    roughness: roughness.mul(materialRoughness).clamp(0.05, 1),
    clock,
    detailTexture,
    meadowTexture,
    rockTexture,
  }
}
