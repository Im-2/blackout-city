# BLACKOUT CITY — Art Bible

Source of truth for every visual. Derived by eye from the reference images in
`/assets` (city concept 1–3, main character, police, roadman, roadman2).
All hex values are sampled by eye and live in code at `src/core/palette.ts` —
change them there, not inline.

## 1. Overall look

- **Voxel-ish low poly.** Everything is built from boxes and chunky prisms.
  No smooth curves; cylinders max 8 sides. Bevels are fake (darker pixel rim
  in the texture), never geometry.
- **Pixel textures.** Every surface has a low-res canvas texture (16–64 px)
  sampled with `NearestFilter`, no mipmaps. Surfaces are *mottled*: each
  "pixel" jitters ±4–8% in value around the base colour, like the concept
  art's hand-placed tiles. Never flat fills, never glossy (Lambert only, no
  specular, no metalness).
- **Texel density:** ~8 texels per metre on buildings and roads, ~32 per metre
  on characters. Keep this consistent so nothing looks "sharper" than its
  neighbours.
- **Mood:** overcast late afternoon tipping into dusk. Grey-warm sky, soft
  long shadows from a low sun, light distance haze that swallows the skyline.
  Street lamps and some windows are already glowing warm.

## 2. Palette

### World

| Role | Hex | Notes |
|---|---|---|
| Sky top | `#7d8288` | flat overcast grey-blue |
| Sky horizon / fog | `#a49d90` | warm haze, distance fog colour |
| Sun light | `#ffd9a8` | low, warm, intensity ~1.6 |
| Ambient/hemi | sky `#a8b0b8`, ground `#5a5248` | |
| Asphalt | `#3b3936` base, `#2f2e2c` dark tiles | blocky patchwork |
| Lane yellow | `#b8912f` | centre double line, curb marks |
| Lane white | `#c8c3b5` | dashes, crosswalks, stop lines |
| Sidewalk tile | `#9b9387` / grout `#7f786d` | large square slabs |
| Curb | `#857e73` | |
| Concrete | `#8f8b83` / `#76726b` | office lower floors |
| Office glass | `#283240` / frame `#4a4f55` | dark navy glass grid |
| Brick | `#7b4a34` / `#8d5a3f` / mortar `#5d4a3c` | faded, low contrast |
| Tan stone | `#b39a73` / `#a1885f` | apartment blocks |
| Bank stone | `#bdb5a6` / `#a8a091` | columns, base, steps |
| Bank green | `#5e7149` / `#4a5b39` | roof cornice, dentils |
| Sage building | `#5f6b4f` / `#707b5d` | concept 2 green block |
| Slate blue building | `#3e5870` | concept 3 left building |
| Window lit | `#f2cf86` | warm interior glow |
| Window dark | `#1e252e` | |
| Foliage | `#5d7a34` / `#4c6a2b` / `#6f8b3d` | blocky cube trees |
| Trunk | `#4b3424` | |
| Planter | `#6a4a34` | wooden/brown planters |
| Metal dark (poles) | `#3a3c3e` | lamps, signal poles |
| Signal housing | `#b38b25` | ochre yellow traffic lights |
| Lamp glow | `#ffd88a` | |

### Accents (use sparingly)

| Role | Hex |
|---|---|
| Siren red | `#e0322a` |
| Siren blue | `#2b5ce0` |
| Hacker cyan | `#46e6ff` |
| Alarm amber | `#ffb000` |

### Vehicles

Olive `#5b6433`, taxi tan `#c4a03c`, teal `#3f7b88`, brick red `#9b3b2f`,
dusty navy `#2f3b4d`, beige `#b9a98a`, white van `#cfccc4`. Police cruiser:
black `#1c1c1e` lower body/hood, white `#dcdad2` doors and roof, red/blue bar.
Glass `#1f2730`. Tyres `#1a1a1a`. Headlights `#f3e6b8`, tail lights `#b8231c`.

