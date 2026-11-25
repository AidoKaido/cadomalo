// Generates emails/brevo/*.html + emails/brevo/templates.json (the Brevo
// email sequence). Edit the copy here, then run:
//   node scripts/build-brevo-emails.js      (writes the HTML files)
//   node scripts/brevo-setup.js             (uploads them to Brevo)
import {writeFileSync, mkdirSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'emails', 'brevo')
mkdirSync(OUT, {recursive: true})

const SITE = 'https://cadomalo.com'
const C = {cream: '#FFF8ED', coral: '#F06B4F', navy: '#39506F', ink: '#29333A', yellow: '#F6C85F', sage: '#83B59B', muted: '#6B7680', line: '#F1E6D6'}
const BODY = `'Nunito Sans', Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`
const HEAD = `Fredoka, 'Nunito Sans', 'Trebuchet MS', Arial, sans-serif`

const T = '{{ contact.OFFER_TOKEN }}'
const LINK = {
  sample: `${SITE}/api/download?free=routine-sample`,
  offerPage: `${SITE}/thank-you-sample?t=${T}`,
  funnel: (product) => `${SITE}/api/funnel-checkout?product=${product}&t=${T}`,
  product: (id) => `${SITE}/api/go?p=${id}`,
  shop: `${SITE}/shop`,
  review: `${SITE}/review`,
  contact: `${SITE}/contact`,
}

// Real prices (CONTRACT.md "PRICE UPDATE").
const PRICE = {
  lab: {store: 9.99, funnel: 4.99},
  book: {store: 7.99, funnel: 4.99},
  collection: {store: 39.99, funnel: 19.99},
  routine: 9.99,
}
const usd = (n) => '$' + n.toFixed(2)
const save = ({store, funnel}) => `You save ${usd(store - funnel)} (${Math.round(((store - funnel) / store) * 100)}%)`

const h1 = (t) => `<h1 style="margin:0 0 14px;font-family:${HEAD};font-weight:600;font-size:26px;line-height:1.25;color:${C.navy};">${t}</h1>`
const h2 = (t) => `<h2 style="margin:22px 0 10px;font-family:${HEAD};font-weight:600;font-size:20px;line-height:1.3;color:${C.navy};">${t}</h2>`
const p = (t) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.65;color:${C.ink};">${t}</p>`
const small = (t) => `<p style="margin:0 0 10px;font-family:${BODY};font-size:13px;line-height:1.6;color:${C.muted};">${t}</p>`
const ul = (items) =>
  `<ul style="margin:0 0 16px;padding-left:22px;font-family:${BODY};font-size:16px;line-height:1.65;color:${C.ink};">${items.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join('')}</ul>`
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px auto 22px;"><tr>
<td align="center" style="background:${C.coral};border-radius:999px;">
<a href="${href}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-family:${BODY};font-weight:800;font-size:16px;border-radius:999px;">${label}</a>
</td></tr></table>`
const link = (href, label) => `<a href="${href}" style="color:${C.coral};font-weight:700;">${label}</a>`

// Offer box: strike-through store price, big funnel price, savings badge.
function offer({title, note = '', price, href, cta, until}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;background:${C.cream};border-radius:18px;">
<tr><td style="padding:20px 22px;text-align:center;">
<p style="margin:0 0 6px;font-family:${HEAD};font-weight:600;font-size:19px;color:${C.navy};">${title}</p>
${note ? `<p style="margin:0 0 10px;font-family:${BODY};font-size:14px;line-height:1.5;color:${C.ink};">${note}</p>` : ''}
<p style="margin:0 0 6px;font-family:${BODY};">
<span style="font-size:17px;color:${C.muted};text-decoration:line-through;">${usd(price.store)}</span>
<span style="font-family:${HEAD};font-size:34px;font-weight:600;color:${C.coral};padding-left:8px;">${usd(price.funnel)}</span></p>
<p style="margin:0 0 4px;"><span style="display:inline-block;background:${C.yellow};color:${C.ink};font-family:${BODY};font-weight:800;font-size:13px;padding:5px 12px;border-radius:999px;">${save(price)}</span></p>
${button(href, cta)}
${until ? `<p style="margin:-10px 0 0;font-family:${BODY};font-size:13px;color:${C.muted};">${until}</p>` : ''}
</td></tr></table>`
}

