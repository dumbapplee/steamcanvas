import axios from 'axios';
import { load } from 'cheerio';
import express from 'express';
import { resolve } from 'node:path';

const app = express();
const port = Number(process.env.PORT || 8787);
const steamHost = 'steamcommunity.com';
const steamImageHost = 'community.cloudflare.steamstatic.com';

type SteamMarketItem = {
  name?: string;
  hash_name?: string;
  sell_price_text?: string;
  asset_description?: {
    icon_url?: string;
    market_name?: string;
    market_hash_name?: string;
    type?: string;
  };
};

type SteamMarketResponse = {
  success?: boolean;
  total_count?: number;
  results?: SteamMarketItem[];
};

type SteamPointShopDefinition = {
  appid?: number;
  defid?: number;
  active?: boolean;
  community_item_class?: number;
  community_item_type?: number;
  bundle_defids?: number[];
  community_item_data?: {
    item_name?: string;
    item_title?: string;
    item_image_small?: string;
    item_image_large?: string;
    item_movie_webm?: string;
    item_movie_mp4?: string;
    animated?: boolean;
    profile_theme_id?: string;
  };
};

type SteamPointShopResponse = {
  response?: {
    responses?: Array<{
      eresult?: number;
      response?: {
        total_count?: number;
        next_cursor?: string;
        definitions?: SteamPointShopDefinition[];
      };
    }>;
  };
};

type PublicScreenshot = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  steamUrl: string;
  searchText?: string;
  appid?: number;
  aspectRatio?: number;
};

