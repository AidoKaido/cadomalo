import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const SITE_URL = (process.env.SITE_URL || 'https://cadomalo.com').replace(/\/$/, '')

const STATIC_PAGES = [
  {loc: '/', priority: '1.0', changefreq: 'weekly'},
  {loc: '/shop', priority: '0.9', changefreq: 'daily'},
  {loc: '/gift-finder', priority: '0.8', changefreq: 'monthly'},
  {loc: '/blog', priority: '0.7', changefreq: 'weekly'},
  {loc: '/about', priority: '0.5', changefreq: 'monthly'},
  {loc: '/contact', priority: '0.5', changefreq: 'monthly'},
  {loc: '/returns', priority: '0.4', changefreq: 'yearly'},
  {loc: '/privacy-policy', priority: '0.3', changefreq: 'yearly'},
  {loc: '/terms', priority: '0.3', changefreq: 'yearly'},
  {loc: '/cookie-policy', priority: '0.3', changefreq: 'yearly'},
  {loc: '/accessibility', priority: '0.3', changefreq: 'yearly'},
]

const BLOG_PAGES = [
  '/blog-anniversary',
  '/blog-personalized',
  '/blog-wedding',
  '/blog-digital',
  '/blog-budget',
  '/blog-last-minute',
  '/blog-baby',
  '/blog-holiday',
  '/blog-men',
]

const today = new Date().toISOString().split('T')[0]

async function main() {
  let products = []
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
    products = JSON.parse(raw).products || []
  } catch (err) {
    console.warn('[sitemap] could not read products.json:', err.message)
  }

  const urls = []
  for (const p of STATIC_PAGES) {
    urls.push({loc: SITE_URL + p.loc, priority: p.priority, changefreq: p.changefreq, lastmod: today})
  }
  for (const b of BLOG_PAGES) {
    urls.push({loc: SITE_URL + b, priority: '0.6', changefreq: 'monthly', lastmod: today})
  }
  for (const prod of products) {
    if (!prod.slug) continue
    urls.push({
      loc: `${SITE_URL}/products/${encodeURIComponent(prod.slug)}`,
      priority: '0.8',
      changefreq: 'weekly',
      lastmod: today,
    })
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
    '',
  ].join('\n')

  await writeFile(join(process.cwd(), 'sitemap.xml'), xml, 'utf8')
  console.log(`[sitemap] wrote sitemap.xml with ${urls.length} URLs`)

  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /order-confirmation',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
  await writeFile(join(process.cwd(), 'robots.txt'), robots, 'utf8')
  console.log('[sitemap] wrote robots.txt')
}

main().catch((err) => {
  console.error('[sitemap] failed:', err)
  process.exit(0)
})
