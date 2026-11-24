# Brevo automations — click-by-click

Two automations: the **lead sequence** (7 emails after someone asks for the free routine pages) and the
**customer sequence** (4 emails after a purchase). About 10 minutes in total.

## Before you start (once)

1. In Vercel → Settings → Environment Variables, add `BREVO_API_KEY` (Production + Preview).
   Never paste the key into a chat.
2. On your computer, in the website folder, with the key available as an environment variable, run:
   `node scripts/brevo-setup.js`
   It creates the lists **Routine sample**, **Customers**, **Newsletter**, the contact attributes
   **OFFER_TOKEN, OFFER_EXP, FUNNEL_EXP, PURCHASED**, and uploads the 12 email templates.
   It prints lines like `BREVO_LIST_ROUTINE=7` — add each of them to Vercel as an environment variable.
   You can run it again any time; it updates the templates instead of duplicating them.
3. Brevo → **Senders, domains & dedicated IPs**: check that `aidora@cadomalo.com` is a verified sender
   and that the domain `cadomalo.com` is authenticated (DKIM/DMARC). Otherwise emails land in spam.
4. Add `FUNNEL_SECRET` in Vercel: any long random string (40+ characters). Do not change it later — doing so
   breaks offer and download links already sent.

## Automation 1 — "Routine sample" lead sequence

1. Brevo → **Automations** → **Create an automation** → **Create from scratch** (custom workflow).
2. Name it `Lead — Routine sample`.
3. **Entry point / trigger:** *Contact added to a list* → choose **Routine sample**.
   (With double opt-in, contacts are only added after they click the confirmation email — that is what we want.)
4. **Exit condition** (Settings of the workflow → *Exit criteria* / *Stop the workflow when*):
   *Contact attribute* **PURCHASED** *is not empty*. This stops the sales emails as soon as someone buys.
   (Buyers are also added to the Customers list, which starts Automation 2.)
5. Add the steps in this order. For each **Send an email** step choose *Use an existing template* and pick the
   template by name:

| Step | Type | Setting |
|---|---|---|
| 1 | Send an email | `Cadomalo Lead 1 — your free routine pages` |
| 2 | Wait / delay | **1 day** |
| 3 | Send an email | `Cadomalo Lead 2 — the 2-minute trick` |
| 4 | Wait / delay | **20 hours** (not 1 day — the $4.99 offer ends 48 h after sign-up, so this must go out before that) |
| 5 | Send an email | `Cadomalo Lead 3 — last chance Discovery Lab` |
| 6 | Wait / delay | **2 days** |
| 7 | Send an email | `Cadomalo Lead 4 — scared of the doctor` |
| 8 | Wait / delay | **2 days** |
| 9 | Send an email | `Cadomalo Lead 5 — inside Medical Heroes` |
| 10 | Wait / delay | **3 days** |
| 11 | Send an email | `Cadomalo Lead 6 — next favourite books` |
| 12 | Wait / delay | **3 days** |
| 13 | Send an email | `Cadomalo Lead 7 — one question` |
| 14 | Wait / delay | **2 days** |
| 15 | Condition (if/else) | *Has clicked a link in email* `Cadomalo Lead 7 — one question`, link contains `weekly=yes` |
| 16 | YES branch: Add to list | **Newsletter** |
| 17 | NO branch | End |

6. **Activate** the automation (top right).

Timing check: Lead 1 at sign-up, Lead 2 at +24 h, Lead 3 at +44 h (the offer ends at +48 h), Lead 4 day 4,
Lead 5 day 6, Lead 6 day 9, Lead 7 day 12. The book and collection prices in emails 4–6 stay valid for 14 days
after sign-up (that date is in each contact's `FUNNEL_EXP`).

## Automation 2 — "Customers" after purchase

The website adds every buyer to **Customers** (and fills `PURCHASED`) automatically. The download email itself is
sent by the website the moment they pay — these are the follow-ups.

1. **Create an automation** → from scratch → name it `Customer — after purchase`.
2. **Trigger:** *Contact added to a list* → **Customers**.
3. Steps:

| Step | Type | Setting |
|---|---|---|
| 1 | Wait / delay | **1 hour** |
| 2 | Send an email | `Cadomalo Customer 1 — printing tips` |
| 3 | Wait / delay | **3 days** |
| 4 | Send an email | `Cadomalo Customer 2 — how is it going` |
| 5 | Wait / delay | **4 days** |
| 6 | Send an email | `Cadomalo Customer 3 — review request` |
| 7 | Wait / delay | **7 days** |
| 8 | Send an email | `Cadomalo Customer 4 — what next` |

4. Workflow settings → allow a contact to enter only **once** (so a second purchase does not restart it).
5. **Activate**.

## The review thank-you code

Email "Customer 3" promises a 15% code to everyone who writes a review — whatever they write. Create it once in
Stripe → Products → Coupons: a 15% coupon with a promotion code (e.g. `THANKYOU15`). When you approve or reject a
review in Sanity Studio, email that code to the reviewer. (Reviews written because of an incentive should be
labelled as such on the site if you ever show the incentive publicly.)

## Testing

1. Open `/free-routine-sample` on staging, sign up with your own address.
2. Click the confirmation email → you land on `/thank-you-sample`.
3. In Brevo → Contacts, your contact is on **Routine sample** with `OFFER_TOKEN` filled.
4. Email 1 arrives; its download button opens the free PDF.
5. Make a Stripe test purchase with the same address → you move to **Customers**, `PURCHASED` is filled and
   the lead sequence stops.
