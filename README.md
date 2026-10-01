# SteamCanvas

Author: [dumbapplee](https://github.com/dumbapplee)

Steam profile preview from public profile HTML. Enter a SteamID64, a custom profile name, or a full Steam Community profile URL. SteamCanvas only previews public profile pages; it does not modify Steam accounts.

## Development

```sh
npm install
npm run dev
```

The Vite app runs at `http://localhost:5173`; its `/api` requests are proxied to the local Node service.

See [Steam profile assets](docs/STEAM_PROFILE_ASSETS.md) for how profile HTML, backgrounds, avatars, avatar frames, and artwork are currently handled and how they should be exposed for future editing.

## Build

```sh
npm run build
```