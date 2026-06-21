// Klaviyo subscribe endpoint.
// Posts an email to a Klaviyo list using the server-side private API.
// Requires env vars:
//   KLAVIYO_PRIVATE_KEY   — your Klaviyo private API key (server-only)
//   KLAVIYO_LIST_ID       — the list ID to subscribe new emails to
// Klaviyo's default double opt-in setting on the list (Manage list → Settings)
// controls whether a confirmation email is sent. Enable double opt-in there.

const KLAVIYO_API = 'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/'
const KLAVIYO_REVISION = '2024-10-15'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  const apiKey = process.env.KLAVIYO_PRIVATE_KEY
  const listId = process.env.KLAVIYO_LIST_ID
  if (!apiKey || !listId) {
    return res.status(500).json({error: 'Newsletter not configured on the server'})
  }

  const body = req.body || (await readJson(req))
  const email = (body?.email || '').toString().trim().toLowerCase()
  if (!isEmail(email)) {
    return res.status(400).json({error: 'Please enter a valid email address'})
  }

  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                email,
                subscriptions: {
                  email: {marketing: {consent: 'SUBSCRIBED'}},
                },
              },
            },
          ],
        },
      },
      relationships: {
        list: {data: {type: 'list', id: listId}},
      },
    },
  }

  try {
    const r = await fetch(KLAVIYO_API, {
      method: 'POST',
      headers: {
        'accept': 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        'revision': KLAVIYO_REVISION,
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
    if (r.status >= 200 && r.status < 300) {
      return res.status(200).json({ok: true})
    }
    const text = await r.text().catch(() => '')
    console.error('[klaviyo-subscribe] non-2xx:', r.status, text.slice(0, 400))
    return res.status(502).json({error: 'Newsletter signup is temporarily unavailable. Please try again later.'})
  } catch (err) {
    console.error('[klaviyo-subscribe] fetch error:', err.message)
    return res.status(502).json({error: 'Could not reach newsletter service. Please try again later.'})
  }
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254
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
