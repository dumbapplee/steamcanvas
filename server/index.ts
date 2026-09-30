import axios from 'axios';
import { load } from 'cheerio';
import express from 'express';

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
  community_item_data?: {
    item_name?: string;
    item_title?: string;
    item_image_large?: string;
    item_movie_webm?: string;
    item_movie_mp4?: string;
    animated?: boolean;
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

const pointsShopCache = new Map<string, { expiresAt: number; payload: object }>();

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

function makePointsShopQuery(cursor?: string): string {
  const query = Buffer.concat([
    encodeNumberField(3, 3),
    encodeStringField(4, 'english'),
    encodeNumberField(5, 20),
    ...(cursor ? [encodeStringField(6, cursor)] : []),
    encodeNumberField(7, 2),
    encodeNumberField(8, 0),
    encodeNumberField(9, 1),
    encodeNumberField(12, 1),
    encodeNumberField(17, 3),
    encodeNumberField(17, 4),
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

  const marketUrl = new URL('/market/search/render/', `https://${steamHost}`);
  marketUrl.searchParams.set('query', query);
  marketUrl.searchParams.set('count', '10');
  marketUrl.searchParams.set('search_descriptions', '0');
  marketUrl.searchParams.set('sort_column', 'popular');
  marketUrl.searchParams.set('sort_dir', 'desc');
  marketUrl.searchParams.set('appid', '753');
  marketUrl.searchParams.append('category_753_item_class[]', 'tag_item_class_3');
  marketUrl.searchParams.set('norender', '1');

  try {
    const pages = await Promise.all(Array.from({ length: Math.ceil(count / 10) }, (_, index) => {
      const pageUrl = new URL(marketUrl);
      pageUrl.searchParams.set('start', String(start + index * 10));
      return axios.get<SteamMarketResponse>(pageUrl.href, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json',
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
        marketUrl: new URL(`/market/listings/753/${encodeURIComponent(hashName)}`, `https://${steamHost}`).href,
      }];
    });

    response.setHeader('Cache-Control', 'public, max-age=60');
    response.json({ items, totalCount: pages[0].data.total_count || 0, pageSize: count });
  } catch {
    response.status(502).json({ error: 'Steam could not load profile backgrounds right now.' });
  }
});

app.get('/api/points-backgrounds', async (request, response) => {
  const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : '';
  if (cursor && (cursor.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor))) {
    response.status(400).json({ error: 'Invalid Points Shop page cursor.' });
    return;
  }

  const cacheKey = cursor || 'first';
  const cached = pointsShopCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.json(cached.payload);
    return;
  }

  const apiUrl = new URL('/ILoyaltyRewardsService/BatchedQueryRewardItems/v1', 'https://api.steampowered.com');
  apiUrl.searchParams.set('origin', 'https://store.steampowered.com');
  apiUrl.searchParams.set('input_protobuf_encoded', makePointsShopQuery(cursor || undefined));
  apiUrl.searchParams.set('format', 'json');

  try {
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
        marketUrl: 'https://store.steampowered.com/points/shop/c/backgrounds/cluster/1',
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
    pointsShopCache.set(cacheKey, { expiresAt: Date.now() + 300000, payload });
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.json(payload);
  } catch {
    response.status(502).json({ error: 'Steam could not load animated Points Shop backgrounds right now.' });
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

function makeInertDocument(html: string, pageUrl: string): { html: string; name: string; avatar?: string; level?: number } {
  const $ = load(html);
  $('#global_header').remove();
  $('script, iframe, object, embed').remove();
  $('*').each((_, element) => {
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
    const result = await axios.get<string>(profileUrl.href, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const resolvedUrl = result.request?.res?.responseUrl || profileUrl.href;
    const profile = makeInertDocument(result.data, resolvedUrl);
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ...profile, url: resolvedUrl });
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

app.listen(port, '0.0.0.0', () => {
  console.log(`SteamCanvas API listening on http://localhost:${port}`);
});