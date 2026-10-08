/**
 * The show-day rehearsal, automated: a phone-sized Edge (or Chrome) opens the POS online, waits
 * for "Offline ready", loses its connection, reloads the POS, sells a card, and syncs once the
 * connection is back. Uses the browser already installed on this computer (playwright-core).
 *
 *   pnpm e2e:offline -- --base http://localhost:3100 --code EDRK50
 *
 * Local only: signs in with the local development passcode from scripts/dev-env.ts.
 */
import { chromium } from "playwright-core";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://localhost:3100");
const code = arg("code", "");
const channel = arg("channel", "msedge");

function step(msg: string) {
  console.log(`- ${msg}`);
}

async function main() {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("local servers only");
  if (!code) throw new Error("pass --code <an in-stock sticker code>");

  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));

  await page.goto(`${base}/login?next=/pos`);
  await page.fill('input[name="passcode"]', "local-dev-passcode");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${base}/pos`);
  step("signed in, POS open");

  await page.getByText("Offline ready", { exact: true }).waitFor({ timeout: 60_000 });
  step("offline ready (page, scanner engine, and inventory cached)");

  await context.setOffline(true);
  await page.reload();
  await page.getByText(/Offline/).first().waitFor({ timeout: 15_000 });
  step("reloaded with no connection: the POS still opens");

  await page.getByRole("button", { name: "Hide cam" }).click();
  await page.fill('input[placeholder="Sticker code or card name"]', code);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByText(/Confirm sale/).waitFor();
  await page.getByRole("button", { name: /Confirm sale/ }).click();
  await page.getByText(/1 to sync/).waitFor({ timeout: 10_000 });
  step(`sold ${code} offline: 1 deal waiting to sync`);

  await page.fill('input[placeholder="Sticker code or card name"]', code);
  await page.getByRole("button", { name: "Find" }).click();
  try {
    await page.getByText(/already SOLD/).waitFor({ timeout: 5_000 });
  } catch (e) {
    const shot = arg("shot", "");
    if (shot) await page.screenshot({ path: shot, fullPage: true });
    console.log(`  screen says: ${(await page.locator("main").innerText()).slice(0, 300).replace(/\s+/g, " ")}`);
    throw e;
  }
  step("scanning the same sticker again says it is already sold");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("Synced", { exact: true }).waitFor({ timeout: 30_000 });
  step("back online: synced");

  const res = await page.request.get(`${base}/api/pos/snapshot`);
  const snap = (await res.json()) as { units: { code: string; status: string }[] };
  const unit = snap.units.find((u) => u.code === code);
  if (unit?.status !== "sold") throw new Error(`server says ${code} is ${unit?.status ?? "missing"}`);
  step(`server has ${code} as sold`);

  await browser.close();
  console.log("PASS");
}

main().catch((e: unknown) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
