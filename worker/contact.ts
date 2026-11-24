/**
 * POST /api/contact — forwards general website messages to the shop inbox.
 *
 * Spam defences, in order (cheapest first):
 *   1. honeypot `website` field  → pretend success, send nothing
 *   2. cross-site Origin         → 403
 *   3. field validation          → 400
 *   4. time trap (`startedAt`)   → 400 when sent < 3 s after the visitor
 *                                  started, or from a page open > 12 h
 *   5. content filter            → 400 for link spam / SEO-crypto pitches
 *   6. Cloudflare Turnstile      → 403 unless the token verifies; only
 *                                  enforced when TURNSTILE_SECRET_KEY is set
 * Every rejection a real person could hit says so and gives the phone
 * number, so a genuine customer is never silently dropped.
 */
export interface ContactEnv {
  RESEND_API_KEY?: string;
  BOOKING_OWNER_EMAIL?: string;
  BOOKING_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  website?: unknown;
  startedAt?: unknown;
  "cf-turnstile-response"?: unknown;
}

const PHONE = "(224) 635-3000";
const SHOP_EMAIL = "service@queensautoservices.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_FILL_MS = 3_000;
const MAX_PAGE_AGE_MS = 12 * 60 * 60 * 1000;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const LINK_RE = /(https?:\/\/|www\.)/gi;
const MARKUP_LINK_RE = /\[url=|\[link=|<a\s+href/i;
const PITCH_RE =
  /\b(seo|backlinks?|guest posts?|crypto(currency)?|bitcoin|casino|viagra|cialis|forex|rank(ing)? (your|on|higher)|first page of google|web ?design(ing)? (services|agency)|lead generation|link building)\b/i;
const CYRILLIC_RE = /[Ѐ-ӿ]{3,}/;

const SPAM_BLOCKED = `Our spam filter blocked this message. Please call ${PHONE} or email ${SHOP_EMAIL}.`;
const HUMAN_CHECK = `Please complete the quick human check and send again, or call ${PHONE}.`;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function recipients(value: string | undefined): string[] {
  const seen = new Set<string>();
  return (value || "").split(",").map((email) => email.trim()).filter((email) => {
    const key = email.toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sameSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return url.host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Link spam, SEO/crypto pitches and Cyrillic spam. Exported for tests. */
export function looksLikeSpam(name: string, message: string): boolean {
  if (LINK_RE.test(name)) return true;
  LINK_RE.lastIndex = 0;
  const links = message.match(LINK_RE)?.length ?? 0;
  if (links > 1) return true;
  if (MARKUP_LINK_RE.test(message)) return true;
  if (PITCH_RE.test(message) || PITCH_RE.test(name)) return true;
  if (CYRILLIC_RE.test(message) || CYRILLIC_RE.test(name)) return true;
  return false;
}

async function turnstileOk(token: string, secret: string, ip: string | null): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

export async function handleContact(request: Request, env: ContactEnv, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!sameSite(request)) return json({ ok: false, error: "Forbidden." }, 403);

  let raw: ContactPayload;
  try {
    raw = await request.json() as ContactPayload;
  } catch {
    return json({ ok: false, error: "Invalid request format." }, 400);
  }
  if (!raw || typeof raw !== "object") return json({ ok: false, error: "Invalid request format." }, 400);
  if (clean(raw.website)) return json({ ok: true });

  const name = clean(raw.name);
  const email = clean(raw.email);
  const phone = clean(raw.phone).slice(0, 40);
  const message = clean(raw.message);
  if (!name || name.length > 100) return json({ ok: false, error: "Please enter your name (100 characters or fewer)." }, 400);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (message.length < 5 || message.length > 5000) {
    return json({ ok: false, error: "Your message must be between 5 and 5,000 characters." }, 400);
  }

  const startedAt = Number(raw.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return json({ ok: false, error: `Please reload the page and try again, or call ${PHONE}.` }, 400);
  }
  const elapsed = now - startedAt;
  if (elapsed < MIN_FILL_MS) return json({ ok: false, error: "Please wait a few seconds and send again." }, 400);
  if (elapsed > MAX_PAGE_AGE_MS) {
    return json({ ok: false, error: `This page has been open a long time. Please reload it and try again, or call ${PHONE}.` }, 400);
  }

  if (looksLikeSpam(name, message)) {
    console.warn("Contact spam filter triggered");
    return json({ ok: false, error: SPAM_BLOCKED }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = clean(raw["cf-turnstile-response"]);
    if (!token) return json({ ok: false, error: HUMAN_CHECK }, 400);
    let verified = false;
    try {
      verified = await turnstileOk(token, env.TURNSTILE_SECRET_KEY, request.headers.get("CF-Connecting-IP"));
    } catch {
      return json({ ok: false, error: `We couldn't verify the human check. Please call ${PHONE}.` }, 503);
    }
    if (!verified) return json({ ok: false, error: HUMAN_CHECK }, 403);
  }

  const apiKey = env.RESEND_API_KEY;
  const ownerEmails = recipients(env.BOOKING_OWNER_EMAIL);
  const fromEmail = env.BOOKING_FROM_EMAIL;
  if (!apiKey || !ownerEmails.length || !fromEmail) {
    return json({ ok: false, error: `Messages aren't available right now. Please call ${PHONE}.` }, 503);
  }

  const html = `<h1>New website message</h1>
<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}
<p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: ownerEmails,
        reply_to: email,
        subject: `New website message: ${name.replace(/[\r\n\t]+/g, " ")}`,
        html,
        text: `New website message\n\nName: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}\n\nMessage:\n${message}`,
      }),
    });
    if (!response.ok) {
      return json({ ok: false, error: `We couldn't send your message. Please call ${PHONE}.` }, 502);
    }
  } catch {
    return json({ ok: false, error: `We couldn't send your message. Please call ${PHONE}.` }, 502);
  }
  return json({ ok: true });
}
