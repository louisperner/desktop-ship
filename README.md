# Desktop Ship

A transparent "cockpit" overlay for your desktop, built with Electron. It draws a sci-fi ship cockpit on top of everything (or behind everything), filled with draggable holographic widgets: clock, system stats, map, todo list, terminal, camera, Spotify, images, video and more.

It is also fully controllable by AI agents via [MCP](https://modelcontextprotocol.io): any MCP client (Claude Code, Claude Desktop, etc.) can spawn, move, configure and close widgets on your screen.

![Desktop Ship](src/renderer/assets/cockpit.png)

## Features

- Transparent, click-through overlay that lives on any display
- Draggable, resizable holographic widgets (`clock, sys, map, ship, log, todo, image, video, folder, gmap, spotify, camera`)
- Always-on-top or behind-everything modes
- Built-in MCP server: control the whole cockpit from an AI agent (see [MCP.md](MCP.md))
- Local-only control channel (WebSocket on `127.0.0.1` with a per-session token)

## Getting started

```bash
git clone https://github.com/louisperner/desktop-ship.git
cd desktop-ship
npm install
npm start
```

Requires Node.js 18+. Currently developed and tested on macOS; other platforms may work but are untested.

## MCP control

Register the bundled MCP server in your MCP client and an agent can drive the cockpit (spawn widgets, move them, switch displays, toggle click-through). See [MCP.md](MCP.md) for the tool list and setup for both dev and the packaged app.

## Building a DMG

```bash
npm run dist    # bundles the MCP server and builds the .dmg (arm64 + x64) into dist/
npm run pack    # packages the .app only, for quick testing
```

Note: to distribute outside your own machine without Gatekeeper warnings, the app must be signed and notarized with an Apple Developer ID.

## License

[MIT](LICENSE)
