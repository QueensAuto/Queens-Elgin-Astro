import { createVoiceToken, type VoiceEnv } from "./voice.ts";

/**
 * POST /api/booking — the landing-page booking forms (/brakes, /wheel-alignment,
 * /auto-repair-discount). The form's `service` picks the offer wording.
 * Emails the shop (lead) and the customer (confirmation) through Resend.
 * Modelled on the K&A Remodeling worker; same env names.
 */
export interface BookingEnv extends VoiceEnv {
  RESEND_API_KEY?: string;
  BOOKING_OWNER_EMAIL?: string;
  BOOKING_FROM_EMAIL?: string;
}

interface BookingPayload {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  vehicle_year?: unknown;
  vehicle_make?: unknown;
  vehicle_model?: unknown;
  service?: unknown;
  comments?: unknown;
  date?: unknown;
  time?: unknown;
  page_url?: unknown;
  /** honeypot: hidden from people, bots fill it in */
  website?: unknown;
}

const SHOP = {
  name: "Queens Auto Service",
  phone: "(224) 635-3000",
  tel: "tel:+12246353000",
  address: "1303 Dundee Ave, Elgin, IL 60120",
  hours: "Mon–Fri 7:30 AM – 6 PM, Sat 7:30 AM – 4 PM",
  site: "https://queensautoserviceselgin.com",
};

/**
 * What each landing page is selling, keyed by the form's lower-cased `service`.
 * lead: owner-email wording ("New brake booking"); noun: customer wording
 * ("your brake service request"); voice: what the voice message says they asked for.
 */
const OFFERS: Record<string, { label: string; lead: string; noun: string; voice: string }> = {
  brakes: { label: "Brake pads & rotors — $369 per axle", lead: "brake", noun: "brake service", voice: "new brakes" },
  "wheel alignment": { label: "Wheel alignment — $35 off (front-end or four-wheel)", lead: "wheel alignment", noun: "wheel alignment", voice: "a wheel alignment" },
  "auto repair": {
    label: "Auto repair — up to $45 off ($15 off $100+, $30 off $200+, $45 off $300+)",
    lead: "auto repair",
    noun: "auto repair",
    voice: "auto repair",
  },
};
function offerFor(service: string) {
  return OFFERS[service.toLowerCase()] ?? { label: service || "Service appointment", lead: "service", noun: "service", voice: "service" };
}

/**
 * BOOKING_OWNER_EMAIL may list several lead recipients, comma-separated
 * ("a@gmail.com, b@gmail.com"). Invalid entries and duplicates are dropped.
 */
