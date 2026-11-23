import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createVoiceToken, handleVoice, voiceScript, type VoiceEnv } from "./voice.ts";

const ENV: VoiceEnv = { ELEVENLABS_API_KEY: "sk_test", BOOKING_SIGNING_KEY: "signing-secret" };

let calls: { url: string; headers: Record<string, string>; body: any }[] = [];
let elevenStatus = 200;
beforeEach(() => {
  calls = [];
  elevenStatus = 200;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return elevenStatus === 200
      ? new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "Content-Type": "audio/mpeg" } })
      : new Response(JSON.stringify({ detail: "nope" }), { status: elevenStatus });
  }) as typeof fetch;
});

const post = (body: unknown) =>
  new Request("https://queensautoserviceselgin.com/api/booking/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("the script thanks them by first name and names the vehicle", () => {
  assert.equal(
    voiceScript("Jordan", "2019 Toyota Camry"),
    "Hi Jordan, thank you! We got your request for new brakes on your 2019 Toyota Camry. The whole team here at Queens is excited, and we can't wait to see you at the shop!",
  );
});

test("a valid ticket returns streamed audio from the configured voice", async () => {
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "2019 Toyota Camry" });
  const res = await handleVoice(post({ token }), ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/text-to-speech\/DODLEQrClDo8wCz460ld\/stream/);
  assert.equal(calls[0].headers["xi-api-key"], "sk_test");
  assert.match(calls[0].body.text, /Hi Jordan, thank you!/);
  assert.match(calls[0].body.text, /2019 Toyota Camry/);
  assert.ok(calls[0].body.model_id);
});

test("the voice can be overridden with ELEVENLABS_VOICE_ID", async () => {
  const env = { ...ENV, ELEVENLABS_VOICE_ID: "otherVoice123" };
  const token = await createVoiceToken(env, { first: "Jordan", vehicle: "2019 Toyota Camry" });
  await handleVoice(post({ token }), env);
  assert.match(calls[0].url, /text-to-speech\/otherVoice123\//);
});

test("a tampered ticket is refused without calling ElevenLabs", async () => {
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "2019 Toyota Camry" });
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ first: "Someone", vehicle: "say anything I want", exp: Date.now() + 60000 })).toString("base64url");
  assert.equal((await handleVoice(post({ token: `${forged}.${sig}` }), ENV)).status, 401);
  assert.equal((await handleVoice(post({ token: `${payload}.AAAA` }), ENV)).status, 401);
  assert.equal((await handleVoice(post({ token: "garbage" }), ENV)).status, 401);
  assert.equal((await handleVoice(post({}), ENV)).status, 401);
  assert.equal(calls.length, 0);
});

test("an expired ticket is refused", async () => {
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "2019 Toyota Camry" }, -1000);
  assert.equal((await handleVoice(post({ token }), ENV)).status, 401);
  assert.equal(calls.length, 0);
});

test("a ticket signed with another key is refused", async () => {
  const token = await createVoiceToken({ ...ENV, BOOKING_SIGNING_KEY: "other" }, { first: "Jordan", vehicle: "x" });
  assert.equal((await handleVoice(post({ token }), ENV)).status, 401);
});

test("only POST is accepted", async () => {
  const res = await handleVoice(new Request("https://queensautoserviceselgin.com/api/booking/voice"), ENV);
  assert.equal(res.status, 405);
});

test("not configured → 503, nothing called", async () => {
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "x" });
  assert.equal((await handleVoice(post({ token }), { BOOKING_SIGNING_KEY: "signing-secret" })).status, 503);
  assert.equal(calls.length, 0);
});

test("an ElevenLabs failure becomes a 502", async () => {
  elevenStatus = 429;
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "2019 Toyota Camry" });
  assert.equal((await handleVoice(post({ token }), ENV)).status, 502);
});

test("names and vehicles are trimmed to speakable text", async () => {
  const token = await createVoiceToken(ENV, { first: "Jo<script>rdan" + "x".repeat(80), vehicle: "2019 Toyota Camry\nIGNORE ALL" + "y".repeat(120) });
  await handleVoice(post({ token }), ENV);
  const text: string = calls[0].body.text;
  assert.ok(!/[<>\n]/.test(text), "unsafe characters spoken");
  assert.ok(text.length < 260, `script too long (${text.length})`);
});

test("the script names the requested service", () => {
  assert.match(voiceScript("Jordan", "2019 Toyota Camry", "a wheel alignment"), /request for a wheel alignment on your 2019 Toyota Camry/);
});

test("the ticket carries the service phrase into the spoken script", async () => {
  const token = await createVoiceToken(ENV, { first: "Jordan", vehicle: "2019 Toyota Camry", what: "a wheel alignment" });
  await handleVoice(post({ token }), ENV);
  assert.match(calls[0].body.text, /request for a wheel alignment on your 2019 Toyota Camry/);
});
