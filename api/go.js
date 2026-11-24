// Stable product links for emails: /api/go?p=<product id>[&lang=fr]
// → 302 to the product page, whatever its slug becomes. Unknown → /shop.

import {loadCatalog, findProduct, slugify} from './_catalog.js'

export default async function handler(req, res) {
  const id = String(req.query?.p || '')
  const fr = req.query?.lang === 'fr'
  let to = fr ? '/fr/boutique' : '/shop'
  try {
    const p = findProduct(await loadCatalog(), id)
    if (p && p.source === 'site' && !p.hidden) to = fr ? `/fr/produits/${slugify(p.titleFr || p.title)}` : `/products/${p.slug}`
  } catch {}
  res.statusCode = 302
  res.setHeader('Location', to)
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.end()
}

