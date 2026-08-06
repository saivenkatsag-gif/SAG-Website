// ═══════════════════════════════════════════════════════════════════
//  Dynamic sitemap.xml — Vercel Serverless Function (Node.js runtime)
//
//  WHY THIS EXISTS
//  The old sitemap.xml was a static file, so every new product added
//  in the admin panel (Supabase `products` table) was invisible to
//  search engines until someone manually edited the XML. This
//  function generates the sitemap on every request: the static pages
//  and blog posts stay hardcoded below (they don't change often), but
//  the product URLs are pulled live from Supabase, so a new product
//  shows up in the sitemap the moment it's added — no deploy needed.
//
//  ROUTING
//  vercel.json rewrites "/sitemap.xml" -> "/api/sitemap" so this file
//  is served at the canonical https://sagdrones.com/sitemap.xml URL
//  (the one already referenced in robots.txt). The old static
//  sitemap.xml file has been removed so there's no conflict.
// ═══════════════════════════════════════════════════════════════════

// Same Supabase project every other page on the site talks to.
// Override via Vercel project env vars (SUPABASE_URL / SUPABASE_ANON_KEY)
// if you ever rotate the key — these hardcoded values are just the
// existing public fallback already shipped elsewhere on the site.
const SUPABASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) ||
  'https://mefmpxohxrpnezwlbchj.supabase.co';
const SUPABASE_KEY =
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lZm1weG9oeHJwbmV6d2xiY2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTk3MjEsImV4cCI6MjA5Mjc5NTcyMX0.PbTag81xO1_X8vuxkizhVYjfhj3lz5CO3yjn8zlnNoM';
const TABLE = 'products';

const SITE = 'https://sagdrones.com';

// Static, hand-maintained pages. Bump lastmod when you meaningfully
// edit one of these — it's a hint to crawlers, not a hard requirement.
const STATIC_PAGES = [
  { loc: '/', lastmod: '2026-05-16', changefreq: 'weekly', priority: '1.0' },
  {
    loc: '/products.html',
    lastmod: '2026-05-16',
    changefreq: 'weekly',
    priority: '0.9',
    images: [
      { loc: 'https://framerusercontent.com/images/JHfqfEGEY832dH8wU2FIj8e42o.png', title: 'Beta 610 TC Drone – SAG Drone Technologies' },
      { loc: 'https://framerusercontent.com/images/eRu3lhJevMrkK1YctwXEMpgZICM.png', title: 'SAG Flash Q20 TC Drone – SAG Drone Technologies' },
      { loc: 'https://framerusercontent.com/images/oDDN2aWnPwDBOacMrdJxrPj3K8.png', title: '14S 22000mAh SAG VOLT Plus Battery' },
      { loc: 'https://framerusercontent.com/images/EIRN6BISlMewm9CBHoIWVhtzYak.png', title: '14S 30000mAh SAG VOLT Plus Battery' },
      { loc: 'https://framerusercontent.com/images/qaHt0hSCGuIztk0xhYkDydSmzM.png', title: 'SiYi MK15 Transmitter Kit' },
      { loc: 'https://framerusercontent.com/images/ccOSG205SKwpOBmfBTiG6vyFe4.jpeg', title: 'SKYRC 3000 Watt Drone Battery Charger' },
    ],
  },
  { loc: '/rpto.html', lastmod: '2026-05-16', changefreq: 'monthly', priority: '0.8' },
  { loc: '/blogs', lastmod: '2026-05-16', changefreq: 'weekly', priority: '0.7' },
];

// Static blog slugs. Blogs aren't in Supabase, so these stay
// hand-maintained — add a line here when you publish a new post.
const BLOG_SLUGS = [
  'dgca-drone-rules-2025',
  'hobbywing-x8-gen2-motor-review',
  'reducing-pesticide-use-with-agri-drones',
  '5-things-before-enrolling-drone-pilot-training',
  'small-vs-medium-drones-for-farms',
  'remote-pilot-certificate-application-guide',
  'drone-spraying-practices-paddy-rice-crops',
  'rpto-5-day-training-program',
];

function escapeXml(s) {
  return String(s).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function toIsoDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function fetchProducts() {
  const url =
    SUPABASE_URL +
    '/rest/v1/' +
    TABLE +
    '?select=id,name,image,created_at,status&order=created_at.desc';
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
    },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function renderUrlBlock({ loc, lastmod, changefreq, priority, images }) {
  let xml = '  <url>\n';
  xml += '    <loc>' + escapeXml(loc) + '</loc>\n';
  if (lastmod) xml += '    <lastmod>' + lastmod + '</lastmod>\n';
  if (changefreq) xml += '    <changefreq>' + changefreq + '</changefreq>\n';
  if (priority) xml += '    <priority>' + priority + '</priority>\n';
  if (images && images.length) {
    for (const img of images) {
      xml += '    <image:image>\n';
      xml += '      <image:loc>' + escapeXml(img.loc) + '</image:loc>\n';
      if (img.title) xml += '      <image:title>' + escapeXml(img.title) + '</image:title>\n';
      xml += '    </image:image>\n';
    }
  }
  xml += '  </url>\n';
  return xml;
}

export default async function handler(req, res) {
  let products = [];
  try {
    products = await fetchProducts();
  } catch (err) {
    // Fail open: a Supabase hiccup shouldn't take down the whole
    // sitemap — just serve it without the product URLs this time.
    products = [];
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n\n';

  for (const page of STATIC_PAGES) {
    xml += renderUrlBlock({ ...page, loc: SITE + page.loc });
  }

  xml += '\n';
  for (const slug of BLOG_SLUGS) {
    xml += renderUrlBlock({
      loc: SITE + '/blog/' + slug,
      lastmod: '2026-05-16',
      changefreq: 'monthly',
      priority: '0.6',
    });
  }

  if (products.length) {
    xml += '\n';
    for (const p of products) {
      if (!p || p.id == null) continue;
      xml += renderUrlBlock({
        loc: SITE + '/product?id=' + p.id,
        lastmod: toIsoDate(p.created_at) || undefined,
        changefreq: 'weekly',
        priority: p.status === 'outofstock' ? '0.4' : '0.7',
        images: p.image ? [{ loc: p.image, title: p.name || undefined }] : undefined,
      });
    }
  }

  xml += '\n</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Edge/CDN cache so we're not hitting Supabase on every crawler
  // request, but still refresh often enough to catch new products.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
}
