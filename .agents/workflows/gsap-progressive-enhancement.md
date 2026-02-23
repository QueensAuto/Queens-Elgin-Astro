---
description: How to audit and fix GSAP animations for progressive enhancement and Astro View Transitions compatibility (prevents blank/invisible content on back-navigation)
---

# GSAP Progressive Enhancement + View Transitions Workflow

## 1. Required Pattern for Every GSAP Component

Every Astro component that uses GSAP **must** follow this lifecycle pattern to work correctly with Astro View Transitions (`<ViewTransitions />`):

```typescript
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// 1. Track the GSAP context at module scope
let ctx: gsap.Context | null = null;

function initAnimations() {
  // 2. Always clean up previous context FIRST
  if (ctx) {
    ctx.revert();
    ctx = null;
  }

  // 3. Find the component's root element — bail if not on this page
  const section = document.querySelector("#my-section");
  if (!section) return;

  // 4. Wrap ALL gsap calls in gsap.context() scoped to the section
  ctx = gsap.context(() => {
    // gsap.set(), gsap.to(), gsap.fromTo(), ScrollTrigger, timelines, etc.
    // ALL go inside here
  }, section);
}

// 5. Init on page load (works for both initial load AND View Transitions)
document.addEventListener("astro:page-load", initAnimations);

// 6. Clean up before page swap (CRITICAL for back-navigation)
document.addEventListener("astro:before-swap", () => {
  if (ctx) {
    ctx.revert();
    ctx = null;
  }
});
```

## 2. Why This Matters

- **`gsap.context()`** tracks every GSAP call made inside it. When you call `.revert()`, it removes all inline styles GSAP applied and kills all ScrollTriggers.
- **Without cleanup**, navigating away and back leaves stale inline styles (`opacity: 0`, `clipPath`, `transform`) baked onto DOM elements — making content invisible.
- **`once: true`** ScrollTriggers that already fired will never fire again on back-nav unless the old ones are properly killed first.

## 3. Progressive Enhancement Rules

- **Never** hide elements with CSS (`opacity: 0`, `visibility: hidden`) as initial state
- **Always** use `gsap.set()` inside `gsap.context()` to set hidden initial states via JS
- If GSAP fails to load, all content remains visible (CSS default)

## 4. Audit Checklist

When adding or reviewing a GSAP component, check:

- [ ] Uses `gsap.context()` wrapping all GSAP calls
- [ ] Has a module-level `ctx` variable (or similar) to track the context
- [ ] Calls `ctx.revert()` at the start of the init function
- [ ] Listens to `astro:page-load` for initialization
- [ ] Listens to `astro:before-swap` for cleanup
- [ ] No CSS-based hidden states — GSAP handles initial state via JS
- [ ] Uses static imports (`import { ScrollTrigger } from "gsap/ScrollTrigger"`) not dynamic `import()`

## 5. Reference Components (Correct Patterns)

These components in the project follow the correct pattern:

| Component | Context Pattern |
|-----------|----------------|
| `GSAPNewTires.astro` | `ctx` variable + full lifecycle |
| `WhyChooseUs.astro` | `wcuCtx` variable + full lifecycle |
| `ServicesHome.astro` | `servicesHomeCtx` variable + full lifecycle |
| `FinancingSection.astro` | `financingCtx` variable + full lifecycle |
| `ServiceCards.astro` | `serviceCardsCtx` variable + full lifecycle |
| `Hero.astro` | `heroCtx` variable + full lifecycle |
| `ReviewsVideo.astro` | `reviewsEntryCtx` variable + full lifecycle |
| `SmoothScroll.astro` | Lenis instance + `astro:before-swap` destroy |

## 6. Common Mistakes

1. **Missing `astro:before-swap`** — Animations work on first load but break on back-navigation
2. **GSAP calls outside `gsap.context()`** — Inline styles persist after `.revert()`
3. **Dynamic `import()` for ScrollTrigger** — Creates race conditions; use static imports
4. **Multiple `gsap.registerPlugin()` calls without context** — Safe but unnecessary; register once at module top
5. **Forgetting to guard with element check** — `if (!section) return;` prevents errors on pages without the component
