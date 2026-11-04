# BLACKOUT CITY

**Cut the power. Rob the city.**

A low-poly open-city heist game that runs in the browser. You play a tired office clerk with a hacking rig: kill the lights on a block, turn the traffic signals against the police, crack the vault, and get away with the money. The city remembers how you did it.

**Play it:** LIVE_LINK

**Source:** REPO_LINK

## Features

- **The heist:** case the bank, hack the doors and cameras, crack the vault, then reach the drop with nobody watching.
- **Hacker mode:** time slows while you take over traffic lights, street lamps, power boxes, cameras, billboards and parked cars. Black out a whole block and disappear.
- **Adaptive police:** five heat levels, roadblocks, a helicopter and SWAT. They learn your favourite escape routes between runs and stake them out.
- **Missions:** a data-driven mission system with markers, intro cards, checkpoints, a GPS line and retries. Includes an armored truck intercept, getaway driver jobs, tailing targets through crowds, and scored prank hacks.
- **Bikes and tricks:** rideable bicycles, scooters and motorbikes, bike racks and rentals, wheelies, stoppies, spins, flips and stunt ramps with a local best-score list.
- **Street races:** checkpoint races against rival drivers in four vehicle classes.
- **A home of your own:** a furnished flat with a hacker desk, wardrobe and trophy shelf. Sleep in the bed to save, and park stolen cars in the garage to build a collection.
- **Reputation:** tracked per district. Shopkeepers, pedestrians, billboards and the police radio all react to what you've done.
- **An open city:** 12×12 blocks, six districts, a highway ring, living crowds and traffic, time of day and rain.
- **Mobile landscape support:** touch controls, phone-sized screens and lower quality settings for phones.

Every model, texture and sound is generated in code.

## Controls

### Desktop

| Input | Action |
|---|---|
| WASD or arrows | Move, drive |
| Mouse | Look |
| Shift | Run, boost |
| Space | Jump, vault, handbrake |
| E | Interact, enter or exit a vehicle. Hold to pick a lock |
| Hold Q or Tab | Hacker mode. Left click or E hacks, right click for the alternative |
| F | On a bike: wheelie. F + S: stoppie. In the air: A/D spins, F + W/S flips |
| C | Car camera |
| M | Full map and location list |
| J | Fixer jobs on your phone |
| P or Esc | Pause |
| R | Retry mission |
| Z | Mute |
| H | Hide the HUD |

### Mobile (hold your device in landscape)

| Input | Action |
|---|---|
| Left side of the screen | Floating stick: move or steer. Push it all the way to run |
| Right side of the screen | Drag to look |
| ACTION | Interact. Hold to pick a lock |
| HACK | Hold for hacker mode, then RUN IT or ALT |
| GAS, BRAKE, DRIFT, EXIT | Driving |
| TRICK, BOOST | On a bike |
| MAP, II | Top centre: map and pause |

The buttons change with what you're doing. CONTROLS on the title and pause screens switches between stick, wheel and tilt steering, and sets button size and sides.

## Run it locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` type-checks and builds a static site into `dist/`.

## Tech stack

- [Three.js](https://threejs.org/) for rendering
- TypeScript
- [Vite](https://vitejs.dev/) for dev and builds
- Procedural canvas textures and WebAudio synthesis, so no sound or texture files are needed
- The [VT323](https://fonts.google.com/specimen/VT323) pixel font, from Google Fonts
- Hosted on [Vercel](https://vercel.com/)

## About

Built with AI assistance for the Loadout AI Game Competition.