function extractFullScreenshotUrl(html: string, pageUrl: string): string | undefined {
  const candidates = [...html.matchAll(/https:\/\/images\.steamusercontent\.com\/ugc\/[^"'<>\s]+/gi)]
    .map((match) => match[0].replace(/&amp;/g, '&'))
    .map((value) => {
      try {
        const url = new URL(value, pageUrl);
        return url.hostname === 'images.steamusercontent.com' ? url : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((url): url is URL => !!url)
    .sort((left, right) => Number(right.searchParams.get('imw') || 0) - Number(left.searchParams.get('imw') || 0));
  return candidates[0]?.href;
}

const catalogCache = new Map<string, { expiresAt: number; payload: unknown }>();
const catalogRequests = new Map<string, Promise<unknown>>();
const catalogCacheTtlMs = 3 * 60 * 60 * 1000;
const catalogCacheMaxEntries = 500;
const profileCacheTtlMs = 10 * 60 * 1000;
const steamRequestIntervalMs = 400;
let steamRequestQueue: Promise<void> = Promise.resolve();
let nextSteamRequestAt = 0;

async function waitForSteamRequestSlot(): Promise<void> {
  const previous = steamRequestQueue;
  let releaseQueue!: () => void;
  steamRequestQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;

  const delayMs = Math.max(0, nextSteamRequestAt - Date.now());
  if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  nextSteamRequestAt = Date.now() + steamRequestIntervalMs;
  releaseQueue();
}

axios.interceptors.request.use(async (config) => {
  await waitForSteamRequestSlot();
  return config;
});

function retryDelayMs(error: unknown, attempt: number): number {
  if (axios.isAxiosError(error)) {
    const retryAfter = error.response?.headers?.['retry-after'];
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.min(15000, retryAfterSeconds * 1000);
    if (typeof retryAfter === 'string') {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) return Math.min(15000, Math.max(500, retryAt - Date.now()));
    }
  }
  return Math.min(8000, 750 * 2 ** attempt);
}

async function getSteamHtmlWithRetry(url: string): Promise<{ data: string; responseUrl: string }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await axios.get<string>(url, {
        timeout: 15000,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      return { data: result.data, responseUrl: result.request?.res?.responseUrl || url };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const retryable = status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, attempt)));
    }
  }
  throw new Error('Steam request failed after retries.');
}

async function getCachedCatalog<T>(key: string, loadCatalog: () => Promise<T>, ttlMs = catalogCacheTtlMs): Promise<T> {
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload as T;

  const activeRequest = catalogRequests.get(key);
  if (activeRequest) return activeRequest as Promise<T>;

  const request = Promise.resolve().then(loadCatalog).then((payload) => {
    const now = Date.now();
    for (const [cacheKey, entry] of catalogCache) {
      if (entry.expiresAt <= now) catalogCache.delete(cacheKey);
    }
    while (catalogCache.size >= catalogCacheMaxEntries) {
      const oldestKey = catalogCache.keys().next().value;
      if (oldestKey === undefined) break;
      catalogCache.delete(oldestKey);
    }
    catalogCache.set(key, { expiresAt: now + ttlMs, payload });
    return payload;
  }).finally(() => {
    catalogRequests.delete(key);
  });
  catalogRequests.set(key, request);
  return request;
}

function setCatalogCacheHeaders(response: express.Response): void {
  response.setHeader('Cache-Control', `public, max-age=${catalogCacheTtlMs / 1000}`);
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function encodeNumberField(field: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function encodeStringField(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(bytes.length), bytes]);
}

function makePointsShopQuery(cursor?: string, communityItemClass = 3, pageSize = 20): string {
  const query = Buffer.concat([
    encodeNumberField(3, communityItemClass),
    encodeStringField(4, 'english'),
    encodeNumberField(5, pageSize),
    ...(cursor ? [encodeStringField(6, cursor)] : []),
    encodeNumberField(7, 2),
    encodeNumberField(8, 0),
    encodeNumberField(9, 1),
    ...(communityItemClass === 3 ? [encodeNumberField(12, 1)] : communityItemClass === 8 ? [encodeNumberField(12, 3)] : []),
    encodeNumberField(17, 3),
    encodeNumberField(17, 4),
  ]);
  return Buffer.concat([encodeVarint(10), encodeVarint(query.length), query]).toString('base64');
}

function makeRewardDefinitionsQuery(defids: number[]): string {
  const query = Buffer.concat([
    encodeStringField(4, 'english'),
    ...defids.map((defid) => encodeNumberField(11, defid)),
    encodeNumberField(16, 1),
  ]);
  return Buffer.concat([encodeVarint(10), encodeVarint(query.length), query]).toString('base64');
}

app.use(express.json({ limit: '4kb' }));

app.get('/api/backgrounds', async (request, response) => {
  const query = typeof request.query.query === 'string' ? request.query.query.trim().slice(0, 80) : '';
  const start = Number(request.query.start ?? 0);
  const count = Number(request.query.count ?? 30);
  if (!Number.isInteger(start) || start < 0 || start > 100000 || !Number.isInteger(count) || count < 1 || count > 30) {
    response.status(400).json({ error: 'Invalid background search page.' });
    return;
  }

  const cacheKey = `market:${query.toLowerCase()}:${start}:${count}`;
  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
  const marketUrl = new URL('/market/search/render/', `https://${steamHost}`);
  marketUrl.searchParams.set('query', query);
  marketUrl.searchParams.set('count', '10');
  marketUrl.searchParams.set('search_descriptions', '0');
  marketUrl.searchParams.set('sort_column', 'popular');
  marketUrl.searchParams.set('sort_dir', 'desc');
  marketUrl.searchParams.set('appid', '753');
  marketUrl.searchParams.append('category_753_item_class[]', 'tag_item_class_3');
  marketUrl.searchParams.set('norender', '1');

    const pages = await Promise.all(Array.from({ length: Math.ceil(count / 10) }, (_, index) => {
      const pageUrl = new URL(marketUrl);
      pageUrl.searchParams.set('start', String(start + index * 10));
      return axios.get<SteamMarketResponse>(pageUrl.href, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://steamcommunity.com/market/',
          Origin: 'https://steamcommunity.com',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
    }));
    if (pages.some(({ data }) => !data.success || !Array.isArray(data.results))) throw new Error('Steam returned an invalid background catalog.');

    const items = pages.flatMap(({ data }) => data.results || []).flatMap((item) => {
      const description = item.asset_description;
      const hashName = item.hash_name || description?.market_hash_name;
      const iconUrl = description?.icon_url;
      if (!description?.type?.toLowerCase().includes('profile background') || !hashName || !iconUrl || !/^[\w-]+$/.test(iconUrl)) return [];

      return [{
        id: hashName,
        name: description.market_name || item.name || hashName,
        game: description.type.replace(/\s+profile background$/i, ''),
        price: item.sell_price_text || '',
        imageUrl: `https://${steamImageHost}/economy/image/${iconUrl}`,
        steamUrl: new URL(`/market/listings/753/${encodeURIComponent(hashName)}`, `https://${steamHost}`).href,
      }];
    });

      return { items, totalCount: pages[0].data.total_count || 0, pageSize: count };
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      response.status(503).json({ error: 'Steam is temporarily limiting Market requests. Please try again in a few seconds.' });
      return;
    }
    response.status(502).json({ error: 'Steam could not load profile backgrounds right now.' });
  }
});