### Characters

| Character | Element | Hex |
|---|---|---|
| Player (office worker) | skin | `#d48a5c` (shade `#b8714a`) |
| | hair messy dark brown | `#3a2a20` |
| | rumpled sage shirt | `#c9c8a8` (shade `#a9a98a`) |
| | dark green tie | `#3d4b2f` |
| | charcoal trousers | `#2f2f30` |
| | brown loafers | `#6b3f24` |
| Police | navy uniform | `#232c40` (shade `#1a2131`) |
| | badge / name tag | `#c9a245` |
| | shoulder patch | `#4a5a78` with gold rim |
| | duty belt | `#1b1b1b`, buckle `#a0a0a0` |
| | shoes | `#6b3f24` |
| Guard (cop recolour) | uniform | `#4a4a44` charcoal-olive, cap none |
| Roadman 1 | hoodie | `#4f9a2e` (shade `#3f7f24`), white drawstrings |
| | headphones | `#2c2c30`, gold "W" `#e0a020` |
| | glasses | `#141414` |
| | hair/beard | `#6a3a1c` / `#5a3018` |
| | trousers | `#2c2e3c`, shoes `#2a2a2a` |
| Roadman 2 | shirt | `#8fb0d6` with `#d8e4f0` vertical stripes |
| | undershirt | `#e6e0d4` |
| | cap | `#1e1e1e` |
| | beard | `#2a2420` |
| | trousers | `#232323`, sneakers black with sole `#e0d8c4` |
| | bracelet | `#9a2a22` |

## 3. Proportions

- Characters ~1.8 m, about 7 heads tall, slim and slightly slouched (the
  player especially — tired shoulders). Head 0.26 m cube-ish (slightly deeper
  than wide). Torso 0.62 m, legs 0.88 m (≈ half the height). Arms reach
  mid-thigh. Feet are chunky, toe forward.
- Cars: boxy 1990s sedans, ~4.4 × 1.9 × 1.45 m; cabin set back, flat hood,
  square wheel arches, 8-sided wheels. Cop cruiser same chassis + light bar.
- Buildings: floors 3.4 m. Brick/tan blocks 3–6 floors, offices 8–18 floors,
  stepped base (a wider, darker 1-floor plinth, see concept 1 tower).
- Roads 14 m (2 lanes each way), sidewalks 4 m, curb 0.15 m.
- Trees: 1 m trunk-box + 2–3 stacked foliage cubes, in square planters.

## 4. Texture style

- Brick: 2:1 bricks, 1 px mortar, every brick independently jittered.
- Concrete/stone: large 4×4-texel blocks with soft value noise.
- Windows: dark recessed glass with a 1 px lighter frame; ~30% lit warm.
- Asphalt: 2×2-texel patches of two greys + rare cracks.
- Sidewalk: 8×8 slab tiles with 1 px grout.
- Characters: the reference sheets read as mottled pixel cloth — 2×2 texel
  noise ±6% plus a darker lower-edge band on each part for fake AO.

## 5. Lighting & post

- One directional sun (low, from south-west), hemisphere fill, no point lights
  (lamp pools are additive ground decals — cheap and consistent).
- Fog: linear, colour = horizon haze, ~70 m → 260 m.
- Post: slight desaturation (~12%), lifted blacks, soft vignette.
- **Blackout:** inside a cut block, everything darkens to ~20% with a cold
  navy tint and a thin cyan rim at the edge of the dead zone.
- **Hacker mode:** world desaturates ~70%, cyan tint, scanlines, slight RGB
  split; hackables show cyan wireframe outlines through walls + pixel icons.

## 6. UI

- Pixel font (`VT323`, fallback monospace), uppercase labels.
- Dark navy panels `#0f141c` at ~80% opacity with a 2 px bevel line, no
  rounded corners. Accent cyan for hacking, amber for objectives, siren
  red/blue for heat stars.
