#!/usr/bin/env node
/* Dev check: follow the @import chain from css/style.css exactly as a browser
   resolves it (relative to each importing file), then assert that the custom
   properties the pages actually use are defined somewhere in the flattened CSS.
   Catches the class of bug where a stylesheet 200s but its imports do not. */
import {readFileSync, existsSync} from 'node:fs'
import {resolve, dirname} from 'node:path'

function flatten(file, seen = new Set(), depth = 0) {
  if (seen.has(file)) return ''
  seen.add(file)
  const pad = '  '.repeat(depth)
  if (!existsSync(file)) {
    console.log(`${pad}MISSING -> ${file}`)
    return ''
  }
  console.log(`${pad}loaded  ${file.replace(process.cwd(), '.')}`)
  const css = readFileSync(file, 'utf8')
  let out = ''
  const re = /@import\s+url\((['"]?)([^'")]+)\1\)\s*;/g
  let m
  while ((m = re.exec(css))) {
    const spec = m[2]
    if (/^https?:/.test(spec)) {
      console.log(`${'  '.repeat(depth + 1)}remote  ${spec}`)
      continue
    }
    out += flatten(resolve(dirname(file), spec), seen, depth + 1)
  }
  return out + css
}

console.log('=== import chain from css/style.css ===')
const all = flatten(resolve('css/style.css'))

const needed = [
  '--cream', '--blue-600', '--coral-500', '--ink-900',
  '--font-display', '--font-body',
  '--radius-pill', '--radius-lg', '--shadow-card', '--shadow-button',
  '--space-4', '--space-9', '--fs-display-1', '--fs-h2',
  '--ease-standard', '--lift-hover', '--type-body', '--type-button',
  '--surface-band-mint', '--surface-band-blush', '--surface-band-butter',
  '--surface-band-peach', '--surface-band-blue',
]

console.log('\n=== tokens the stylesheet consumes ===')
let bad = 0
for (const t of needed) {
  const defined = all.includes(`${t}:`)
  if (!defined) bad++
  console.log(`  ${defined ? 'defined  ' : 'UNDEFINED'} ${t}`)
}

/* Also surface any var() the stylesheet uses that nothing defines. */
const used = new Set()
for (const m of all.matchAll(/var\((--[\w-]+)/g)) used.add(m[1])
const undef = [...used].filter((t) => !all.includes(`${t}:`))

console.log(`\n=== every var() used but never defined ===`)
if (undef.length === 0) console.log('  none')
else undef.forEach((t) => console.log(`  UNDEFINED ${t}`))

console.log(`\n${bad || undef.length ? 'PROBLEMS FOUND' : 'CSS CHAIN OK'}`)
process.exitCode = bad || undef.length ? 1 : 0
