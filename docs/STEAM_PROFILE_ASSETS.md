# Steam Profile Assets

This document describes how SteamCanvas currently loads a public Steam profile and how its visual assets should be identified for future editing. SteamCanvas is a preview and asset-preparation tool: it does not write changes to a Steam account.

## Current flow

1. The client sends a SteamID64, custom profile name, or profile URL to `POST /api/profile`.
2. The Node service resolves the input to `https://steamcommunity.com/id/{name}` or `https://steamcommunity.com/profiles/{steamid64}` and requests the public page with Axios.
3. Cheerio parses the response. The service removes `#global_header`, scripts, embedded frames/objects, and inline event-handler attributes. Profile HTML and linked stylesheets are retained for the preview.
4. The service adds a base URL so relative resources resolve against Steam Community, then returns the sanitized HTML and a small amount of profile metadata.
5. React displays the HTML in a sandboxed iframe and uses the extracted avatar in the **Current Source** panel.

The current implementation is in `server/index.ts`; the iframe and Current Source display are in `src/App.tsx`.

## Asset inventory

| Asset | How to find it in public profile HTML | Current status | Future editor use |
| --- | --- | --- | --- |
| Profile background | Usually an inline `background-image` on `.profile_page` (often a `div.profile_page` with classes such as `has_profile_background` or `full_width_background`). | Preserved as part of the HTML, not returned as a separate field. | Extract the URL and retain the original element/position so the editor can replace the image or adjust fit, crop, overlay, and alignment. |
| Avatar image | Prefer `<meta property="og:image" content="…">`, then `twitter:image`; fallback to avatar `<img>` URLs under `.playerAvatarAutoSizeInner` / `.playerAvatar` whose host is `avatars.fastly.steamstatic.com`. | Extracted and returned as `avatar`; shown in Current Source. | Keep the portrait square; allow replacement, crop, and zoom without confusing it with the separate frame layer. |
| Avatar frame / border | `.playerAvatarAutoSizeInner .profile_avatar_frame` is the frame/overlay container. Steam can put `<picture>`, `<source srcset>` and `<img>` elements here. Frame artwork may be hosted under `shared.fastly.steamstatic.com/community_assets/images/items/…`. | Preserved in the preview HTML but not parsed as a separate asset. | Extract the frame image(s) separately from the avatar. Support static and responsive variants; preserve stacking order and clipping. |
| Profile name and status | Current name lookup: `#personaName`, then `.actual_persona_name`, then `<title>`. Other profile labels and status are present in profile-specific markup. | Name is returned; the rest remains in the HTML preview. | Extract only fields needed for controls or accessible labels. Keep the Steam HTML as a visual reference, not as the editor's data model. |
| Steam level | `.profile_header_badgeinfo .friendPlayerLevelNum` contains the numeric level inside the profile badge area. | Returned as optional numeric `level` and shown beside the name in Current Source. | Keep it optional; profiles without a visible level should not fail or display a placeholder. |
| Showcases and artwork | Profile-specific showcase blocks and their images appear in the page body. Image sources may be in `src`, `srcset`, or inline CSS, depending on the block. | Preserved in the HTML preview; not separately inventoried. | Identify showcase containers and image slots, then expose each slot with its order, type, source URL, and display geometry. |
| Middle / side artwork | These are layout/asset concepts rather than reliable universal HTML selectors. Their presence and structure depend on the profile content and selected showcases. | No dedicated extraction or editing yet. | Treat as explicit editor slots only after real profile samples confirm their mapping. Do not infer these assets from an unrelated image or avatar-frame item. |

## Background extraction

The first candidate should be the profile root's computed-style source in the HTML, commonly:

```html
<div class="no_header profile_page has_profile_background full_width_background"
     style="background-image: url('https://…');">
```