function layout({preheader, body, footer = 'marketing'}) {
  const foot =
    footer === 'doi'
      ? `You are receiving this because someone asked for the free Cadomalo routine pages with this address. If it was not you, simply ignore this email.`
      : `You are receiving this because you asked for the free routine pages or ordered from Cadomalo.<br><a href="{{ unsubscribe }}" style="color:${C.navy};">Unsubscribe</a> · <a href="${SITE}/privacy-policy" style="color:${C.navy};">Privacy</a>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Cadomalo</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito+Sans:wght@400;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:20px;">
<tr><td style="padding:28px 32px 4px;text-align:center;">
<a href="${SITE}"><img src="${SITE}/assets/logo-horizontal.png" width="200" alt="Cadomalo" style="width:200px;max-width:70%;height:auto;border:0;"></a>
</td></tr>
<tr><td style="padding:18px 32px 26px;">${body}</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid ${C.line};text-align:center;">
<p style="margin:0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.muted};">Cadomalo · Fokebo LLC · <a href="${SITE}" style="color:${C.navy};">cadomalo.com</a><br>${foot}</p>
</td></tr>
</table></td></tr></table>
</body></html>
`
}

const sign = p(`Warmly,<br>Aidora<br><span style="color:${C.muted};font-size:14px;">Founder of Cadomalo</span>`)
const UNTIL_LAB = 'This price is tied to your email and ends {{ contact.OFFER_EXP | default : "48 hours after you signed up" }}. After that it is back to $9.99.'
const UNTIL_FUNNEL = 'These subscriber prices are tied to your email and last until {{ contact.FUNNEL_EXP | default : "14 days after you signed up" }}.'

