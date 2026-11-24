// Brevo (Sendinblue) API v3 helpers. (Underscore prefix: not an endpoint.)
//
// Env vars:
//   BREVO_API_KEY (or CADOMALO_WEBSITE) — API key (Brevo → SMTP & API → API keys)
//   BREVO_LIST_ROUTINE     — numeric id of the list "Routine sample" (funnel leads)
//   BREVO_LIST_CUSTOMERS   — numeric id of the list "Customers"
//   BREVO_LIST_NEWSLETTER  — numeric id of the list "Newsletter"
//   BREVO_DOI_TEMPLATE_ID  — numeric id of the double opt-in confirmation template
// scripts/brevo-setup.js creates all of these and prints the ids.

const API = 'https://api.brevo.com/v3'

const brevoKey = () => process.env.BREVO_API_KEY || process.env.CADOMALO_WEBSITE || ""
export const brevoConfigured = () => !!brevoKey()
export const listId = (name) => {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function brevo(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'api-key': brevoKey(),
      accept: 'application/json',
      ...(body ? {'content-type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text().catch(() => '')
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return {ok: r.ok, status: r.status, data}
}

// Existing contact or null.
export async function getContact(email) {
  const r = await brevo('GET', `/contacts/${encodeURIComponent(email)}`)
  return r.ok ? r.data : null
}

// Double opt-in: Brevo emails a confirmation link; the contact is only added
// to `listIdValue` once they click it (GDPR-friendly).
export async function doubleOptIn({email, list, attributes, redirectionUrl}) {
  const templateId = parseInt(process.env.BREVO_DOI_TEMPLATE_ID || '', 10)
  if (!templateId) {
    // No DOI template configured: add directly (single opt-in) rather than lose the lead.
    return upsertContact({email, attributes, listIds: [list]})
  }
  return brevo('POST', '/contacts/doubleOptinConfirmation', {
    email,
    attributes,
    includeListIds: [list],
    templateId,
    redirectionUrl,
  })
}

export async function upsertContact({email, attributes, listIds}) {
  return brevo('POST', '/contacts', {
    email,
    attributes,
    listIds: (listIds || []).filter(Boolean),
    updateEnabled: true,
  })
}

export async function updateContact(email, patch) {
  return brevo('PUT', `/contacts/${encodeURIComponent(email)}`, patch)
}
