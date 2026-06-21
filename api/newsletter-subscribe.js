/**
 * Newsletter signup — adds the email to a Resend Audience.
 *
 * Env vars:
 *   RESEND_API_KEY       — already set for transactional email
 *   RESEND_AUDIENCE_ID   — UUID of the Audience to add to (create one at https://resend.com/audiences)
 *
 * Resend's free tier covers Audiences (subscriber list storage). Sending
 * marketing email from the audience is metered against the free 100/day
 * outbound limit — fine for early-stage volume.
 *
 * This endpoint is idempotent — Resend treats duplicate email submissions
 * as a no-op for an existing contact in the audience.
 */

const RESEND_KEY = process.env.RESEND_API_KEY
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!RESEND_KEY || !AUDIENCE_ID) {
    // Diagnostic — surface which env var is missing so we can tell whether
    // RESEND_AUDIENCE_ID isn't set vs has a typo'd name. Remove after fix.
    return res.status(503).json({
      error: 'Newsletter is not configured yet',
      _debug: {
        hasResendKey: !!RESEND_KEY,
        hasAudienceId: !!AUDIENCE_ID,
        audienceIdLength: AUDIENCE_ID ? AUDIENCE_ID.length : 0,
        envKeysWithResend: Object.keys(process.env).filter(k => k.toLowerCase().includes('resend') || k.toLowerCase().includes('audience')),
      },
    })
  }

  const body = req.body || (await readJson(req))
  const email = (body?.email || '').toString().trim().toLowerCase()
  if (!isEmail(email)) {
    return res.status(400).json({error: 'Please enter a valid email address'})
  }

  try {
    const r = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({email, unsubscribed: false}),
    })
    // 200 = created, 422 (or similar) usually means already subscribed — treat as success.
    if (r.ok || r.status === 422) {
      return res.status(200).json({ok: true})
    }
    const text = await r.text().catch(() => '')
    console.error('[newsletter-subscribe] non-2xx:', r.status, text.slice(0, 400))
    return res.status(502).json({error: 'Newsletter signup is temporarily unavailable. Please try again later.'})
  } catch (err) {
    console.error('[newsletter-subscribe] fetch error:', err.message)
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
