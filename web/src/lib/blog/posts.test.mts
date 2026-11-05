import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { BLOG_DATA } from "./data";
import { POSTS, postText } from "./posts";

const strip = (t: string) => t.replace(/\]\([^)]+\)/g, "]"); // link targets are URLs, not prose

describe("blog posts", () => {
  test("five posts, one per rule, unique slugs", () => {
    assert.equal(POSTS.length, 5);
    assert.deepEqual(new Set(POSTS.map((p) => p.rule)), new Set(["sma", "rsi", "kk", "strong", "ma200"]));
    assert.equal(new Set(POSTS.map((p) => p.slug)).size, 5);
  });

  test("no hyphen, dash or minus sign anywhere a reader sees (the owner's house style)", () => {
    for (const p of POSTS) {
      for (const t of postText(p)) {
        assert.ok(!/[-‐‑‒–—―−]/.test(strip(t)), `${p.slug}: "${t.slice(0, 80)}"`);
      }
    }
  });

  test("SEO basics: title tag under 60, description 110 to 170, takeaways and questions present", () => {
    for (const p of POSTS) {
      assert.ok(p.seoTitle.length <= 60, `${p.slug} seoTitle ${p.seoTitle.length}`);
      assert.ok(p.description.length >= 110 && p.description.length <= 170, `${p.slug} description ${p.description.length}`);
      assert.ok(p.faq.length >= 3 && p.takeaways.length >= 4, p.slug);
      const ids = p.blocks.flatMap((b) => (b.type === "h2" ? [b.id] : []));
      assert.equal(new Set(ids).size, ids.length, `${p.slug} duplicate section id`);
    }
  });

  test("the short answer stays short enough to be quoted (40 to 90 words)", () => {
    for (const p of POSTS) {
      const n = p.answer.split(/\s+/).length;
      assert.ok(n >= 40 && n <= 90, `${p.slug}: ${n} words`);
    }
  });

  test("the data hangs together: both sides, a spread that sums to 100, years that add up, an example", () => {
    for (const k of ["sma", "rsi", "kk", "strong", "ma200"] as const) {
      const d = BLOG_DATA[k];
      for (const s of [d.usual, d.ours]) {
        assert.ok(s.all.trades > 500, k);
        assert.ok(Math.abs(s.hist.reduce((a, b) => a + b, 0) - 100) < 0.6, `${k} hist`);
        assert.equal(s.all.trades, s.years.reduce((a, y) => a + y.trades, 0), `${k} years add up`);
      }
      assert.ok(d.example && d.example.closes.length > 200 && d.example.ours.length >= 2 && d.example.usual.length >= 2, `${k} example`);
    }
    assert.ok(BLOG_DATA.strong.usualTrail, "strong has the common exit too");
  });
});
