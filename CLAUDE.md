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
    quality.ts            quality presets + automatic downgrade
    save.ts               persistent cash/stash/outfits/upgrades/escape counts
    economy.ts            Loot (carried, fence, stash) + Shop (upgrades, outfits, respray)
  assets/textures.ts      procedural pixel textures (facades, asphalt, sidewalk…)
  render/
    patch.ts              world shader patch: blackout darkness bubbles
    post.ts               post pass: grade, vignette, hacker vision, flashes
    environment.ts        sky dome (pixel clouds), sun, hemi, fog
    fx.ts                 instanced cube particles (sparks, smoke, debris)
    ambient.ts            pigeons, steam, newspapers, litter
    world.ts              time of day, rain, rush hour, street market event
  world/
    layout.ts             grid constants, road graph, street names
    geo.ts                GeoBuilder (merged boxes w/ world UVs, vertex colours)
    collision.ts          AABB spatial hash, circle resolve, raycast/LOS
    materials.ts          shared world materials
    city.ts               seeded city generator (blocks, lamps, signals, skyline)
    bank.ts               hand-built bank: lobby, office, vault, doors, cams
    signals.ts            traffic-light state machine + hack overrides, green wave
    streetlife.ts         carts, ATMs, bus stops, cell towers, vents, crowd spots
    interior.ts           Kit: modular rooms/props/colliders/surfaces, streamable
    buildings.ts          enterable buildings, ladders, ziplines, per-site alarms
  characters/
    skins.ts              colour/detail specs from the reference sheets
    rig.ts                procedural SkinnedMesh rig + animations
    loader.ts             optional GLB loader with procedural fallback
  player/
    player.ts             on-foot controller (walk/run/vault/interact)
    camera.ts             third-person + vehicle camera rig, shake, FOV kick
    disguise.ts           outfits; police remember the last one they saw
  vehicles/
    vehicle.ts            arcade car physics, damage, collision
    carMesh.ts            boxy sedan / cruiser / van meshes
    skids.ts              instanced skid marks
  ai/
    traffic.ts            civilian traffic on the road graph
    police.ts             heat, police cars/officers, roadblocks, helicopter
    routeMemory.ts        adaptive route-memory heatmap (persisted)
    pedestrians.ts        sidewalk crowds, panic, lures
    guards.ts             guards with vision cones (bank + per-building)
    cameras.ts            security cameras (street, bank, per-building)
    escapes.ts            metro, sewers, hiding, billboards, drones, bollards, adaptive posts
  hacking/hack.ts         hacker mode, hackables, effects
  heist/heist.ts          objectives, alarm, win/fail, stats
  heist/jobs.ts           fixer phone: ATM, courier, data, armored truck, evidence
  ui/hud.ts               HUD, minimap, toasts, screens, phone, escape list
  ui/news.ts              radio lines + billboard ticker
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
- **Phase 2 vehicles:** 20 kinds in `vehicles/carMesh.ts` (bicycle, scooter, motorbike, police bike, sedan, hatchback, taxi, sports, muscle, pickup, SUV, delivery van, food truck, box truck, garbage truck, bus, ambulance, fire truck, cruiser, SWAT) with per-kind tuning in `PARAMS` (vehicle.ts). Two-wheelers: lean, Shift = boost (+wheelie on motorbikes), 0.42 m hitbox, rider visible in a `ride` pose (pedals on bicycles), thrown off on impacts > 8.5 m/s. Collision circles scale with vehicle length. Building gaps inside blocks are 1.5 m: bikes fit, cars don't.
- **Traffic (`ai/traffic.ts`):** density from quality (12–32), district spawn weights (downtown / industrial / residential, `SPAWN_WEIGHTS`), lane changes when blocked, honking in jams, panic swerve from a player car closing fast head-on, pulling over for sirens, ambulance/fire-truck runs every 35–60 s, 2 city buses on fixed loops that stop at bus stops. Parked vehicles use the same district weights.
- **Stealing:** parked vehicles are locked — hold E for 1.4 s to pick the lock (witnesses may call; 25 % car alarm), or hack the vehicle (LMB = unlock quietly, RMB = alarm decoy). Traffic is carjacked instantly. Police bikes join at heat 2+.
- Clip keys: B bicycle, N motorbike, V cycles every vehicle kind, K crowd burst, [ / ] teleport between sites.
- **Phase 3 buildings (`world/buildings.ts`, kit in `world/interior.ts`):** reserved blocks stay empty in `city.ts` (`Buildings.reserve` runs before `city.build`). Exteriors always exist; interiors stream in < 60 m, out > 110 m (meshes, colliders, surfaces, hackables, guards and cams all released; per-site state resets on stream-in). Playable: Mart 24 (rob or skim register; clerk calls 911 unless you stay within 3.5 m), Gems & Co (hack door, lasers, 4 cases, safe, alarm panel), Pawn & Loan (fence, clothes), safehouse (wardrobe, stash, upgrades, sleep/save), police station (records hack: heat -2, forgets routes), parking garage (3 levels, ramps, respray $200, cars to swap, hackable barrier), Vantage Tower (turnstiles, elevator, server room, roof helipad, ziplines). Warehouse and Lucky 7 Arcade are closed stubs. Public areas are safe: `Buildings.trespassing` limits alarms to `restricted` zones and upper floors. Multi-level ground goes through `surfaces`/`surfaceHeight` in `layout.ts`. Hand-placed + 10 generated fire escapes; 4 ziplines. `g.carAction` = context action for E while driving.
- **Phase 4 escapes (`ai/escapes.ts`):** three metro stations under the street (y = -8), hack or vault turnstiles, trains every 30 s, riding drops the trail at the origin station. **Default: the metro is underground and fade-cut, so trains are not visible crossing the map.** Six paired sewer manholes. Hide in dumpsters, parked vans/box trucks, the wardrobe. Decoys: car alarms, billboards, drones. No waterfront, so **bollards replace the drawbridge** (3 hackable rows, 2.24 m spacing: bikes pass, cars don't). **Green wave:** LMB on a signal while driving > 2 m/s turns it and the next two green for you and red for cross traffic; each flips to a cop-obeyed red once you pass (on foot LMB = all green chaos; RMB = all red). Disguises and respray make the description stale: recognition drops to 8–10 m. Adaptive: after 2+ uses of an escape (`save.data.escapes`) police post officers at metro/sewer, fly the helicopter from heat 3 for rooftops, and search dumpsters, with a HUD hint.
- **Phase 5:** cash in `core/save.ts`/`economy.ts` (fence pays 80 %, 60 % while hot; busted = carried loot confiscated; stash is safe). Upgrades: longer blackouts, cheaper hacks, faster recharge, tuned getaway car. Jobs on J/Enter/X. `render/world.ts`: 8 real minutes per in-game day, rain lowers grip 18 %, rush hour +30 % traffic, a street market closes one Mill St block (`REdge.closed`). Clip keys O = +3 hours, I = rain.
- **Perf (stress: heat 5, rain, near 4 buildings, Intel Iris Xe, 1920×1080 CSS at 150 % scaling, forced GPU sync):** LOW ≈ 15 ms, MEDIUM ≈ 19 ms, HIGH ≈ 19 ms, ULTRA ≈ 26 ms. Fixes that got there: 8-bit sRGB render target instead of half-float, PCF instead of PCF-soft shadows, 30 Hz shadow refresh on LOW/MEDIUM, MSAA per preset. Game starts on HIGH and auto steps down.
- Python edits on Windows: use `open(..., encoding='utf-8', newline='')` — default cp1252/CRLF corrupts sources.

## Testing notes
- Plain screenshots of the preview pane can return a stale image; `zoom` over the full region captures a fresh frame.
- The in-app preview pane pauses `requestAnimationFrame` when hidden; loading falls back to timeouts. For scripted tests, call `game.frame()` in a loop from the console (`window.game` is exposed) and dispatch `KeyboardEvent`s on `window`.
- Perf baseline (mid-chase, heat 3): ~330 draw calls incl. shadows, ~4.7 ms render, ~1.6 ms update.
- Build: see `npm run build` output; no asset files.
- `window.game` is the canvas (named element access) until `main.ts` runs: wait for `game.state` before scripting. Editing a source reloads the page mid-script.
