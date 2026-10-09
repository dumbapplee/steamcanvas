<div align="center">

# SteamCanvas

### Your Steam profile. Your style. Your call.

Preview profile ideas, tune the details, and shape your showcases — all before changing anything on Steam.

<p>
  <a href="https://github.com/dumbapplee/steamcanvas"><img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white"></a>
  <a href="https://github.com/dumbapplee/steamcanvas"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white"></a>
  <a href="https://github.com/dumbapplee/steamcanvas"><img alt="Vite" src="https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white"></a>
  <a href="https://github.com/dumbapplee/steamcanvas"><img alt="Express" src="https://img.shields.io/badge/Express-5-111111?logo=express&logoColor=white"></a>
</p>

[Explore the features](#-the-workshop) · [Run locally](#-run-it-locally) · [Read the asset notes](docs/STEAM_PROFILE_ASSETS.md)

</div>

---

SteamCanvas is a local-first editor for experimenting with **public Steam profiles**. Load a profile, try a new look, arrange its showcases, and export the artwork or a portable HTML preview when you are happy with it.

> **A safe space to experiment:** SteamCanvas previews changes in your browser. It does not sign in to Steam or edit your Steam account.

## ✨ The workshop

### Make the profile yours

- Load a public profile using its custom URL, SteamID64, or full profile link.
- Crop, zoom, and rotate an avatar image before previewing it.
- Browse and preview Steam avatar frames, profile themes, and animated or static backgrounds.
- Search backgrounds in both the Community Market and Steam Points Shop.
- Adjust the preview level without changing the level on Steam.

### Make every showcase feel intentional

- Add, reorder, remove, and restore Artwork, Featured Artwork, Screenshot, and Workshop showcases.
- Split one image into showcase-sized artwork panels, or use separate, ready-made panels.
- Browse public profile screenshots and place selected images into Screenshot Showcase slots.
- Preview GIF artwork and export showcase assets together in a ZIP.
- Use an upgraded Workshop Showcase as **1 × 5** or **2 × 5**. For 2 × 5, use one source image per row or provide ten prepared panels.
- Export a complete profile-preview ZIP with an `index.html` wired to local copies of uploaded assets.

### Pick up where you left off

SteamCanvas autosaves the current preview as a draft in your browser. Return to the app in the same browser to resume it, or reset the preview to the profile as it was loaded.

## 🚀 Run it locally

### Requirements

- Node.js and npm
- An internet connection to load Steam profiles and browse Steam items

### Start the development app

```sh
git clone https://github.com/dumbapplee/steamcanvas.git
cd steamcanvas
npm install
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)**. The development command starts both the Vite frontend and the local API server; Vite forwards `/api` requests to the server on port `8787`.

### Build and run the production app

```sh
npm run build
npm run start
```

The build checks both TypeScript projects and creates the frontend in `dist/`. The server then serves the built app and its API at **[http://localhost:8787](http://localhost:8787)** by default.

### Optional catalog database

SteamCanvas works without a database. Set `DATABASE_URL` for the server to enable its PostgreSQL-backed catalog indexing; without it, Points Shop catalog searches use Steam's fallback. The local development setup does not require PostgreSQL.

## 🧭 A quick tour

1. Enter a public profile URL, custom profile name, or 17-digit SteamID64.
2. Explore appearance options and edit the showcases in the preview.
3. Use **Export** for a ZIP with the profile HTML and its local assets, or download an individual showcase's artwork.
4. Open the exported `index.html` from the extracted ZIP to revisit the preview.
5. Upload exported artwork to Steam yourself when you are ready.

## 📦 Workshop exports

Workshop image exports apply the community-documented `0x21` final-byte workaround to each image **in the Workshop ZIP only**. It is not applied to other showcase exports or the profile preview assets. This is an unofficial Steam upload technique, not a guarantee from Valve.

The full-export ZIP keeps unmodified Workshop image copies for local HTML preview, separate from the upload-ready files. The HTML references these assets with relative paths. Steam-hosted styles and profile assets that were not uploaded into the editor still require an internet connection.

For details on image handling, Workshop layouts, and export behavior, see [Steam profile assets](docs/STEAM_PROFILE_ASSETS.md).

## ℹ️ What to know

- Only **public** Steam profiles can be loaded.
- SteamCanvas is a preview and export tool; it does not apply changes to your Steam account. Upload artwork and make profile changes on Steam yourself.
- Some showcase types are preserved as Steam provided them. Artwork editing is supported for the showcase types listed above; other showcase blocks can remain unchanged while you reorder or remove them.
- The **2 × 5** Workshop option is available when the loaded showcase has ten slots. A profile with the Steam upgrade can show either one or two rows in the preview.
- Steam can rate-limit or temporarily fail to serve profiles and catalog results. Try again later if a request cannot be completed.
- Exported HTML may need an internet connection for Steam-hosted content that is not included in the ZIP.

## 🛠️ Built with

| Part | Technology |
| --- | --- |
| User interface | React 19, TypeScript, Vite |
| Local API | Node.js, Express 5 |
| Asset processing | Canvas, `gifuct-js`, `gifenc`, JSZip |
| Optional catalog index | PostgreSQL |

## 📁 Project map

```text
src/
  components/   Profile, avatar, background, theme, and showcase editors
  utils/        Shared profile and network helpers
  App.tsx       App shell, profile loading, drafts, and full export
server/
  index.ts      Steam-facing API and optional catalog index
docs/
  STEAM_PROFILE_ASSETS.md
```

## 📜 Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite frontend and API server for local development |
| `npm run build` | Type-check the client and server, then build the frontend |
| `npm run start` | Serve the production build and API |

---

<div align="center">

Made for people who like their Steam profile to feel like **theirs**.

[Back to top](#steamcanvas)

</div>
