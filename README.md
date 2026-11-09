# Mini-Fortnite V4

A low-quality-on-purpose Fortnite-style battle royale in 3D. It runs in the browser on Three.js, needs no build step and is made for PC.
The menus *and* the HUD look like Windows 95, and there's an optional 1998 graphics mode.

**Play:** https://torgtim.github.io/MiniFortnite-V4/

## What's in it

### The match
- **The Party Bus 95** flies across the island. Jump out when you want, skydive (hold **W** to dive faster), and the glider opens on its own near the ground.
- 1-39 bots (20 players by default). The storm has 6 circles and starts after the bus has left.
- Supply drops come down on balloons. Chests hum when you're close. There are also ammo boxes.
- Eliminations break the body into glowing pixels, and everything they carried drops: weapons, items, ammo and materials.

### Movement
- Sprint (**Shift**, or turn on "sprint by default"), and crouch with **C**. It's not on Ctrl because Ctrl+W closes the browser tab.
- Sliding: press **C** while sprinting. Slopes speed you up, and you can slide-jump.
- Mantling: jump at a ledge to climb up. Hurdling: jump while sprinting into a low wall to vault over it.
- Fall damage only starts above about 7.5 m, like the real game.

### Building and editing
- Four pieces: **wall (Z), floor (X), ramp (F), cone (V)**. Press **Q** to toggle build mode, and switch material (wood, brick or metal) with **T** or the right mouse button.
- Pieces start weak and build up their health over time: wood is fast, metal is slow but strong.
- Structural support: if you break what holds a structure up, the unsupported pieces collapse.
- Edit mode (**G**): click or drag tiles, then press **G** to confirm. Right-click resets the piece.
  - **Walls** have 3x3 tiles, for doors, windows and half walls.
  - **Floors** have 2x2 tiles, for holes.
  - **Ramps** have 2x2 tiles. Dragging a path rotates the ramp, and a path in one column makes a half ramp.
  - **Cones** have 2x2 tiles, for slopes, corner roofs and flat tops.
- Pickaxe weak points: hit the blue circle for double damage and double materials.

### Combat
- About 24 weapons across the 4 seasons. They're Fortnite-like classes, not exact copies.
- Bloom (spread grows while you spray), first-shot accuracy, and crouching gives better aim.
- Shotgun pellets add up into one damage number. Damage numbers are blue for shield, white for health and yellow for headshots.
- Rockets and grenade launchers fire real projectiles. Sniper bullets travel and drop. Grenades bounce.
- Third person (Fortnite style) aims through the crosshair. First person is optional (**H** toggles). Scoped snipers switch to the scope view.

### Bots
- Bots pick a landing spot and jump from the bus.
- They loot and farm materials, and rotate early when the storm is coming.
- They hear gunfire and come looking.
- They choose weapons by range, and their aim settles over time and leads moving targets.
- They wall up when they get shot, ramp-rush you when you're above them, and box up to heal.
- They shoot through your builds, throw grenades at you when you hide, and mantle over obstacles.
- They go through doors into houses.

### The 4 seasons
The toggle bar in the lobby swaps the **entire map and loot pool**:

| Season | Map | Liquid | Weapons |
|---|---|---|---|
| Greenfield | hills and a lake | water | classic |
| Frostbite | snow and a frozen lake | icy water (hurts) | cold weapons |
| Dustbowl | mesas and cacti | quicksand | wild west |
| Neon Meltdown | volcano with neon crystals | lava (hurts a lot) | plasma weapons only |

### Settings
- Sensitivity, ADS sensitivity, invert Y, FOV.
- Camera mode, sprint by default, toggle crouch, confirm edit on release.
- Bot count and difficulty.
- Quality preset, render scale, draw distance, grass density, shadows, clouds and weather.
- **Graphics style: Modern or 1998** (chunky pixels, 15-bit colour, dithering, scanlines).
- Crosshair, volume, and every key can be rebound. Settings are saved in localStorage.

## Controls (defaults)
| Key | Action |
|---|---|
| WASD | move |
| Shift | sprint |
| C | crouch / slide |
| Space | jump / glider / mantle |
| Mouse | aim & fire |
| Right mouse | aim down sights (in build mode: material; in edit mode: reset) |
| 1-6 / wheel | hotbar |
| E | pick up / open |
| R | reload |
| Q | build mode |
| Z X F V | wall, floor, ramp, cone |
| G | edit |
| T | material |
| M | big map |
| H | 1st / 3rd person |
| Esc / P | pause |

## Code layout
- `js/main.js` sets up the game, the match flow (bus, drop, storm), input and cameras.
- `js/seasons.js` holds the season definitions: terrain, colours, props, decoration and loot tables.
- `js/world.js` builds the terrain, houses, props and decoration, plus colliders and the grid raycast. `js/liquid.js` is the animated water and lava, and `js/sky.js` is the sky, clouds and weather.
- `js/physics.js` and `js/geom.js` handle character physics, mantling, ramps, roofs and ray tests.
- `js/build.js`, `js/pieces.js` and `js/edit.js` are the building system, piece shapes and edit mode.
- `js/combat.js` and `js/weapons.js` cover shooting, projectiles, the pickaxe, weak points and the weapon data.
- `js/bots.js` is the bot AI. `js/player.js` and `js/entity.js` are the player controller and the shared entity logic.
- `js/characters.js` has the character models, faces, gliders and animation.
- `js/loot.js` covers pickups, chests, ammo boxes and supply drops.
- `js/storm.js` is the storm and `js/bus.js` is the Party Bus.
- `js/hud.js`, `js/ui.js` and `js/settings.js` are the Windows 95 HUD, the menus and the settings.
- `js/fx.js` is particles, `js/retro.js` is the 1998 render pass, `js/textures.js` makes the procedural pixel textures, `js/audio.js` is the synthesised sound and `js/viewmodel.js` is the first-person gun.
- `lib/` holds vendored, minified Three.js.

To run it locally, start `python3 -m http.server` and open `http://localhost:8000`.

## Not yet
Multiplayer, vehicles, bots editing their builds, and traps.
