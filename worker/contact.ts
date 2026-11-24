import { json, parseRecipients } from "./booking.ts";

/** POST /api/contact — forwards a visitor message to the shop through Resend. */
export interface ContactEnv {
  RESEND_API_KEY?: string;
  BOOKING_OWNER_EMAIL?: string;
  BOOKING_FROM_EMAIL?: string;
}

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  website?: unknown;
}

const PHONE = "(224) 635-3000";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function handleContact(request: Request, env: ContactEnv): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  let raw: ContactPayload;
  try { raw = await request.json() as ContactPayload; } catch { return json({ ok: false, error: "Invalid request format." }, 400); }
  if (!raw || typeof raw !== "object") return json({ ok: false, error: "Invalid request format." }, 400);
  if (typeof raw.website === "string" && raw.website.trim()) return json({ ok: true });

  const name = typeof raw.name === "string" ? raw.name.replace(/[\r\n\t]+/g, " ").trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const phone = typeof raw.phone === "string" ? raw.phone.trim().slice(0, 40) : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!name || name.length > 100) return json({ ok: false, error: "Please enter your name (up to 100 characters)." }, 400);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (message.length < 5 || message.length > 5000) return json({ ok: false, error: "Please enter a message between 5 and 5000 characters." }, 400);

  const recipients = parseRecipients(env.BOOKING_OWNER_EMAIL);
  if (!env.RESEND_API_KEY || !env.BOOKING_FROM_EMAIL || !recipients.length) {
    return json({ ok: false, error: `Messages aren't available right now. Please call ${PHONE}.` }, 503);
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const html = `<h1>New website message</h1><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>${phone ? `<p><strong>Phone:</strong> ${safePhone}</p>` : ""}<p><strong>Message:</strong><br>${safeMessage}</p>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.BOOKING_FROM_EMAIL, to: recipients, reply_to: email, subject: `New website message: ${name}`, html, text: `Name: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}\n\n${message}` }),
    });
    if (!response.ok) return json({ ok: false, error: `We couldn't send your message. Please call ${PHONE}.` }, 502);
  } catch {
    return json({ ok: false, error: `We couldn't send your message. Please call ${PHONE}.` }, 502);
  }
  return json({ ok: true });
}
