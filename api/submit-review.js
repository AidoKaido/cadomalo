// Review submission. Writes a pending reviewSubmission document to Sanity.
// Admin moderates in Sanity Studio. Approved reviews are then attached to
// the product's reviews[] array (manually in Studio, or via a sync step).
//
// Required env vars:
//   SANITY_PROJECT_ID
//   SANITY_DATASET
//   SANITY_API_TOKEN   — write access
//
// Expected POST body:
//   { productSlug, productId, author, rating, title?, body, orderId? }

const SANITY_REVISION = 'v2024-01-01'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }

  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const token = process.env.SANITY_API_TOKEN
  if (!projectId || !dataset || !token) {
    return res.status(500).json({error: 'Reviews are temporarily unavailable.'})
  }

  const body = req.body || (await readJson(req))
  const productSlug = (body?.productSlug || '').toString().trim().slice(0, 120)
  const author = (body?.author || '').toString().trim().slice(0, 80)
  const rating = Math.max(1, Math.min(5, Math.round(Number(body?.rating) || 0)))
  const title = (body?.title || '').toString().trim().slice(0, 120)
  const reviewBody = (body?.body || '').toString().trim().slice(0, 2000)
  const orderId = (body?.orderId || '').toString().trim().slice(0, 80) || null
  const productId = (body?.productId || '').toString().trim().slice(0, 120) || null

  if (!productSlug) return res.status(400).json({error: 'Missing product'})
  if (!author) return res.status(400).json({error: 'Please add your name'})
  if (!rating) return res.status(400).json({error: 'Please choose a rating'})
  if (!reviewBody || reviewBody.length < 20) {
    return res.status(400).json({error: 'Please write at least a sentence about your experience'})
  }

  const doc = {
    _type: 'reviewSubmission',
    productSlug,
    productId,
    author,
    rating,
    title,
    body: reviewBody,
    orderId,
    status: 'pending',
    submittedAt: new Date().toISOString(),
  }

  try {
    const r = await fetch(`https://${projectId}.api.sanity.io/${SANITY_REVISION}/data/mutate/${dataset}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({mutations: [{create: doc}]}),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('[submit-review] Sanity', r.status, JSON.stringify(data).slice(0, 400))
      return res.status(502).json({error: 'Could not save your review. Try again later.'})
    }
    return res.status(200).json({ok: true, id: data?.results?.[0]?.id || null})
  } catch (err) {
    console.error('[submit-review] fetch error:', err.message)
    return res.status(502).json({error: 'Could not save your review. Try again later.'})
  }
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}
