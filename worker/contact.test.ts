import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleContact, looksLikeSpam, type ContactEnv } from "./contact.ts";

const PHONE_RE = /\(224\) 635-3000/;
const ENV: ContactEnv = {
  RESEND_API_KEY: "re_test",
  BOOKING_OWNER_EMAIL: "owner@example.com, second@example.com",
  BOOKING_FROM_EMAIL: "Queens Auto <messages@example.com>",
};
const TS_ENV: ContactEnv = { ...ENV, TURNSTILE_SECRET_KEY: "ts_secret" };
const NOW = 1_800_000_000_000;
const VALID = {
  name: "Maria Lopez",
  email: "maria@example.com",
  phone: "847-555-0142",
  message: "I have a question about my car.",
  website: "",
  startedAt: NOW - 20_000,
};

type Sent = { url: string; headers: Headers; body: Record<string, unknown> | URLSearchParams };
let sent: Sent[] = [];
let resendStatus = 200;
let turnstileSuccess = true;

beforeEach(() => {
  sent = [];
  resendStatus = 200;
  turnstileSuccess = true;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) {
      sent.push({ url, headers: new Headers(init?.headers), body: init?.body as URLSearchParams });
      return Response.json({ success: turnstileSuccess });
    }
    sent.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: resendStatus });
  }) as typeof fetch;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://queensautoserviceselgin.com/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const read = async (response: Response) => ({ status: response.status, body: await response.json() as { ok: boolean; error?: string } });
const send = (body: unknown, env: ContactEnv = ENV, headers?: Record<string, string>) => handleContact(post(body, headers), env, NOW);
const resendCalls = () => sent.filter((s) => s.url === "https://api.resend.com/emails");

test("valid contact message sends one escaped email to configured recipients", async () => {
  const result = await read(await send({ ...VALID, name: "<Maria & Co>", message: "<script>alert('x')</script>" }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(sent.length, 1);
  const mail = sent[0].body as Record<string, unknown>;
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].headers.get("Authorization"), "Bearer re_test");
  assert.deepEqual(mail.to, ["owner@example.com", "second@example.com"]);
  assert.equal(mail.reply_to, "maria@example.com");
  assert.equal(mail.subject, "New website message: <Maria & Co>");
  assert.match(String(mail.html), /&lt;Maria &amp; Co&gt;/);
  assert.match(String(mail.html), /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(String(mail.html), /<script>/);
});

test("contact honeypot succeeds without sending", async () => {
  const result = await read(await send({ ...VALID, website: "bot" }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(sent.length, 0);
});

test("contact rejects a post from another website", async () => {
  const result = await send(VALID, ENV, { Origin: "https://spam.example.net" });
  assert.equal(result.status, 403);
  assert.equal(sent.length, 0);
});

test("contact validates name, email and message", async () => {
  for (const bad of [{ name: "" }, { name: "x".repeat(101) }, { email: "nope" }, { message: "1234" }, { message: "x".repeat(5001) }]) {
    assert.equal((await send({ ...VALID, ...bad })).status, 400);
  }
  assert.equal(sent.length, 0);
});

test("time trap: missing, too fast and stale submissions are refused", async () => {
  const missing = await read(await send({ ...VALID, startedAt: undefined }));
  assert.equal(missing.status, 400);
  assert.match(missing.body.error!, /reload/);
  assert.equal((await send({ ...VALID, startedAt: NOW - 1_000 })).status, 400);
  assert.equal((await send({ ...VALID, startedAt: NOW - 13 * 60 * 60 * 1000 })).status, 400);
  assert.equal((await send({ ...VALID, startedAt: "soon" })).status, 400);
  assert.equal(sent.length, 0);
  assert.equal((await send({ ...VALID, startedAt: NOW - 3_000 })).status, 200);
});

test("spam filter blocks link spam and pitches but keeps normal messages", async () => {
  const spam = [
    "Visit https://a.example and https://b.example today",
    "Check [url=https://x.example]this[/url]",
    "We can boost your SEO and get you backlinks",
    "Get your shop on the first page of Google",
    "Привет, у нас есть предложение",
  ];
  for (const message of spam) {
    const result = await read(await send({ ...VALID, message }));
    assert.equal(result.status, 400, message);
    assert.match(result.body.error!, PHONE_RE);
  }
  assert.equal((await send({ ...VALID, name: "Visit www.spam.example" })).status, 400);
  assert.equal(sent.length, 0);

  assert.equal(looksLikeSpam("Juan", "Hola, necesito cambiar las llantas. ¿Tienen cita el sábado?"), false);
  assert.equal(looksLikeSpam("Ann", "My brakes squeal, here is a photo: https://photos.example/abc"), false);
  assert.equal(looksLikeSpam("Bob", "Do you do alignments on a 2015 F-150? Seen your website, looks great."), false);
});

test("Turnstile is skipped when no secret is configured", async () => {
  assert.equal((await send(VALID)).status, 200);
  assert.equal(sent.filter((s) => s.url.includes("challenges")).length, 0);
});

test("Turnstile: missing token is refused before any email", async () => {
  const result = await read(await send(VALID, TS_ENV));
  assert.equal(result.status, 400);
  assert.match(result.body.error!, /human check/);
  assert.equal(sent.length, 0);
});

test("Turnstile: a failed token is refused", async () => {
  turnstileSuccess = false;
  const result = await send({ ...VALID, "cf-turnstile-response": "bad" }, TS_ENV);
  assert.equal(result.status, 403);
  assert.equal(resendCalls().length, 0);
});

test("Turnstile: a valid token is verified with the secret and visitor IP, then the email sends", async () => {
  const result = await send({ ...VALID, "cf-turnstile-response": "good-token" }, TS_ENV, { "CF-Connecting-IP": "203.0.113.7" });
  assert.equal(result.status, 200);
  const verify = sent.find((s) => s.url.includes("challenges.cloudflare.com"))!;
  const form = verify.body as URLSearchParams;
  assert.equal(form.get("secret"), "ts_secret");
  assert.equal(form.get("response"), "good-token");
  assert.equal(form.get("remoteip"), "203.0.113.7");
  assert.equal(resendCalls().length, 1);
});

test("missing contact email configuration returns 503 and a call number", async () => {
  const result = await read(await send(VALID, { ...ENV, RESEND_API_KEY: undefined }));
  assert.equal(result.status, 503);
  assert.match(result.body.error!, PHONE_RE);
  assert.equal(sent.length, 0);
});

test("Resend failure returns 502 and a call number", async () => {
  resendStatus = 500;
  const result = await read(await send(VALID));
  assert.equal(result.status, 502);
  assert.match(result.body.error!, PHONE_RE);
  assert.equal(sent.length, 1);
});
