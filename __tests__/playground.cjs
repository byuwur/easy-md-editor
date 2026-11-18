/*
 * File: __tests__/playground.cjs
 * Desc: One smoke check for the real playground's preview and copied starter.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { chromium, firefox, webkit } = require("playwright");
const engine = process.env.BROWSER_ENGINE || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(engine), "Unsupported BROWSER_ENGINE");
const root = path.join(__dirname, "..");

test("MD editor playground loads, updates, and copies a starter", { timeout: 30000 }, async (t) => {
  const browser = await { chromium, firefox, webkit }[engine].launch({ timeout: 10000, ...(engine === "chromium" ? { channel: process.env.BROWSER_CHANNEL, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.copiedHTML = value;
        }
      }
    });
  });
  // Use real local companions behind the page's declared URLs, without contacting the CDN.
  const projects = {
    "spa.js": process.env.SPA_ASSETS_ROOT || path.join(root, "../spa.js"),
    "code.view": path.join(root, "../code.view"),
    "md.view": path.join(root, "../md.view"),
    "md.edit": root
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const remote = url.origin === "https://cdn.jsdelivr.net" && url.pathname.match(/^\/gh\/byuwur\/([^@/]+)@[^/]+\/(.+)$/);
    const directory = url.origin === "https://playground.test" ? root : remote && projects[remote[1]];
    if (!directory) return route.abort();
    const file = remote ? remote[2] : url.pathname.slice(1) || "index.html";
    const target = path.resolve(directory, file);
    if (!target.startsWith(path.resolve(directory) + path.sep)) return route.abort();
    let body;
    try {
      body = await fs.readFile(target);
    } catch (error) {
      // Project distributions are generated; test their authored counterparts locally.
      if (error.code !== "ENOENT") throw error;
      body = await fs.readFile(target.replace(/\.min(?=\.(?:css|js)$)/, ""));
    }
    const contentType = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream";
    return route.fulfill({ body, contentType: `${contentType}; charset=UTF-8` });
  });
  await page.goto("https://playground.test/index.html");
  assert.equal(await page.locator("#latest-release").textContent(), "Latest Release");
  assert.equal(await page.locator("#latest-release").getAttribute("href"), "https://github.com/byuwur/md.edit/releases/latest");
  assert.equal(await page.locator("#download-release").getAttribute("href"), "https://github.com/byuwur/md.edit/releases/latest/download/md.edit.zip");
  assert.equal(await page.locator("#download-minified").getAttribute("href"), "https://github.com/byuwur/md.edit/releases/latest/download/md.edit.minified.zip");
  await page.locator("#editor.byMDeditor").waitFor();
  assert.equal(await page.locator("#statusBar").isChecked(), false);
  assert.equal(await page.locator("#editor .byEDstatus").isVisible(), false);
  await page.getByText("Editor controls", { exact: true }).click();
  await page.getByText("Configuration JSON", { exact: true }).click();
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-bs-theme")) !== theme) await page.locator("#site-theme").click();
    const contrast = await page.waitForFunction(() => {
      const style = getComputedStyle(document.getElementById("options-json")),
        body = getComputedStyle(document.body);
      if (style.color !== body.color || style.backgroundColor !== body.backgroundColor) return false;
      /** Convert a computed RGB color to relative luminance. @param {string} color @returns {number} */
      const luminance = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .reduce((sum, value, index) => {
            const channel = Number(value) / 255;
            return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
          }, 0);
      const values = [luminance(style.color), luminance(style.backgroundColor)];
      const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      return ratio >= 4.5 ? ratio : false;
    });
    assert.ok((await contrast.jsonValue()) >= 4.5, `Configuration JSON stays readable in ${theme}`);
    await contrast.dispose();
  }
  await page.selectOption("#document-source", "custom");
  await page.evaluate(() => {
    File.prototype.text = () =>
      new Promise((resolve) => {
        window.finishFileRead = () => resolve("older file");
      });
  });
  await page.locator("#file").setInputFiles({ name: "old.md", mimeType: "text/markdown", buffer: Buffer.from("older file") });
  const surface = page.locator("#editor .byEDsurface");
  await surface.click();
  await surface.press("ControlOrMeta+A");
  await surface.pressSequentially("PLAYGROUND_CORE");
  await page.waitForFunction(() => document.getElementById("source-characters").textContent === String("PLAYGROUND_CORE".length));
  await page.evaluate(() => window.finishFileRead());
  assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), "PLAYGROUND_CORE");
  await page.locator("#copy-integration").click();
  await page.waitForFunction(() => typeof window.copiedHTML === "string");
  assert.match(await page.evaluate(() => window.copiedHTML), /md\.edit(?:\.min)?\.js/);
  assert.deepEqual(errors, [], "No uncaught playground errors");
});
