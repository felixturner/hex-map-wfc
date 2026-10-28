# Paired map export contract v1

Exports are `map-<id>-<revision>.render.json` and
`map-<id>-<revision>.resources.json`. Both are ordinary UTF-8 JSON. The generator
produces no per-hex totals file and implements no Ashdomes gameplay APIs.

The workshop's **Export paired JSON** downloads both files. Browser multiple-download
permission may be needed. Export captures the canonical displayed transforms once
and requires an already resolved resource cache; it never rerolls scenery or samples
resources. If terrain was edited, Save resolves the new snapshot first.

## Envelope and revision

| Field                                    | Render                                                                                  | Resources                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| format                                   | `hex-map-wfc-render`                                                                    | `hex-map-wfc-resources`                          |
| version                                  | 1                                                                                       | 1                                                |
| id, revision, createdAt, generatorCommit | identical                                                                               | identical                                        |
| payload                                  | name, seed, radius, grids, waterSideIndex, generationSettings, tiles, landscape, assets | resources                                        |
| renderSha256                             | absent                                                                                  | SHA-256 of exact uncompressed render UTF-8 bytes |

`revision` is a full lowercase SHA-256, not a sequential counter. Its canonical
input contains `id`, `createdAt`, all render payload fields (including the asset
manifest), the complete resources object, and generatorCommit. The shared
`canonicalJSON` function recursively sorts object keys and preserves array order
and JSON numeric values. A dependency or either dataset changing changes the revision.
Repeated exports of the same snapshot/release are byte-identical. `createdAt` is
preserved from the resolved snapshot. `generatorCommit` records the repository HEAD
when the release was first generated; implementation file hashes additionally identify uncommitted
source changes, so a commit alone is not the complete release identity.

`renderSha256` hashes emitted bytes, not parsed/re-serialized JSON, compressed
HTTP bytes, or a canonicalized representation. Preserve those bytes on the server.
All numbers, sparse rows, coverage and units survive ordinary JSON serialization;
no rounding or quantization is performed by conversion. Yield values already
include sampled area and coverage: **sum wood/minerals/food directly**, without
multiplying by area or coverage again. See [resource semantics](resource-export.md).

## Schemas and validators

- [Render structural schema](../schemas/render-v1.schema.json)
- [Resources structural schema](../schemas/resources-v1.schema.json)
- `decodeMapSnapshot(render)` validates the render envelope, tile completeness,
  semantic tile names, rotations, elevation and saved landscape without resources.
- `validateResourceGrid(resources)` validates the original grid, including numeric
  bounds, dimensions, ordered unique sparse rows and coverage.
- `validateExportPair(renderBytes, resourcesBytes)` validates both, identical
  envelope fields, exact-byte hash and content-derived revision.
- `combineExportPair` returns a validated combined v3 document for old tooling.

JSON Schema is structural. Cross-field checks (cube sum, footprint completeness,
mesh membership, matrix constraints, cell bounds/order and cryptographic pairing)
require the JS validators. These validators target the current catalog; future
incompatible catalog/landscape versions require an explicit migration.

## Immutable assets

Run `npm run assets:release` (also run before dev/build). The release is under
`public/assets/releases/<sha256>/`; `src/maps/AssetRelease.json` points to it.
Release paths are content-addressed and existing different bytes are never overwritten.
Retain old release directories as long as maps reference them. Serve `public/` as
an asset root. Each manifest entry has a relative path, role, byte length and SHA-256.

`catalog.json` maps semantic tile names and scenery mesh names to geometry keys,
records dimensions, elevation scaling and the geometry encoding. `meshes.json`
contains the **processed** indexed geometry attributes, including procedural trees
and detailed terrain, in Three BufferGeometry JSON. Models and textures remain
separate assets. Clients need only catalog, meshes and their selected textures;
source GLB, pinned implementation sources and dependency lockfile are provenance
and porting aids, not mandatory client downloads. Verify fetched bytes against
manifest hashes before decoding. Texture paths are pinned just like models.

`loadRenderGroup(render, assetBaseURL)` is a minimal Three consumer that fetches
only catalog, meshes and the default atlas, verifies hashes, then reconstructs
terrain and every saved landscape instance without RNG or resource sampling.
It shows static terrain/scenery; animated water, natural shading, lighting and
unsaved decorative structures are application presentation features. The original
v3 landscape stores trees, rocks, hills and mountains; it did not persist buildings,
flowers, bridges or water plants. Conversion cannot invent their original transforms.
`loadRenderGroup` deliberately renders exactly the saved landscape. The workshop
continues its existing reconstruction of unsaved decorative structures.

The workshop opens render-only documents from its matching release. It cannot
export a new pair until the raw resources are supplied or a new resolved map is
explicitly saved. Select both JSON files in Import to validate and combine them.
A different release is rejected by the workshop; use its matching runtime or the
manifest-driven standalone loader. A hash provides integrity, not publisher identity;
Ashdomes controls which release manifests it trusts.

