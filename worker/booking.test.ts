import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleBooking, type BookingEnv } from "./booking.ts";

const ENV: BookingEnv = {
  RESEND_API_KEY: "re_test",
  BOOKING_OWNER_EMAIL: "owner@example.com",
  BOOKING_FROM_EMAIL: "Queens Auto Service <bookings@example.com>",
};

const VALID = {
  first_name: "Maria",
  last_name: "Lopez",
  email: "maria@example.com",
  phone: "(224) 555-0142",
  vehicle_year: "2018",
  vehicle_make: "Honda",
  vehicle_model: "Civic",
  service: "Brakes",
  comments: "Grinding on the front left",
  date: "2026-11-25",
  time: "10:30 AM",
  page_url: "https://queensautoserviceselgin.com/brakes",
  website: "",
};

type Sent = { to: string[]; reply_to?: string; subject: string; html: string; text: string; from: string };
let sent: Sent[] = [];
let resendStatus: number[] = [];

beforeEach(() => {
  sent = [];
  resendStatus = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const status = resendStatus.shift() ?? 200;
    return new Response(JSON.stringify(status === 200 ? { id: `em_${sent.length}` } : { message: "boom" }), { status });
  }) as typeof fetch;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://queensautoserviceselgin.com/api/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as { ok: boolean; error?: string } });

test("only POST is accepted", async () => {
  const res = await handleBooking(new Request("https://queensautoserviceselgin.com/api/booking"), ENV);
  assert.equal(res.status, 405);
});

test("a valid booking emails the shop, then the customer, and returns ok", async () => {
  const { status, body } = await read(await handleBooking(post(VALID), ENV));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(sent.length, 2);
  const [owner, customer] = sent;
  assert.deepEqual(owner.to, ["owner@example.com"]);
  assert.equal(owner.reply_to, "maria@example.com");
  assert.match(owner.subject, /Maria Lopez/);
  assert.match(owner.subject, /2018 Honda Civic/);
  assert.match(owner.text, /\(224\) 555-0142/);
  assert.match(owner.text, /Wed, Nov 25, 2026/);
  assert.match(owner.text, /10:30 AM/);
  assert.match(owner.text, /Grinding on the front left/);
  assert.deepEqual(customer.to, ["maria@example.com"]);
  assert.equal(customer.reply_to, undefined);
  assert.match(customer.html, /Maria/);
  assert.match(customer.text, /Wed, Nov 25, 2026/);
  assert.match(customer.text, /\(224\) 635-3000/);
});

test("the honeypot silently succeeds without sending anything", async () => {
  const { status, body } = await read(await handleBooking(post({ ...VALID, website: "http://spam.example" }), ENV));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(sent.length, 0);
});

test("missing required fields are rejected with a plain message", async () => {
  for (const field of ["first_name", "email", "vehicle_year", "vehicle_make", "vehicle_model", "date", "time"]) {
    const { status, body } = await read(await handleBooking(post({ ...VALID, [field]: "" }), ENV));
    assert.equal(status, 400, field);
    assert.ok(body.error && body.error.length > 10, field);
  }
  assert.equal(sent.length, 0);
});

test("an invalid email or a short phone number is rejected", async () => {
  assert.equal((await handleBooking(post({ ...VALID, email: "maria@" }), ENV)).status, 400);
  const short = await read(await handleBooking(post({ ...VALID, phone: "555-0142" }), ENV));
  assert.equal(short.status, 400);
  assert.match(short.body.error!, /10-digit/);
});

test("a +1 country code is accepted", async () => {
  assert.equal((await handleBooking(post({ ...VALID, phone: "+1 224 555 0142" }), ENV)).status, 200);
});

test("a malformed date is rejected", async () => {
  assert.equal((await handleBooking(post({ ...VALID, date: "next tuesday" }), ENV)).status, 400);
});

test("invalid JSON is a 400, not a crash", async () => {
  assert.equal((await handleBooking(post("{nope"), ENV)).status, 400);
});

test("posts from another website are refused", async () => {
  const res = await handleBooking(post(VALID, { Origin: "https://evil.example" }), ENV);
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
});

test("a same-site Origin header is accepted", async () => {
  const res = await handleBooking(post(VALID, { Origin: "https://queensautoserviceselgin.com" }), ENV);
  assert.equal(res.status, 200);
});

test("unconfigured email returns 503 and tells the visitor to call", async () => {
  const { status, body } = await read(await handleBooking(post(VALID), { ...ENV, RESEND_API_KEY: undefined }));
  assert.equal(status, 503);
  assert.match(body.error!, /\(224\) 635-3000/);
  assert.equal(sent.length, 0);
});

test("if the shop email fails the visitor is told, and the customer isn't emailed", async () => {
  resendStatus = [500];
  const { status, body } = await read(await handleBooking(post(VALID), ENV));
  assert.equal(status, 502);
  assert.match(body.error!, /\(224\) 635-3000/);
  assert.equal(sent.length, 1);
});

test("a failed customer confirmation does not fail the booking", async () => {
  resendStatus = [200, 422];
  const { status, body } = await read(await handleBooking(post(VALID), ENV));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test("submitted text is HTML-escaped in both emails", async () => {
  await handleBooking(post({ ...VALID, first_name: "<img src=x onerror=alert(1)>", comments: "<script>x</script>" }), ENV);
  for (const e of sent) {
    assert.ok(!e.html.includes("<img src=x"), "name not escaped");
    assert.ok(!e.html.includes("<script>x"), "comments not escaped");
  }
});

test("header injection in the name can't add recipients or headers", async () => {
  await handleBooking(post({ ...VALID, first_name: "Maria\r\nBcc: victim@example.com" }), ENV);
  assert.ok(!/[\r\n]/.test(sent[0].subject), "newline in subject");
});

test("a booking returns a voice ticket when voice messages are configured", async () => {
  const res = await handleBooking(post(VALID), { ...ENV, ELEVENLABS_API_KEY: "sk_test", BOOKING_SIGNING_KEY: "k" });
  const body = (await res.json()) as { ok: boolean; voiceToken?: string };
  assert.equal(body.ok, true);
  assert.match(body.voiceToken ?? "", /^[\w-]+\.[\w-]+$/);
});

test("no voice ticket when voice messages aren't configured", async () => {
  const body = (await (await handleBooking(post(VALID), ENV)).json()) as { voiceToken?: string };
  assert.equal(body.voiceToken, undefined);
});
