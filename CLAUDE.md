# BLACKOUT CITY — project rules

Browser 3D open-city heist game. Tagline: **"Cut the power. Rob the city."**
Vite + TypeScript + Three.js. Game-jam entry judged on gameplay footage, so a
tight, great-feeling, good-looking slice beats a big empty map.

## Live
- Game: https://blackout-city-five.vercel.app
- Repo: https://github.com/Im-2/blackout-city (public, branch `master`)

## Commands
- `npm run dev` — dev server on http://localhost:5173
- `npm run build` — typecheck (`tsc --noEmit`) + static build into `dist/`
- `npm run preview` — serve the build
- Deploy: push to `master`. The GitHub repo is connected to Vercel, so each push builds and goes to production. By hand: `vercel --prod`.
- Vercel settings: build `npm run build`, output `dist` (`vercel.json`), production branch `master` (it defaulted to `main`, which doesn't exist here). `blackout-city.vercel.app` belongs to someone else: use the address above. Deployment URLs with a hash need a Vercel login; the address above is public. `.vercelignore` keeps the reference PNGs out of CLI uploads.
- Before publishing anything: this repo is public. Never commit `.env*`, keys or personal details. The Vercel CLI writes a token to `.env.local`, which `.gitignore` covers.
- Pushing the first time timed out on this connection and still landed. If a push reports an error, check `git ls-remote origin` before retrying.

## Rules
- All visuals follow **ART_BIBLE.md**. Colours come from `src/core/palette.ts`; never inline a new hex for a world material without adding it there first (props/characters may use art-bible hexes directly).
- Textures are procedural canvas textures (`src/assets/textures.ts`), low-res, `NearestFilter` mag. World textures use `NearestMipmapNearest` min-filter to stop distant moire (no texel blending). No image files ship in the build.
- Materials: Lambert (matte) or Basic only. Every world material must go through `patchWorld()`/`worldMat()` (`src/render/patch.ts`) so blackout darkness works on it.
- No physics engine. Arcade physics + AABB spatial hash (`src/world/collision.ts`).
- Repeated geometry: `InstancedMesh` (trees, lamps, signal lamps, skyline, particles, skid marks). Static geometry is merged per block per material with `GeoBuilder`.
- Characters: one `SkinnedMesh` per character (rigid bone weights, single draw call), shared skeleton layout for player/cops/peds/guards. GLBs in `/assets/models` override procedural rigs when present.
- No guns, no copyrighted characters/music/logos. All audio is synthesized with WebAudio.
- **Input:** gameplay never checks raw keys. It asks `input.pressed('interact')`, `input.held('handbrake')`, `input.moveX`, `input.lookX` and so on; `BINDINGS` in `core/input.ts` is the only place keys and mouse buttons are named. Add an `Action` there for anything new. `press()`/`release()`/`setAxis()`/`addLook()` are the hooks for touch controls. Only `debug/debug.ts` reads raw keys (`debugKey`, clip tools). Full-map drag and wheel, and clicks on DOM buttons, are still DOM events.
- Keep 60 fps on a mid-range laptop: watch draw calls, shadow map 2048, fog ~70–270 m.
- After each build step: run the dev server, test, fix errors, commit with a clear message.

## Units & world layout
- 1 unit = 1 metre. Y up. Characters face +Z at rest; yaw 0 = facing +Z; forward = (sin yaw, cos yaw).
- 12×12 blocks, pitch 56 m, roads 14 m (2 lanes each way, right-hand traffic), sidewalks 4 m, curb 0.15 m. Map spans ±336 m; water beyond the south and east shore. Constants in `src/world/layout.ts`.
- The original 6×6 city is blocks 3..8 at its old world coordinates, so all hand-placed coordinates (bank, shops, stations) stay valid. Add 3 to any old block index.
- Road graph: 13×13 intersections (one skipped by the overpass), `RoadGraph` (Dijkstra paths, street names). The perimeter is `RING`, the highway.
- The Bank: block (4,5), front faces Union Blvd (z = 0). Interior floor y = 0.95.
- Drop point: Old Garage in block (8,8), roll-up door facing west.
- Player start: the bedroom at home (-30.6, 32.6), `Home.START` in `world/home.ts`, in free roam.
- Home: block (5,6) south half, x -45..-11, z 27..45, facing the street at z = 56. Front door (-28, 45), garage door centred on x = -39.75.

## File map
```
src/
  main.ts                 bootstrap: loading screen, title, game loop
  style.css               HUD / screens styling (pixel font VT323)
  core/
    palette.ts            all colours (art bible)
    math.ts               RNG (mulberry32), damp/lerp/angle helpers
    input.ts              named input actions + bindings, axes, hooks for touch; pointer lock
    game.ts               Game: owns every system, update order, state machine
    quality.ts            quality presets + automatic downgrade
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
    stores.ts             clothes stores, barber, corner shops, food stands
    waterfront.ts         lagoon quay, piers, boardwalk, cranes, ship, seawall colliders
    water.ts              waves, drawbridge, marinas, wakes, sinking
    metro.ts              elevated loop: spline, stations, instanced trains, riding
    properties.ts         houses to buy: PROPERTIES table, floor plans, furniture, garages, benefits
    home.ts               the player's home + garage: baked lighting, furniture, TV, displays, parking
  characters/
    skins.ts              colour/detail specs from the reference sheets
    rig.ts                procedural SkinnedMesh rig + animations
    loader.ts             optional GLB loader with procedural fallback
  player/
    player.ts             on-foot controller (walk/run/vault/interact)
    camera.ts             third-person + vehicle camera rig, shake, FOV kick
    clothes.ts            every clothing item, haircut and snack; Look -> Skin
    disguise.ts           what you wear vs what police and news have on file
  vehicles/
    vehicle.ts            arcade car physics, damage, collision
    carMesh.ts            boxy sedan / cruiser / van meshes
    skids.ts              instanced skid marks
    damage.ts             every damage number: health per kind, thresholds, cooldown, limp
  ai/
    traffic.ts            civilian traffic on the road graph
    police.ts             heat, police cars/officers, roadblocks, helicopter
    routeMemory.ts        adaptive route-memory heatmap (persisted)
    pedestrians.ts        sidewalk crowds, panic, lures
    guards.ts             guards with vision cones (bank + per-building)
    cameras.ts            security cameras (street, bank, per-building)
    escapes.ts            sewers, hiding, billboards, drones, bollards, adaptive posts
  hacking/hack.ts         hacker mode, hackables, effects
  heist/heist.ts          bank rules: doors, alarm, loot, drop (active only during the mission)
  heist/jobs.ts           fixer phone: ATM, courier, data, armored truck, evidence
  missions/
    types.ts              MissionDef, MissionStep, type colours + tags
    data.ts               the mission list
    missions.ts           runner: markers, intro card, steps, checkpoints, end screens, rewards
  activities/
    activities.ts         activity spots: map icons, first-visit intro cards
    bikes.ts              bike parking + rental stands, streamed bikes
    stunts.ts             ramps, Stunt Park, Long Jump, Shore Leap
    tricks.ts             trick scoring, combo multiplier, HUD feed
    races.ts              race defs (built into missions), rivals, position, prizes
    route.ts              drivable lines through the road graph, kerb spots, route following
    truck.ts              armored truck intercept
    getaway.ts            getaway driver jobs + crew in the car
    tail.ts               surveillance: tailing a target on foot, phone hack, leads
    pranks.ts             billboard messages + filter, scored prank missions
    collection.ts         rare cars, sets, set rewards
    repair.ts             roadside repair pads
    waterjobs.ts          smuggling run, jet ski race, dock heist
  reputation/reputation.ts rep per district + overall, tiers, shop + ped reactions
  save/records.ts         local best trick scores + race times (written at once)
  save/save.ts            localStorage save: cash, stash, outfits, upgrades, escapes, missions, rep, vehicles
  map/
    districts.ts          the 6 districts: tint, styles, traffic + crowd mix, block table
    chunks.ts             world streaming around the player, parked cars
    fasttravel.ts         taxi stands + menu
    gps.ts                waypoint, road-graph route, chevrons on the road
  ui/hud.ts               HUD, minimap, toasts, screens, phone, escape list, mission card + end screens
  map/places.ts           every place on the map in one list: icon, colour, priority, status
  ui/mapicons.ts          the icon shapes, shared by full map, location list, minimap
  ui/fullmap.ts           full map (M): decluttered markers + LOCATIONS panel, waypoint
  ui/shopui.ts            shop + wardrobe screen: list beside a live view of the player
  ui/homeui.ts            home screens: hacker desk tabs, gallery, wardrobe, stash, trophies, billboard text
  ui/minigame.ts          the timed hit-the-green minigame (E, Enter, click or tap)
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
- GLB models are read from `/assets/models/*.glb`. `vite.config.ts` lists what's there into `__GLB_MODELS__` when the server or build starts, so nothing is requested unless it exists (asking for a missing file is a 404 in production). Restart the dev server after adding one.

## Expansion pass 2 ("make the city alive")
- **Phase 0:** heat-4 roadblocks fire 2.5 s after reaching heat 4 (40–120 m ahead, prefers learned routes, fallback cone); reaching heat 5 force-spawns a SWAT van (bypasses the unit cap) and the helicopter arrives from 60 m. `core/quality.ts`: 4 presets (LOW→ULTRA) scale traffic, crowd size, full-detail rigs, shadow map, pixel ratio; auto-downgrades when the frame-time EMA exceeds the 60 fps budget for 2.5 s, re-upgrades after 15 s of headroom. F3 = debug overlay (fps, draw calls, agent counts), F4 = cycle quality.
- **Phase 1 crowd (`ai/pedestrians.ts`):** 90–230 agents on a sidewalk graph (block corners + crosswalk edges that wait for the signal). LOD: nearest N agents (quality.rigs) within 52 m get a pooled `RigCharacter`; the rest are 4 `InstancedMesh` "ghost" draw calls; agents >195 m run a cheap path-only update. Roles: walkers (office/jogger/courier/teen/tourist/construction/dogwalker/local), vendors at carts, queues at carts/ATMs, buskers, bench sitters/homeless, chat groups, tower security. Types come from `characters/pedTypes.ts` (recoloured/re-propped reference sheets; rig supports briefcase/parcel/phone/camera/hardhat/guitar/backpack/apron + hi-vis). Walkers duck into street doors and re-emerge elsewhere.
- **Witnesses:** crimes call `peds.witnessCrime(pos)`; up to 2 peds with LOS start a 5.5 s 911 call (red ☎ icon + progress). Cancelled by getting within 3.2 m (they put hands up and flee), breaking LOS for 2.2 s, a blackout, or a jammed cell tower (hackable `cell`, 150 m, 30 s). A completed call = heat +1 and a radio/news line.
- **Ambient (`render/ambient.ts`):** pigeon flocks that scatter from people/cars, steam vents, tumbling newspapers, instanced litter. Street furniture in `world/streetlife.ts` (food/coffee carts, ATMs, bus stops, cell towers, vents).
- **News/radio (`ui/news.ts`)** describes the player by current outfit or car colour ("suspect in a green tie"). `player/disguise.ts` + the save module added as groundwork for later phases.
- **Phase 2 vehicles:** 20 kinds in `vehicles/carMesh.ts` (bicycle, scooter, motorbike, police bike, sedan, hatchback, taxi, sports, muscle, pickup, SUV, delivery van, food truck, box truck, garbage truck, bus, ambulance, fire truck, cruiser, SWAT) with per-kind tuning in `PARAMS` (vehicle.ts). Two-wheelers: lean, Shift = boost (+wheelie on motorbikes), 0.42 m hitbox, rider visible in a `ride` pose (pedals on bicycles), thrown off on impacts > 8.5 m/s. Collision circles scale with vehicle length. Building gaps inside blocks are 1.5 m: bikes fit, cars don't.
- **Traffic (`ai/traffic.ts`):** density from quality (12–32), district spawn weights (downtown / industrial / residential, `SPAWN_WEIGHTS`), lane changes when blocked, honking in jams, panic swerve from a player car closing fast head-on, pulling over for sirens, ambulance/fire-truck runs every 35–60 s, 2 city buses on fixed loops that stop at bus stops. Parked vehicles use the same district weights.
- **Stealing:** parked vehicles are locked — hold E for 1.4 s to pick the lock (witnesses may call; 25 % car alarm), or hack the vehicle (LMB = unlock quietly, RMB = alarm decoy). Traffic is carjacked instantly. Police bikes join at heat 2+.
- Clip keys: B bicycle, N motorbike, V cycles every vehicle kind, K crowd burst, [ / ] teleport between sites.
- **Phase 3 buildings (`world/buildings.ts`, kit in `world/interior.ts`):** reserved blocks stay empty in `city.ts` (`Buildings.reserve` runs before `city.build`). Exteriors always exist; interiors stream in < 60 m, out > 110 m (meshes, colliders, surfaces, hackables, guards and cams all released; per-site state resets on stream-in). Playable: Mart 24 (rob or skim register; clerk calls 911 unless you stay within 3.5 m), Gems & Co (hack door, lasers, 4 cases, safe, alarm panel), Pawn & Loan (fence, clothes), safehouse (wardrobe, stash, upgrades, sleep/save), police station (records hack: heat -2, forgets routes), parking garage (3 levels, ramps, respray $200, cars to swap, hackable barrier), Vantage Tower (turnstiles, elevator, server room, roof helipad, ziplines). Warehouse and Lucky 7 Arcade are closed stubs. Public areas are safe: `Buildings.trespassing` limits alarms to `restricted` zones and upper floors. Multi-level ground goes through `surfaces`/`surfaceHeight` in `layout.ts`. Hand-placed + 10 generated fire escapes; 4 ziplines. `g.carAction` = context action for E while driving.
- **Phase 4 escapes (`ai/escapes.ts`):** the underground metro here was replaced by the elevated one in `world/metro.ts` (pass 4). Six paired sewer manholes. Hide in dumpsters, parked vans/box trucks, the wardrobe. Decoys: car alarms, billboards, drones. No waterfront, so **bollards replace the drawbridge** (3 hackable rows, 2.24 m spacing: bikes pass, cars don't). **Green wave:** LMB on a signal while driving > 2 m/s turns it and the next two green for you and red for cross traffic; each flips to a cop-obeyed red once you pass (on foot LMB = all green chaos; RMB = all red). Disguises and respray make the description stale: recognition drops to 8–10 m. Adaptive: after 2+ uses of an escape (`save.data.escapes`) police post officers at metro/sewer, fly the helicopter from heat 3 for rooftops, and search dumpsters, with a HUD hint.
- **Phase 5:** cash in `save/save.ts`/`economy.ts` (fence pays 80 %, 60 % while hot; busted = carried loot confiscated; stash is safe). Upgrades: longer blackouts, cheaper hacks, faster recharge, tuned getaway car. Jobs on J/Enter/X. `render/world.ts`: 8 real minutes per in-game day, rain lowers grip 18 %, rush hour +30 % traffic, a street market closes one Mill St block (`REdge.closed`). Clip keys O = +3 hours, I = rain.
- **Perf (stress: heat 5, rain, near 4 buildings, Intel Iris Xe, 1920×1080 CSS at 150 % scaling, forced GPU sync):** LOW ≈ 15 ms, MEDIUM ≈ 19 ms, HIGH ≈ 19 ms, ULTRA ≈ 26 ms. Fixes that got there: 8-bit sRGB render target instead of half-float, PCF instead of PCF-soft shadows, 30 Hz shadow refresh on LOW/MEDIUM, MSAA per preset. Game starts on HIGH and auto steps down.
- Python edits on Windows: use `open(..., encoding='utf-8', newline='')` — default cp1252/CRLF corrupts sources.

## Expansion pass 3 ("the open world")
- **Phase A, wider map:** 12×12 blocks. Districts in `map/districts.ts`: Downtown (centre-north), Old Town (west), Docks & Industrial (east), Residential (north + south-centre), Park & Waterfront (south rows + the downtown square). `districtAt(x,z)` is the lookup; the shop-row block straddles the line so the pawn shop is Old Town and the safehouse Residential. Districts differ by tint (vertex colours on facades and sidewalks), facade styles, floors, lot types, traffic and crowd weights.
- **Old Town "narrow streets" default:** road width is unchanged (the road graph and lanes assume 14 m). Buildings crowd 1 m closer on 3 m sidewalks instead.
- **Highway ring:** perimeter road, no signals or crosswalks, traffic runs up to double cruise, police pathing prefers it. **Bridge:** south side over a harbour channel. **Overpass:** Foundry St flies over Pier Ave in the docks (`OVERPASS`; a 112 m graph edge, node (10,4) only connects along the avenue). `City.elevated()` builds these from `surfaces` plus rail colliders. A seawall stops anyone reaching the water; landward sides end in boundary buildings.
- **Streaming (`map/chunks.ts`):** a chunk is 2×2 blocks (36 + boundary sectors). On crossing a 28 m cell: chunk meshes hide and free GPU buffers (`geometry.dispose()`, re-uploaded on return), instanced trees/lamps rebuild for active blocks only, signal lamps limit to near heads, parked cars stream in < 115 m and out > 165 m (max 26; a stolen car's spot stays empty for the run), crowd and pigeons re-home. Quality preset `view` sets both the streaming radius and fog far (165–265 m). Colliders and road graph stay loaded (static, cheap).
- **Crowd streaming:** fixed 230-agent pool shuffled so quality drops all roles evenly. Stationary roles claim the nearest free spots within 180 m (released past 205 m); walkers past 195 m reappear out of sight 90 m+ away, accepted by that district's `peds` weights.
- **Blackouts** no longer swap facade materials per block (chunks are bigger than blocks); the darkness shader alone dims windows.
- **Vehicle LOD:** hubs off past 35 m, wheels and brake lights off past 110 m (Manhattan distance). Wheels cast no shadows. Saves ~8 draws per car.
- **Fast travel:** E at a taxi stand (one per district + the safehouse door): $50, free if you're broke, refused while heat > 0.
- **Clip:** `[` `]` now also teleports to each district's stand. Saved route memory from the old map is discarded (edge count changed).
- **Perf (stress: heat 5, chase, Intel Iris Xe, 1920×1080 CSS at 150 % scaling, forced GPU sync):** LOW ≈ 15 ms (178 draws), MEDIUM ≈ 16 ms (135), HIGH ≈ 25 ms (240). `npm run build` ≈ 270 KB gz.
- Minimap redraws at 15 Hz from a sub-rect of the map canvas; it was 4.7 ms per frame before.
- **Phase B, missions:** the game now starts in free roam at the safehouse. A mission is a `MissionDef` in `missions/data.ts`: id, title, giver, district, type, marker, `unlock`, `steps`, `timeLimit`, `failIf`, `failOnWreck`, `setup`/`cleanup`/`summary`, `reward`, `replay`. Nothing else needs touching to add one. A step has `text`/`sub` (string or function), `target` (drives beam, arrow, GPS, distance), `reach` and/or `done`, `enter`, and an optional `checkpoint.restore` that rebuilds the world when retrying from it. Samples: `courier_run` "Hot Parcel" and `bank_heist` "Cut the Power".
- **Mission flow:** walk (2.8 m) or drive (5.5 m) into a marker for the intro card: the player freezes, a car brakes, E/Enter starts, Backspace/X declines. Fail screen: Enter/C = checkpoint, R = mission, X/Backspace = quit. Success: Enter/E/Space continues free roam where you stand. End screens come up 1.4 s after the result. `GameState` gained `map`; `g.play()` returns to gameplay. `g.missionTarget()` priority: mission, then job, then waypoint.
- **Mission defaults (revisit if needed):** heat alone never fails a mission, only a bust does. Missions don't track a specific vehicle, so swapping or leaving one can't break them. Markers refuse to start while heat > 0, with a hint, so a chase never dumps into a card. The bank heist is locked behind Hot Parcel to demonstrate locks: delete `unlock` in `data.ts` to open it. Retrying from a checkpoint keeps the time on the clock and counts elapsed time toward best time. Bank doors are hackable and the loot grabbable only while `heist.active`.
- **Free-roam bust:** fine up to $250, heat cleared, released outside the police station at (84, 8). A bust during a mission opens the fail screen instead.
- **Keys:** M = full map (click = waypoint, right-click clears, drag = pan, wheel = zoom). Mute moved from M to Z. R retries only while a mission is running. Clip: backtick = unlock all missions, L = reset to the heist's escape step. `?clip` starts at that step too.
- **Save:** `blackoutcity.save.v1` holds completed missions (count, best time), reputation (overall + per district), owned vehicles and `unlockAll` on top of the older fields. The title shows CONTINUE + NEW GAME when progress exists. New Game on the title and pause screens asks for a second click, then wipes the save.
- **Part 1, the home (`world/home.ts`, screens in `ui/homeui.ts`):** replaces the old safehouse on the same lot, in Residential. A ground-floor flat (living room, kitchen, bedroom, bathroom, hacker den) with a garage beside it. New games and reloads start in the bedroom. The front door has no gap in the wall: E + fade at the door each way, so nothing can walk in. Same for the door between the flat and the garage.
- **Home lighting:** `bake()` multiplies vertex colours by a `LAMPS` list at stream-in (lamps only light their own room), drawn with an unlit material, so warmth is one draw call and ignores the sun and the clock. Rooms are painted as inward-facing quads 1.5 cm proud of the shell (or they z-fight). Hex colours go in through `** 2.2` because the material is unlit. While inside, `post.warm` warms the grade and softens the vignette, and the hemisphere light turns warm so the player's model matches. The windows are real gaps: the street outside is the live street.
- **Save rule:** only sleeping in the bed writes to `localStorage` (`save.commit()`), and New Game wipes it. Everything else, mission rewards included, stays in memory until then, and a hint after each mission says so. The bed refuses while heat > 0 or during a mission. Sleeping skips 8 hours and the hour is saved. Carried loot isn't saved: the bed warns you to stash it.
- **Police and the home:** `g.home.inside` covers the flat and the garage. Inside, they can't see you or bust you, `lastKnown` is pinned to the front door, cars pull up within 22 m and deploy officers (cap 6) who wait on the pavement via `home.stakeout()`, and heat decays 5× slower than normal (`dt / 35`). Walking out puts you straight back in a pursuit. The garage door stays shut while heat > 0 unless you're inside it.
- **Garage + collection:** stop in the garage with a vehicle and E parks it (`g.carAction`). New kind + colour pairs join `save.ownedVehicles`, and `save.garage` is what waits in the bay after a reset. The bay holds one vehicle; the desk's COLLECTION tab swaps in any you own. Parked vehicles appear as model cars on the den shelf.
- **Other home interactions:** bed, wardrobe (outfit list), hacker desk (tabs: missions + GPS, map, collection, reputation, upgrades), stash safe (stash loot, or take it back out to sell), trophy shelf (cups per mission, stash goods, cash bricks from `save.earned`), coffee machine (fills hack energy). `home.refreshDisplays()` rebuilds the shelves. The TV draws `news.ticker` to a canvas at 12 Hz and the big monitor shows a live police map at 2.5 Hz, both only while you're in the flat.
- **Map icons:** green house = home (minimap: always pinned; full map: tooltip), green `G` = your garage, gold `TAXI` includes a Home stand beside the front door. New `GameState` `menu` freezes the world behind the home screens. `fadeTeleport` takes an optional callback at the black point, and `g.fading` freezes the player on foot.
- **Camera:** the shoulder offset is clamped by a raycast (it could start behind a wall), the camera pulls in to 2.7 m in the flat, the on-foot minimum distance dropped from 0.6 m to 0.1 m (0.6 could land it behind the wall you're backed against), in the home it's pushed off walls by a 0.2 m circle, and the player model hides when the camera is within 0.55 m. Shadows don't refresh while you're in the flat. Vaulting now needs a clear line at head height, so it can't carry you through a wall.

- **Part 2, activities:** every spot goes through `g.activities.add()` (name, type, map icon, intro) and gets its first-visit card automatically (`save.seen`). New map types in `TYPE_INFO`: `stunt`, `bike`. Races are missions (`RACE_MISSIONS`), so markers, cards, beams, GPS, fail and retry come from the mission runner.
- **Bikes:** bicycle and motorbike were already rideable. Bike parking (free bicycles) and rental stands (motorbike $40, scooter $20, bicycle $8; `Vehicle.rental`; broke = hold E to pick the lock) are placed on clear pavement by `Bikes.findSpot`, stream like parked cars and restock once you're 70 m away.
- **Airtime:** `Vehicle` now has real vertical motion: `air`, `vy`, gravity 20. When the ground drops > 0.3 m it launches with the climb rate it had. In the air, two-wheelers spin with steer and flip with `trick` + throttle (flips need the key because everyone holds the gas off a ramp). `landed` is consumed by `tricks.ts`; a crooked landing (> 60°) throws you off. Air applies to every vehicle, including cars off deck edges.
- **Tricks:** `trick` action = F. Hold F = wheelie, F + S = stoppie, Shift's boost wheelie on motorbikes also scores. Each trick adds to a combo, +1 multiplier (max ×8), 2.6 s to chain, banked as score × mult = cash (score / 25) + rep. Best five in `Records`, shown on the Stunt Park scoreboard (E) and the desk's RECORDS tab. Records save immediately and survive New Game: they're an arcade table, not progress.
- **Ramps:** `Stunts.ramp()` = a `surfaces` slope + 0.6 m collider slices just under it. Ramps must line up with a run-up: `RUNWAYS` park blocks have no fountain, no planters, and a surface on their grass. A flat top after a ramp kills the launch (climb rate decays), so don't add one.
- **Races:** `RACES` in `activities/races.ts`: class, corners on the road graph, laps. Three rivals in the same vehicle start ahead of you. Corner speeds come from what the car can actually steer (`steerRate / (1 + v/45)`), with a backward pass for braking. Rubber band: over 30 m from you, at most -12 % / +8 %, off in the last 20 %. Rivals never wreck (hp floor 25) and rejoin the line only if badly stuck out of sight. Finish top three for 100 / 40 / 15 % of the prize; last place fails. Polylines must not hold repeated points: they read as a hairpin and the corner limit crawls.
- **Reputation:** `g.rep.add(district, n)` from missions, crimes (`news.report`), tricks. Tiers NOBODY 0, SMALL-TIME 10, KNOWN 50, WANTED NAME 150, CITY LEGEND 400. `tierHere` = local rep + 25 % of overall. Clerks and the fence greet you by tier; from KNOWN the Mart clerk stops calling 911; fence pays +2 % per tier, clothes -5 % per tier. Walkers recognise you (speech bubble, stop and film, or run if you have heat; a changed outfit makes it rarer). `news.ts`: ticker on billboards + TV carries headlines and your record; the radio scanner reads your outfit and record every 70 s. Crime counts live in `save.crimes`.
- **Keys:** F trick. Clip: `;` = +25 rep.
- **Map:** add a place in `map/places.ts` (or via `g.activities.add`, or as a mission) and it appears on the full map, list and minimap. Priority (`PRIO`): active mission 100, mission 90, race 85, home 80, key places 70, stunts 60, shops 50, garages 40, taxi/bike/metro/closed 30. Shapes (`mapicons.ts`): mission = diamond with type colour + letter, race = pink chequered flag, home = green house, bank = gold temple, police = blue shield, tower = pale bar, stunt = lime wedge, shop = circle with S, fence = ringed coin, garage = square with P/G/D, taxi = small yellow bar, metro = small blue triangle, bike rack = violet ring, rental = ring with gold centre, patrol car = small red/blue bar (the "two red squares" were these, unlabelled), group = grey circle with a count.
- **Map declutter (`FullMap.buildLayout`, runs each draw):** places at shop priority or below merge when within 25 px into a count badge; click or zoom to split. Everything then places in priority order: a marker that would touch one already placed (or the player arrow) moves to the nearest free spot, with a thin leader line and a dot at its true position. Icon scale grows 0.85 to 1.3 with zoom. District names are drawn faint behind markers. The tooltip picks whichever side covers the fewest markers. `g.map.layout` is public so tests can check overlaps.
- **LOCATIONS panel:** beside the map, and the map's width shrinks to fit. Tabs ALL / MISSIONS / RACES / ACTIVITIES / SHOPS / SERVICES (←→), search, sort near/type, ↑↓ moves the selection, Enter or double-click toggles GPS, click flies the map there. Bank and police station count as SERVICES. A mission's waypoint still loses to the mission target (`g.missionTarget`). `Input` ignores keys typed into text boxes.
- **Minimap:** same icons and priority. Places draw most important first; anything landing on one already drawn is skipped, minor ones only show in range, only missions, races, home and Stunt Park pin to the edge. No labels.

## Remaining activities
Everything below is a `MissionDef` (or a place), so markers, map, minimap, LOCATIONS, cards, GPS, fail, retry and save come for free. A mission's `icon` and `category` choose its map shape and tab. New types: `intercept`, `getaway`, `tail`, `prank`, `rare`. `g.routeLine` draws a dashed route on both maps. With 30+ markers only the nearest six pin to the minimap edge.
- **Minigame (`ui/minigame.ts`):** a cursor sweeps a bar, hit the green. A miss costs 2 s. The world keeps running and the player stands still. Touch gets a HIT button. Used for the truck door and phone hacks. There is no separate "lockpick" or "trace" game: lock-picking is hold-to-pick.
- **Cash in Transit (`truck.ts`):** the truck is a repainted `swat` with driver `racer`, so it can't be stolen and doesn't count as police. It ignores normal lights and stops only for a hacked red (`override` + red for its axis) or a road barrier (two hackable, on its route). Four routes, a different one each attempt, joined about 130 m from you. It holds 26 s once stopped, then drives on unless the door is being cracked. Dispatch calls at 38 s (heat 2). Grabbing the crates = heat 3, +1 every 18 s up to 4 while they can see you. Pays when heat reaches 0: $6,000 + up to $1,500 for speed + $3,000 with the Banker lead. Reaching the end of the route fails it. The older fixer-phone armored job is still there, separately.
- **Getaway (`getaway.ts`):** Diamond Dash (Gems & Co), Payroll Run (Docks), The Vantage Job (Tower; locked behind Shadow the Courier). Default: any car counts as yours, bikes don't fit. Swap cars and the crew get out, run over and get in. The drop refuses while police saw you in the last 2.5 s. Score /100: speed 40 (par time per job), damage 30, heat lost 30. Pay = base × (0.5 + score/100). Ranks S 85, A 65, B 45.
- **Tailing (`tail.ts`):** band 5–42 m. Seeing you takes 2.5 s up close, 9 s at 22 m, faster from a car. It needs line of sight, the view cone (±60°) and no cover: two peds within 3 m of you is cover, and a blackout counts too. The target stops for 1.2 s (a warning) then looks back for 2.8 s every 9–15 s. Under 5 m also fills the meter. Past 42 m for 7 s = lost. The target walks through small props, like normal walkers. Leads: Shadow the Courier unlocks The Vantage Job and The Banker's Lunch; The Banker's Lunch adds $3,000 to truck jobs.
- **Pranks (`pranks.ts`):** hacking any billboard opens a message menu (`HomeTab` `billboard`), 40 s on screen. Custom text is 24 chars, plain characters, checked against `BLOCKED` with leet-speak folded. It's a basic filter: it won't catch everything, and presets are the safe route. Hackable kind `prank`: Mart 24 and Pawn & Loan doors (7 s, people inside put their hands up and complain) and the Vantage lift (8 s). `save.grudges` makes the clerk bring it up next visit. Scored: Prime Time (3 billboards, custom text scores more), Disco Junction (5 lights on Union Blvd in a colour pattern, wrong colour -100), Car Alarm Concert (6 cars on Mill St, on the beat 300, off 100, 4 to pass). Time left adds points. Best scores in `Records.pranks`. No heat from pranks.
- **Rare cars (`collection.ts`):** 9 cars in 3 sets (`RARES`, `RARE_SETS`), each snapped to the nearest `city.parking` spot. Before you've been within 70 m, the map shows only a rough spot and the LOCATIONS row says which district. Parking at home (`home.park` calls `collection.onPark`) owns it. Sets pay $4,000–6,000, all nine another $15,000. Abandoned or wrecked ones go back to their spot once you're 175 m away. Progress on the pause screen, the LOCATIONS panel and the desk's GALLERY tab, where a row sets GPS.
- **Perf:** compared with `c7ddb5d` at the same spot, heat 3: about +8 draw calls (154 vs 146 on LOW, shadows off that frame), frame times the same within noise. Absolute numbers from the hidden browser pane (about 30 ms on LOW) are too slow to judge 60 fps.

## Mobile
- **Device (`core/device.ts`):** `device.touch` = touch-capable and coarse pointer (touchscreen laptops stay on keyboard); `device.mobile` adds the phone/tablet settings; `lowEnd` = deviceMemory ≤ 3 or ≤ 4 cores. Test URLs: `?touch` forces touch + mobile, `?mobile` mobile only, `?desktop` neither. In the browser pane, a viewport under 768 wide also emulates touch (740×360 works).
- **Controls (`ui/touch.ts`):** drives `Input.press/release/setAxis/addLook` only, with one overlay and pointer events, so any number of fingers work. Left side = floating stick (full push also runs), right side = drag to look, `Sides` swaps them. Buttons change with context: on foot ACTION, JUMP, RUN, JOBS, HACK. Driving GAS, BRAKE, DRIFT, EXIT/USE, CAM, HACK. Bikes add TRICK and BOOST (sports and muscle cars get BOOST too). Hacker mode RUN IT, ALT, HACK with look to aim. Mission card START, NOT NOW. Taxi and phone get their own buttons. Top centre MAP, pause. Hold ACTION to pick a lock. In the air: stick spins, TRICK + GAS or BRAKE flips.
- **Settings (CONTROLS on title and pause, `blackoutcity.controls.v1`):** steering stick + pedals / wheel + pedals / tilt + pedals / stick only, button size, sides, look speed, quality, fullscreen. iOS tilt asks permission when chosen.
- **Text:** `touchText()` rewrites key names in toasts, hints, prompts and intro cards. Write new text with the same phrases, or extend it.
- **Layout:** `#ui.touch` moves the minimap to the top left, objective beside it, MAP and pause top centre; `@media (max-height: 520px)` shrinks everything for phones. Portrait shows `.rotate-screen` and pauses. Safe-area insets on HUD, screens, map panel, buttons. Page zoom, scroll and text selection are blocked in `touch.ts`, the viewport meta and `html, body` CSS; only `.ms-list`, `.hu-list`, `.tc-panel` and `.screen` may scroll.
- **Full map on touch:** one finger pans, pinch zooms, tap selects; KEY button shows the legend on phones. Mouse events are ignored on touch so a menu tap isn't a hack click, and pointer lock is skipped.
- **First tap:** starts audio, requests fullscreen + landscape lock. On iPhone Safari (no fullscreen API on phones) a one-time hint says Add to Home Screen. `public/manifest.webmanifest` + `public/icon.svg` (vector, generated by hand, the one image file that ships).
- **Quality:** `MOBILE_PRESETS` MINIMAL (no shadows), LOW (default), MEDIUM, HIGH; pixel ratio 1 to 2; no MSAA below HIGH; view 110–190 m. Low-end devices start MINIMAL and can only reach LOW; others reach MEDIUM. Auto targets 30 fps: steps down after 1 s over budget, up after 30 s of headroom. Saved under a separate key. Pools: crowd 90 agents (230), particles 180 at 40 % counts (700), parked cars 10 (26).

## Vehicle damage (`vehicles/damage.ts`)
- **Two tables: `playerVehicleDurability` and `aiVehicleDurability`.** `v.durability` picks by `v.driver` at the moment of each hit, so a parked car uses the AI table until the player gets in and goes back when they leave. Health is a share (`v.health`), so damage carries across the switch. The AI table is the original pre-durability numbers: 100 health, linear damage, no cooldown or limp. Mission vehicles can set their own `v.maxHp` (truck 9000, fixer job truck 160).
- **Hits to wreck, head-on into a building:** player sedan 80+ at 36 km/h, 19 at 72, 7 at 108. AI sedan 53, 5, 3. Player bus 80+, 45, 18. AI bus 21, 4, 3. Player motorbike 80+, 14, 5. Ramming: a cruiser wrecks a player sedan in 8 at 90 km/h; a player sedan wrecks a cruiser in 5 at 90; a player box truck wrecks one in 3 at 72.
- `v.hp` is in points and `v.maxHp` differs by kind, so read `v.health` (0..1). `v.repair()` restores it. The speed panel shows a bar and a percentage; smoke starts below 40 %, fire below 15 %, engine output fades below 30 % to 72 % at zero.
- **Wreck fails:** races and the bank heist fail on a wreck. Getaway and truck jobs don't: you swap cars, by the "missions don't track a vehicle" rule. Getaway's clean score now counts share of health lost (35 % = no points).
- **Repair:** parking at home is free. Four pads (`activities/repair.ts`) cost $25 to $200 by damage and refuse while police can see you.

## Pedestrians and traffic (`ai/pedestrians.ts`)
- **Crossing:** a crossing is 17.6 m and a signal gives 13 s of red, so `mayCross` starts only if `signals.redLeft()` covers the walk at `CROSS_SPEED`. 48 crossings have no light: gap only. Every vehicle on that road is judged in seconds; the player counts for the whole crossing time even on a red. Mid-crossing: the light changes = `hurry`; a car past stopping distance = run for the nearer kerb (swap `a`/`b`) or `dodge`.
- **No straight lines over roads:** `fleeGoal` runs along the pavement, or to the nearest kerb if already on the road. `return` goes to a corner of the same block (`nearestCorner`), `toDoor` and `lure` stay on the block, spots on the road are dropped, nobody stands in the road for a witness call or a look. No jaywalking at all.
- **Spawning:** `relocate` uses side edges only and refuses `aheadOfCar` (30 m + speed).
- **Reactions:** `binCars` bins moving vehicles every frame in 24 m cells; pavement peds read 3×3 cells, the few on a road read the list. Reaction delay 0.12 to 0.35 s, faster for faster cars. A car on the road passing a pavement ped is no threat; one coming up the kerb is. `stats.playerHitsRoad` and `playerHitsSidewalk` count hits for tests.
- **Test driver:** a console script using `followRoute`, in 100 s stretches. Hits: 0 at 36 km/h, 0 at 58, 1 at 86 target (car clipped a kerb on a corner), 1 running every light at avg 64 km/h (ped on a walk signal). Old code: 4 in 71 s running lights. On the pavement on purpose at 65 km/h: 47 of 112 placed in the way. `peds.update` 0.37 ms against 0.28 ms before.

## Mobile text sizes
- Every touch size is in the block at the end of `style.css`, using `--t-body`, `--t-small`, `--t-head`, `--t-title` on `#ui.touch`: clamps on `vh`, so they follow screen height. Use those for anything new, not fixed px.
- **Prompts** sit low (left 46 %, clear of the buttons), max 38vw, two lines, no touch capture. `touchText` shortens long labels.
- **First-visit cards** have their own element (`hud.infoCard`, `.info-card`): small, low, tap or 5 s to dismiss. Give a spot a `short` line for phones. Seen ids go to `blackoutcity.seen.v1` at once (`save.markSeen`), so they don't come back even without sleeping. New Game clears them.
- **Mission card** fits the safe area, scrolls, and has a ✕ (`hud.cardClose`). START is in the button cluster.
- **Test tip:** the screenshot tool's `scale` crops instead of scaling. Leave it out.

## Expansion pass 4 ("water, boats, metro, properties, clothing")
Tag `stable-before-pass4` is the rollback point. Phases: 1 clothing, 2 properties, 3 waterfront, 4 visible metro, all done. Each stopped for testing. Deploy only when told.
- **Clothes (`player/clothes.ts`):** an item is a `Partial<Skin>`, in one of 7 slots. A `Look` is one item per slot; `buildSkin(look, hair)` draws it, and the rig caches by the key it builds. Add an item to `ITEMS` and it's on sale. Old saves' whole outfits (`LEGACY`) become items on load.
- **Where:** THREADS + OLD CUTS block (1,6), MERIDIAN + QUICKSTOP block (7,4), VELVET + CORNER SHOP block (5,8), second-hand at Pawn & Loan. Each block: a two-unit row on the north side, a plain building behind (`world/stores.ts`). Check a new shop door isn't on a mission marker: Hot Parcel's at (-190, 9) drove the Old Town row one block west.
- **Screen (`ui/shopui.ts`):** the camera moves to whichever direction has the most room and the player turns on the spot, so the preview is the real model. `Section`s of `Row`s, each with a look or hair to preview and a primary and alt action. Toasts don't show in `menu`; messages go in `.shop-msg`. Store walls are drawn unlit (`k.glow`) so shops stay bright at night.
- **Disguise:** `known` is the outfit last seen, `save.described` everything ever described. Range: same outfit normal, described before 14 m, never described 8 m. Only top, jacket and hat count (`lookSig`). News says "suspect last seen in X". The records hack clears it all (`forget()`).
- **Wardrobe:** 6 slots (`save.outfitSlots`), each marked CLEAN or ON THE NEWS; "Wear a clean disguise" picks a clean one. In the bedroom and the desk's WARDROBE tab.
- **Food:** no inventory, you consume it on the spot. Hack energy, or `player.sprintT` (run +15 %). Every street cart sells; one per district is on the map (`minor`).
- **Saving:** purchases follow the bed rule: in memory until you sleep. Intro cards are the exception.
- **Properties (`world/properties.ts`):** six rows in `PROPERTIES`: Elm Court, block (3,8), $8k; Harcourt Row (5,1), $22k; Foundry Loft (8,3), $45k; The Glasshouse (7,9), $80k; Villa Marina (8,11), $140k; Skyline Penthouse (5,3), $250k. A row has the plan (`rooms`, `walls`, `doors`, `windows`), the benefits, and `fit`, which places furniture from `Furnish`. A piece of furniture stands with its back to a point and faces n/s/e/w; the bed, wardrobe, desk, safe, kitchen and trophies add their own interactions, which only work if you own the place. Home's painting and baking are shared: `paintRoom`, `partitionWall`, `makeBake`.
- **Doors:** E + fade, front door on the north side. Unowned = buy card (`HomeUi.openProperty`) with a confirm step and a free tour. `Site.minY` keeps a raised home apart from the garage under it, `Site.unload` runs on stream-out, and `Buildings.load(id)` forces a site in. Raised homes (loft 14 m, penthouse 38 m) have a real surface and real views; at 60 m the penthouse only saw fog. Tier 3 and up get tall windows (`Opening.sill`, `head`).
- **`g.home.inside` and `inHouse` now mean any property.** `g.home.doorOut` is the door of wherever you're hiding, so police stake that out. `g.properties.heatDiv` is how fast heat fades there.
- **Active home** (`save.activeHome`, set on the desk's PROPERTIES tab): where you wake, the pinned map icon, and whose `regen` and `hackOff` count. `stashCap` is the largest safe you own: one stash, reachable from any home. Over the cap nothing is lost, you just can't add.
- **Garages:** `save.propCars[id]` is indexed by bay. Stored vehicles are real only while the garage kit is loaded; one you've driven off stays out there. Bikes use bike bays first, then car bays. The first flat keeps its one bay and `save.garage`. Purchases follow the bed rule.
- **Taxis:** each property has a stand that works once you own it (`Stand.prop`). **Map:** `property` icon, gold $ for sale, green O owned, HOMES tab in LOCATIONS.
- **Water (`layout.ts`):** `isWater(x, z)` is the sea past `SHORE`, `LAGOON` (dug out of park block (5,11), its pavement is the quay) and `CHANNEL` under the ring. `groundHeight` returns `WATER_Y` there, so anything without a deck falls in. Piers and the bridge are `surfaces` above it. Colliders below y = 0 stop boats; above it they stop people and cars, with gaps where a pier starts.
- **Boats (`Vehicle.boat`, kinds jetski, speedboat, policeboat):** `updateBoat` has no wheels: slides, leans, lifts its nose, bobs. They have no wheel objects. Jet ski counts as `two` for the rider, but can't throw you and has no tricks. `SEA_LIMIT` pushes you back. Step off only near a landing (`landingNear`); forced off, you go to the nearest. Boats stream at 170 m, like parked cars. No mission cards from a boat.
- **Falling in:** a non-boat below -0.7 over water, or a wrecked boat, sets `v.sunk`: it sinks, you're fished out to the nearest landing 1.3 s later (so a mission's wreck check still sees it), and your vehicle is gone. On foot: fade to the nearest landing.
- **Drawbridge (`Drawbridge`, `g.water.bridge`):** on the ring between nodes (5,12) and (6,12). Hack toggles it (kind `bridge`, range 110); auto-lowers after 32 s. Up = `edge.closed`, stops across the road, deck surface removed, `gate` collider off. `gate` sits at y -0.5 to 1: a speedboat's top reaches it, a jet ski's doesn't, so only jet skis pass under it down. `holdDist(v)` makes traffic, police and rivals queue; police also repath at once; roadblocks and spawns skip closed edges. It waits up to 5 s for the deck to clear, then anyone still on it falls in.
- **Police boats:** heat 3+ while you're on a boat: launches spawn out of sight in open water (2, 3 at heat 5), `driveBoat`. Road units keep trying the shore. They leave once you're ashore and they're out of sight.
- **Map:** `mapExtent` is now `HALF + 130` and the full map opens centred on (45, 45) to fit the bay. New icons `boat`, `bridge`. New mission type `water`. Places: Harbour Marina on the lagoon's north quay, Docks Marina on the pier at z 52 to 60, cargo pier z 160 to 176, boardwalk x -140 to -50, Villa Marina's jetty x 143 to 151.
- **Metro (`world/metro.ts`):** one elevated loop, `METRO_LINE` in `layout.ts`, rail at y 10, over the middle of the roads. Portal frames stand on the kerbs at 6.95 m from the centre, clear of every lane and of junctions. `buildSpline` rounds the corners and resamples to one point per metre, with a speed limit per point. 6 stations, 3 trains of 4 cars: three `InstancedMesh`es (bodies, lit windows, door leaves), updated each frame, 0.04 ms. A train waits for 9 s at each stop; a platform sees one about every 60 to 85 s.
- **Boarding:** kiosk on the pavement, $5 or hack its gate (20 s), fade up to the platform. E on the platform while doors are open. Riding: `player.aboard` + `hidden`, so nothing sees you; the car you're in scales to zero and a real interior takes its place (`inside`), with window gaps, two or three seated people, and `Metro.camera()` running after the rig. E at the next open doors gets off. `player.spawn` clears `aboard`, so any bust or restart tidies itself.
- **Police:** on boarding, heat goes search mode at the station you left. If they saw you get on (seen in the last 2 s, an officer within 45 m, heat 2+), there's a 55 % chance a cop boards and walks down the carriage: within 1.5 m, `copClose` counts toward a bust. Get off first. Officers posted by `adapt()` wait at the kiosks.
- **Hacks:** kind `train` (range 110, follows the lead car): stops it for 12 s, or holds the doors at a station. A train behind keeps its distance. Kind `subway` is the gate.
- **Default:** elevated, so trains are a shortcut, not a street-level obstacle: no level crossings, nothing to hit. No cop follows you up to the platform on foot.
- **Default:** the road grid stays whole, so the "harbour" is one dug-out park block, decks over open water, and the sea out to `SEA_LIMIT`. No warehouses were added on land; the docks already have them.
- **Activities:** `ActivitySpot` gained `icon`, `color`, `category`, `minor`, so a new shop needs no map code. New icons: hanger, scissors, cup, stand.

## Testing notes
- Plain screenshots of the preview pane can return a stale image; `zoom` over the full region captures a fresh frame.
- The in-app preview pane pauses `requestAnimationFrame` when hidden; loading falls back to timeouts. For scripted tests, call `game.frame()` in a loop from the console (`window.game` is exposed) and dispatch `KeyboardEvent`s on `window`.
- Perf baseline (mid-chase, heat 3): ~330 draw calls incl. shadows, ~4.7 ms render, ~1.6 ms update.
- Build: see `npm run build` output; no asset files.
- `window.game` is the canvas (named element access) until `main.ts` runs: wait for `game.state` before scripting. Editing a source reloads the page mid-script.
