import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const FILE = join(process.cwd(), 'js', 'pixels.js')

const REPLACEMENTS = [
  {placeholder: 'YOUR_FB_PIXEL_ID',        env: 'FB_PIXEL_ID'},
  {placeholder: 'YOUR_TIKTOK_PIXEL_ID',    env: 'TIKTOK_PIXEL_ID'},
  {placeholder: 'YOUR_PINTEREST_TAG_ID',   env: 'PINTEREST_TAG_ID'},
  {placeholder: 'G-XXXXXXXXXX',            env: 'GA4_ID'},
]

async function main() {
  let src = await readFile(FILE, 'utf8')
  let touched = 0
  for (const {placeholder, env} of REPLACEMENTS) {
    const value = process.env[env]
    if (!value) {
      console.log(`[pixels] ${env} not set — leaving ${placeholder} placeholder (pixel will be skipped at runtime)`)
      continue
    }
    if (!src.includes(placeholder)) {
      console.log(`[pixels] ${placeholder} not found in pixels.js — skipping ${env}`)
      continue
    }
    src = src.split(placeholder).join(value)
    touched++
    console.log(`[pixels] injected ${env} → ${value.slice(0, 4)}…`)
  }
  if (touched > 0) {
    await writeFile(FILE, src, 'utf8')
    console.log(`[pixels] wrote ${touched} replacements to ${FILE}`)
  } else {
    console.log('[pixels] no replacements made (no env vars set)')
  }
}

main().catch((err) => {
  console.error('[pixels] failed:', err)
  process.exit(0)
})
