// PDF delivery from the private Vercel Blob store.
//
//   GET /api/download?t=<signed token {k: blob pathname, sid, n, exp}>
//       Valid for 7 days (signed by api/_stripe.js buildDownloads).
//   GET /api/download?free=routine-sample
//       The free lead magnet: public, no token.
//
// Delivery: a presigned blob URL valid for 5 minutes (302), or — if
// presigning is not available for the store — the file is streamed through
// this function with the read-write token.
//
// Env: BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is
// connected to the project).
//
// The plan's "5 downloads" cap is not enforced: there is no counter store.
// Links expire after 7 days and are tied to one order.

import {Readable} from 'node:stream'
import {get, issueSignedToken, presignUrl} from '@vercel/blob'
import {loadCatalog, findProduct, FREE_IDS, slugify} from './_catalog.js'
import {verifyToken, clientIp, makeRateLimiter} from './_util.js'

const limited = makeRateLimiter(60, 10 * 60 * 1000)

// Stable product links for emails: /api/go?p=<id>[&lang=fr] is rewritten here
// (vercel.json) so it doesn't cost a separate function on the Hobby plan.
async function productRedirect(req, res) {
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

export default async function handler(req, res) {
  if (req.query?.p && !req.query?.t && !req.query?.free) return productRedirect(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET')
    return res.status(405).send('Method not allowed')
  }
  if (limited(clientIp(req))) return page(res, 429, 'Too many downloads in a short time — please try again in a few minutes.')
  if (!process.env.BLOB_READ_WRITE_TOKEN) return page(res, 503, 'Downloads are being set up. Please reply to your order email and we will send your files right away.')

  let key = null
  let name = null
  const q = req.query || {}

  if (q.free) {
    const catalog = await loadCatalog().catch(() => [])
    const p = findProduct(catalog, String(q.free))
    if (!p || !FREE_IDS.has(p.id) || !p.files?.length) return page(res, 404, 'This free download could not be found.')
    const f = p.files[Math.min(p.files.length - 1, Math.max(0, parseInt(q.i, 10) || 0))]
    key = f.key
    name = `${p.id}.pdf`
  } else {
    const payload = verifyToken(String(q.t || ''), 'd')
    if (!payload || !payload.k) return page(res, 400, 'This download link is not valid.')
    if (Date.now() / 1000 > payload.exp) {
      return page(res, 410, 'This download link has expired (links last 7 days). Reply to your order email or write to support@cadomalo.com and we will send fresh links.')
    }
    key = String(payload.k)
    name = String(payload.n || key.split('/').pop())
  }
  name = name.replace(/[^\w.\-]+/g, '-')

  // 1) Presigned URL (no file bytes through the function).
  try {
    const signed = await issueSignedToken({pathname: key, operations: ['get'], validUntil: Date.now() + 5 * 60 * 1000})
    const {presignedUrl} = await presignUrl(signed, {operation: 'get', pathname: key, access: 'private'})
    res.setHeader('Cache-Control', 'no-store')
    res.statusCode = 302
    res.setHeader('Location', presignedUrl)
    return res.end()
  } catch (err) {
    console.warn('[download] presign unavailable, streaming instead:', err.message)
  }

  // 2) Stream it.
  try {
    const r = await get(key, {access: 'private'})
    if (!r || r.statusCode !== 200 || !r.stream) return page(res, 404, 'File not found. Please write to support@cadomalo.com.')
    res.statusCode = 200
    res.setHeader('Content-Type', r.blob.contentType || 'application/pdf')
    if (r.blob.size) res.setHeader('Content-Length', String(r.blob.size))
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    if (req.method === 'HEAD') return res.end()
    Readable.fromWeb(r.stream).pipe(res)
  } catch (err) {
    console.error('[download] blob get failed:', key, err.message)
    return page(res, 502, 'We could not fetch your file just now. Please try again, or write to support@cadomalo.com.')
  }
}

// Small branded HTML page for errors (people reach this from an email).
function page(res, status, message) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download — Cadomalo</title><link rel="stylesheet" href="/css/style.css">
<style>body{margin:0;background:#FFF8ED;color:#29333A;font-family:"Nunito Sans",Nunito,system-ui,sans-serif}
.box{max-width:520px;margin:12vh auto;padding:32px 24px;background:#fff;border-radius:20px;text-align:center;box-shadow:0 6px 24px rgba(57,80,111,.08)}
h1{font-family:Fredoka,"Nunito Sans",sans-serif;color:#39506F;font-size:24px;margin:0 0 12px}
a.btn{display:inline-block;margin-top:16px;background:#F06B4F;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700}</style>
</head><body><div class="box"><img src="/assets/logo.png" alt="Cadomalo" width="160" style="height:auto"><h1>${status < 400 ? 'Your download' : 'Hmm, a small hiccup'}</h1>
<p>${message}</p><a class="btn" href="/contact">Contact us</a></div></body></html>`)
}