app.get('/api/points-backgrounds', async (request, response) => {
  const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : '';
  if (cursor && (cursor.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor))) {
    response.status(400).json({ error: 'Invalid Points Shop page cursor.' });
    return;
  }

  const cacheKey = `points-v3:${cursor || 'first'}`;
  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
  const apiUrl = new URL('/ILoyaltyRewardsService/BatchedQueryRewardItems/v1', 'https://api.steampowered.com');
  apiUrl.searchParams.set('origin', 'https://store.steampowered.com');
  apiUrl.searchParams.set('input_protobuf_encoded', makePointsShopQuery(cursor || undefined));
  apiUrl.searchParams.set('format', 'json');

    const result = await axios.get<SteamPointShopResponse>(apiUrl.href, {
      timeout: 15000,
      headers: { Accept: 'application/json' },
    });
    const pointShopResponse = result.data.response?.responses?.find((entry) => entry.eresult === 1)?.response;
    if (!pointShopResponse || !Array.isArray(pointShopResponse.definitions)) throw new Error('Steam returned an invalid Points Shop catalog.');

    const items = pointShopResponse.definitions.flatMap((definition) => {
      const data = definition.community_item_data;
      const appid = definition.appid;
      const image = data?.item_image_large;
      if (!definition.active || definition.community_item_class !== 3 || !data?.animated || !appid || !definition.defid || !image) return [];

      const assetBase = `https://shared.fastly.steamstatic.com/community_assets/images/items/${appid}/`;
      return [{
        id: `points:${appid}:${definition.defid}`,
        name: data.item_title || data.item_name || 'Animated profile background',
        game: String(appid),
        price: '',
        imageUrl: `https://community.fastly.steamstatic.com/economy/profilebackground/items/${appid}/${image}?size=320x200`,
        videoPoster: `${assetBase}${image}`,
        steamUrl: `https://store.steampowered.com/points/shop/app/${appid}`,
        animated: true,
        videoWebm: data.item_movie_webm ? `${assetBase}${data.item_movie_webm}` : undefined,
        videoMp4: data.item_movie_mp4 ? `${assetBase}${data.item_movie_mp4}` : undefined,
      }];
    });

    const payload = {
      items,
      totalCount: pointShopResponse.total_count || items.length,
      pageSize: 20,
      nextCursor: pointShopResponse.next_cursor || null,
    };
      return payload;
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load animated Points Shop backgrounds right now.' });
  }
});

