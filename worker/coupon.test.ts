import { test } from "node:test";
import assert from "node:assert/strict";
import { COUPON_ALPHABET, generateCoupon } from "./coupon.ts";

test("a coupon is 6 characters of capital letters and digits", () => {
  for (let i = 0; i < 200; i++) assert.match(generateCoupon(), /^[A-Z0-9]{6}$/);
});

test("look-alike characters (0/O, 1/I) are never used", () => {
  assert.doesNotMatch(COUPON_ALPHABET, /[01OI]/);
  const many = Array.from({ length: 2000 }, () => generateCoupon()).join("");
  assert.doesNotMatch(many, /[01OI]/);
});

test("codes mix letters and digits across the whole alphabet", () => {
  const seen = new Set(Array.from({ length: 3000 }, () => generateCoupon()).join(""));
  assert.equal(seen.size, COUPON_ALPHABET.length, "every allowed character shows up");
});

test("codes don't repeat in practice", () => {
  const codes = new Set(Array.from({ length: 10000 }, () => generateCoupon()));
  assert.equal(codes.size, 10000);
});
