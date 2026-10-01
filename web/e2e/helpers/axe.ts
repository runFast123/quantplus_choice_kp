import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** Serious and critical WCAG 2.1 AA violations, as "rule: selectors" strings. */
export const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
