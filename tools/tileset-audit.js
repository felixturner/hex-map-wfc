/**
 * Tileset Sub-Completeness Audit
 *
 * Enumerates all possible (edgeType, level) combinations per direction,
 * checks how many tile states can satisfy each, and reports fragile/dead-end configs.
 *
 * Run: node --experimental-vm-modules tools/tileset-audit.js
 * (needs ESM support for importing HexTileData)
 */

// Inline the tile data to avoid ESM import issues with Node.js
const LEVELS_COUNT = 3
const HexDir = ['NE', 'E', 'SE', 'SW', 'W', 'NW']
const HexOpposite = { NE: 'SW', E: 'W', SE: 'NW', SW: 'NE', W: 'E', NW: 'SE' }

const TILE_LIST = [
  { name: 'GRASS', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 300 },
  { name: 'WATER', edges: { NE: 'ocean', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'ocean', NW: 'ocean' }, weight: 50 },
  { name: 'ROAD_A', edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 10 },
  { name: 'ROAD_B', edges: { NE: 'road', E: 'grass', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 8 },
  { name: 'ROAD_D', edges: { NE: 'road', E: 'grass', SE: 'road', SW: 'grass', W: 'road', NW: 'grass' }, weight: 2 },
  { name: 'ROAD_E', edges: { NE: 'road', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 2 },
  { name: 'ROAD_F', edges: { NE: 'grass', E: 'road', SE: 'road', SW: 'grass', W: 'road', NW: 'grass' }, weight: 2 },
  { name: 'ROAD_H', edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'road', W: 'road', NW: 'road' }, weight: 2 },
  { name: 'ROAD_J', edges: { NE: 'grass', E: 'road', SE: 'road', SW: 'road', W: 'road', NW: 'grass' }, weight: 1 },
  { name: 'ROAD_M', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 4 },
  { name: 'RIVER_A', edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' }, weight: 20 },
  { name: 'RIVER_A_CURVY', edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' }, weight: 20 },
  { name: 'RIVER_B', edges: { NE: 'river', E: 'grass', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' }, weight: 60 },
  { name: 'RIVER_D', edges: { NE: 'river', E: 'grass', SE: 'river', SW: 'grass', W: 'river', NW: 'grass' }, weight: 4 },
  { name: 'RIVER_E', edges: { NE: 'river', E: 'river', SE: 'grass', SW: 'grass', W: 'river', NW: 'grass' }, weight: 4 },
  { name: 'RIVER_F', edges: { NE: 'grass', E: 'river', SE: 'river', SW: 'grass', W: 'river', NW: 'grass' }, weight: 4 },
  { name: 'RIVER_G', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'river', W: 'river', NW: 'river' }, weight: 4 },
  { name: 'RIVER_H', edges: { NE: 'grass', E: 'river', SE: 'grass', SW: 'river', W: 'river', NW: 'river' }, weight: 2 },
  { name: 'COAST_A', edges: { NE: 'grass', E: 'coast', SE: 'ocean', SW: 'coast', W: 'grass', NW: 'grass' }, weight: 20 },
  { name: 'COAST_B', edges: { NE: 'grass', E: 'coast', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'grass' }, weight: 15 },
  { name: 'COAST_C', edges: { NE: 'coast', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'grass' }, weight: 15 },
  { name: 'COAST_D', edges: { NE: 'ocean', E: 'ocean', SE: 'ocean', SW: 'ocean', W: 'coast', NW: 'coast' }, weight: 15 },
  { name: 'COAST_E', edges: { NE: 'grass', E: 'grass', SE: 'coast', SW: 'coast', W: 'grass', NW: 'grass' }, weight: 10 },
  { name: 'RIVER_CROSSING_A', edges: { NE: 'grass', E: 'river', SE: 'road', SW: 'grass', W: 'river', NW: 'road' }, weight: 4 },
  { name: 'RIVER_CROSSING_B', edges: { NE: 'road', E: 'river', SE: 'grass', SW: 'road', W: 'river', NW: 'grass' }, weight: 4 },
  { name: 'GRASS_SLOPE_HIGH', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 20, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  { name: 'ROAD_A_SLOPE_HIGH', edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 12, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  { name: 'GRASS_CLIFF', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 6, highEdges: ['NE', 'E', 'SE'], levelIncrement: 2 },
  { name: 'GRASS_CLIFF_C', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 6, highEdges: ['E'], levelIncrement: 2 },
  { name: 'GRASS_SLOPE_LOW', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 20, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  { name: 'ROAD_A_SLOPE_LOW', edges: { NE: 'grass', E: 'road', SE: 'grass', SW: 'grass', W: 'road', NW: 'grass' }, weight: 12, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  { name: 'GRASS_CLIFF_LOW', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 6, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1 },
  { name: 'GRASS_CLIFF_LOW_C', edges: { NE: 'grass', E: 'grass', SE: 'grass', SW: 'grass', W: 'grass', NW: 'grass' }, weight: 6, highEdges: ['E'], levelIncrement: 1 },
]

// --- Helpers ---

function rotateHexEdges(edges, rotation) {
  const rotated = {}
  for (let i = 0; i < 6; i++) {
    const fromDir = HexDir[i]
    const toDir = HexDir[(i + rotation) % 6]
    rotated[toDir] = edges[fromDir]
  }
  return rotated
}

function getEdgeLevel(tileType, rotation, dir, baseLevel) {
  const def = TILE_LIST[tileType]
  if (!def || !def.highEdges) return baseLevel

  const highEdges = new Set()
  for (const highDir of def.highEdges) {
    const dirIndex = HexDir.indexOf(highDir)
    const rotatedIndex = (dirIndex + rotation) % 6
    highEdges.add(HexDir[rotatedIndex])
  }

  const levelIncrement = def.levelIncrement ?? 1
  return highEdges.has(dir) ? baseLevel + levelIncrement : baseLevel
}

// --- Build all states ---

const allStates = []
for (let type = 0; type < TILE_LIST.length; type++) {
  const def = TILE_LIST[type]
  const isSlope = def.highEdges && def.highEdges.length > 0

  for (let rotation = 0; rotation < 6; rotation++) {
    if (isSlope) {
      const increment = def.levelIncrement ?? 1
      const maxBaseLevel = LEVELS_COUNT - 1 - increment
      for (let level = 0; level <= maxBaseLevel; level++) {
        allStates.push({ type, rotation, level })
      }
    } else {
      for (let level = 0; level < LEVELS_COUNT; level++) {
        allStates.push({ type, rotation, level })
      }
    }
  }
}

// Compute edges for each state
const stateEdges = allStates.map(state => {
  const edges = rotateHexEdges(TILE_LIST[state.type].edges, state.rotation)
  const info = {}
  for (const dir of HexDir) {
    info[dir] = {
      type: edges[dir],
      level: getEdgeLevel(state.type, state.rotation, dir, state.level),
    }
  }
  return { ...state, edges: info }
})

console.log(`Total tile types: ${TILE_LIST.length}`)
console.log(`Total states (type x rotation x level): ${allStates.length}`)
console.log()

// --- Audit 1: Per-edge compatibility count ---
// For each (edgeType, level) on direction D, how many states have a matching edge on the opposite direction?

console.log('='.repeat(70))
console.log('AUDIT 1: Edge compatibility counts')
console.log('For each (type, level) on a direction, how many states can match it')
console.log('from the opposite direction? (i.e., how many neighbor tiles are compatible)')
console.log('='.repeat(70))
console.log()

// Collect all (edgeType, level) combos that actually appear
const edgeCombos = new Set()
for (const state of stateEdges) {
  for (const dir of HexDir) {
    const e = state.edges[dir]
    edgeCombos.add(`${e.type}:${e.level}`)
  }
}

const sortedCombos = [...edgeCombos].sort()

for (const combo of sortedCombos) {
  const [edgeType, levelStr] = combo.split(':')
  const level = parseInt(levelStr)

  // For each direction, count how many states have this edge on the OPPOSITE direction
  // (because a neighbor's edge D must match our edge opposite(D))
  // Since the tileset is rotationally symmetric, just check one direction pair
  const matchCounts = {}
  const matchTiles = {}

  for (const dir of HexDir) {
    const oppDir = HexOpposite[dir]
    const matches = stateEdges.filter(s => {
      const e = s.edges[oppDir]
      if (e.type !== edgeType) return false
      if (edgeType === 'grass') return true  // grass matches any level
      return e.level === level
    })
    matchCounts[dir] = matches.length
    matchTiles[dir] = [...new Set(matches.map(s => TILE_LIST[s.type].name))]
  }

  // All directions are equivalent due to rotation, so just report the count
  // (they should all be the same)
  const count = matchCounts[HexDir[0]]
  const tiles = matchTiles[HexDir[0]]
  const status = count === 0 ? 'DEAD' : count <= 3 ? 'FRAGILE' : count <= 10 ? 'LOW' : 'OK'

  if (status !== 'OK') {
    console.log(`[${status}] ${edgeType} @ level ${level}: ${count} matching states (${tiles.length} tile types: ${tiles.join(', ')})`)
  }
}

console.log()

// --- Audit 2: Pairwise edge compatibility ---
// For each pair of (edgeType, level) on two ADJACENT directions of the same cell,
// how many states satisfy both? This finds "pinch points" where two constraints
// on adjacent edges leave very few options.

console.log('='.repeat(70))
console.log('AUDIT 2: Pairwise adjacent-edge constraints')
console.log('For each pair of (type,level) on two adjacent edges of a single cell,')
console.log('how many states satisfy BOTH? Low counts = likely contradiction sources.')
console.log('='.repeat(70))
console.log()

const dirPairs = []
for (let i = 0; i < 6; i++) {
  dirPairs.push([HexDir[i], HexDir[(i + 1) % 6]])
}

const pairResults = []

for (const combo1 of sortedCombos) {
  const [type1, level1Str] = combo1.split(':')
  const level1 = parseInt(level1Str)

  for (const combo2 of sortedCombos) {
    const [type2, level2Str] = combo2.split(':')
    const level2 = parseInt(level2Str)

    // Check: how many states have type1@level1 on dir0 AND type2@level2 on dir1?
    // Use NE and E as the test pair (representative due to rotation)
    const dir0 = 'NE'
    const dir1 = 'E'

    const matches = stateEdges.filter(s => {
      const e0 = s.edges[dir0]
      const e1 = s.edges[dir1]

      const match0 = e0.type === type1 && (type1 === 'grass' || e0.level === level1)
      const match1 = e1.type === type2 && (type2 === 'grass' || e1.level === level2)

      return match0 && match1
    })

    if (matches.length <= 5) {
      pairResults.push({
        edge1: `${type1}@${level1}`,
        edge2: `${type2}@${level2}`,
        count: matches.length,
        tiles: [...new Set(matches.map(s => TILE_LIST[s.type].name))],
      })
    }
  }
}

// Sort by count ascending
pairResults.sort((a, b) => a.count - b.count)

// Split by severity
const impossible = pairResults.filter(r => r.count === 0)
const fragile = pairResults.filter(r => r.count > 0 && r.count <= 2)
const low = pairResults.filter(r => r.count > 2)

console.log(`--- FRAGILE pairs (1-2 states) — most likely to cause contradictions ---`)
for (const r of fragile) {
  console.log(`  [FRAGILE] ${r.edge1} + ${r.edge2}: ${r.count} states (${r.tiles.join(', ')})`)
}
console.log()

console.log(`--- LOW pairs (3-5 states) ---`)
for (const r of low) {
  console.log(`  [LOW] ${r.edge1} + ${r.edge2}: ${r.count} states (${r.tiles.join(', ')})`)
}
console.log()

console.log(`--- IMPOSSIBLE pairs (0 states): ${impossible.length} total ---`)
// Group impossible by first edge type for readability
const byFirst = {}
for (const r of impossible) {
  const key = r.edge1
  if (!byFirst[key]) byFirst[key] = []
  byFirst[key].push(r.edge2)
}
for (const [edge1, edge2s] of Object.entries(byFirst)) {
  console.log(`  ${edge1} + [${edge2s.join(', ')}]`)
}

console.log()

// --- Audit 3: Triple edge constraints (3 fixed neighbors) ---
// The worst case: a cell has 3 adjacent fixed neighbors. Check triples.

console.log('='.repeat(70))
console.log('AUDIT 3: Triple adjacent-edge constraints (3 consecutive fixed neighbors)')
console.log('For 3 consecutive edges with specific (type,level), how many states satisfy ALL 3?')
console.log('These represent the worst-case scenario for 3-neighbor grid boundaries.')
console.log('='.repeat(70))
console.log()

const tripleResults = []

// Only check non-grass combos (grass is flexible, not interesting)
const nonGrassCombos = sortedCombos.filter(c => !c.startsWith('grass:'))
// Also include grass at non-zero levels as they can still constrain
const interestingCombos = sortedCombos.filter(c => {
  if (c.startsWith('grass:0')) return false  // grass@0 matches everything
  return true
})

// Use NE, E, SE as the test triple
for (const combo1 of interestingCombos) {
  const [type1, l1] = combo1.split(':')
  const level1 = parseInt(l1)

  for (const combo2 of interestingCombos) {
    const [type2, l2] = combo2.split(':')
    const level2 = parseInt(l2)

    for (const combo3 of interestingCombos) {
      const [type3, l3] = combo3.split(':')
      const level3 = parseInt(l3)

      const matches = stateEdges.filter(s => {
        const e0 = s.edges['NE']
        const e1 = s.edges['E']
        const e2 = s.edges['SE']

        const m0 = e0.type === type1 && (type1 === 'grass' || e0.level === level1)
        const m1 = e1.type === type2 && (type2 === 'grass' || e1.level === level2)
        const m2 = e2.type === type3 && (type3 === 'grass' || e2.level === level3)

        return m0 && m1 && m2
      })

      if (matches.length === 0) {
        tripleResults.push({
          edges: `${type1}@${level1} + ${type2}@${level2} + ${type3}@${level3}`,
          count: 0,
        })
      }
    }
  }
}

if (tripleResults.length === 0) {
  console.log('No impossible triples found!')
} else {
  console.log(`Found ${tripleResults.length} impossible triple combinations:`)
  // Show first 30
  for (const r of tripleResults.slice(0, 30)) {
    console.log(`[IMPOSSIBLE] ${r.edges}`)
  }
  if (tripleResults.length > 30) {
    console.log(`... and ${tripleResults.length - 30} more`)
  }
}

console.log()

// --- Summary ---
console.log('='.repeat(70))
console.log('SUMMARY')
console.log('='.repeat(70))

const deadPairs = pairResults.filter(r => r.count === 0)
const fragilePairs = pairResults.filter(r => r.count > 0 && r.count <= 2)

console.log(`Edge types in use: ${[...new Set(sortedCombos.map(c => c.split(':')[0]))].join(', ')}`)
console.log(`Edge+level combos: ${sortedCombos.length}`)
console.log(`Impossible pairs (0 states): ${deadPairs.length}`)
console.log(`Fragile pairs (1-2 states): ${fragilePairs.length}`)
console.log(`Impossible triples: ${tripleResults.length}`)
console.log()
console.log('Recommendation: Add transition tiles for any IMPOSSIBLE or FRAGILE pairs')
console.log('to improve sub-completeness and reduce WFC contradictions.')
