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

app.use(express.json({ limit: '4kb' }));

app.get('/api/backgrounds', async (request, response) => {
  const query = typeof request.query.query === 'string' ? request.query.query.trim().slice(0, 80) : '';
  const start = Number(request.query.start ?? 0);
  const count = Number(request.query.count ?? 24);
  if (!Number.isInteger(start) || start < 0 || start > 100000 || !Number.isInteger(count) || count < 1 || count > 50) {
    response.status(400).json({ error: 'Invalid background search page.' });
    return;
  }

  const marketUrl = new URL('/market/search/render/', `https://${steamHost}`);
  marketUrl.searchParams.set('query', query);
  marketUrl.searchParams.set('start', String(start));
  marketUrl.searchParams.set('count', String(count));
  marketUrl.searchParams.set('search_descriptions', '0');
  marketUrl.searchParams.set('sort_column', 'popular');
  marketUrl.searchParams.set('sort_dir', 'desc');
  marketUrl.searchParams.set('appid', '753');
  marketUrl.searchParams.append('category_753_item_class[]', 'tag_item_class_3');
  marketUrl.searchParams.set('norender', '1');

  try {
    const result = await axios.get<SteamMarketResponse>(marketUrl.href, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!result.data.success || !Array.isArray(result.data.results)) throw new Error('Steam returned an invalid background catalog.');

    const items = result.data.results.flatMap((item) => {
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
    response.json({ items, totalCount: result.data.total_count || 0, pageSize: count });
  } catch {
    response.status(502).json({ error: 'Steam could not load profile backgrounds right now.' });
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