# Phaser React TypeScript Template

This is a Phaser project template that uses the React framework and Vite for bundling. It includes a bridge for React to Phaser game communication, hot-reloading for quick development workflow and scripts to generate production-ready builds.

**[This Template is also available as a JavaScript version.](https://github.com/phaserjs/template-react)**

### Versions

This template has been updated for:

- [Phaser 4.2.1](https://github.com/phaserjs/phaser)
- [React 19.0.0](https://github.com/facebook/react)
- [Vite 6.3.1](https://github.com/vitejs/vite)
- [TypeScript 5.7.2](https://github.com/microsoft/TypeScript)

## Requirements

[Bun](https://bun.sh) is the package manager used by this template (a `bun.lock` is committed — do not generate a `package-lock.json`). [Node.js](https://nodejs.org) 18+ is required to run the dev server.

## Available Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install project dependencies |
| `bun run dev` | Launch a development web server |
| `bun run build` | Create a production build in the `dist` folder |

## Writing Code

After cloning the repo, run `bun install` from your project directory. Then, you can start the local development server by running `bun run dev`.

The local development server runs on `http://localhost:8080` by default. Please see the Vite documentation if you wish to change this, or add SSL support.

Once the server is running you can edit any of the files in the `src` folder. Vite will automatically recompile your code and then reload the browser.

## Template Project Structure

We have provided a default project structure to get you started. This is as follows:

| Path                          | Description                                                                 |
|-------------------------------|-----------------------------------------------------------------------------|
| `index.html`                  | A basic HTML page to contain the game.                                     |
| `src`                         | Contains the React client source code.                                     |
| `src/main.tsx`                | The main **React** entry point. This bootstraps the React application.      |
| `src/App.tsx`                 | The React shell: mounts the game into `#game-container` (`useLayoutEffect` → `StartGame("game-container")`, destroy on unmount), subscribes to `EventBus` (`current-scene-ready` → `phaserRef`), and hosts ALL UI overlays in the `#hud` div. |
| `src/vite-env.d.ts`           | Global TypeScript declarations, providing type information.                |
| `src/game/main.ts`            | Game engine bootstrap & scene lifecycle: `StartGame(parent)` factory, `EventBus` export, and the `Game` scene class (`preload()`/`create()`/`update()` lifecycle). |
| `src/game/config.ts`          | Shared game tuning constants: speeds, gravity, health, dimensions, and color palette. |
| `src/game/levels.ts`          | ASCII layout matrices, grid tile size, and level progression maps.         |
| `src/game/controls.ts`        | Universal dual-input controls: merges keyboard and Rex Virtual Joystick for mobile. |
| `src/game/audio.ts`           | Procedural retro SFX presets powered by ZzFX (zero external audio dependencies). |
| `public/style.css`            | Some simple CSS rules to help with page layout.                            |
| `public/assets`               | Contains the static assets used by the game.                               |

## React Bridge

The `App.tsx` component is the bridge between React and Phaser. It initializes the Phaser game into `#game-container` and destroys it on unmount.

To communicate between React and Phaser, you can use the **`EventBus`** exported from `src/game/main.ts`. This is a simple event bus that allows you to emit and listen for events from both React and Phaser.

```ts
// In React
import { EventBus } from './game/main';

// Emit an event
EventBus.emit('event-name', data);

// In Phaser
// Listen for an event
EventBus.on('event-name', (data) => {
    // Do something with the data
});
```

In addition to this, `App.tsx` exposes the Phaser game instance along with the most recently active Phaser Scene through the `phaserRef` (`IRefPhaserGame`).

Once exposed, you can access them like any regular react reference.

## Phaser Scene & Entity Handling

In Phaser, the Scene is where your sprites, game logic and all of the Phaser systems live. This template ships ONE scene class (`Game`) inside `src/game/main.ts`, registered in the config's `scene: [Game]` list.

For clean, modular game development:
- **Tuning numbers**: place player speeds, jump velocity, spawn intervals, and health in `src/game/config.ts`.
- **Level design**: place ASCII terrain matrices and level maps in `src/game/levels.ts`.
- **Entities**: place standalone entity classes in `src/game/entities/` (e.g. `Player.ts`, `Enemy.ts`), each with its own `update(time, delta)` method.
- **Scenes**: modular scene files live under `src/game/scenes/` (e.g. `BootScene.ts`, `GameScene.ts`).

The scene hands itself to React by emitting the `"current-scene-ready"` event via the `EventBus` at the end of `create()`, like this:

```ts
class MyScene extends Phaser.Scene
{
    constructor ()
    {
        super('MyScene');
    }

    create ()
    {
        // Your Game Objects and logic here

        // At the end of create method:
        EventBus.emit('current-scene-ready', this);
    }
}
```

You don't have to emit this event if you don't need to access the specific scene from React. Also, you don't have to emit it at the end of `create`, you can emit it at any point. For example, should your Scene be waiting for a network request or API call to complete, it could emit the event once that data is ready.

### React Component Example

`App.tsx` already subscribes to `current-scene-ready` and stores the scene on `phaserRef.current.scene`. From that reference, the game instance is available via `phaserRef.current.game` and the most recently active Scene via `phaserRef.current.scene`.

## Handling Assets

Vite supports loading assets via JavaScript module `import` statements.

To load static files such as audio files, videos, etc place them into the `public/assets` folder. Then you can use this path in the Loader calls within Phaser:

```js
preload ()
{
    //  This is an example of loading a static image
    //  from the public/assets folder:
    this.load.image('background', 'assets/bg.png');
}
```

The template ships pre-packaged assets under `public/assets/` (letters `a`–`z`, fx particle textures, audio SFX/BGM loops, a vehicles sheet) — see the AVAILABLE ASSET MANIFEST comment at the top of `src/game/main.ts`. The template loads NO assets by default; add a `preload()` to the `Game` scene and load only what your game uses.

When you issue the `bun run build` command, all static assets are automatically copied to the `dist/assets` folder.

## Deploying to Production

After you run the `bun run build` command, your code will be built into a single bundle and saved to the `dist` folder, along with any other assets your project imported, or stored in the public assets folder.

In order to deploy your game, you will need to upload *all* of the contents of the `dist` folder to a public facing web server.

## Customizing the Template

### Vite

If you want to customize your build, such as adding plugin (i.e. for loading CSS or fonts), you can modify the `vite/config.*.mjs` file for cross-project changes, or you can modify and/or create new configuration files and target them in specific npm tasks inside of `package.json`. Please see the [Vite documentation](https://vitejs.dev/) for more information.

## Join the Phaser Community!

We love to see what developers like you create with Phaser! It really motivates us to keep improving. So please join our community and show-off your work 😄

**Visit:** The [Phaser website](https://phaser.io) and follow on [Phaser Twitter](https://twitter.com/phaser_)<br />
**Play:** Some of the amazing games [#madewithphaser](https://twitter.com/search?q=%23madewithphaser&src=typed_query&f=live)<br />
**Learn:** [API Docs](https://newdocs.phaser.io), [Support Forum](https://phaser.discourse.group/) and [StackOverflow](https://stackoverflow.com/questions/tagged/phaser-framework)<br />
**Discord:** Join us on [Discord](https://discord.gg/phaser)<br />
**Code:** 2000+ [Examples](https://labs.phaser.io)<br />
**Read:** The [Phaser World](https://phaser.io/community/newsletter) Newsletter<br />

Created by [Phaser Studio](mailto:support@phaser.io). Powered by coffee, anime, pixels and love.

The Phaser logo and characters are &copy; 2011 - 2025 Phaser Studio Inc.

All rights reserved.
