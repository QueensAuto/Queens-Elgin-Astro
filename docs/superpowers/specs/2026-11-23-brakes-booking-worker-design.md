# /brakes booking — Cloudflare Worker + on-page confirmation

Date: 2026-11-23
Status: approved 2026-11-23 (owner: "build it"; email values supplied later)

## Intent
The /brakes booking form stops posting to n8n and stops redirecting to a thank-you page.
It posts to a Cloudflare Worker that emails the shop and the customer through Resend, and
the visitor stays on the page: confetti, then "Thank you, {first name}" with a note to check
their email for a confirmation. The owner is leaving n8n and no longer sends GTM tracking
from this form.

## Decided by owner
- No n8n: the form no longer calls the n8n webhook (no audio clip, no coupon).
- No GTM tracking from the form: drop the `generate_lead` and `purchase` dataLayer pushes.
- Endpoint `queensautoserviceselgin.com/api/booking`, same shape as the K&A Remodeling site.
- Same env names as K&A: `BOOKING_OWNER_EMAIL`, `BOOKING_FROM_EMAIL` (variables), `RESEND_API_KEY` (secret).

## Approaches
- **Standalone Worker on a route — chosen.** A small Worker (`worker/`, own `wrangler.jsonc`)
  bound to `queensautoserviceselgin.com/api/booking*`. The live site's hosting is untouched.
- Move the whole site onto Workers static assets (the K&A setup). Rejected: changes hosting of
  a live site for one endpoint.
- Pages Function. Rejected: depends on how the site is hosted, which isn't confirmed.

## Design
**Worker** (`worker/booking.ts`, modelled on K&A's): POST only, JSON body, honeypot field
(silently succeeds), validation (first name, valid email, 10-digit phone, vehicle year/make/model,
date, time), owner lead email (reply-to customer, tap-to-call), customer confirmation email
(appointment summary, $369-per-axle brake service, shop address/hours/phone), Queens branding.
Customer email failure never fails the lead. Missing config → 503 with "please call (224) 635-3000".
`wrangler.jsonc` has the route and `keep_vars: true` so deploys never overwrite the dashboard
variables. Unit-tested with `node --test` (mocked Resend).

**Form** (`BookingForm.astro`): posts to `/api/booking`; on success swaps the form card for a
confirmation panel — confetti (canvas-confetti, skipped under reduced motion), "Thank you,
{first name}! Your booking request is on its way.", "Check {email} for a confirmation email",
and the date/time they picked. On failure: stays on the form, keeps their answers, shows the
error with a call button. Removes the n8n webhook, the dataLayer pushes and the redirect.

**Cleanup:** delete `src/pages/brakes/thank-you.astro` (it only existed for the redirect and the
n8n audio/coupon). Local dev: Astro proxies `/api/booking` to `wrangler dev`.

## Not in scope
- Other n8n forms on the site (`customer-details`, `tire-installation`, the `/api/webhook` proxy).
- Turnstile/rate limiting (honeypot only, like K&A) — can follow.
- Deploying: the owner deploys (`npx wrangler deploy` in `worker/`); nothing is pushed.

## Needs the owner
- Queens values for `BOOKING_FROM_EMAIL` / `BOOKING_OWNER_EMAIL`, and a Resend-verified sending
  domain for queensautoserviceselgin.com.
