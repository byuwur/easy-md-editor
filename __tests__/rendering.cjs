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

  await t.test("code language changes preserve fenced source, selection, and undo history", async () => {
    const source = '# Before\r\n\r\n  ~~~~js title="demo"\r\nconst n = 1;\r\n  ~~~~\r\n\r\nAfter\r\n';
    const anchor = source.indexOf("const") + 8,
      focus = anchor - 6;
    await page.evaluate(
      ({ source, anchor, focus }) => {
        window.editor = byMDeditor(root, source, { animations: false });
        editor.setSelection(anchor, focus);
      },
      { source, anchor, focus }
    );
    const picker = page.locator(".byEDcontextToolbar select");
    assert.equal(await picker.inputValue(), "js", "Existing language aliases remain selected");
    await picker.selectOption("python");
    const expected = source.replace("~~~~js", "~~~~python");
    assert.equal(await page.evaluate(() => editor.getMarkdown()), expected);
    assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: anchor + 4, focus: focus + 4 });
    await page.evaluate(() => editor.command("undo"));
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor, focus });
    await page.evaluate(() => editor.command("redo"));
    assert.equal(await page.evaluate(() => editor.getMarkdown()), expected);
    assert.equal(await page.evaluate(() => editor.command("codeLanguage", "bad\nlanguage")), false);
    await page.evaluate(() => editor.setSelection(0));
    assert.equal(await page.evaluate(() => editor.command("codeLanguage", "json")), false, "Prose has no code language to change");
    await page.locator(".byEDgroup-fence").hover();
    await picker.selectOption("plain");
    assert.equal(await page.evaluate(() => editor.getMarkdown()), expected.replace("~~~~python", "~~~~plain"));
    assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 0, focus: 0 }, "Hover controls retain the prose caret");
    await page.evaluate(() => {
      editor.setSyntaxMode("no-code");
      editor.setSelection(editor.getMarkdown().indexOf("const"));
    });
    await picker.selectOption("json");
    assert.equal(await page.locator('[data-type="fenceOpen"]').isVisible(), false);
    assert.equal(await page.evaluate(() => editor.getMarkdown()), expected.replace("~~~~python", "~~~~json"));
    await picker.press("Escape");
    assert.equal(await picker.isVisible(), false);
    await page.evaluate(() => editor.setPreview(true));
    assert.equal(await picker.isVisible(), false);
  });

  await t.test("image and code controls share their popup without losing sizing or translations", async () => {
    await page.route("https://image.test/logo.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#777"/></svg>' }));
    const source = "![Sample](https://image.test/logo.svg)\r\n\r\n~~~js\r\nlet n = 1;\r\n~~~";
    await page.evaluate((source) => {
      window.editor = byMDeditor(root, source, { animations: false });
    }, source);
    const image = page.locator(".byEDimage");
    await image.click();
    await page.locator(".byEDcontextToolbar").getByRole("button", { name: "Small (160px)", exact: true }).click();
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source.replace(")", ")<!-- bymd:size=small -->"));
    await page.evaluate(() => editor.setLanguage("es"));
    await page.keyboard.press("Escape");
    await page.locator(".byEDgroup-fence").hover();
    assert.equal(await page.locator(".byEDcontextToolbar select").getAttribute("aria-label"), "Lenguaje");
    await page.evaluate(() => editor.setLanguage("fr"));
    await image.click();
    assert.equal(await page.locator(".byEDcontextToolbar").getByRole("button", { name: "Petite (160px)", exact: true }).getAttribute("aria-pressed"), "true");
    await image.focus();
    await image.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-pressed")), "true");
    await page.evaluate(() => editor.command("undo"));
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    assert.equal(await page.locator(".byEDstatus").isVisible(), false);
    await page.evaluate(() => {
      editor.setSyntaxMode("assisted");
      editor.setControls({ statusBar: true });
    });
    assert.equal(await page.locator(".byEDstatus").isVisible(), true);
  });

  await t.test("code fences resize with syntax reveal and collapse without changing source", async () => {
    const result = await page.evaluate(async () => {
      const source = "Before\n\n~~~js\nconst flag = true;\n~~~\n\nAfter";
      window.editor = byMDeditor(root, source, { animations: true });
      editor.setSelection(0);
      await new Promise(requestAnimationFrame);
      const group = root.querySelector(".byEDgroup-fence");
      const collapsed = group.getBoundingClientRect().height;
      // Seeking real CSS transitions makes both intermediate layouts deterministic.
      /** Sample and finish the fence-row transitions. @returns {Promise<Object>} Intermediate and final block heights. */
      const sample = async () => {
        await new Promise(requestAnimationFrame);
        const transitions = group.getAnimations({ subtree: true }).filter((animation) => ["block-size", "height"].includes(animation.transitionProperty));
        for (const animation of transitions) {
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration / 2;
        }
        const middle = group.getBoundingClientRect().height;
        for (const animation of transitions) animation.finish();
        await Promise.all(transitions.map((animation) => animation.finished));
        await new Promise(requestAnimationFrame);
        return { count: transitions.length, middle, end: group.getBoundingClientRect().height };
      };
      editor.setSelection(source.indexOf("const"));
      const opening = await sample();
      editor.setSelection(0);
      const closing = await sample();
      editor.setAnimations(false);
      editor.setSelection(source.indexOf("const"));
      return { supported: CSS.supports("interpolate-size", "allow-keywords"), collapsed, opening, closing, immediate: group.getBoundingClientRect().height, source: editor.getMarkdown(), expected: source };
    });
    assert.equal(result.source, result.expected);
    assert.ok(result.opening.end > result.collapsed, JSON.stringify(result));
    assert.equal(result.closing.end, result.collapsed, JSON.stringify(result));
    assert.equal(result.immediate, result.opening.end);
    if (result.supported) {
      assert.equal(result.opening.count, 2);
      assert.equal(result.closing.count, 2);
      assert.ok(result.opening.middle > result.collapsed && result.opening.middle < result.opening.end);
      assert.ok(result.closing.middle > result.collapsed && result.closing.middle < result.opening.end);
    }
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