For the initial parser, inspect `.profile_page` and parse the `background-image` CSS value rather than matching the entire style attribute with a regular expression. Resolve relative URLs against the final redirected profile URL. If Steam moves the background into a stylesheet or changes its markup, the iframe may still show it while the explicit asset extractor needs updating.

Store the source URL separately from presentation settings. Future fit/crop/zoom/overlay controls should modify SteamCanvas state, never mutate a Steam account.

## Steam Market background catalog

The background picker reads the Steam Community Market directly through `GET /api/backgrounds`. The server requests `/market/search/render/` for app `753`, filters item class `tag_item_class_3`, and returns paginated items whose Steam item type identifies them as profile backgrounds. Names, market prices, listing links, and image paths all come from Steam responses or Steam-hosted image URLs; no third-party catalog is used.

The selected market image is applied only to `.profile_page` inside the sandboxed profile preview. Resetting the picker restores the source page's original inline background, or lets its stylesheet background show through. This does not equip or purchase the item on Steam.

## Avatar and frame extraction

Avatar and frame are separate layers:

- The avatar is the portrait itself. The profile's `og:image` currently points to the expected `avatars.fastly.steamstatic.com` image.
- The border/frame is drawn around or over the portrait by `.profile_avatar_frame`. Its image can be an equipped Steam item, including animated artwork. It must not be selected as the portrait just because it is the first image inside `.playerAvatar`.

The current parser prefers `og:image`, then `twitter:image`, then an avatar image under the avatar container whose resolved host is `avatars.fastly.steamstatic.com`. Keep this host check on the fallback: the frame may also contain an `<img>` but use `shared.fastly.steamstatic.com`.

When adding frame controls, record frame sources independently and preserve source order from `<picture>` / `<source srcset>`. For `srcset`, parse candidate URLs and descriptors as a list; do not treat the whole attribute as one URL. Animated frames may have a reduced-motion source and a regular source, so retain both when available.

## Suggested API shape for the editor

Keep the HTML preview payload separate from an explicit, stable asset manifest. For example:

```ts
type ProfileAsset = {
  sourceUrl: string;
  kind: 'background' | 'avatar' | 'avatar-frame' | 'showcase' | 'artwork';
  slot?: string;
  variants?: Array<{ url: string; media?: string; descriptor?: string }>;
};

type ProfileAssets = {
  background?: ProfileAsset;
  avatar?: ProfileAsset;
  avatarFrame?: ProfileAsset;
  showcases: ProfileAsset[];
};
```

This is a design suggestion, not the current API contract. Keep editor settings (crop, zoom, fit, overlay, border visibility, and layout variant) in client-side state and apply them to a SteamCanvas-owned preview layer. Do not rewrite the fetched Steam HTML as the only source of truth.

## Parser and preview constraints

- Steam's public HTML is the source for this preview, but its selectors and markup can change. Prefer metadata plus narrowly scoped selectors, and keep fallbacks explicit.
- Missing selectors are normal: private profiles, hidden sections, profiles without a background, and profiles with no showcases should still render without failing the request.
- A CSS background will not appear as an `<img>` in the DOM. Search the relevant element's inline style or, later, inspect computed styles in a controlled rendering step.
- Keep removing scripts and inline event handlers before placing fetched HTML in the iframe. The preview does not need page scripts to show the server-rendered layout, and those scripts must not be enabled for convenience.
- Remote images and stylesheets can fail or change independently of the HTML. Report an unavailable asset gracefully and keep its source URL available for diagnosis.
- Do not bypass profile privacy, login requirements, rate limits, or Steam access controls.

## Validation profiles

When the extractor grows, verify it against several public profiles rather than only one:

- a profile with a background and an avatar frame;
- a profile with no custom background or frame;
- a profile with multiple showcases and artwork;
- a profile with animated avatar or frame variants;
- a private or unavailable profile, which should produce a clear error or graceful missing assets.

For each sample, check that the extracted avatar URL is the portrait, not a frame item; the background URL corresponds to the page background; and missing assets do not break the profile preview.