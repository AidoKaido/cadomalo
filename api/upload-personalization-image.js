// Personalization image upload.
//
// Client sends raw image bytes as the request body with:
//   Content-Type: image/<jpeg|png|webp|...>
//   X-Filename:   "original-name.jpg"
//
// We forward the bytes to Sanity's asset upload endpoint and return the public URL.
//
// Required env vars:
//   SANITY_PROJECT_ID   — e.g. 8ue8kmgn
//   SANITY_DATASET      — e.g. production
//   SANITY_API_TOKEN    — a token with write access to assets (server-only)
//
// Limits: max 10 MB per upload, image/* only.

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '10mb',
  },
}

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }

  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const token = process.env.SANITY_API_TOKEN
  if (!projectId || !dataset || !token) {
    return res.status(500).json({error: 'Asset upload not configured on the server'})
  }

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(400).json({error: 'Unsupported image type'})
  }

  const filename = (req.headers['x-filename'] || 'upload').toString().slice(0, 80).replace(/[^\w.\- ]+/g, '_')

  let body
  try {
    body = await readRawBody(req, MAX_BYTES)
  } catch (err) {
    if (err.code === 'TOO_LARGE') {
      return res.status(413).json({error: 'Image too large. Max 10 MB.'})
    }
    return res.status(400).json({error: 'Could not read upload'})
  }
  if (!body.length) {
    return res.status(400).json({error: 'Empty upload'})
  }

  const url = `https://${projectId}.api.sanity.io/v2024-01-01/assets/images/${dataset}?filename=${encodeURIComponent(filename)}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${token}`,
      },
      body,
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data?.document?.url) {
      console.error('[upload] Sanity error', r.status, JSON.stringify(data).slice(0, 400))
      return res.status(502).json({error: 'Upload failed. Please try again.'})
    }
    return res.status(200).json({
      url: data.document.url,
      assetId: data.document._id,
      filename,
    })
  } catch (err) {
    console.error('[upload] fetch error:', err.message)
    return res.status(502).json({error: 'Upload failed. Please try again.'})
  }
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) {
        const err = new Error('Body too large')
        err.code = 'TOO_LARGE'
        reject(err)
        try { req.destroy() } catch {}
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
