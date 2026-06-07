# clansocket-osrs-cache-extractor

OSRS cache extractor + item / object / NPC icon renderer.

Reads the RuneLite live cache, dumps configs / models / textures losslessly to
JSON + PNG, then renders sprites via LWJGL3 OpenGL.

## what it does

two halves:

1. **node extractor** — `pipeline/lossless/` walks the RuneLite cache and writes
   structured JSON (item defs, object defs, npc defs, sequences, maps, world
   areas, locations, reference tables) + model JSON chunks + texture PNGs.
   loaders are RuneLite-faithful: no field renames, no sentinel resolution
   beyond what the parser strictly needs, `_unknownOpcodes` markers preserved.

2. **java renderer** — `src/main/java/com/clansocket/extractor/` reads the
   lossless JSON, builds models on the GPU (MSAA FBO, GPU downsample, threaded
   PNG encode), writes a size pyramid per id.

cache source defaults to `~/.runelite/jagexcache/oldschool/LIVE/`. updating
RuneLite refreshes that folder automatically; no manual cache step.

## requirements

- node 20+
- java 24 (gradle toolchain pulls it if missing)
- a RuneLite install with at least one login (so the live cache exists)
- XTEA keys at `~/.runelite/cache/xtea.json` for encrypted map locations
- windows natives are wired into `build.gradle`; linux / macos need the matching
  LWJGL classifiers added

## install

```
npm install
```

gradle wraps itself — no install step.

## extract (node side)

```
npm run extract:raw       # configs + maps + world-areas + reference tables
npm run extract:models    # 60k models → Models-N.json chunks
npm run extract:textures  # 200+ textures → PNG + TextureIndex-0.json
```

all three default to `extracted_osrs_cache/raw/`. each script accepts
`--cache-dir <path>` and `--out <path>` overrides.

`extract:raw` also has `--only <section>` (`maps` / `configs` / `world-areas` /
`reference-tables`) and `--include-binary` (also dump decompressed `.bin`
payloads for byte-level inspection).

## render (java side)

```
./gradlew extractSprites    # items   → ../clansocket-app/.../icon_item_ids_xl/
./gradlew extractObjects    # objects → ../clansocket-app/.../game_objects_xl/
./gradlew extractNpcs       # npcs    → ../clansocket-app/.../game_npcs_xl/
./gradlew inspect           # real-time model inspector with toggle sidebar
```

defaults render every def, at native 8192 with a single 1024 output. items
write one PNG per id. objects and NPCs write three angles (`front`,
`front-right`, `right`) per id.

flags are passed via `-Pargs="..."`:

```
./gradlew extractSprites -Pargs="--limit 10 --output ./test-output/items --render-size 1024"
./gradlew extractObjects -Pargs="--limit 10 --sizes 256,128,64 --output ./test-output/objects"
./gradlew extractNpcs    -Pargs="--limit 5  --output ./test-output/npcs"
```

| flag             | applies to     | default                                   |
|------------------|----------------|-------------------------------------------|
| `--items-dir`    | items only     | `extracted_osrs_cache/raw/configs`        |
| `--models-dir`   | items only     | `extracted_osrs_cache/raw/models`         |
| `--textures-dir` | items only     | `extracted_osrs_cache/raw/textures`       |
| `--defs`         | objects / npcs | `extracted_osrs_cache/raw/configs`        |
| `--models`       | objects / npcs | `extracted_osrs_cache/raw/models`         |
| `--textures`     | objects / npcs | `extracted_osrs_cache/raw/textures`       |
| `--output`       | all            | `../clansocket-app/public/resources/osrs/...` |
| `--render-size`  | all            | `8192` (GPU native)                       |
| `--sizes`        | all            | `1024` (output pyramid, comma-separated)  |
| `--limit`        | all            | `-1` (render every def)                   |

`--render-size` is the GPU supersample resolution. `--sizes` lists the output
pyramid; the max of the list is the GPU readback target, smaller tiers
downsample via Java2D bicubic.

## end-to-end

```
npm run extract:raw
npm run extract:models
npm run extract:textures
./gradlew extractSprites
./gradlew extractObjects
./gradlew extractNpcs
```

first run takes a while: `extract:models` writes ~1-3 GB of model JSON and
`extract:raw` writes every region + every config archive.

## output layout

```
extracted_osrs_cache/raw/
├── configs/
│   ├── Items-0.json … Items-N.json
│   ├── Objects-0.json … Objects-N.json
│   ├── Npcs-0.json … Npcs-N.json
│   ├── Sequences-N.json
│   ├── Underlays.json   Overlays.json   Kits.json
│   ├── Varbits-N.json   GraphicEffects-N.json
├── models/
│   └── Models-0.json … Models-N.json   (~2000 models per chunk)
├── textures/
│   ├── TextureIndex-0.json
│   └── model/<textureId>.png
├── maps/
│   └── <regionId>-r<x>-<y>.json        (terrain + XTEA-decrypted locations)
├── world-areas/world-areas.json
├── reference-tables/index-<N>.json
└── manifest.json
```

## directory layout

```
pipeline/lossless/        node extractor
  ├── extract-raw.mjs     configs, maps, world-areas, reference tables
  ├── extract-models.mjs  cache index 7 → Models-N.json chunks
  ├── extract-textures.mjs cache index 8/9 → PNG + manifest
  └── src/                shared loaders + cache primitives
src/main/java/            java renderer
  ├── com/clansocket/extractor/   ItemSpriteExtractor + EntitySpriteExtractor + ModelInspector
  └── com/bestbudz/engine/        GPU pipeline + texture store + model representation
build.gradle              gradle tasks for the renderer
package.json              node scripts for the extractor
```

## notes

- the renderer opens a hidden GLFW window for the OpenGL context. headless
  servers need a virtual display.
- texture PNGs in the cache are tiny (17×18-ish). `TextureStore` upscales each
  one to a uniform 128×128 layer on load so the GL_TEXTURE_2D_ARRAY footprint
  is consistent.
- map locations (`index 5 file 1`) are XTEA-encrypted. missing keys are
  surfaced in the per-region JSON's `locationsXteaStatus` field.
- the inspector (`./gradlew inspect`) is the easiest way to iterate on a
  single model with live render-toggle sidebar.

## license

BSD 2-Clause. see [LICENSE](LICENSE).