app.get('/api/avatar-frames', async (request, response) => {
  const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : '';
  if (cursor && (cursor.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor))) {
    response.status(400).json({ error: 'Invalid avatar frame page cursor.' });
    return;
  }

  const cacheKey = `frames-v3:${cursor || 'first'}`;
  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
  const apiUrl = new URL('/ILoyaltyRewardsService/BatchedQueryRewardItems/v1', 'https://api.steampowered.com');
  apiUrl.searchParams.set('origin', 'https://store.steampowered.com');
  apiUrl.searchParams.set('input_protobuf_encoded', makePointsShopQuery(cursor || undefined, 14));
  apiUrl.searchParams.set('format', 'json');

    const result = await axios.get<SteamPointShopResponse>(apiUrl.href, {
      timeout: 15000,
      headers: { Accept: 'application/json' },
    });
    const pointShopResponse = result.data.response?.responses?.find((entry) => entry.eresult === 1)?.response;
    if (!pointShopResponse || !Array.isArray(pointShopResponse.definitions)) throw new Error('Steam returned an invalid avatar frame catalog.');

    const items = pointShopResponse.definitions.flatMap((definition) => {
      const data = definition.community_item_data;
      const appid = definition.appid;
      const image = data?.item_image_large;
      if (!definition.active || definition.community_item_class !== 14 || !appid || !definition.defid || !image) return [];

      const assetBase = `https://shared.fastly.steamstatic.com/community_assets/images/items/${appid}/`;
      return [{
        id: `frame:${appid}:${definition.defid}`,
        name: data.item_title || data.item_name || 'Avatar frame',
        game: String(appid),
        imageUrl: `${assetBase}${image}`,
        thumbnailUrl: `${assetBase}${data.item_image_small || image}`,
        steamUrl: `https://store.steampowered.com/points/shop/app/${appid}`,
        animatedImageUrl: data.animated && data.item_image_small ? `${assetBase}${data.item_image_small}` : undefined,
        animated: Boolean(data.animated),
      }];
    });

    const payload = {
      items,
      totalCount: pointShopResponse.total_count || items.length,
      pageSize: 20,
      nextCursor: pointShopResponse.next_cursor || null,
    };
      return payload;
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load avatar frames right now.' });
  }
});

app.get('/api/profile-themes', async (request, response) => {
  const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : '';
  if (cursor && (cursor.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor))) {
    response.status(400).json({ error: 'Invalid profile theme page cursor.' });
    return;
  }

  const cacheKey = `profile-themes-v5:${cursor || 'first'}`;
  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
      const apiUrl = new URL('/ILoyaltyRewardsService/BatchedQueryRewardItems/v1', 'https://api.steampowered.com');
      apiUrl.searchParams.set('origin', 'https://store.steampowered.com');
      apiUrl.searchParams.set('input_protobuf_encoded', makePointsShopQuery(cursor || undefined, 8));
      apiUrl.searchParams.set('format', 'json');

      const result = await axios.get<SteamPointShopResponse>(apiUrl.href, {
        timeout: 15000,
        headers: { Accept: 'application/json' },
      });
      const pointShopResponse = result.data.response?.responses
        ?.filter((entry) => entry.eresult === 1 && Array.isArray(entry.response?.definitions))
        .map((entry) => entry.response!)
        .sort((left, right) => (right.definitions?.length || 0) - (left.definitions?.length || 0))[0];
      if (!pointShopResponse || !Array.isArray(pointShopResponse.definitions)) throw new Error('Steam returned an invalid profile theme catalog.');

      const items = pointShopResponse.definitions.flatMap((definition) => {
        const data = definition.community_item_data;
        const appid = definition.appid;
        const image = data?.item_image_large;
        if (!definition.active || definition.community_item_class !== 8 || !data?.profile_theme_id || !appid || !definition.defid || !image || !definition.bundle_defids?.length) return [];

        const assetBase = `https://shared.fastly.steamstatic.com/community_assets/images/items/${appid}/`;
        return [{
          id: `theme:${appid}:${definition.defid}`,
          name: data.item_title || data.item_name || 'Profile theme',
          game: String(appid),
          appid,
          communityItemType: definition.community_item_type,
          profileThemeId: data.profile_theme_id,
          bundleDefids: definition.bundle_defids,
          imageUrl: `${assetBase}${image}`,
          thumbnailUrl: `${assetBase}${data.item_image_small || image}`,
          steamUrl: `https://store.steampowered.com/points/shop/app/${appid}`,
        }];
      });

      return {
        items,
        totalCount: pointShopResponse.total_count || items.length,
        pageSize: 20,
        nextCursor: pointShopResponse.next_cursor || null,
      };
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load profile themes right now.' });
  }
});