function parseRecipients(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (value || "").split(",")) {
    const addr = raw.trim();
    const key = addr.toLowerCase();
    if (!EMAIL_RE.test(addr) || seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

const NAVY = "#0b1121";
const BLUE = "#0a79c8";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Single-line field: trimmed, capped, no line breaks (keeps email headers clean). */
function clean(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max = 1000): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "2026-11-25" → "Wed, Nov 25, 2026"; null when not a real date. */
function formatDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Browsers send Origin on cross-site POSTs; refuse other websites (local dev allowed). */
function sameSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (o.hostname === "localhost" || o.hostname === "127.0.0.1") return true;
    return o.host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function sendResendEmail(
  apiKey: string,
  email: { from: string; to: string[]; reply_to?: string; subject: string; html: string; text: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(email),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: data.message || data.name || `Resend returned ${res.status}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function emailShell(badge: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background-color:#eef1f5; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f5; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#ffffff; border:1px solid #dfe4ea; border-radius:12px; overflow:hidden;">
        <tr><td style="height:4px; background-color:${BLUE}; font-size:0; line-height:0;">&nbsp;</td></tr>
        <tr><td style="background-color:${NAVY}; padding:22px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="color:#ffffff; font-size:19px; font-weight:800; font-style:italic; letter-spacing:-0.01em;">${SHOP.name}</td>
            <td align="right"><span style="display:inline-block; padding:4px 10px; border-radius:999px; background-color:${BLUE}; color:#ffffff; font-size:12px; font-weight:700;">${escapeHtml(badge)}</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px;">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 28px; background-color:#f6f8fa; border-top:1px solid #dfe4ea; font-size:12px; line-height:1.55; color:#64748b;">${footerHtml}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function row(label: string, valueHtml: string, last = false): string {
  const border = last ? "" : " border-bottom:1px solid #e5e9ef;";
  return `<tr>
    <td style="padding:11px 16px; width:130px; font-size:13px; color:#64748b; background-color:#f6f8fa;${border}">${label}</td>
    <td style="padding:11px 16px; font-size:14px; color:#0f172a;${border}">${valueHtml}</td>
  </tr>`;
}

function button(href: string, label: string, primary = true): string {
  const style = primary
    ? `background-color:${BLUE}; color:#ffffff;`
    : "background-color:#eef1f5; color:#0f172a;";
  return `<a href="${href}" style="display:inline-block; padding:12px 20px; ${style} font-size:14px; font-weight:600; text-decoration:none; border-radius:999px;">${label}</a>`;
}

export async function handleBooking(request: Request, env: BookingEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!sameSite(request)) return json({ ok: false, error: "Forbidden." }, 403);

  let raw: BookingPayload;
  try {
    raw = (await request.json()) as BookingPayload;
  } catch {
    return json({ ok: false, error: "Invalid request format." }, 400);
  }
  if (!raw || typeof raw !== "object") return json({ ok: false, error: "Invalid request format." }, 400);

  // Honeypot: succeed quietly so bots don't retry or burn email quota.
  if (clean(raw.website, 200)) {
    console.warn("Booking honeypot triggered");
    return json({ ok: true });
  }

  const firstName = clean(raw.first_name, 80);
  const lastName = clean(raw.last_name, 80);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const email = clean(raw.email, 160);
  const phone = clean(raw.phone, 40);
  const year = clean(raw.vehicle_year, 4);
  const make = clean(raw.vehicle_make, 60);
  const model = clean(raw.vehicle_model, 80);
  const service = clean(raw.service, 80) || "Brakes";
  const offer = offerFor(service);
  const comments = cleanMultiline(raw.comments, 1000);
  const date = clean(raw.date, 10);
  const time = clean(raw.time, 20);
  const pageUrl = clean(raw.page_url, 300);

  const digits = phone.replace(/\D/g, "");
  const phoneDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const friendlyDate = formatDate(date);

  if (phoneDigits.length !== 10) {
    return json({ ok: false, error: "Please enter a complete 10-digit phone number." }, 400);
  }
  if (!firstName || !EMAIL_RE.test(email) || !year || !make || !model || !friendlyDate || !time) {
    return json({ ok: false, error: "Please fill in every required field with a valid email address." }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  const ownerEmails = parseRecipients(env.BOOKING_OWNER_EMAIL);
  const fromEmail = env.BOOKING_FROM_EMAIL;
  if (!apiKey || !ownerEmails.length || !fromEmail) {
    return json({ ok: false, error: `Online booking isn't available right now. Please call us at ${SHOP.phone}.` }, 503);
  }

  const formattedPhone = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
  const customerTel = `tel:+1${phoneDigits}`;
  const vehicle = `${year} ${make} ${model}`;
  const when = `${friendlyDate} at ${time}`;

  // ---------------------------------------------------------------- shop
  const ownerText = [
    `New ${offer.lead} booking — ${vehicle}`,
    "",
    `Name: ${fullName}`,
    `Phone: ${formattedPhone}`,
    `Email: ${email}`,
    `Vehicle: ${vehicle}`,
    `Service: ${offer.label}`,
    `Requested: ${when}`,
    comments ? `Notes: ${comments}` : "",
    pageUrl ? `Page: ${pageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ownerBody = `
    <h1 style="margin:0 0 6px; font-size:22px; line-height:1.25;">New ${escapeHtml(offer.lead)} booking</h1>
    <p style="margin:0 0 22px; font-size:15px; color:#475569;"><strong style="color:#0f172a;">${escapeHtml(vehicle)}</strong> · ${escapeHtml(when)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9ef; border-radius:8px; border-collapse:separate; overflow:hidden; margin-bottom:20px;">
      ${row("Name", `<strong>${escapeHtml(fullName)}</strong>`)}
      ${row("Phone", `<a href="${customerTel}" style="color:${BLUE}; font-weight:600; text-decoration:none;">${escapeHtml(formattedPhone)}</a>`)}
      ${row("Email", `<a href="mailto:${escapeHtml(email)}" style="color:#0f172a;">${escapeHtml(email)}</a>`)}
      ${row("Vehicle", escapeHtml(vehicle))}
      ${row("Service", escapeHtml(offer.label))}
      ${row("Requested", `<strong>${escapeHtml(when)}</strong>`, true)}
    </table>
    ${
      comments
        ? `<div style="padding:14px 16px; background-color:#f6f8fa; border-left:3px solid ${BLUE}; border-radius:4px; margin-bottom:22px; font-size:14px; line-height:1.55;">
             <div style="font-size:12px; font-weight:700; color:#64748b; margin-bottom:6px;">Customer notes</div>
             ${escapeHtml(comments).replace(/\n/g, "<br/>")}
           </div>`
        : ""
    }
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px;">${button(customerTel, `Call ${escapeHtml(formattedPhone)}`)}</td>
      <td>${button(`mailto:${escapeHtml(email)}`, "Reply by email", false)}</td>
    </tr></table>`;

  const ownerResult = await sendResendEmail(apiKey, {
    from: fromEmail,
    to: ownerEmails,
    reply_to: email,
    subject: `New ${offer.lead} booking: ${fullName} — ${vehicle}, ${when}`,
    html: emailShell(
      "New booking",
      ownerBody,
      pageUrl ? `Booked from <a href="${escapeHtml(pageUrl)}" style="color:#64748b;">${escapeHtml(pageUrl)}</a>` : `Booked from ${SHOP.site}`,
    ),
    text: ownerText,
  });

  if (!ownerResult.ok) {
    console.error("Resend owner email failed:", ownerResult.error);
    return json({ ok: false, error: `We couldn't send your booking right now. Please call us at ${SHOP.phone}.` }, 502);
  }

  // ------------------------------------------------------------- customer
  const customerText = [
    `Hi ${firstName},`,
    "",
    `Thanks for booking with ${SHOP.name}. We received your ${offer.noun} request for ${when}, and we'll be in touch to confirm your appointment.`,
    "",
    "Your request:",
    `- Vehicle: ${vehicle}`,
    `- Service: ${offer.label}`,
    `- Requested time: ${when}`,
    comments ? `- Your notes: ${comments}` : "",
    "",
    `Need to change something? Call us at ${SHOP.phone} (${SHOP.hours}).`,
    "",
    `${SHOP.name}`,
    SHOP.address,
  ]
    .filter(Boolean)
    .join("\n");

  const customerBody = `
    <h1 style="margin:0 0 10px; font-size:22px; line-height:1.25;">Thanks, ${escapeHtml(firstName)} — we got your booking.</h1>
    <p style="margin:0 0 22px; font-size:15px; line-height:1.6; color:#334155;">
      We received your ${escapeHtml(offer.noun)} request for <strong>${escapeHtml(when)}</strong>. We'll be in touch to confirm your appointment.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9ef; border-radius:8px; border-collapse:separate; overflow:hidden; margin-bottom:22px;">
      ${row("Vehicle", escapeHtml(vehicle))}
      ${row("Service", escapeHtml(offer.label))}
      ${row("Requested", `<strong>${escapeHtml(when)}</strong>`, !comments)}
      ${comments ? row("Your notes", escapeHtml(comments).replace(/\n/g, "<br/>"), true) : ""}
    </table>
    <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#334155;">
      Need to change the time or ask a question? Give us a call.
    </p>
    ${button(SHOP.tel, `Call ${SHOP.phone}`)}
    <p style="margin:14px 0 0; font-size:13px; line-height:1.55; color:#64748b;">${SHOP.address}<br/>${SHOP.hours}</p>`;

  // Sent independently: a typo in the customer's address must never lose the lead.
  // No reply_to, so replies go to the from address (avoids freemail reply-to spam flags).
  const customerResult = await sendResendEmail(apiKey, {
    from: fromEmail,
    to: [email],
    subject: `Your ${offer.noun} request — ${SHOP.name}`,
    html: emailShell("Request received", customerBody, `${SHOP.name} · ${SHOP.address} · <a href="${SHOP.site}" style="color:#64748b;">queensautoserviceselgin.com</a>`),
    text: customerText,
  });
  if (!customerResult.ok) console.warn("Resend customer confirmation failed:", customerResult.error);

  // ticket for the personalised voice message (empty when voice isn't configured)
  const voiceToken = await createVoiceToken(env, { first: firstName, vehicle, what: offer.voice }).catch(() => "");
  return json(voiceToken ? { ok: true, id: ownerResult.id, voiceToken } : { ok: true, id: ownerResult.id });
}