const templates = [
  {
    file: '00-doi-confirm.html',
    name: 'Cadomalo DOI — confirm your email',
    subject: 'Please confirm: your free routine pages are one click away',
    preheader: 'Tap the button to confirm and get your free Morning & Bedtime pages.',
    doi: true,
    body: `${h1('One click and they are yours')}
${p('Thanks for asking for the free Morning & Bedtime Routine pages! Please confirm your email address so we know it is really you.')}
${button('{{ doubleoptin }}', 'Yes, send me the pages')}
${small('If you did not ask for this, you can ignore this email — you will not hear from us again.')}`,
  },
  {
    file: '01-lead-sample.html',
    name: 'Cadomalo Lead 1 — your free routine pages',
    subject: 'Your free Morning & Bedtime Routine pages',
    preheader: 'Your download is inside, plus 3 small ways to use it tonight.',
    body: `${h1('Your free routine pages are here')}
${p('Hello,')}
${p('Thank you for joining us! Here are your 10 free pages from the Morning & Bedtime Routine Busy Book: one routine world, the star chart and a certificate to celebrate.')}
${button(LINK.sample, 'Download your free pages')}
${h2('3 ways to use them tonight')}
${ul([
  '<strong>Let your child choose.</strong> Ask them where the chart should live. Children follow what they helped build.',
  '<strong>Keep it at their eye level</strong> — on the fridge or the bedroom door, where they can tick it off themselves.',
  '<strong>Same order, every night.</strong> Celebrate one finished step, not a perfect evening. Small wins add up.',
])}
${sign}
${p(`<strong>P.S.</strong> As a thank-you for signing up, the full <strong>My Amazing Body Discovery Lab</strong> is ${usd(PRICE.lab.funnel)} instead of ${usd(PRICE.lab.store)} for the next 48 hours. ${link(LINK.offerPage, 'See what is inside →')}`)}`,
  },
  {
    file: '02-lead-visual-schedule.html',
    name: 'Cadomalo Lead 2 — the 2-minute trick',
    subject: 'The 2-minute trick that ends morning battles',
    preheader: 'Why pictures work better than reminders — and how to start tomorrow.',
    body: `${h1('The 2-minute trick that ends morning battles')}
${p('Hello again,')}
${p('Most morning battles are not about the shoes or the toothbrush. They are about a small child being told what to do, again and again, by a hurried grown-up.')}
${p('A <strong>visual schedule</strong> moves the “boss” job from you to a picture. Instead of “brush your teeth!”, you ask “what does the chart say comes next?” — and your child gets to be the one who knows.')}
${h2('Try this tomorrow (2 minutes tonight)')}
${ul([
  'Lay out the routine pages in order before bed.',
  'In the morning, point — do not repeat. Let your child say the next step out loud.',
  'When a step is done, they tick it. When the chart is done, a high five. That is it.',
])}
${p('It will not be perfect on day one — give it a few days of practice and see how it feels.')}
${offer({
  title: 'My Amazing Body Discovery Lab',
  note: 'Hands-on printable activities about how the body works, for curious kids.',
  price: PRICE.lab,
  href: LINK.offerPage,
  cta: `Get it for ${usd(PRICE.lab.funnel)}`,
  until: UNTIL_LAB,
})}
${sign}`,
  },
  {
    file: '03-lead-last-chance.html',
    name: 'Cadomalo Lead 3 — last chance Discovery Lab',
    subject: `Last chance: Discovery Lab for ${usd(PRICE.lab.funnel)}`,
    preheader: 'Your sign-up price ends soon. After that it goes back to $9.99.',
    body: `${h1('A quick reminder before it ends')}
${p('Hello,')}
${p(`When you signed up, we set aside the <strong>My Amazing Body Discovery Lab</strong> for you at ${usd(PRICE.lab.funnel)}. That price is real, it is tied to your email, and it ends {{ contact.OFFER_EXP }}.`)}
${p('No pressure at all — if it is not right for your family, just ignore this email. If you were meaning to look, now is the moment.')}
${ul([
  'Instant PDF download — print at home, US Letter and A4 included',
  'Print as many copies as your family needs',
  '30-day happiness promise: if it is not what you expected, write to us and we will make it right or refund you',
])}
${offer({title: 'My Amazing Body Discovery Lab', price: PRICE.lab, href: LINK.offerPage, cta: `Yes, get it for ${usd(PRICE.lab.funnel)}`, until: UNTIL_LAB})}
${sign}`,
  },
  {
    file: '04-lead-doctor.html',
    name: 'Cadomalo Lead 4 — scared of the doctor',
    subject: 'When your child is scared of the doctor',
    preheader: 'A gentle way to turn a scary visit into a story they already know.',
    body: `${h1('When your child is scared of the doctor')}
${p('Hello,')}
${p('It happens in so many families: a little one hiding behind a parent’s legs, eyes on the stethoscope. Not because anyone did anything wrong — just because it is new, and new can be scary.')}
${p('What helps most is <strong>knowing the story before it happens</strong>. Who will I meet? What will they do? Why do they listen to my chest? When a child has already “met” the doctor in a book, the real visit becomes the second time, not the first.')}
${p('That is why I made <strong>Medical Heroes</strong>: ten picture books, each about one person who helps us stay healthy — the doctor, the nurse, the dentist, the pharmacist, the midwife and more.')}
${offer({
  title: 'The Doctor Listens Closely',
  note: 'Start with the visit that worries them most.',
  price: PRICE.book,
  href: LINK.funnel('mh01'),
  cta: `Get this book for ${usd(PRICE.book.funnel)}`,
})}
${offer({
  title: 'Medical Heroes — all 10 books',
  note: 'Doctor, nurse, pharmacist, dentist, midwife, physiotherapist, lab scientist, psychologist, dietitian and more.',
  price: PRICE.collection,
  href: LINK.funnel('mh-bundle'),
  cta: `Get all 10 for ${usd(PRICE.collection.funnel)}`,
  until: UNTIL_FUNNEL,
})}
${sign}`,
  },
  {
    file: '05-lead-inside-mh.html',
    name: 'Cadomalo Lead 5 — inside Medical Heroes',
    subject: 'Inside Medical Heroes (4 languages)',
    preheader: 'A look inside, the questions parents ask, and our 30-day promise.',
    body: `${h1('A look inside Medical Heroes')}
${p('Hello,')}
${p(`Each Medical Heroes book is a short, warm story your child can follow from start to end, followed by colouring pages of the pages they just read. The text sits in four languages, each in its own colour, so you read the one you speak at home. ${link(LINK.product('mh-bundle'), 'See the page previews →')}`)}
${h2('Questions parents ask')}
${p('<strong>Is it accurate?</strong> Yes — simplified for small children, but never wrong.')}
${p('<strong>Will four languages confuse my child?</strong> No — you read one. The others become a fun “spot the word” game, and many families use them to keep a grandparent’s language alive.')}
${p('<strong>What if we do not love it?</strong> Our 30-day happiness promise: write to us and we will make it right or refund you.')}
${offer({title: 'Medical Heroes — all 10 books', price: PRICE.collection, href: LINK.funnel('mh-bundle'), cta: `Get all 10 for ${usd(PRICE.collection.funnel)}`, until: UNTIL_FUNNEL})}
${h2('Loved the free routine pages?')}
${p(`The full <strong>Morning & Bedtime Routine Busy Book</strong> has every routine world, more charts and certificates — 34 pages for ${usd(PRICE.routine)}.`)}
${button(LINK.product('routine'), 'See the full routine book')}
${sign}`,
  },
  {
    file: '06-lead-next-favourite.html',
    name: 'Cadomalo Lead 6 — next favourite books',
    subject: "Your child's next favourite books",
    preheader: 'Two collections, ten books each — at subscriber prices.',
    body: `${h1('Your child’s next favourite books')}
${p('Hello,')}
${p('If your child loves asking “why?”, you might enjoy our two book collections. Each book is a short story first, then colouring pages — instant PDFs you print at home as often as you like.')}
${offer({
  title: 'Human Body Wonders — all 10 books',
  note: 'Head, lungs, stomach, bones, muscles, skin, blood, eyes, ears and teeth — each told by a friendly “body friend”.',
  price: PRICE.collection,
  href: LINK.funnel('bundle'),
  cta: `Get all 10 for ${usd(PRICE.collection.funnel)}`,
})}
${offer({
  title: 'Medical Heroes — all 10 books',
  note: 'Meet the people who help us stay healthy, so the next check-up feels familiar.',
  price: PRICE.collection,
  href: LINK.funnel('mh-bundle'),
  cta: `Get all 10 for ${usd(PRICE.collection.funnel)}`,
})}
${p(`Just want to try one? Any single book from either collection is ${usd(PRICE.book.funnel)} instead of ${usd(PRICE.book.store)} — for example ${link(LINK.funnel('teeth'), 'the teeth book')} or ${link(LINK.funnel('mh07'), 'Dentists Protect Every Smile')}.`)}
${small(UNTIL_FUNNEL)}
${p('We are a small, new shop, so we do not have many reviews yet. If you buy, we would love to hear honestly how it went.')}
${sign}`,
  },
  {
    file: '07-lead-one-question.html',
    name: 'Cadomalo Lead 7 — one question',
    subject: 'One question for you',
    preheader: 'Just hit reply — I read every answer.',
    body: `${h1('One question for you')}
${p('Hello,')}
${p('I would love to know: <strong>what is your child into right now?</strong> Dinosaurs, space, feelings, the body, a new baby on the way?')}
${p('Just hit reply and tell me in a sentence. I read every answer myself, and it decides what I make next.')}
${p(`If you would like a short weekly note from me — one idea to try at home and the occasional new book — ${link(`${SITE}/blog?weekly=yes`, 'click here and I will add you')}. If not, this is the last email in this little series.`)}
${sign}`,
  },
  {
    file: '11-customer-welcome.html',
    name: 'Cadomalo Customer 1 — printing tips',
    subject: 'Your files + how to get the best prints',
    preheader: 'Where your PDFs are, and 4 tips for crisp prints at home.',
    body: `${h1('Thank you — welcome to Cadomalo!')}
${p('Hi {{ contact.FIRSTNAME | default : "there" }},')}
${p('Your download links arrived in a separate email titled <strong>“Your Cadomalo PDFs are ready to download”</strong>. Links work for 7 days, so save the files to your device or cloud as soon as you can.')}
${h2('4 tips for great prints')}
${ul([
  'Print at <strong>“Actual size” / 100%</strong>, not “Fit to page”.',
  'Choose US Letter or A4 to match your paper — both versions are included.',
  'The <strong>ink-saving</strong> version is perfect for colouring pages.',
  'Slightly thicker paper (or card stock) makes charts and certificates last.',
])}
${p(`Cannot find the email, or a link has expired? ${link(LINK.contact, 'Write to us')} or just reply — we will send fresh links.`)}
${sign}`,
  },
  {
    file: '12-customer-how-is-it-going.html',
    name: 'Cadomalo Customer 2 — how is it going',
    subject: 'How is it going so far?',
    preheader: 'A small tip to keep the new books exciting.',
    body: `${h1('How is it going so far?')}
${p('Hi {{ contact.FIRSTNAME | default : "there" }},')}
${p('A few days in, here is a tip that works well for lots of children: <strong>read the story first, colour later</strong>. Let your child pick their favourite page from the story, then print just that colouring page as a reward.')}
${p('Another one: ask your child to “teach” the book to a teddy or a grandparent. Explaining something is the best way to remember it.')}
${p('If anything is not working — a file, a print, a question — reply to this email and I will help.')}
${sign}`,
  },
  {
    file: '13-customer-review.html',
    name: 'Cadomalo Customer 3 — review request',
    subject: 'Would you tell other parents what you think?',
    preheader: 'Two minutes, and a photo if you like.',
    body: `${h1('Would you tell other parents what you think?')}
${p('Hi {{ contact.FIRSTNAME | default : "there" }},')}
${p('We are a small, new shop, and honest reviews from real families help other parents decide. Good, bad or somewhere in between — we would love to hear it. A photo of your child’s colouring (no faces needed) is a lovely bonus.')}
${button(LINK.review, 'Write a short review')}
${p('As a thank-you for taking the time, we will email you a 15% code for your next order once your review comes in — whatever you write.')}
${sign}`,
  },
  {
    file: '14-customer-cross-sell.html',
    name: 'Cadomalo Customer 4 — what next',
    subject: 'What to read next',
    preheader: 'If they enjoyed this one, here are some ideas for what comes next.',
    body: `${h1('What to read next')}
${p('Hi {{ contact.FIRSTNAME | default : "there" }},')}
${p('If your child enjoyed their first Cadomalo book, here are a few ideas for what to read or play next:')}
${ul([
  `${link(LINK.product('bundle'), 'Human Body Wonders — all 10 books')} — the whole body, one friendly story at a time.`,
  `${link(LINK.product('mh-bundle'), 'Medical Heroes — all 10 books')} — the people who keep us healthy, before the next check-up.`,
  `${link(LINK.product('routine'), 'Morning & Bedtime Routine Busy Book')} — calmer mornings and bedtimes.`,
  `${link(LINK.product('wonder-island'), 'Wonder Island')} — a printable escape room for a rainy afternoon.`,
])}
${button(LINK.shop, 'Browse the shop')}
${small('Already have them all? Thank you for supporting a small, family-run shop — it means a lot.')}
${sign}`,
  },
]

const manifest = []
for (const t of templates) {
  writeFileSync(join(OUT, t.file), layout({preheader: t.preheader, body: t.body, footer: t.doi ? 'doi' : 'marketing'}))
  manifest.push({file: t.file, name: t.name, subject: t.subject, ...(t.doi ? {doi: true} : {})})
}
writeFileSync(join(OUT, 'templates.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${manifest.length} templates to ${OUT}`)