## Coordinate contract v1

Use [CoordinatesV1.js](../src/maps/CoordinatesV1.js) and the matching catalog's
`coordinates`. Right-handed axes: X/Z ground plane, Y up. Cubes are integer
`q,r,s` with `q+r+s=0`. Pointy-top hexes have width `w` (flat-to-flat X) and height
`h` (point-to-point Z). Defaults are w=2, h=4/√3, but use catalog values to preserve
float-authored dimensions. For local cube coordinates:

```
x = w * (q + r/2)
z = h * 0.75 * r
r = z / (h * 0.75)
q = x/w - r/2
s = -q-r
```

For a tile in a grid, subtract `grid.center` from global cube coordinates, apply
these equations, then add that landscape grid's saved `offset.x/z`. Do not derive
grid offsets from the integer grid address: the saved offsets are authoritative.
`cubeToWorld`/`worldToFractionalCube` operate on a lattice centered at zero;
`worldToCube` picks the nearest lattice center. Negative rows use the same equations.

Tile rotation is a right-handed Y rotation of **-rotation × π/3**. In X/Z terms,
`x' = cos(a)x + sin(a)z`, `z' = -sin(a)x + cos(a)z`. Translation Y is
`level × 0.5`; nominal tile surface is one unit above its base. Slope geometry
already includes its authored rise: do not apply it again. The processed terrain
pivot is centered X/Z at its base; geometry already includes the source +1 Y
translation. Bottom fill has its top at zero, is placed at tile base Y and scaled
in Y by `level × 0.5`.

Landscape matrices are column-major, local-to-grid, affine 4×4 matrices. Multiply
the released mesh vertex by that matrix, then add the grid offset in X/Z. Translation
is indices 12/13/14. Do not re-center, re-ground or re-scale released meshes: tree
pivots and the various authored scenery pivots have already been processed. Saved
matrices override generation settings, animations and seed-based placement.

## Resource-cell centers → terrain hexes

`resourceCellCenter` returns `origin + (column+0.5,row+0.5) × cellSize` in X/Z.
Build one `createResourceHexAssigner(render, catalog.coordinates)` per map and
pass centers to it. For each saved grid it subtracts its offset, chooses the
nearest local lattice center and checks radius and tile membership. Squared-distance
ties within 1e-12 world units² select the numerically lexicographically smallest
(q,r,s). Multiple grid candidates use the same numeric order globally. This is a
lattice ownership convention, not mesh triangle containment or a gameplay rule.
Boundary ownership is selected before footprint membership; an outside owner is
not snapped onto the last terrain hex.

The function returns `null` outside the terrain lattice footprint. A partially
covered cell can have a center outside: keep its entire row in an unassigned
bucket rather than discarding its yields or assigning it to the nearest edge.
Per-hex totals **plus unassigned totals** must equal raw-grid totals. Sparse omitted
cells have no sampled footprint; never synthesize yields for them. This center
assignment does not divide cells among neighboring hexes and does not change
resource sampling's existing geometric coverage semantics.

## Existing exports and examples

```
npm run convert:map -- /path/to/combined-v3.json /path/to/output [matching-release.json]
```

Conversion does not load models, regenerate resources or touch RNG. It preserves
the original id/timestamp and writes two new files (refusing existing paths). Select
the release that actually generated the map. Old combined files have no asset hash
or commit provenance: a converter cannot infer those; the supplied matching release
is the operator's assertion. The default is this checkout's release.

Versions 1/2 lack resource data and exact scenery. Lossless conversion rejects them.
Open and explicitly save them in the generator to create a new resolved v3 snapshot,
then export; that is a reconstruction, not recovery of missing historical data.

`node tools/create-export-example.js` creates the reproducible example under
`examples/paired/`, including a v3 conversion input and the two delivered JSONs.
This is a generated example, **not the supplied sample** (no sample file was present
in the request/workspace). `index.json` identifies the pair. The example uses actual
released terrain/tree geometry and sampled yields.

## Verification in this change

35 Node tests passed, including exact payload/total preservation, pair tampering,
revision changes, negative coordinates, deterministic ties, offset-aware ownership,
outside-center totals, immutable asset byte hashes and export's no-resampling guard.
The standalone render consumer constructed all terrain, elevation fills and saved
scenery while fetching exactly catalog, models and atlas; no resources file was
requested. Its saved instance matrix matched exactly. CLI conversion of the example
produced byte-identical paired output. Rebuilding the asset release produced the
same release hash. Production build passed with the existing bundle-size and Sounds
import warnings; `git diff --check` passed.

Run `npm run preview:render` and open
`http://127.0.0.1:5178/tools/render-preview.html` for the WebGPU visual check.
Actual browser/pixel verification remains pending because Computer Use permissions
were unavailable in this session. Pi's preferred provider had no API key; permission
for the configured-default fallback was declined, so independent review was not run.
