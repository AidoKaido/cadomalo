#!/usr/bin/env node
/*
 * One-off: fill the legal placeholders the design drop shipped unfilled.
 *
 * Everything knowable comes from the live site. Three facts cannot be
 * invented — company registration number, VAT number, and the French consumer
 * mediator — so the sentences carrying them are REMOVED rather than shipped
 * with visible [brackets] or plausible-looking fiction, and the gap is
 * recorded in the file's _todo key.
 *
 * Re-runnable: substitutions are idempotent.
 */
import {readFileSync, writeFileSync} from 'node:fs'

const FILE = 'content/legal.json'
const ENTITY = 'Fokebo LLC'
const ADDRESS = '501 Silverside Rd, Ste 105-291, Wilmington, DE 19809, USA'
const HOST = 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA'
const DIRECTOR = 'Aidora'  // matches the About page signature; full legal name to be confirmed
const EMAIL = 'support@cadomalo.com'

/* straight replacements */
const SUBS = [
  ['[Legal entity name]', ENTITY],
  ['[Registered address]', ADDRESS],
  ['[Hosting provider, address, phone]', HOST],
  ['[Hébergeur, adresse, téléphone]', HOST],
  ['[Name]', DIRECTOR],
  ['[Nom]', DIRECTOR],
  ['[Country/State]', 'the State of Delaware, USA'],
  ['[pays]', "de l'État du Delaware (États-Unis)"],
  /* the live site uses support@, not the drop's hello@ */
  ['hello@cadomalo.com', EMAIL],
]

/* whole sentences to drop, because the fact behind them is unknown */
const DROP = [
  /\s*Registration:\s*\[Registration number\][^.]*\./g,
  /\s*Immatriculation\s*:\s*\[Registration number\][^.]*\./g,
  /\s*En cas de litige, vous pouvez recourir gratuitement au médiateur de la consommation\s*:\s*\[nom et coordonnées du médiateur\]\./g,
]

let raw = readFileSync(FILE, 'utf8')
const data = JSON.parse(raw)

let subCount = 0
let dropCount = 0

const fix = (s) => {
  let out = s
  for (const re of DROP) {
    const before = out
    out = out.replace(re, '')
    if (out !== before) dropCount++
  }
  for (const [from, to] of SUBS) {
    if (out.includes(from)) {
      out = out.split(from).join(to)
      subCount++
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

for (const doc of data) {
  for (const lang of ['en', 'fr']) {
    for (const section of doc.sections[lang]) {
      section.h = fix(section.h)
      section.p = section.p.map(fix).filter(Boolean)
    }
  }
}

/* record what is still missing, invisibly (the generator skips _ keys) */
const out = {
  _todo: {
    note: 'Facts that could not be filled without the owner. The sentences that carried them were removed rather than shipped as [brackets] or invented.',
    missing: [
      'Company registration number (Delaware file number) — legal notice',
      'VAT / OSS number, or confirmation that none applies — legal notice',
      'Appointed French consumer mediator (name + contact) — required before selling to FR consumers',
      "Publication director full legal name — currently shown as 'Aidora', matching the About page signature; a FR legal notice expects a full legal name",
    ],
  },
  docs: data,
}

writeFileSync(FILE, JSON.stringify(out.docs, null, 2) + '\n')
writeFileSync('content/legal-todo.json', JSON.stringify(out._todo, null, 2) + '\n')

console.log(`[legal] ${subCount} substitution(s), ${dropCount} sentence(s) removed`)
const left = JSON.stringify(data).match(/\[[^\]]{3,60}\]/g) || []
console.log(left.length ? `[legal] STILL UNFILLED: ${[...new Set(left)].join(', ')}` : '[legal] no placeholders remain')
