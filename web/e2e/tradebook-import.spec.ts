import { expect, HOOK_REASON, state, test } from "./helpers/fixtures";

/** Portfolio plan, step C (ADR-047): a broker tradebook imported in one go, checked first, and undone. */
test.skip(() => !state().hook, HOOK_REASON);
test.describe.configure({ mode: "serial" });

// Zerodha Console's tradebook columns. ITC and SBIN keep this file apart from the other portfolio tests.
const ZERODHA = Buffer.from(
  [
    "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
    "ITC,INE154A01025,2026-01-05,NSE,EQ,EQ,buy,false,10,400,E2E501,1,2026-01-05T10:00:00",
    "ITC,INE154A01025,2026-02-05,NSE,EQ,EQ,buy,false,10,500,E2E502,2,2026-02-05T10:00:00",
    "NIFTY26JANFUT,,2026-01-06,NFO,FO,,buy,false,75,24000,E2E505,5,2026-01-06T09:20:00",
    "ITC,INE154A01025,2026-03-05,NSE,EQ,EQ,sell,false,5,450,E2E503,3,2026-03-05T10:00:00",
    "SBIN,INE062A01020,2026-04-01,NSE,EQ,EQ,buy,false,4,800,E2E504,4,2026-04-01T10:00:00",
    "ZZZNOTASTOCK,,2026-04-02,NSE,EQ,EQ,buy,false,1,10,E2E506,6,2026-04-02T10:00:00",
  ].join("\n"),
);

test("tradebook: checked first, imported in one go, the same file twice adds nothing, undone as a whole", async ({ proPage }) => {
  await proPage.goto("/app/portfolio");
  await proPage.getByRole("link", { name: "Import trades" }).click();
  await expect(proPage).toHaveURL(/\/app\/portfolio\/import/);
  const wiz = proPage.getByTestId("tradebook-import");
  await wiz.getByRole("button", { name: "Next: choose the file" }).click();
  await wiz.getByLabel("Tradebook files").setInputFiles({ name: "tradebook.csv", mimeType: "text/csv", buffer: ZERODHA });

  // The check: futures left out, an unknown stock to place, each stock worked out oldest shares first.
  const review = proPage.getByTestId("review-step");
  await expect(review).toContainText("5 trades in 2 stocks");
  await expect(proPage.getByTestId("left-out")).toContainText("futures, options or another non-equity segment");
  await expect(proPage.getByTestId("unknown-stocks")).toContainText("ZZZNOTASTOCK");
  const itc = proPage.getByTestId("review-ITC");
  await expect(itc).toContainText("15 at 466.67");
  await expect(itc).toContainText("▲ made ₹250.00 on 1 sale");
  await expect(itc).toContainText("Ready");

  await review.getByRole("button", { name: "Import 4 trades" }).click();
  await expect(proPage.getByTestId("import-done")).toContainText("Imported 4 trades.");

  // The same file again: everything is already there.
  await proPage.getByRole("button", { name: "Import another file" }).click();
  await wiz.getByLabel("Tradebook files").setInputFiles({ name: "tradebook.csv", mimeType: "text/csv", buffer: ZERODHA });
  await expect(proPage.getByTestId("review-ITC")).toContainText("Already imported");
  await expect(review.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();

  // The portfolio follows the tradebook, then the import is undone from the list.
  await proPage.goto("/app/portfolio");
  await expect(proPage.getByTestId("positions").locator("tr", { hasText: "ITC" })).toContainText("466.67");
  await proPage.goto("/app/portfolio/import");
  const list = proPage.getByTestId("imports");
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText("4 trades");
  await list.getByRole("button", { name: /^Undo Zerodha import/ }).click();
  await list.getByRole("button", { name: /^Undo, really: Zerodha import/ }).click();
  await expect(proPage.getByTestId("imports")).toHaveCount(0);
  await proPage.goto("/app/portfolio");
  await expect(proPage.getByTestId("positions").locator("tr", { hasText: "ITC" })).toHaveCount(0);
});

test("tradebook: columns we don't recognise are matched once, by hand", async ({ proPage }) => {
  await proPage.goto("/app/portfolio/import");
  const wiz = proPage.getByTestId("tradebook-import");
  await wiz.getByText("Another broker", { exact: true }).click();
  await wiz.getByRole("button", { name: "Next: choose the file" }).click();
  const odd = Buffer.from("When,Scrip,Direction,Shares,Rate\n05/01/2026,WIPRO,B,3,250\n");
  await wiz.getByLabel("Tradebook files").setInputFiles({ name: "odd.csv", mimeType: "text/csv", buffer: odd });

  const cols = proPage.getByTestId("columns-step");
  await expect(cols).toContainText("Which column is which in odd.csv?");
  await expect(cols.getByRole("button", { name: "Use these columns" })).toBeDisabled();
  // "Scrip", "Shares" and "Rate" are names brokers use: matched already. Only the date and the side are left.
  const column = (name: string) => cols.getByRole("combobox", { name, exact: true });
  await expect(column("Symbol")).toHaveValue("1");
  await expect(column("Quantity (needed)")).toHaveValue("3");
  await expect(column("Price per share")).toHaveValue("4");
  await column("Trade date (needed)").selectOption({ label: "When" });
  await column("Buy or sell (needed)").selectOption({ label: "Direction" });
  await cols.getByRole("button", { name: "Use these columns" }).click();
  await expect(proPage.getByTestId("review-WIPRO")).toContainText("3 at 250.00");
  await expect(proPage.getByTestId("review-step").getByRole("button", { name: "Import 1 trade" })).toBeEnabled();
});