app.get('/api/profile-theme-style', async (request, response) => {
  const appid = Number(request.query.appid);
  const itemType = Number(request.query.itemtype);
  if (!Number.isSafeInteger(appid) || appid < 1 || appid > 0xffffffff || !Number.isSafeInteger(itemType) || itemType < 1 || itemType > 0xffffffff) {
    response.status(400).json({ error: 'Invalid profile theme preview identifiers.' });
    return;
  }

  const previewUrl = new URL('/profiles/76561197960266962', `https://${steamHost}`);
  previewUrl.searchParams.set('previewprofile', '1');
  previewUrl.searchParams.set('appid', String(appid));
  previewUrl.searchParams.set('itemtype', String(itemType));
  const cacheKey = `profile-theme-style:${appid}:${itemType}`;

  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
      const result = await axios.get<string>(previewUrl.href, {
        timeout: 15000,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      const $ = load(result.data);
      const themeRule = $('style').toArray()
        .map((element) => $(element).text().match(/body\.GameProfileTheme\s*\{([^}]*)\}/s)?.[1])
        .find(Boolean);
      if (!themeRule) throw new Error('Steam did not return profile theme styles.');

      const allowedProperties = new Set([
        '--gradient-right', '--gradient-left', '--gradient-background', '--gradient-background-right',
        '--gradient-background-left', '--color-showcase-header', '--gradient-showcase-header-left',
        '--btn-background', '--btn-background-hover', '--btn-outline',
      ]);
      const variables: Record<string, string> = {};
      for (const declaration of themeRule.matchAll(/(--[\w-]+)\s*:\s*([^;]+)\s*;?/g)) {
        const [, property, rawValue] = declaration;
        const value = rawValue.trim();
        if (!allowedProperties.has(property)) continue;
        if (/^(?:#[\da-f]{3,8}|rgba?\([\d.%\s,/]+\)|hsla?\([\d.%\s,/]+\)|transparent)$/i.test(value)) {
          variables[property] = value;
        }
      }
      if (!variables['--color-showcase-header'] || !variables['--gradient-background']) {
        throw new Error('Steam returned incomplete profile theme styles.');
      }
      return { variables };
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load the selected profile theme right now.' });
  }
});

app.get('/api/profile-theme-items', async (request, response) => {
  const rawDefids = typeof request.query.defids === 'string' ? request.query.defids : '';
  const defids = rawDefids.split(',').map((value) => Number(value));
  if (!rawDefids || defids.length < 1 || defids.length > 8 || defids.some((defid) => !Number.isInteger(defid) || defid < 1 || defid > 0xffffffff)) {
    response.status(400).json({ error: 'Invalid profile theme bundle item IDs.' });
    return;
  }

  const uniqueDefids = [...new Set(defids)];
  const cacheKey = `profile-theme-items:${uniqueDefids.slice().sort((a, b) => a - b).join(',')}`;
  try {
    const payload = await getCachedCatalog(cacheKey, async () => {
      const apiUrl = new URL('/ILoyaltyRewardsService/BatchedQueryRewardItems/v1', 'https://api.steampowered.com');
      apiUrl.searchParams.set('origin', 'https://store.steampowered.com');
      apiUrl.searchParams.set('input_protobuf_encoded', makeRewardDefinitionsQuery(uniqueDefids));
      apiUrl.searchParams.set('format', 'json');
      const result = await axios.get<SteamPointShopResponse>(apiUrl.href, { timeout: 15000, headers: { Accept: 'application/json' } });
      const definitions = result.data.response?.responses?.flatMap((entry) => entry.eresult === 1 ? entry.response?.definitions || [] : []) || [];
      if (definitions.length !== uniqueDefids.length) throw new Error('Steam returned an incomplete profile theme bundle.');
      return { items: definitions };
    });
    setCatalogCacheHeaders(response);
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load the profile theme bundle right now.' });
  }
});

function resolveProfileUrl(input: unknown): URL {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Enter a SteamID64, custom profile name, or full profile URL.');
  }

  const value = input.trim();
  if (/^\d{17}$/.test(value)) return new URL(`/profiles/${value}`, `https://${steamHost}`);

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error('That does not look like a valid Steam profile address.');
  }

  if (parsed.hostname !== steamHost && parsed.hostname !== `www.${steamHost}`) {
    if (value.includes('/') || value.includes(':')) {
      throw new Error('Use a steamcommunity.com profile URL or enter only the custom profile name.');
    }
    return new URL(`/id/${encodeURIComponent(value)}`, `https://${steamHost}`);
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || !['id', 'profiles'].includes(parts[0])) {
    throw new Error('Use a Steam profile URL in the form /id/name or /profiles/SteamID64.');
  }
  if (parts[0] === 'profiles' && !/^\d{17}$/.test(parts[1])) {
    throw new Error('The SteamID64 in that profile URL must contain 17 digits.');
  }
  if (parts[0] === 'id' && !/^[\w-]{1,64}$/.test(decodeURIComponent(parts[1]))) {
    throw new Error('That custom profile name contains unsupported characters.');
  }

  return new URL(`/${parts[0]}/${encodeURIComponent(decodeURIComponent(parts[1]))}`, `https://${steamHost}`);
}

