import {readFile, writeFile, readdir} from 'node:fs/promises'
import {join} from 'node:path'

const SITE_URL = (process.env.SITE_URL || 'https://cadomalo.com').replace(/\/$/, '')

// Pages written by scripts/build-pages.js live as <dir>/index.html. Walk them
// and list every page that isn't marked noindex (cart, order confirmation).
const SKIP_DIRS = new Set(['node_modules', 'templates', 'api', 'scripts', 'content', 'data', 'css', 'js', 'assets', '.git', '.vercel', '.github'])

// Pre-redesign pages still served as flat .html files.
const LEGACY_PAGES = [
  '/accessibility',
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

async function collectPages(dir, rel = '') {
  const found = []
  const entries = await readdir(dir, {withFileTypes: true})
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
    found.push(...(await collectPages(join(dir, e.name), rel + '/' + e.name)))
  }
  if (entries.some((e) => e.isFile() && e.name === 'index.html')) {
    const html = await readFile(join(dir, 'index.html'), 'utf8')
    if (!/<meta name="robots" content="noindex/.test(html)) found.push(rel || '/')
  }
  return found
}

function priorityFor(loc) {
  if (loc === '/' || loc === '/fr') return '1.0'
  if (/^(\/fr)?\/(shop|boutique)$/.test(loc)) return '0.9'
  if (/\/(products|produits)\//.test(loc)) return '0.8'
  if (/\/blog/.test(loc)) return '0.6'
  return '0.5'
}

async function main() {
  const pages = await collectPages(process.cwd())
  const urls = [...pages.sort(), ...LEGACY_PAGES].map((loc) => ({
    loc: SITE_URL + (loc === '/' ? '/' : loc),
    priority: priorityFor(loc),
    changefreq: 'weekly',
    lastmod: today,
  }))

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
