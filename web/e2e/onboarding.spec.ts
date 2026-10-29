import { expect, test } from "./helpers/fixtures";

/**
 * Phase 3: the header says how fresh prices are, new users get a setup checklist they can hide,
 * browser notifications can be managed from Settings, and the app is installable.
 */
test.describe("onboarding and alert delivery", () => {
  test("the header says prices are end-of-day and when the next update lands", async ({ proPage }) => {
    await proPage.goto("/app");
    const chip = proPage.getByText(/^EOD \d{1,2} \w{3} · next /);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("title", /end-of-day closes .* not live/);
  });

  test("the setup checklist shows progress and can be hidden", async ({ proPage }) => {
    await proPage.goto("/app");
    const checklist = proPage.getByTestId("first-run");
    await expect(checklist).toBeVisible();
    await expect(checklist).toContainText(/\d of \d done/);
    await expect(checklist.getByRole("link", { name: /Turn on browser notifications/ })).toHaveAttribute("href", "/app/settings?tab=notifications");
    await checklist.getByRole("button", { name: "Hide the setup checklist" }).click();
    await expect(checklist).toHaveCount(0);
    await proPage.reload();
    await expect(proPage.getByTestId("first-run")).toHaveCount(0);
  });

  test("Settings has a Notifications tab with browser controls", async ({ proPage }) => {
    await proPage.goto("/app/settings?tab=notifications");
    await expect(proPage.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
    const controls = proPage.getByTestId("push-controls");
    await expect(controls).toBeVisible();
    // Once the browser has been asked, the controls leave the "checking" state.
    await expect(controls).not.toHaveAttribute("data-status", "checking");
    await expect(proPage.getByText("Turned on in")).toBeVisible();
  });

  test("the app is installable and the push cron is locked", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.name).toBe("QuantsPulse");
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    expect((await request.get("/icons/icon-192.png")).status()).toBe(200);
    expect((await request.get("/sw.js")).status()).toBe(200);
    expect((await request.get("/api/cron/push")).status()).toBe(401);
  });
});