function extractPublicScreenshots(html: string, pageUrl: string): PublicScreenshot[] {
  const $ = load(html);
  const screenshots: PublicScreenshot[] = [];
  $('a.profile_media_item[data-publishedfileid]').each((_, element) => {
    if (screenshots.length >= 50) return;
    const item = $(element);
    const id = item.attr('data-publishedfileid');
    const rawImage = item.find('.imgWallItem').first().attr('style')?.match(/background-image\s*:\s*url\(['"]?([^'"\)]+)['"]?\)/i)?.[1];
    if (!id || !rawImage) return;
    try {
      const thumbnailUrl = new URL(rawImage, pageUrl);
      if (thumbnailUrl.hostname !== 'images.steamusercontent.com') return;
      const imageUrl = new URL(thumbnailUrl.href);
      imageUrl.search = '';
      imageUrl.hash = '';
      const aspectRatio = Number(item.attr('data-desired-aspect'));
      screenshots.push({
        id,
        imageUrl: imageUrl.href,
        thumbnailUrl: thumbnailUrl.href,
        steamUrl: new URL(item.attr('href') || `/sharedfiles/filedetails/?id=${id}`, pageUrl).href,
        searchText: `Screenshot ${id} App ${item.attr('data-appid') || ''}`,
        ...(Number.isInteger(Number(item.attr('data-appid'))) ? { appid: Number(item.attr('data-appid')) } : {}),
        ...(Number.isFinite(aspectRatio) && aspectRatio > 0 ? { aspectRatio } : {}),
      });
    } catch {
      // Ignore malformed or non-public screenshot URLs.
    }
  });
  return screenshots;
}

function makeInertDocument(html: string, pageUrl: string): { html: string; name: string; avatar?: string; level?: number } {
  const $ = load(html);
  $('#global_header').remove();
  $('script, iframe, object, embed').remove();
  $('*').each((_, element) => {
    if (!('attribs' in element)) return;
    for (const attribute of Object.keys(element.attribs)) {
      if (attribute.toLowerCase().startsWith('on')) $(element).removeAttr(attribute);
    }
  });
  $('base').remove();
  $('head').prepend(`<base href="${new URL('/', pageUrl).href}">`);

  const name = $('#personaName').text().trim()
    || $('.actual_persona_name').first().text().trim()
    || $('title').text().trim()
    || 'Steam profile';
  const levelText = $('.profile_header_badgeinfo .friendPlayerLevelNum').first().text().trim();
  const level = /^\d+$/.test(levelText) ? Number(levelText) : undefined;
  const avatarImages = $('.playerAvatarAutoSizeInner img, .playerAvatar img').toArray();
  const avatarSource = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || avatarImages.map((image) => {
      const candidate = $(image).attr('src')
        || $(image).attr('data-src')
        || $(image).attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
      return candidate && new URL(candidate, pageUrl).hostname === 'avatars.fastly.steamstatic.com' ? candidate : undefined;
    }).find(Boolean);
  const avatar = avatarSource ? new URL(avatarSource, pageUrl).href : undefined;

  return { html: $.html(), name, ...(avatar ? { avatar } : {}), ...(level !== undefined ? { level } : {}) };
}

