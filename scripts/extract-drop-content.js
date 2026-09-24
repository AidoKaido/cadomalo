#!/usr/bin/env node
/*
 * One-off: lift the design drop's data files into clean JSON under content/.
 * The drop ships browser globals (window.CDM); we execute them in a sandbox
 * and serialise the result. Re-runnable; overwrites content/*.json.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import vm from 'node:vm'

const DROP = join(process.cwd(), 'New', 'Cadomalo Site Phone')
const OUT = join(process.cwd(), 'content')
mkdirSync(OUT, {recursive: true})

const sandbox = {window: {}, console}
vm.createContext(sandbox)

for (const file of ['site-data.js', 'site-content.js']) {
  const src = readFileSync(join(DROP, file), 'utf8')
  vm.runInContext(src, sandbox, {filename: file})
  console.log(`[extract] ran ${file}`)
}

const C = sandbox.window.CDM
if (!C) throw new Error('window.CDM was never populated')

const write = (name, data) => {
  const p = join(OUT, `${name}.json`)
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  const n = Array.isArray(data) ? data.length : Object.keys(data).length
  console.log(`[extract] wrote content/${name}.json (${n} top-level entries)`)
}

write('catalog', C.products)
write('reviews', C.reviews)
write('ui', C.ui)
write('posts', C.posts)
write('legal', C.legal)

console.log('\n[extract] keys found on window.CDM:', Object.keys(C).join(', '))
