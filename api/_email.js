// Branded transactional email layout (Resend). Underscore: not an endpoint.
// Palette: cream #FFF8ED, coral #F06B4F, navy #39506F, ink #29333A.
// Fonts: Fredoka / Nunito Sans from Google Fonts where the mail client
// allows web fonts, otherwise the system fallbacks.

import {escapeHtml} from './_util.js'

export const C = {cream: '#FFF8ED', coral: '#F06B4F', navy: '#39506F', ink: '#29333A', yellow: '#F6C85F', sage: '#83B59B', muted: '#6B7680'}
const BODY_FONT = `'Nunito Sans', Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`
const HEAD_FONT = `Fredoka, 'Nunito Sans', 'Trebuchet MS', Arial, sans-serif`

export function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 20px;"><tr>
<td style="background:${C.coral};border-radius:999px;mso-padding-alt:14px 30px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-family:${BODY_FONT};font-weight:800;font-size:16px;border-radius:999px;">${escapeHtml(label)}</a>
</td></tr></table>`
}

export const h1 = (t) =>
  `<h1 style="margin:0 0 14px;font-family:${HEAD_FONT};font-weight:600;font-size:26px;line-height:1.2;color:${C.navy};">${t}</h1>`
export const p = (t, extra = '') =>
  `<p style="margin:0 0 14px;font-family:${BODY_FONT};font-size:16px;line-height:1.6;color:${C.ink};${extra}">${t}</p>`
export const small = (t) =>
  `<p style="margin:0 0 8px;font-family:${BODY_FONT};font-size:13px;line-height:1.6;color:${C.muted};">${t}</p>`

export function layout({preheader = '', body, siteUrl = 'https://cadomalo.com', lang = 'en'}) {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Cadomalo</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito+Sans:wght@400;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:20px;">
<tr><td style="padding:28px 32px 4px;text-align:center;">
<a href="${siteUrl}"><img src="https://cadomalo.com/assets/logo-horizontal.png" width="200" alt="Cadomalo" style="width:200px;max-width:70%;height:auto;border:0;"></a>
</td></tr>
<tr><td style="padding:18px 32px 26px;">${body}</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #F1E6D6;text-align:center;">
<p style="margin:0;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:${C.muted};">Cadomalo · Fokebo LLC · <a href="${siteUrl}" style="color:${C.navy};">cadomalo.com</a><br>
${lang === 'fr' ? 'Une question ? Répondez simplement à cet e-mail.' : 'Questions? Just reply to this email — a real person reads it.'}</p>
</td></tr>
</table></td></tr></table>
</body></html>`
}
