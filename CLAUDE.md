# BLACKOUT CITY — project rules

Browser 3D open-city heist game. Tagline: **"Cut the power. Rob the city."**
Vite + TypeScript + Three.js. Game-jam entry judged on gameplay footage, so a
tight, great-feeling, good-looking slice beats a big empty map.

## Commands
- `npm run dev` — dev server on http://localhost:5173
- `npm run build` — typecheck (`tsc --noEmit`) + static build into `dist/`
- `npm run preview` — serve the build
- Deploy: Vercel static build (`vercel.json`: build `npm run build`, output `dist`).

## Rules
- All visuals follow **ART_BIBLE.md**. Colours come from `src/core/palette.ts`; never inline a new hex for a world material without adding it there first (props/characters may use art-bible hexes directly).
- Textures are procedural canvas textures (`src/assets/textures.ts`), low-res, `NearestFilter` mag. World textures use `NearestMipmapNearest` min-filter to stop distant moire (no texel blending). No image files ship in the build.
- Materials: Lambert (matte) or Basic only. Every world material must go through `patchWorld()`/`worldMat()` (`src/render/patch.ts`) so blackout darkness works on it.
- No physics engine. Arcade physics + AABB spatial hash (`src/world/collision.ts`).
- Repeated geometry: `InstancedMesh` (trees, lamps, signal lamps, skyline, particles, skid marks). Static geometry is merged per block per material with `GeoBuilder`.
- Characters: one `SkinnedMesh` per character (rigid bone weights, single draw call), shared skeleton layout for player/cops/peds/guards. GLBs in `/assets/models` override procedural rigs when present.
- No guns, no copyrighted characters/music/logos. All audio is synthesized with WebAudio.
- Keep 60 fps on a mid-range laptop: watch draw calls, shadow map 2048, fog ~70–270 m.
- After each build step: run the dev server, test, fix errors, commit with a clear message.

## Units & world layout
- 1 unit = 1 metre. Y up. Characters face +Z at rest; yaw 0 = facing +Z; forward = (sin yaw, cos yaw).
- 6×6 blocks, pitch 56 m, roads 14 m (2 lanes each way, right-hand traffic), sidewalks 4 m, curb 0.15 m. Map spans ±168 m. Constants in `src/world/layout.ts`.
- Road graph: 7×7 intersections, `RoadGraph` (Dijkstra paths, street names).
- The Bank: block (1,2), front faces Union Blvd (z = 0). Interior floor y = 0.95.
- Drop point: Old Garage in block (5,5), roll-up door facing west.
- Player start: the bank's front sidewalk on Union Blvd (-75, -8.6).

## File map
```
src/
  main.ts                 bootstrap: loading screen, title, game loop
  style.css               HUD / screens styling (pixel font VT323)
  core/
    palette.ts            all colours (art bible)
    math.ts               RNG (mulberry32), damp/lerp/angle helpers
    input.ts              keyboard/mouse, pointer lock, per-frame edges
    game.ts               Game: owns every system, update order, state machine
  assets/textures.ts      procedural pixel textures (facades, asphalt, sidewalk…)
  render/
    patch.ts              world shader patch: blackout darkness bubbles
    post.ts               post pass: grade, vignette, hacker vision, flashes
    environment.ts        sky dome (pixel clouds), sun, hemi, fog
    fx.ts                 instanced cube particles (sparks, smoke, debris)
  world/
    layout.ts             grid constants, road graph, street names
    geo.ts                GeoBuilder (merged boxes w/ world UVs, vertex colours)
    collision.ts          AABB spatial hash, circle resolve, raycast/LOS
    materials.ts          shared world materials
    city.ts               seeded city generator (blocks, lamps, signals, skyline)
    bank.ts               hand-built bank: lobby, office, vault, doors, cams
    signals.ts            traffic-light state machine + hack overrides
  characters/
    skins.ts              colour/detail specs from the reference sheets
    rig.ts                procedural SkinnedMesh rig + animations
    loader.ts             optional GLB loader with procedural fallback
  player/
    player.ts             on-foot controller (walk/run/vault/interact)
    camera.ts             third-person + vehicle camera rig, shake, FOV kick
  vehicles/
    vehicle.ts            arcade car physics, damage, collision
    carMesh.ts            boxy sedan / cruiser / van meshes
    skids.ts              instanced skid marks
  ai/
    traffic.ts            civilian traffic on the road graph
    police.ts             heat, police cars/officers, roadblocks, helicopter
    routeMemory.ts        adaptive route-memory heatmap (persisted)
    pedestrians.ts        sidewalk crowds, panic, lures
    guards.ts             bank guards with vision cones
  hacking/hack.ts         hacker mode, hackables, effects
  heist/heist.ts          objectives, alarm, win/fail, stats
  ui/hud.ts               HUD, minimap, toasts, screens
  audio/audio.ts          WebAudio synth (engine, siren, hacks, ambience)
  debug/debug.ts          clip/debug keys, ?clip mode
assets/                   reference art (not shipped) + optional models/
```

