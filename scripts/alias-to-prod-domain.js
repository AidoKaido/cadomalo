#!/usr/bin/env node
/*
 * Post-build step: alias the just-built deployment to cadomalo.com.
 * Only runs for production builds (VERCEL_ENV=production).
 * Needs VERCEL_TOKEN (a personal access token) set in Vercel env vars.
 * Workaround for a persistent issue where the custom domain doesn't
 * auto-claim the latest production deployment on this project.
 */

const env = process.env
const TARGET_DOMAIN = 'cadomalo.com'
const PROJECT_ID = 'prj_F841MaslQWoPn14BJn0uIf5TfdTV'
const TEAM_ID = 'team_iQpzDhMKA3hYpct90Sk10eRe'

if (env.VERCEL_ENV !== 'production') {
  console.log('[alias] not a production build, skipping')
  process.exit(0)
}
if (!env.VERCEL_TOKEN) {
  console.warn('[alias] VERCEL_TOKEN not set — skipping alias step')
  process.exit(0)
}
if (!env.VERCEL_URL) {
  console.warn('[alias] VERCEL_URL not set — skipping alias step')
  process.exit(0)
}

const deploymentUrl = env.VERCEL_URL
const headers = {
  Authorization: `Bearer ${env.VERCEL_TOKEN}`,
  'Content-Type': 'application/json',
}

async function main() {
  const res = await fetch(
    `https://api.vercel.com/v2/deployments/${deploymentUrl}/aliases?teamId=${TEAM_ID}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({alias: TARGET_DOMAIN}),
    }
  )
  const body = await res.text()
  if (!res.ok) {
    console.error(`[alias] FAILED (${res.status}): ${body.slice(0, 400)}`)
    process.exit(1)
  }
  console.log(`[alias] ✓ ${TARGET_DOMAIN} → ${deploymentUrl}`)
}

main().catch((e) => {
  console.error('[alias] error:', e.message)
  process.exit(1)
})
