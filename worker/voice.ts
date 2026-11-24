/**
 * Personalised voice message after a booking (ElevenLabs text-to-speech).
 *
 * Two steps so a booking never waits on ElevenLabs:
 *   1. POST /api/booking returns a short-lived signed ticket (createVoiceToken).
 *   2. The page POSTs that ticket to /api/booking/voice; the audio streams back.
 * The script is always built here from the ticket, so the endpoint can't be used
 * as a free text-to-speech service.
 * Runs as a Pages Function via functions/api/booking/voice.ts, with variables
 * and secrets set in the Cloudflare Pages project settings.
 */
export interface VoiceEnv {
  ELEVENLABS_API_KEY?: string;
  BOOKING_SIGNING_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
}

interface VoiceTicket {
  first: string;
  vehicle: string;
  /** what they asked for, e.g. "new brakes" (from the booking handler's offer list) */
  what?: string;
  exp: number;
}

const DEFAULT_VOICE_ID = "DODLEQrClDo8wCz460ld";
const MODEL_ID = "eleven_flash_v2_5"; // ElevenLabs' low-latency model
const TICKET_TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Letters, digits and simple punctuation only, single-spaced, capped. */
function speakable(value: string, max: number): string {
  return value
    .replace(/[^\p{L}\p{N} .'\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export function voiceScript(first: string, vehicle: string, what = "new brakes"): string {
  return `Hi ${first}, thank you! We got your request for ${what} on your ${vehicle}. The whole team here at Queens is excited, and we can't wait to see you at the shop!`;
}

/** Signed ticket for one booking's message. Returns "" when voice isn't configured. */
export async function createVoiceToken(
  env: VoiceEnv,
  data: { first: string; vehicle: string; what?: string },
  ttlMs = TICKET_TTL_MS,
): Promise<string> {
  if (!env.ELEVENLABS_API_KEY || !env.BOOKING_SIGNING_KEY) return "";
  const ticket: VoiceTicket = {
    first: speakable(data.first, 30),
    vehicle: speakable(data.vehicle, 60),
    what: speakable(data.what || "new brakes", 40),
    exp: Date.now() + ttlMs,
  };
  const payload = b64url(enc.encode(JSON.stringify(ticket)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env.BOOKING_SIGNING_KEY), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

async function readTicket(token: unknown, secret: string): Promise<VoiceTicket | null> {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as VoiceTicket;
    if (typeof t.first !== "string" || typeof t.vehicle !== "string" || typeof t.exp !== "number") return null;
    if (Date.now() > t.exp) return null;
    return t;
  } catch {
    return null;
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleVoice(request: Request, env: VoiceEnv): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!env.ELEVENLABS_API_KEY || !env.BOOKING_SIGNING_KEY) return json({ ok: false, error: "Voice messages aren't set up." }, 503);

  let body: { token?: unknown } = {};
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    /* falls through to the ticket check */
  }
  const ticket = await readTicket(body?.token, env.BOOKING_SIGNING_KEY);
  if (!ticket || !ticket.first || !ticket.vehicle) return json({ ok: false, error: "Invalid or expired ticket." }, 401);

  const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: voiceScript(ticket.first, ticket.vehicle, ticket.what || "new brakes"), model_id: MODEL_ID }),
  }).catch(() => null);

  if (!res || !res.ok || !res.body) {
    console.error("ElevenLabs request failed:", res?.status);
    return json({ ok: false, error: "Couldn't create the message." }, 502);
  }
  return new Response(res.body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
  });
}
