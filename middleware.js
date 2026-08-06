// ═══════════════════════════════════════════════════════════════════
//  Vercel Edge Middleware — bot pre-rendering for /product.html
//
//  WHY THIS EXISTS
//  product.html renders its title/description/OG image via client-side
//  JS after fetching the product from Supabase. That's fine for users
//  and for Googlebot (which executes JS), but link-preview crawlers
//  (WhatsApp, Facebook, Twitter/X, Slack, Telegram, LinkedIn, Discord…)
//  do NOT execute JavaScript — they only read the raw <head> that's
//  served on the very first response. Without this, every shared
//  product link shows the generic fallback title/description/image
//  instead of the actual product.
//
//  WHAT THIS DOES
//  For requests to /product?id=... from a known bot user-agent, it
//  fetches the product from Supabase, self-fetches the *real*
//  product.html (so markup/CSS/JS stay a single source of truth), and
//  rewrites only the placeholder <head> tags (title, meta description,
//  canonical, OG/Twitter tags, JSON-LD) before returning it. Regular
//  users and any request that doesn't match are passed straight
//  through untouched.
//
//  NOTE ON CLEAN URLS
//  vercel.json has "cleanUrls": true, so the live site actually serves
//  (and WhatsApp/Facebook/etc. actually request) the extensionless
//  "/product?id=..." — NOT "/product.html?id=...". Edge Middleware
//  runs on the raw incoming request, before Vercel's own cleanUrls
//  redirect logic, so the matcher below has to target "/product"
//  directly. "/product.html" is included too in case an old link with
//  the extension is shared/crawled directly — Vercel will normally
//  308-redirect that to "/product" and the crawler follows it, but
//  matching it here avoids the extra hop.
// ═══════════════════════════════════════════════════════════════════

export const config = {
  matcher: ['/product', '/product.html'],
};

// Recognized link-preview / search crawlers.
// Add more here if you notice a bot's preview isn't picking this up.
const BOT_UA_REGEX = new RegExp(
  [
    'facebookexternalhit',
    'Facebot',
    'WhatsApp',
    'Twitterbot',
    'Slackbot',
    'Slack-ImgProxy',
    'TelegramBot',
    'LinkedInBot',
    'Discordbot',
    'redditbot',
    'SkypeUriPreview',
    'Pinterest',
    'vkShare',
    'W3C_Validator',
    'Googlebot',
    'Google-InspectionTool',
    'AdsBot-Google',
    'bingbot',
    'DuckDuckBot',
    'YandexBot',
    'Baiduspider',
    'Applebot',
    'ia_archiver',
    'bot',
    'crawl',
    'spider',
  ].join('|'),
  'i'
);

// Same Supabase project product.html already talks to. Override via
// Vercel project env vars (SUPABASE_URL / SUPABASE_ANON_KEY) if you
// ever rotate the anon key — these hardcoded values are just the
// existing public fallback already shipped in product.html's JS.
const SUPABASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) ||
  'https://mefmpxohxrpnezwlbchj.supabase.co';
const SUPABASE_KEY =
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lZm1weG9oeHJwbmV6d2xiY2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTk3MjEsImV4cCI6MjA5Mjc5NTcyMX0.PbTag81xO1_X8vuxkizhVYjfhj3lz5CO3yjn8zlnNoM';
const TABLE = 'products';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

