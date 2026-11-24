import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTrailingSlashes } from './index.mjs';

const pages = new Set(['/about', '/services/brake-services', '/sitemap']);
const fix = (html) => addTrailingSlashes(html, (p) => pages.has(p));

test('adds a slash to links that point at built pages', () => {
  assert.equal(fix('<a href="/about">'), '<a href="/about/">');
  assert.equal(fix("<a href='/about'>"), "<a href='/about/'>");
  assert.equal(fix('<a class="x" href="/services/brake-services">'), '<a class="x" href="/services/brake-services/">');
});

test('keeps the hash and query string after the slash', () => {
  assert.equal(fix('<a href="/about#team">'), '<a href="/about/#team">');
  assert.equal(fix('<a href="/about?ref=nav">'), '<a href="/about/?ref=nav">');
});

test('leaves everything else alone', () => {
  for (const html of [
    '<a href="/">',
    '<a href="/about/">',
    '<a href="/#reviews">',
    '<a href="/api/contact">',
    '<a href="/sitemap-index.xml">',
    '<link href="/fonts/a.woff2">',
    '<a href="//cdn.example/about">',
    '<a href="https://example.com/about">',
    '<a href="tel:8478441700">',
    '<a href="/used-tires">',
  ]) {
    assert.equal(fix(html), html);
  }
});
