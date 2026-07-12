import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("renders real report data without browser errors or page overflow", async ({ page }, testInfo) => {
  const browserMessages: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("RedactBench Target Field");
  await expect(page.getByRole("heading", { level: 2, name: "Run 2026-07-12 / demo" })).toBeVisible();
  await expect(page.getByText("GPT-5.5 xHigh")).toBeVisible();
  await expect(page.getByText("Not run")).toHaveCount(11);
  await expect(page.getByLabel("Overall score: 100.0%")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Fixture Strong" })).toHaveAttribute("aria-pressed", "true");

  const dimensions = await page.evaluate(() => ({
    ancestors: (() => {
      const items = [];
      let element: HTMLElement | null = document.querySelector(".leaderboard-table");
      while (element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        items.push({
          className: element.className,
          clientWidth: element.clientWidth,
          display: style.display,
          maxWidth: style.maxWidth,
          minWidth: style.minWidth,
          overflowX: style.overflowX,
          rectWidth: rect.width,
          scrollWidth: element.scrollWidth,
          tag: element.tagName
        });
        element = element.parentElement;
      }
      return items;
    })(),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: element.className, right: rect.right, tag: element.tagName, width: rect.width };
      })
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 10)
  }));
  expect(
    dimensions.scrollWidth,
    JSON.stringify({ ancestors: dimensions.ancestors, offenders: dimensions.offenders })
  ).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(await page.evaluate(() => document.fonts.check('16px "IBM Plex Mono"'))).toBe(true);

  if (testInfo.project.name === "mobile") {
    const tableOverflow = await page.locator(".leaderboard-section .table-scroll").evaluate((element) =>
      element.scrollWidth > element.clientWidth
    );
    expect(tableOverflow).toBe(true);
  }

  await mkdir("tmp/qa", { recursive: true });
  await page.screenshot({ path: `tmp/qa/dashboard-${testInfo.project.name}.png` });
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ fullPage: true, path: "tmp/qa/dashboard-mobile-full.png" });
  }

  await page.getByLabel("Harness filter").selectOption("opencode");
  await expect(page.getByText("GLM 5.2 Max")).toBeVisible();
  await expect(page.getByText("Hy3 High")).toBeVisible();
  await expect(page.getByText("GPT-5.5 xHigh")).toHaveCount(0);
  await page.getByLabel("Harness filter").selectOption("all");

  await page.getByRole("button", { exact: true, name: "Fixture Fast" }).click();
  await expect(page.getByLabel("Overall score: 59.1%")).toBeVisible();
  await page.getByLabel("Category filter").selectOption("context-recovery");
  await expect(page.getByLabel("Overall score: 66.7%")).toBeVisible();

  await page.getByRole("button", { name: "New run" }).click();
  await expect(page.getByRole("dialog", { name: "Start a new run" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(browserMessages).toEqual([]);
  expect(httpErrors).toEqual([]);
});
