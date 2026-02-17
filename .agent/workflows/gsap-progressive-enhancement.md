---
description: How to audit and fix GSAP animations for progressive enhancement (prevents blank/invisible content)
---

# GSAP Progressive Enhancement Workflow

Use this workflow when auditing or building GSAP animations on any Astro site with View Transitions. The goal: **content is always visible by default — animations are an enhancement, never a requirement.**

---

## Step 1: Find All Dangerous Patterns

Search the `src/components` and `src/pages` directories for CSS or inline styles that hide content:

```bash
# CSS opacity: 0 (the most common offender)
grep -rn "opacity:\s*0" src/components/ --include="*.astro"

# Inline clip-path hiding elements
grep -rn 'clip-path:\s*inset' src/components/ --include="*.astro"

# CSS visibility: hidden
grep -rn "visibility:\s*hidden" src/components/ --include="*.astro"

# CSS transform that offsets content (translateY, translateX)
grep -rn "transform:\s*translate" src/components/ --include="*.astro"
```

## Step 2: Classify Each Result

For every match, determine if it's **dangerous** or **safe**:

### ❌ DANGEROUS — CSS hides content, JS reveals

Content is hidden by default in `<style>` or inline `style=""`. If JS fails, content is invisible.

```css
/* BAD: CSS style block */
.my-element { opacity: 0; }
.my-element { transform: translateY(40px); }
```

```html
<!-- BAD: Inline style -->
<img style="clip-path: inset(0 0 100% 0);" />
<div style="opacity: 0;" />
```

### ✅ SAFE — JS handles both hide and reveal

These patterns are fine because GSAP manages the initial state:

```js
// SAFE: gsap.from() — GSAP sets starting state in JS
gsap.from(".element", { opacity: 0, y: 30 });

// SAFE: gsap.fromTo() — GSAP sets both states in JS
gsap.fromTo(".element", { opacity: 0 }, { opacity: 1 });

// SAFE: gsap.set() followed by gsap.to()
gsap.set(".element", { opacity: 0 });
gsap.to(".element", { opacity: 1 });
```

### ⚠️ INTENTIONAL — Scroll-pinned experiences

Some components (like full-screen scroll-driven animations) intentionally hide content as part of the design. These are fine to leave as-is IF:
- The section is a non-essential decorative experience
- The core message/CTA is accessible elsewhere on the page

## Step 3: Fix Each Dangerous Pattern

### Pattern A: CSS `opacity: 0` → `gsap.set()`

**Before:**
```css
/* In <style> block */
.hero-badge { opacity: 0; }
```
```js
gsap.to(".hero-badge", { opacity: 1, delay: 2 });
```

**After:**
```css
/* REMOVE the opacity: 0 from CSS */
/* Add a comment explaining why */
/* Entry animation handled by gsap.set() in JS for progressive enhancement */
```
```js
// JS sets hidden state — if JS fails, element stays visible
gsap.set(".hero-badge", { opacity: 0 });
gsap.to(".hero-badge", { opacity: 1, delay: 2 });
```

---

### Pattern B: Inline `clip-path` → `gsap.set()`

**Before:**
```html
<video style="clip-path: inset(0 0 100% 0);" class="my-video" />
```
```js
gsap.to(".my-video", { clipPath: "inset(0 0 0% 0)" });
```

**After:**
```html
<!-- REMOVE inline clip-path -->
<video class="my-video" />
```
```js
gsap.set(".my-video", { clipPath: "inset(0 0 100% 0)" });
gsap.to(".my-video", { clipPath: "inset(0 0 0% 0)" });
```

---

### Pattern C: CSS `transform` + `opacity` combo → `gsap.set()`

**Before:**
```css
.timeline-item {
    opacity: 0;
    transform: translateY(40px);
}
```
```js
gsap.to(".timeline-item", { opacity: 1, y: 0 });
```

**After:**
```css
/* REMOVE opacity and transform from CSS */
.timeline-item { }
```
```js
gsap.set(".timeline-item", { opacity: 0, y: 40 });
gsap.to(".timeline-item", { opacity: 1, y: 0 });
```

---

### Pattern D: `gsap.to()` without initial state → `gsap.fromTo()`

If you see a `gsap.to()` that animates TO a visible state but relies on CSS for the FROM state, convert to `gsap.fromTo()`:

**Before:**
```css
.card { opacity: 0; }
```
```js
gsap.to(".card", { opacity: 1, stagger: 0.1 });
```

**After:**
```js
// No CSS needed — fromTo handles both states
gsap.fromTo(".card",
    { opacity: 0 },
    { opacity: 1, stagger: 0.1 }
);
```

## Step 4: Fix IntersectionObserver Edge Cases

If IntersectionObserver is used for reveal animations, handle elements already in viewport on client-side navigation:

```js
function initReveals() {
    const elements = document.querySelectorAll("[data-reveal]");

    elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;

        if (isInViewport) {
            // Already visible — animate immediately
            gsap.set(el, { opacity: 0, y: 30 });
            void el.offsetWidth; // force reflow
            gsap.to(el, { opacity: 1, y: 0, duration: 0.8 });
        } else {
            // Below fold — hide and let observer trigger
            gsap.set(el, { opacity: 0, y: 30 });
            observer.observe(el);
        }
    });
}

// Handle both initial load and View Transitions
document.addEventListener("astro:page-load", initReveals);
```

Also avoid large negative `rootMargin` values (like `-100px`) that prevent triggering when elements are already at the top of the viewport.

## Step 5: Add CSS Fallback for clip-path

For components using `clip-path` reveals, add a `@supports` fallback:

```css
@supports not (clip-path: inset(0)) {
    .reveal-image {
        clip-path: none !important;
        opacity: 1 !important;
    }
}
```

// turbo-all
## Step 6: Verify

1. Run `npm run build` — confirm 0 errors
2. Disable JavaScript in browser DevTools → verify all content is visible
3. Test client-side navigation between pages → verify animations trigger
4. Test hard refresh on each page → verify animations trigger
