import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleContact, type ContactEnv } from "./contact.ts";

const ENV: ContactEnv = { RESEND_API_KEY: "re_test", BOOKING_OWNER_EMAIL: "owner@example.com, second@example.com", BOOKING_FROM_EMAIL: "Queens Auto Service <messages@example.com>" };
const VALID = { name: "Taylor <Admin>", email: "taylor@example.com", phone: "224-555-0111", message: "Please help me <soon> & thanks.", website: "" };
let requests: { url: string; authorization: string | null; body: Record<string, unknown> }[] = [];
let resendStatus = 200;

beforeEach(() => {
  requests = [];
  resendStatus = 200;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: resendStatus });
  }) as typeof fetch;
});

const post = (body: unknown) => new Request("https://queensautoserviceselgin.com/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const result = async (response: Response) => ({ status: response.status, body: await response.json() as { ok: boolean; error?: string } });

test("valid message sends one escaped owner email with visitor reply-to", async () => {
  const { status, body } = await result(await handleContact(post(VALID), ENV));
  assert.equal(status, 200); assert.equal(body.ok, true); assert.equal(requests.length, 1);
  const sent = requests[0];
  assert.equal(sent.url, "https://api.resend.com/emails"); assert.equal(sent.authorization, "Bearer re_test");
  assert.deepEqual(sent.body.to, ["owner@example.com", "second@example.com"]);
  assert.equal(sent.body.reply_to, VALID.email); assert.equal(sent.body.subject, "New website message: Taylor <Admin>");
  assert.match(String(sent.body.html), /Taylor &lt;Admin&gt;/); assert.match(String(sent.body.html), /&lt;soon&gt; &amp; thanks\./);
});

test("honeypot succeeds without sending", async () => {
  const { status, body } = await result(await handleContact(post({ ...VALID, website: "filled by bot" }), ENV));
  assert.equal(status, 200); assert.equal(body.ok, true); assert.equal(requests.length, 0);
});

test("invalid names, emails, and message lengths return 400", async () => {
  for (const invalid of [{ ...VALID, name: "" }, { ...VALID, name: "n".repeat(101) }, { ...VALID, email: "bad" }, { ...VALID, message: "no" }, { ...VALID, message: "x".repeat(5001) }]) {
    assert.equal((await handleContact(post(invalid), ENV)).status, 400);
  }
  assert.equal(requests.length, 0);
});

test("missing environment returns 503 with phone fallback", async () => {
  const { status, body } = await result(await handleContact(post(VALID), {}));
  assert.equal(status, 503); assert.match(body.error!, /\(224\) 635-3000/); assert.equal(requests.length, 0);
});

test("Resend failure returns 502 with phone fallback", async () => {
  resendStatus = 500;
  const { status, body } = await result(await handleContact(post(VALID), ENV));
  assert.equal(status, 502); assert.match(body.error!, /couldn't send/); assert.match(body.error!, /\(224\) 635-3000/);
});