// Mirrors cldOpt() in product.html so the OG image matches what users see.
function cldOpt(url, width) {
  if (!url) return url;
  if (url.indexOf('res.cloudinary.com') !== -1 && url.indexOf('/upload/') !== -1) {
    return url.replace(/\/upload\/(?:[^/]+\/)?/, '/upload/f_webp,q_auto,w_' + width + '/');
  }
  if (url.indexOf('res.cloudinary.com') !== -1 && url.indexOf('/fetch/') !== -1) {
    return url.replace(/\/fetch\/[^/]+\//, '/fetch/f_webp,q_auto,w_' + width + '/');
  }
  return 'https://res.cloudinary.com/drfl8crbx/image/fetch/f_webp,q_auto,w_' + width + '/' + url;
}

async function fetchProduct(id) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id) + '&select=*',
    { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

// Replaces the value of `attr="..."` inside a tag matched by its id="X".
// Works whether the id attribute appears before or after the target attr.
function setAttrById(html, elementId, attr, value) {
  const tagRegex = new RegExp('(<[^>]*\\bid=["\']' + elementId + '["\'][^>]*>)', 'i');
  const match = html.match(tagRegex);
  if (!match) return html;
  const tag = match[1];
  const attrRegex = new RegExp('(' + attr + '=)(["\'])(.*?)\\2', 'i');
  let newTag;
  if (attrRegex.test(tag)) {
    newTag = tag.replace(attrRegex, '$1$2' + value.replace(/\$/g, '$$$$') + '$2');
  } else {
    newTag = tag.replace(/>$/, ' ' + attr + '="' + value + '">');
  }
  return html.replace(tag, newTag);
}

function setTextById(html, elementId, text) {
  const regex = new RegExp('(<[^>]*\\bid=["\']' + elementId + '["\'][^>]*>)([\\s\\S]*?)(<\\/[^>]+>)', 'i');
  return html.replace(regex, function (_m, open, _old, close) {
    return open + text + close;
  });
}

function buildProductHtml(rawHtml, product, pageUrl) {
  const inStock = product.status !== 'outofstock';
  const img = cldOpt(product.image, 800);
  const desc = product.description
    ? String(product.description).slice(0, 155)
    : product.name +
      ' available at \u20b9' +
      Number(product.price).toLocaleString('en-IN') +
      ' from SAG Drone Technologies' +
      (product.category ? ' — ' + product.category : '') +
      '. Certified quality, pan-India delivery.';
  const title = product.name + ' – SAG Drone Technologies';
  // Extensionless to match the live, cleanUrls-served URL — pointing
  // canonical/og:url at the .html path would point crawlers at a URL
  // that just 308-redirects to this one.
  const canonicalUrl = 'https://sagdrones.com/product?id=' + product.id;

  let html = rawHtml;
  html = setTextById(html, 'pageTitle', escapeHtml(title));
  html = setAttrById(html, 'metaDescription', 'content', escapeAttr(desc));
  html = setAttrById(html, 'canonicalLink', 'href', canonicalUrl);
  html = setAttrById(html, 'ogTitle', 'content', escapeAttr(title));
  html = setAttrById(html, 'ogDescription', 'content', escapeAttr(desc));
  html = setAttrById(html, 'ogUrl', 'content', canonicalUrl);
  html = setAttrById(html, 'twitterTitle', 'content', escapeAttr(title));
  html = setAttrById(html, 'twitterDescription', 'content', escapeAttr(desc));
  if (img) {
    html = setAttrById(html, 'ogImage', 'content', escapeAttr(img));
    html = setAttrById(html, 'twitterImage', 'content', escapeAttr(img));
  }

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: desc,
    image: img ? [img] : undefined,
    category: product.category || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: product.price,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonicalUrl,
    },
  };
  html = html.replace(
    /(<script id="productSchema" type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i,
    function (_m, open, _old, close) {
      return open + JSON.stringify(schema) + close;
    }
  );

  return html;
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // Prevents the internal self-fetch below from re-triggering this
  // same logic and looping forever.
  if (url.searchParams.get('__prerendered') === '1') {
    return; // fall through to the static file untouched
  }

  const ua = request.headers.get('user-agent') || '';
  if (!BOT_UA_REGEX.test(ua)) {
    return; // real users get the normal client-rendered SPA page
  }

  const id = url.searchParams.get('id');
  if (!id) {
    return; // no product id (e.g. bare /product.html) — nothing to inject
  }

  try {
    const product = await fetchProduct(id);
    if (!product) {
      return; // let the normal "not found" client-side flow handle it
    }

    // Force the extensionless path for the self-fetch regardless of
    // which variant the bot actually requested, so we don't waste a
    // redirect hop internally.
    const originUrl = new URL(request.url);
    originUrl.pathname = '/product';
    originUrl.searchParams.set('__prerendered', '1');
    const originRes = await fetch(originUrl.toString(), {
      headers: { 'user-agent': ua },
    });
    if (!originRes.ok) return;

    const rawHtml = await originRes.text();
    const finalHtml = buildProductHtml(rawHtml, product, url);

    return new Response(finalHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Cache at the edge so repeated bot hits (WhatsApp re-crawls,
        // Googlebot revisits) don't hammer Supabase every time.
        'cache-control': 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400',
        'x-prerendered-for-bot': '1',
      },
    });
  } catch (err) {
    // Any failure (Supabase down, network hiccup, etc.) — fail open
    // and just serve the normal page rather than erroring out.
    return;
  }
}