## Design decisions (defaults picked, revisit if needed)
- **Time of day:** overcast late afternoon tipping to dusk, so lamps/windows glow and blackouts read strongly.
- **Hacker mode** slows time to ~35 % while held (aiming hacks is easier and it looks great on video). Hack target = hackable closest to the crosshair within range. LMB/E = primary hack; RMB on a traffic light = all red.
- **Win condition:** reach the Old Garage drop with the loot while no cop has eyes on you (unseen ≥ 3 s). Heat decays while unseen.
- **Busted:** a cop on foot within ~1.6 m of you for a cumulative 3 s, or your car is stopped & boxed in by cops for 3 s, or the getaway car is wrecked during the escape.
- **Route memory persists** in `localStorage` across runs (with decay), so the police "learn" favourite escape routes between attempts. Shown via HUD hints + minimap highlights.
- **Bank alarm:** cameras/guards spotting you in the restricted zone fill a suspicion meter; full = alarm (heat 2). Grabbing the loot always trips the alarm.
- GLB models are looked up at `/assets/models/*.glb` (dev serves the folder; the build copies it into `dist`).

## Expansion pass 2 ("make the city alive")
- **Phase 0:** heat-4 roadblocks fire 2.5 s after reaching heat 4 (40–120 m ahead, prefers learned routes, fallback cone); reaching heat 5 force-spawns a SWAT van (bypasses the unit cap) and the helicopter arrives from 60 m. `core/quality.ts`: 4 presets (LOW→ULTRA) scale traffic, crowd size, full-detail rigs, shadow map, pixel ratio; auto-downgrades when the frame-time EMA exceeds the 60 fps budget for 2.5 s, re-upgrades after 15 s of headroom. F3 = debug overlay (fps, draw calls, agent counts), F4 = cycle quality.
- **Phase 1 crowd (`ai/pedestrians.ts`):** 90–230 agents on a sidewalk graph (block corners + crosswalk edges that wait for the signal). LOD: nearest N agents (quality.rigs) within 52 m get a pooled `RigCharacter`; the rest are 4 `InstancedMesh` "ghost" draw calls; agents >195 m run a cheap path-only update. Roles: walkers (office/jogger/courier/teen/tourist/construction/dogwalker/local), vendors at carts, queues at carts/ATMs, buskers, bench sitters/homeless, chat groups, tower security. Types come from `characters/pedTypes.ts` (recoloured/re-propped reference sheets; rig supports briefcase/parcel/phone/camera/hardhat/guitar/backpack/apron + hi-vis). Walkers duck into street doors and re-emerge elsewhere.
- **Witnesses:** crimes call `peds.witnessCrime(pos)`; up to 2 peds with LOS start a 5.5 s 911 call (red ☎ icon + progress). Cancelled by getting within 3.2 m (they put hands up and flee), breaking LOS for 2.2 s, a blackout, or a jammed cell tower (hackable `cell`, 150 m, 30 s). A completed call = heat +1 and a radio/news line.
- **Ambient (`render/ambient.ts`):** pigeon flocks that scatter from people/cars, steam vents, tumbling newspapers, instanced litter. Street furniture in `world/streetlife.ts` (food/coffee carts, ATMs, bus stops, cell towers, vents).
- **News/radio (`ui/news.ts`)** describes the player by current outfit or car colour ("suspect in a green tie"). `player/disguise.ts` + `core/save.ts` added as groundwork for later phases.
- Python edits on Windows: use `open(..., encoding='utf-8', newline='')` — default cp1252/CRLF corrupts sources.

## Testing notes
- Plain screenshots of the preview pane can return a stale image; `zoom` over the full region captures a fresh frame.
- The in-app preview pane pauses `requestAnimationFrame` when hidden; loading falls back to timeouts. For scripted tests, call `game.frame()` in a loop from the console (`window.game` is exposed) and dispatch `KeyboardEvent`s on `window`.
- Perf baseline (mid-chase, heat 3): ~330 draw calls incl. shadows, ~4.7 ms render, ~1.6 ms update.
- Build: ~215 KB gzipped JS, no asset files.
