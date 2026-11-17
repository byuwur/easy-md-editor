/*
 * File: __tests__/rendering.cjs
 * Desc: Bounded, offline checks for the public MD editor renderer contract.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { chromium, firefox, webkit } = require("playwright");
const engine = process.env.BROWSER_ENGINE || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(engine), "Unsupported BROWSER_ENGINE");

test("MD editor library", { timeout: 30000 }, async (t) => {
  const browser = await { chromium, firefox, webkit }[engine].launch({
    timeout: 10000,
    ...(engine === "chromium" ? { channel: process.env.BROWSER_CHANNEL, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {})
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Load authored files directly; CDN availability is not part of this contract.
  // Optional icon glyphs do not participate in source/history checks.
  await page.route("**/*", (route) => (route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ body: "", contentType: "text/css" }) : route.abort()));
  await page.setContent('<!doctype html><meta charset="UTF-8"><div id="viewer"></div>');
  // Exercise the real published companion APIs, checked out beside the editor in CI.
  await page.addStyleTag({ path: path.join(__dirname, "../../md.view/md.css") });
  await page.addScriptTag({ path: path.join(__dirname, "../../md.view/md.js") });
  await page.addStyleTag({ path: path.join(__dirname, "../../code.view/code.css") });
  await page.addScriptTag({ path: path.join(__dirname, "../../code.view/code.js") });
  await page.addStyleTag({ path: path.join(__dirname, "../md.edit.css") });
  await page.addScriptTag({ path: path.join(__dirname, "../md.edit.js") });
  await page.evaluate(() => {
    window.root = document.getElementById("viewer");
  });

  await t.test("editing commits exact source and undo/redo restores it", async () => {
    const source = "# Core\r\n\r\nOriginal";
    await page.evaluate((source) => {
      window.changes = [];
      window.editor = byMDeditor(root, source, { syntax: "source", animations: false, onChange: (value) => changes.push(value) });
    }, source);
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    await page.locator(".byEDsource").fill("# Changed\n\nText");
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "# Changed\n\nText");
    assert.equal(await page.evaluate(() => changes.at(-1)), "# Changed\n\nText");
    await page.evaluate(() => editor.command("undo"));
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    await page.evaluate(() => editor.command("redo"));
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "# Changed\n\nText");
  });

  await t.test("mode changes and preview preserve the authoritative source", async () => {
    const source = "# Core\r\n\r\n**keep** this\r\n";
    await page.evaluate((source) => editor.setMarkdown(source), source);
    for (const mode of ["assisted", "clean", "no-code", "source"]) {
      await page.evaluate((mode) => editor.setSyntaxMode(mode), mode);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    }
    await page.evaluate(() => editor.setPreview(true));
    assert.equal(await page.locator(".byEDpreview h1").textContent(), "Core");
    assert.equal(await page.evaluate(() => editor.command("bold")), false);
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
  });

  await t.test("preview keeps untrusted content inert and disposal removes owned UI", async () => {
    await page.evaluate(() => {
      editor.setMarkdown('<img src=x onerror="window.injected=1">\n\n[bad](javascript:alert(1))');
      editor.setPreview(true);
    });
    assert.equal(await page.locator(".byEDpreview img, .byEDpreview script, .byEDpreview a[href^='javascript:']").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.evaluate(() => editor.destroy());
    assert.equal(await page.locator("#viewer").evaluate((element) => element.childNodes.length), 0);
  });

  assert.deepEqual(errors, [], "No uncaught browser errors");
});
