#!/usr/bin/env node
// One-time (and re-runnable) Brevo setup for the funnel.
//
//   BREVO_API_KEY=… node scripts/brevo-setup.js [--dry-run]
//
// Run it from a terminal where BREVO_API_KEY is set (e.g. after
// `vercel env pull .env.local` and loading it) — never paste the key in chat.
//
// Creates, if missing (matched by name, so re-running is safe):
//   - contact folder "Cadomalo"
//   - lists "Mini Discovery Kit", "Customers", "Cadomalo Newsletter"
//     (the funnel list used to be called "Routine sample": it is renamed in
//     place, so its id — env BREVO_LIST_ROUTINE — and the automation stay)
//   - contact attributes OFFER_TOKEN, OFFER_EXP, FUNNEL_EXP, PURCHASED, MAGNET (text)
//   - the 12 email templates in emails/brevo/templates.json. Each entry's
//     `brevoId` is the live template id: it is updated in place (subject,
//     name and HTML), so the automations keep pointing at it. Entries without
//     an id (or whose id is gone) fall back to matching by name, else create.
// Then prints the ids to set as Vercel env vars.
//
// Optional env: BREVO_SENDER_EMAIL (default aidora@cadomalo.com — must be a
// verified sender in Brevo), BREVO_SENDER_NAME (default "Aidora at Cadomalo").

import {readFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
const KEY = process.env.BREVO_API_KEY || process.env.CADOMALO_WEBSITE
const API = 'https://api.brevo.com/v3'
const SENDER = {
  name: process.env.BREVO_SENDER_NAME || 'Aidora at Cadomalo',
  email: process.env.BREVO_SENDER_EMAIL || 'aidora@cadomalo.com',
}
const LISTS = {
  BREVO_LIST_ROUTINE: 'Mini Discovery Kit',
  BREVO_LIST_CUSTOMERS: 'Customers',
  BREVO_LIST_NEWSLETTER: 'Cadomalo Newsletter',
}
// old list names that are renamed to the current one (same id, same automation)
const LIST_RENAMES = {'Mini Discovery Kit': ['Routine sample']}
const ATTRIBUTES = ['OFFER_TOKEN', 'OFFER_EXP', 'FUNNEL_EXP', 'PURCHASED', 'MAGNET']

if (!KEY) {
  console.error('BREVO_API_KEY is not set in this terminal. Set it as an environment variable first (do not paste it anywhere else).')
  process.exit(1)
}

async function api(method, path, body) {
  if (DRY && method !== 'GET') {
    console.log(`  [dry-run] ${method} ${path}`)
    return {id: 0}
  }
  const r = await fetch(API + path, {
    method,
    headers: {'api-key': KEY, accept: 'application/json', ...(body ? {'content-type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

async function all(path, key) {
  const out = []
  for (let offset = 0; ; offset += 50) {
    const sep = path.includes('?') ? '&' : '?'
    const page = await api('GET', `${path}${sep}limit=50&offset=${offset}`)
    const items = page[key] || []
    out.push(...items)
    if (items.length < 50) break
  }
  return out
}

async function main() {
  console.log(DRY ? 'Dry run — nothing will be created.\n' : '')
  const env = {}

  // Folder
  const folders = await all('/contacts/folders', 'folders')
  let folder = folders.find((f) => f.name === 'Cadomalo')
  if (!folder) {
    console.log('Creating folder "Cadomalo"')
    folder = {id: (await api('POST', '/contacts/folders', {name: 'Cadomalo'})).id}
  }

  // Lists
  const lists = await all('/contacts/lists', 'lists')
  for (const [envName, name] of Object.entries(LISTS)) {
    let list = lists.find((l) => l.name === name)
    if (!list) {
      const old = lists.find((l) => (LIST_RENAMES[name] || []).includes(l.name))
      if (old) {
        console.log(`Renaming list "${old.name}" (#${old.id}) to "${name}"`)
        await api('PUT', `/contacts/lists/${old.id}`, {name})
        list = old
      }
    }
    if (!list) {
      console.log(`Creating list "${name}"`)
      list = {id: (await api('POST', '/contacts/lists', {name, folderId: folder.id}))?.id}
    }
    env[envName] = list.id
  }

  // Attributes
  const attrs = (await api('GET', '/contacts/attributes')).attributes || []
  for (const name of ATTRIBUTES) {
    if (attrs.some((a) => a.name === name && a.category === 'normal')) continue
    console.log(`Creating contact attribute ${name}`)
    await api('POST', `/contacts/attributes/normal/${name}`, {type: 'text'})
  }

  // Templates
  const manifest = JSON.parse(readFileSync(join(ROOT, 'emails', 'brevo', 'templates.json'), 'utf8'))
  const existing = await all('/smtp/templates?templateStatus=true', 'templates').catch(() => [])
  const inactive = await all('/smtp/templates?templateStatus=false', 'templates').catch(() => [])
  const known = [...existing, ...inactive]
  const byName = new Map(known.map((t) => [t.name, t]))
  const byId = new Map(known.map((t) => [Number(t.id), t]))
  const ids = []
  for (const t of manifest) {
    const htmlContent = readFileSync(join(ROOT, 'emails', 'brevo', t.file), 'utf8')
    const payload = {
      templateName: t.name,
      subject: t.subject,
      htmlContent,
      sender: SENDER,
      replyTo: SENDER.email,
      isActive: true,
      ...(t.doi ? {tag: 'optin'} : {}),
    }
    const direct = t.brevoId && !byId.has(Number(t.brevoId))
      ? await api('GET', `/smtp/templates/${t.brevoId}`).catch(() => null)
      : null
    const found = (t.brevoId && byId.get(Number(t.brevoId))) || (direct && direct.id ? direct : null) || byName.get(t.name)
    let id
    if (found) {
      console.log(`Updating template #${found.id} "${found.name}"${found.name !== t.name ? ` → "${t.name}"` : ''}`)
      await api('PUT', `/smtp/templates/${found.id}`, payload)
      id = found.id
    } else {
      console.log(`Creating template "${t.name}"`)
      id = (await api('POST', '/smtp/templates', payload)).id
    }
    ids.push({id, name: t.name, subject: t.subject})
    if (t.doi) env.BREVO_DOI_TEMPLATE_ID = id
  }

  console.log('\nTemplates (use these in the Brevo automation — see emails/brevo/AUTOMATION.md):')
  for (const t of ids) console.log(`  #${t.id}  ${t.name}`)
  console.log('\nAdd these to Vercel → Settings → Environment Variables (Production + Preview):')
  for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`)
  console.log('\nAlso make sure BREVO_API_KEY and FUNNEL_SECRET are set there.')
}

main().catch((err) => {
  console.error('Brevo setup failed:', err.message)
  process.exit(1)
})
