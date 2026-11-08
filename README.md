# Mini-Fortnite V4

A low-poly, 3D, PC-first battle royale that runs in the browser (Three.js, no build step).

**Play:** https://torgtim.github.io/MiniFortnite-V4/

## Features
- **4 seasons** (toggle bar in the lobby) - each swaps the *entire* map and loot pool:
  Greenfield (hills + lake), Frostbite (snow, icy water), Dustbowl (mesas, quicksand), Neon Meltdown (volcano, lava, plasma weapons only)
- **Fortnite-lite loop:** drop from the sky, glide, loot ground items and chests, fight 15 bots, survive the shrinking storm
- **Building:** walls, floors and ramps on a grid, wood/brick/metal
- **Settings:** sensitivity, ADS sensitivity, invert Y, FOV, render scale, shadows, draw distance, FPS counter, crosshair, volume, fully rebindable keys (saved in localStorage)

## Controls (defaults)
WASD move - Shift sprint - Space jump / glider - Mouse aim & fire - RMB aim down sights - 1-6 / wheel hotbar - E pick up / open chest - R reload - Q build mode - Z/X/C wall/floor/ramp - T material - Esc pause

## Layout
- `js/seasons.js` - season definitions (terrain, colours, props, loot tables)
- `js/world.js` - terrain, buildings, props, colliders, raycasts
- `js/physics.js` - character collision and movement
- `js/combat.js`, `js/weapons.js`, `js/loot.js`, `js/build.js`, `js/storm.js` - gameplay systems
- `js/bots.js`, `js/player.js`, `js/entity.js` - actors
- `js/hud.js`, `js/ui.js`, `js/settings.js`, `js/audio.js`, `js/viewmodel.js`, `js/main.js` - presentation and glue
- `lib/` - vendored, minified Three.js

Run locally: `python3 -m http.server` and open `http://localhost:8000`.

## Not yet
Edit mode, bots that build, multiplayer.
