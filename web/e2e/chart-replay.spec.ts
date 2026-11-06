import { seriousViolations } from "./helpers/axe";
import { expect, expectNoHorizontalOverflow, test } from "./helpers/fixtures";

/**
 * Chart replay (ADR-048): pick a start, step and play a day at a time, practise a trade, leave. Also measures the
 * frames while it plays at the fastest speed: a frame over 50 ms is a visible stutter.
 */
test.describe("chart replay @chart", () => {
  test("start, step, keys, practise a trade, play and pause, leave", async ({ proPage }) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");
    await proPage.getByTestId("replay-toggle").click();

    const setup = proPage.getByTestId("replay-setup");
    await expect(setup).toContainText("Where should the replay start?");
    await setup.getByRole("button", { name: "6 months ago" }).click();
    await expect(setup.getByRole("button", { name: "6 months ago" })).toHaveAttribute("aria-pressed", "true");
    await setup.getByRole("button", { name: /^Start the replay on/ }).click();

    const controls = proPage.getByTestId("replay-controls");
    const progress = proPage.getByTestId("replay-progress");
    await expect(progress).toHaveText(/^Day 0 of \d+$/);
    const day0 = await proPage.getByTestId("replay-date").textContent();

    await controls.getByRole("button", { name: "Forward one day" }).click();
    await expect(progress).toHaveText(/^Day 1 of/);
    await expect(proPage.getByTestId("replay-date")).not.toHaveText(day0 ?? "");
    await controls.getByRole("button", { name: "Back one day" }).click();
    await expect(progress).toHaveText(/^Day 0 of/);
    await proPage.keyboard.press("ArrowRight");
    await expect(progress).toHaveText(/^Day 1 of/);
    await proPage.keyboard.press("Shift+ArrowRight");
    await expect(progress).toHaveText(/^Day 11 of/);

    // Practise: buy at the close, three days on, sell; stepping back before the sale undoes it.
    const practice = proPage.getByTestId("replay-practice");
    await practice.getByRole("button", { name: "Buy", exact: true }).click();
    await expect(proPage.getByTestId("replay-position")).toContainText("You hold");
    await expect(practice.getByRole("button", { name: "Sell", exact: true })).toBeDisabled();
    for (let i = 0; i < 3; i++) await controls.getByRole("button", { name: "Forward one day" }).click();
    await practice.getByRole("button", { name: "Sell", exact: true }).click();
    await expect(proPage.getByTestId("replay-trades")).toContainText("1 practice trade");
    await controls.getByRole("button", { name: "Back one day" }).click();
    await expect(proPage.getByTestId("replay-trades")).toHaveCount(0);
    await expect(proPage.getByTestId("replay-position")).toContainText("You hold");

    // Play at the fastest speed without pausing at signals, measure the frames, pause.
    await controls.getByLabel("Pause at each rule signal").uncheck();
    await controls.getByRole("radio", { name: "20×" }).click();
    await controls.getByRole("button", { name: "Play", exact: true }).click();
    const frames = await proPage.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let prev = performance.now();
          const tick = (now: number) => {
            out.push(now - prev);
            prev = now;
            if (out.length < 90) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await controls.getByRole("button", { name: "Pause", exact: true }).click();
    const played = Number((await progress.textContent())?.match(/^Day (\d+)/)?.[1]);
    expect(played).toBeGreaterThan(20);
    const sortedFrames = [...frames].sort((a, b) => a - b);
    const p95 = sortedFrames[Math.floor(sortedFrames.length * 0.95)];
    const stutters = frames.filter((f) => f > 50).length;
    test.info().annotations.push({ type: "frames", description: `p95 ${p95.toFixed(1)} ms, over 50 ms: ${stutters} of ${frames.length}` });
    console.log(`[replay frames] p95 ${p95.toFixed(1)} ms, median ${sortedFrames[45].toFixed(1)} ms, over 50 ms: ${stutters} of ${frames.length}`);
    expect(stutters).toBeLessThanOrEqual(2);

    await expect(proPage.getByTestId("chart-replay")).toBeVisible();
    expect(await seriousViolations(proPage)).toEqual([]);
    await expectNoHorizontalOverflow(proPage);

    await proPage.keyboard.press("Escape");
    await expect(proPage.getByTestId("chart-replay")).toHaveCount(0);
    await expect(proPage.getByRole("img", { name: /TCS daily price chart/ })).toBeVisible();
  });
});
