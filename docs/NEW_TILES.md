# New Tiles (Priority Order)

Tiles ordered by expected impact on reducing WFC contradictions.
Edge patterns shown in base rotation — all tiles get 6 rotations automatically.

## 1. River Dead-End

**Why:** Rivers currently must continue or branch. If WFC can't find a valid path, it contradicts. A dead-end lets it terminate gracefully.

```
Edges: { NE: grass, E: river, SE: grass, SW: grass, W: grass, NW: grass }
```

Visual: River enters from one side and ends in a pond/marsh. Like ROAD_M but for rivers.

## 2. River-Into-Coast

**Why:** Rivers can never meet the ocean — river and coast/ocean can't appear on the same tile (audit: impossible pair). Rivers near coastlines always get stuck.

```
Edges: { NE: grass, E: river, SE: coast, SW: ocean, W: coast, NW: grass }
```

Visual: River flows in from E, meets a bay/estuary opening to ocean on SW. Coast edges transition on either side. May need a few shape variants like coast tiles have (A, B, C).

## 3. Additional Coast Shapes

**Why:** coast+coast is a fragile pair (only 2 states: specific rotations of COAST_D and COAST_E). Tight coastline corners frequently fail.

### COAST_F — Three-coast arc
```
Edges: { NE: coast, E: ocean, SE: ocean, SW: coast, W: grass, NW: grass }
```
Visual: Wide bay with 3 ocean-facing edges. Fills the gap between COAST_C (which has coast+ocean+ocean+ocean+coast) and COAST_A.

### COAST_G — Narrow inlet
```
Edges: { NE: coast, E: coast, SE: grass, SW: grass, W: grass, NW: grass }
```
Visual: Two adjacent coast edges with grass everywhere else. Gives WFC another option for coast+coast pairs beyond COAST_D/E.

## 4. Coast Slopes

**Why:** If level-1 grass borders ocean, no coast tile can bridge the height. Coast tiles are all flat — no slope variants exist.

```
Edges: { NE: grass, E: coast, SE: ocean, SW: coast, W: grass, NW: grass }
highEdges: ['NE', 'W', 'NW'], levelIncrement: 1
```

Visual: Coast tile where the land side is elevated. Same shape as COAST_A/B but the grass edges are one level up. Need low (increment 1) and high (increment 2) variants of the most common coast shapes.

## 5. Road Slope Dead-Ends (x4)

**Why:** Road slopes require a through-route (ROAD_A_SLOPE). A dead-end variant would let elevated roads terminate without contradiction.

### Low slope dead-end
```
Edges: { NE: grass, E: grass, SE: grass, SW: grass, W: road, NW: grass }
highEdges: ['NE', 'E', 'SE'], levelIncrement: 1
```

### High slope dead-end
```
Edges: { NE: grass, E: grass, SE: grass, SW: grass, W: road, NW: grass }
highEdges: ['NE', 'E', 'SE'], levelIncrement: 2
```

Visual: Like ROAD_M (flat dead-end) but the road climbs up to nothing — a hillside path ending at a viewpoint.

## 6. River Slopes

**Why:** Rivers can't change elevation. If a river meets a slope edge, contradiction.

```
Edges: { NE: grass, E: river, SE: grass, SW: grass, W: river, NW: grass }
highEdges: ['NE', 'E', 'SE'], levelIncrement: 1
```

Visual: Like RIVER_A but the river flows downhill. Water cascading over a small drop. Need low variant at minimum.

---

## Reference

From `tools/tileset-audit.js` output:
- **138 impossible pairs** — most are cross-type (coast+river, ocean+road) or cross-level
- **9 fragile pairs** — coast+coast (2 states), river+road crossing (2 states each direction)
- Tiles 1-3 above directly address the fragile pairs and highest-frequency impossible pairs
