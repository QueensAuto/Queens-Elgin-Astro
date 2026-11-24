# /brakes booking — Cloudflare Pages Functions + on-page confirmation

Date: 2026-11-23
Status: approved 2026-11-23 (owner: "build it"; email values supplied later)

## Intent
The /brakes booking form stops posting to n8n and stops redirecting to a thank-you page.
It posts to a Cloudflare Pages Function that emails the shop and the customer through Resend, and
the visitor stays on the page: confetti, then "Thank you, {first name}" with a note to check
their email for a confirmation. The owner is leaving n8n and no longer sends GTM tracking
from this form.

## Decided by owner
- No n8n: the form no longer calls the n8n webhook (no audio clip, no coupon).
- No GTM tracking from the form: drop the `generate_lead` and `purchase` dataLayer pushes.
- Endpoint `queensautoserviceselgin.com/api/booking`, same shape as the K&A Remodeling site.
- Same env names as K&A: `BOOKING_OWNER_EMAIL`, `BOOKING_FROM_EMAIL` (variables), `RESEND_API_KEY` (secret).

## Hosting
The site is hosted on Cloudflare Pages and builds from Git. The files in `functions/` route
`/api/booking` and `/api/booking/voice` to the shared handlers in `worker/`.

## Design
**Booking handler** (`worker/booking.ts`, modelled on K&A's): POST only, JSON body, honeypot field
(silently succeeds), validation (first name, valid email, 10-digit phone, vehicle year/make/model,
date, time), owner lead email (reply-to customer, tap-to-call), customer confirmation email
(appointment summary, $369-per-axle brake service, shop address/hours/phone), Queens branding.
Customer email failure never fails the lead. Missing config → 503 with "please call (224) 635-3000".
Configure production variables and secrets in the Cloudflare Pages project settings. Unit-tested
with `node --test` (mocked Resend).

**Form** (`BookingForm.astro`): posts to `/api/booking`; on success swaps the form card for a
confirmation panel — confetti (canvas-confetti, skipped under reduced motion), "Thank you,
{first name}! Your booking request is on its way.", "Check {email} for a confirmation email",
and the date/time they picked. On failure: stays on the form, keeps their answers, shows the
error with a call button. Removes the n8n webhook, the dataLayer pushes and the redirect.

**Cleanup:** delete `src/pages/brakes/thank-you.astro` (it only existed for the redirect and the
n8n audio/coupon). In local development, put the bindings in the git-ignored `.dev.vars` at
the repository root. Run `npm run worker:dev` to start Pages on port 8799, where Astro proxies
`/api/booking` and `/api/booking/voice`.

## Not in scope
- Other n8n forms on the site (`customer-details`, `tire-installation`, the `/api/webhook` proxy).
- Turnstile/rate limiting (honeypot only, like K&A) — can follow.
- Deploying this change. Cloudflare Pages bundles the Functions during its Git deployment.

## Production setup

In the existing Queens Auto Pages project, open **Settings → Variables and Secrets**
for **Production**. Save the bindings before deploying to production. Use the
existing Astro build command and `dist` output directory.
- Production bindings `BOOKING_FROM_EMAIL`, `BOOKING_OWNER_EMAIL`, `RESEND_API_KEY`,
  `BOOKING_SIGNING_KEY`, and `ELEVENLABS_API_KEY`, plus a Resend-verified sending domain.
  `ELEVENLABS_VOICE_ID` can override the default voice.

On Windows, generate a fresh signing key and copy it to the clipboard in PowerShell.
Paste the generated value into the Cloudflare secret `BOOKING_SIGNING_KEY`.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" | Set-Clipboard
```
