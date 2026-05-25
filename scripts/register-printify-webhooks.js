// Idempotent: ensures Printify webhooks point at the Vercel STAGING deploy hook
// so any product change in Printify rebuilds staging (not production).
// Runs during `npm run build`. Skips silently if env vars missing.

const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN
const STAGING_HOOK =
  process.env.PRINTIFY_WEBHOOK_TARGET ||
  'https://api.vercel.com/v1/integrations/deploy/prj_F841MaslQWoPn14BJn0uIf5TfdTV/ksH3fgib3Q'

const EVENTS = [
  'product:publish:started',
  'product:publish:succeeded',
  'product:publish:failed',
  'product:deleted',
]

async function main() {
  if (!PRINTIFY_TOKEN) {
    console.log('[printify-webhooks] PRINTIFY_API_TOKEN not set, skipping')
    return
  }

  const shops = await api('/shops.json')
  if (!Array.isArray(shops) || shops.length === 0) {
    console.log('[printify-webhooks] no shops returned, skipping')
    return
  }

  for (const shop of shops) {
    const shopId = shop.id
    let existing
    try {
      existing = await api(`/shops/${shopId}/webhooks.json`)
    } catch (err) {
      console.warn(`[printify-webhooks] shop ${shopId} (${shop.title}): cannot list webhooks (${err.message}) — skipping`)
      continue
    }

    const byTopic = new Map()
    for (const w of existing || []) byTopic.set(w.topic, w)

    for (const topic of EVENTS) {
      const current = byTopic.get(topic)
      if (current && current.url === STAGING_HOOK) {
        continue // already correct
      }
      if (current && current.url !== STAGING_HOOK) {
        try {
          await api(`/shops/${shopId}/webhooks/${current.id}.json`, 'DELETE')
          console.log(`[printify-webhooks] shop ${shopId}: removed stale ${topic} → ${current.url}`)
        } catch (err) {
          console.warn(`[printify-webhooks] shop ${shopId}: failed to delete stale ${topic}: ${err.message}`)
          continue
        }
      }
      try {
        await api(`/shops/${shopId}/webhooks.json`, 'POST', {topic, url: STAGING_HOOK})
        console.log(`[printify-webhooks] shop ${shopId} (${shop.title}): registered ${topic}`)
      } catch (err) {
        console.warn(`[printify-webhooks] shop ${shopId}: failed to register ${topic}: ${err.message}`)
      }
    }
  }
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`https://api.printify.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PRINTIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return null
  return res.json()
}

main().catch((err) => {
  console.warn('[printify-webhooks] non-fatal error:', err.message)
  process.exit(0)
})
