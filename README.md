# ClanSocket OSRS Cache Extractor

An OSRS cache extractor and item/object/NPC icon renderer. It reads the RuneLite live cache, dumps configs, models, and textures losslessly to JSON and PNG, then renders sprites via LWJGL3 OpenGL.

> GitHub repository: [`osrs-clansocket/clansocket-osrs-cache-extractor`](https://github.com/osrs-clansocket/clansocket-osrs-cache-extractor). A standalone Git repository that checks out as a flat sibling under the `clansocket-workspace` umbrella.

---

## Role in the System

This is an offline asset-generation tool. It produces the rendered OSRS icons (items, objects, NPCs) and the lossless cache dumps that the platform consumes — the renderer's default output path writes into the sibling `clansocket-app` (`../clansocket-app/public/resources/osrs/...`). It runs on Gradle and Node directly and is not driven by the workspace-root `npm` orchestrator.

It has two halves:

1. **Node extractor** — `pipeline/lossless/` walks the RuneLite cache and writes structured JSON (item, object, and NPC definitions; sequences; maps; world areas; locations; reference tables) plus model JSON chunks and texture PNGs. The loaders are RuneLite-faithful: no field renames, minimal sentinel resolution, and `_unknownOpcodes` markers preserved.
2. **Java renderer** — `src/main/java/com/clansocket/extractor/` reads the lossless JSON, builds models on the GPU (MSAA FBO, GPU downsample, threaded PNG encode), and writes a size pyramid per id.

The cache source defaults to `~/.runelite/jagexcache/oldschool/LIVE/`. Updating RuneLite refreshes that folder automatically, so there is no manual cache step.

---

## Requirements

- Node 20+
- Java 24 (the Gradle toolchain pulls it if missing)
- A RuneLite install with at least one login, so the live cache exists
- XTEA keys at `~/.runelite/cache/xtea.json` for encrypted map locations
- Windows natives are wired into `build.gradle`; Linux and macOS need the matching LWJGL classifiers added

---

## Install

```bash
npm install
```

Gradle wraps itself through the bundled wrapper — there is no separate install step.

---

## Extract (Node Side)

```bash
npm run extract:raw       # configs + maps + world-areas + reference tables
npm run extract:models    # ~60k models → Models-N.json chunks
npm run extract:textures  # 200+ textures → PNG + TextureIndex-0.json
```

All three default to `extracted_osrs_cache/raw/`, and each accepts `--cache-dir <path>` and `--out <path>` overrides. `extract:raw` also accepts `--only <section>` (`maps`, `configs`, `world-areas`, or `reference-tables`) and `--include-binary` (also dumps decompressed `.bin` payloads for byte-level inspection).

---

## Render (Java Side)

```bash
./gradlew extractSprites    # items   → ../clansocket-app/.../icon_item_ids_xl/
./gradlew extractObjects    # objects → ../clansocket-app/.../game_objects_xl/
./gradlew extractNpcs       # npcs    → ../clansocket-app/.../game_npcs_xl/
./gradlew inspect           # real-time model inspector with a render-toggle sidebar
```

By default every definition is rendered at native 8192 with a single 1024 output. Items write one PNG per id; objects and NPCs write three angles (`front`, `front-right`, `right`) per id.

Flags are passed via `-Pargs="..."`:

```bash
./gradlew extractSprites -Pargs="--limit 10 --output ./test-output/items --render-size 1024"
./gradlew extractObjects -Pargs="--limit 10 --sizes 256,128,64 --output ./test-output/objects"
./gradlew extractNpcs    -Pargs="--limit 5  --output ./test-output/npcs"
```

| Flag | Applies to | Default |
| --- | --- | --- |
| `--items-dir` | items only | `extracted_osrs_cache/raw/configs` |
| `--models-dir` | items only | `extracted_osrs_cache/raw/models` |
| `--textures-dir` | items only | `extracted_osrs_cache/raw/textures` |
| `--defs` | objects / npcs | `extracted_osrs_cache/raw/configs` |
| `--models` | objects / npcs | `extracted_osrs_cache/raw/models` |
| `--textures` | objects / npcs | `extracted_osrs_cache/raw/textures` |
| `--output` | all | `../clansocket-app/public/resources/osrs/...` |
| `--render-size` | all | `8192` (GPU native) |
| `--sizes` | all | `1024` (output pyramid, comma-separated) |
| `--limit` | all | `-1` (render every definition) |

`--render-size` is the GPU supersample resolution. `--sizes` lists the output pyramid; the maximum of the list is the GPU readback target, and smaller tiers downsample via Java2D bicubic.

---

## End-to-End

```bash
npm run extract:raw
npm run extract:models
npm run extract:textures
./gradlew extractSprites
./gradlew extractObjects
./gradlew extractNpcs
```

The first run takes a while: `extract:models` writes 1-3 GB of model JSON and `extract:raw` writes every region and config archive.

---

## Output Layout

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

---

## Directory Layout

```
pipeline/lossless/             node extractor
  ├── extract-raw.mjs          configs, maps, world-areas, reference tables
  ├── extract-models.mjs       cache index 7 → Models-N.json chunks
  ├── extract-textures.mjs     cache index 8/9 → PNG + manifest
  └── src/                     shared loaders + cache primitives
src/main/java/                 java renderer
  ├── com/clansocket/extractor/   ItemSpriteExtractor + EntitySpriteExtractor + ModelInspector
  └── com/bestbudz/engine/        GPU pipeline + texture store + model representation
build.gradle                   gradle tasks for the renderer
package.json                   node scripts for the extractor
```

---

## Notes

- The renderer opens a hidden GLFW window for the OpenGL context, so headless servers need a virtual display.
- Texture PNGs in the cache are tiny (around 17×18). `TextureStore` upscales each one to a uniform 128×128 layer on load so the `GL_TEXTURE_2D_ARRAY` footprint is consistent.
- Map locations (`index 5 file 1`) are XTEA-encrypted; missing keys are surfaced in each per-region JSON's `locationsXteaStatus` field.
- `./gradlew inspect` is the easiest way to iterate on a single model, with a live render-toggle sidebar.

---

## License

BSD 2-Clause. See [LICENSE](LICENSE).
