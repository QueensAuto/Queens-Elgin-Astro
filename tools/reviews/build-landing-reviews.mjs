// Build per-landing-page review sets from a Google Business Profile review export (Apify JSON).
// Usage: node tools/reviews/build-landing-reviews.mjs "F:/Dev 2/Local SEO Bible/reviews/queens-auto-services-elgin-2026-11-23.json"
// Reviews are quoted word for word. Reviewers show as "First L." from the export's `name` field;
// if an export lacks names, the first name is taken from the owner's reply ("Thank you …, Mike.").
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("pass the path to the review export JSON");
const all = JSON.parse(readFileSync(src, "utf8")).filter((r) => r.stars === 5 && r.text);

/** Each page: review text openings, in display order (topic matches first). */
const PICKS = {
  brakes: [
    "Highly recommend! Probably one of the best shops",
    "The guys were very helpful and accommodating. Got me right in",
    "Great experience from start to finish. Honest, professional",
    "Honest diagnosis, fair price, and repair done right",
    "Had a great experience here, fair prices and quick repair",
    "Exceptional customer service, prices, and quality of work!",
  ],
  alignment: [
    "I've always used this place for my vehicle's alignment",
    "Ultra clean shop and very friendly people, they gave me a really good price on a wheel alignment",
    "Good place to get your tire, balancing, Alignment and more",
    "Great experience from start to finish. Honest, professional",
    "Had a great experience here, fair prices and quick repair",
    "Exceptional customer service, prices, and quality of work!",
  ],
  repair: [
    "Queens Auto and Gio are excellent. They stepped up",
    "Great experience from start to finish. Honest, professional",
    "Honest diagnosis, fair price, and repair done right",
    "Very thorough when it comes to diagnosing the service needed",
    "Had a great experience here, fair prices and quick repair",
    "This is a great neighborhood auto repair shop",
  ],
};

const clean = (t) => t.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

/** Reviewer shown as "First L." (export field `name`); falls back to the owner reply's greeting. */
function firstName(r) {
  const parts = (r.name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length && r.name !== r.title) {
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  }
  const reply = r.responseFromOwnerText || "";
  const m = reply.match(/,\s*([A-Z][a-z]+)[.!]/) || reply.match(/^(?:Hi|Hello|Thanks|Thank you)\s+([A-Z][a-z]+)\b/);
  const skip = /^(We|Our|Thank|Thanks|Queens|Service|Elgin|Auto)$/;
  return m && !skip.test(m[1]) ? m[1] : "Google reviewer";
}

const month = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

mkdirSync("src/data/landing-reviews", { recursive: true });
for (const [page, openings] of Object.entries(PICKS)) {
  const out = openings.map((start) => {
    const r = all.find((x) => clean(x.text).startsWith(start));
    if (!r) throw new Error(`${page}: no 5-star review starting "${start}"`);
    return { name: firstName(r), stars: 5, text: clean(r.text), source: "Google Reviews", date: month(r.publishedAtDate) };
  });
  writeFileSync(`src/data/landing-reviews/${page}.json`, JSON.stringify(out, null, 4) + "\n");
  console.log(page.padEnd(10), out.map((x) => `${x.name} (${x.date})`).join(", "));
}