app.post('/api/profile', async (request, response) => {
  let profileUrl: URL;
  try {
    profileUrl = resolveProfileUrl(request.body?.identifier);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid profile address.' });
    return;
  }

  try {
    const profile = await getCachedCatalog(`profile:${profileUrl.href}`, async () => {
      const result = await getSteamHtmlWithRetry(profileUrl.href);
      return { ...makeInertDocument(result.data, result.responseUrl), url: result.responseUrl };
    }, profileCacheTtlMs);
    response.setHeader('Cache-Control', 'no-store');
    response.json(profile);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      response.status(404).json({ error: 'Steam could not find that profile.' });
      return;
    }
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      response.status(504).json({ error: 'Steam took too long to respond. Try again in a moment.' });
      return;
    }
    response.status(502).json({ error: 'Steam did not return a usable public profile. It may be private or temporarily unavailable.' });
  }
});

app.post('/api/profile-screenshots', async (request, response) => {
  let profileUrl: URL;
  try {
    profileUrl = resolveProfileUrl(request.body?.profileUrl);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid profile address.' });
    return;
  }

  const screenshotsUrl = new URL(profileUrl);
  screenshotsUrl.pathname = `${screenshotsUrl.pathname.replace(/\/$/, '')}/screenshots/`;
  const requestedPage = Math.max(1, Number(request.body?.page) || 1);
  const pageBatchSize = 6;
  const cacheKey = `profile-screenshots:${screenshotsUrl.href}:page-${requestedPage}`;
  try {
    const catalog = await getCachedCatalog(cacheKey, async () => {
      const pages: PublicScreenshot[][] = [];
      for (let index = 0; index < pageBatchSize; index += 1) {
        const pageUrl = new URL(screenshotsUrl.href);
        pageUrl.searchParams.set('p', String(requestedPage + index));
        const result = await getSteamHtmlWithRetry(pageUrl.href);
        pages.push(extractPublicScreenshots(result.data, result.responseUrl));
        if (index < pageBatchSize - 1) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        items: [...new Map(pages.flat().map((item) => [item.id, item])).values()],
        hasMore: pages[pages.length - 1]?.length > 0,
      };
    });
    setCatalogCacheHeaders(response);
    response.json(catalog);
  } catch (error) {
    const status = axios.isAxiosError(error) && error.response?.status === 429 ? 429 : axios.isAxiosError(error) && error.code === 'ECONNABORTED' ? 504 : 502;
    response.status(status).json({ error: status === 429 ? 'Steam is rate limiting screenshot requests. Wait a moment and try again.' : status === 504 ? 'Steam took too long to load the screenshot gallery.' : 'Steam could not load this public screenshot gallery right now.' });
  }
});

app.post('/api/screenshot-image', async (request, response) => {
  try {
    const screenshotUrl = new URL(String(request.body?.steamUrl || ''));
    if (screenshotUrl.hostname !== steamHost && screenshotUrl.hostname !== `www.${steamHost}` || screenshotUrl.pathname !== '/sharedfiles/filedetails/') {
      throw new Error('Invalid screenshot URL.');
    }
    const imageUrl = await getCachedCatalog(`screenshot-image:${screenshotUrl.href}`, async () => {
      const result = await getSteamHtmlWithRetry(screenshotUrl.href);
      return extractFullScreenshotUrl(result.data, result.responseUrl);
    });
    if (!imageUrl) throw new Error('Steam did not expose a full-resolution screenshot.');
    response.json({ imageUrl });
  } catch (error) {
    const status = axios.isAxiosError(error) && error.response?.status === 429 ? 429 : axios.isAxiosError(error) && error.code === 'ECONNABORTED' ? 504 : 502;
    response.status(status).json({ error: status === 429 ? 'Steam is rate limiting full-resolution requests. Wait a moment and try again.' : status === 504 ? 'Steam took too long to load the full-resolution screenshot.' : 'Steam could not load the full-resolution screenshot right now.' });
  }
});

const clientBuildPath = resolve('dist');
app.use(express.static(clientBuildPath));
app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
  response.sendFile(resolve(clientBuildPath, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SteamCanvas listening on http://localhost:${port}`);
});