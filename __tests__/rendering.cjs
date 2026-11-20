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
  // ===== BROWSER FIXTURE =====
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

  // ===== RENDERING BEHAVIOR =====
  await t.test("editing commits exact source and undo/redo restores it", async () => {
    const source = "# Core\r\n\r\nOriginal";
    await page.evaluate((source) => {
      window.changes = [];
      window.editor = byMDeditor(root, source, {
        syntax: "source",
        animations: false,
        onChange: (value) => changes.push(value)
      });
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
    assert.deepEqual(await page.evaluate(() => editor.getSelection()), {
      anchor: anchor + 4,
      focus: focus + 4
    });
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
    await page.route("https://image.test/logo.svg", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#777"/></svg>'
      })
    );
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

  await t.test("table actions preserve cell source, mixed line endings, selection, and atomic history", async () => {
    const source = "\uFEFFBefore\r\n\r\n| Name  | Role |\r\n| :--- | ---: |\n| A\\|B | `x|y` |\r| Sam | Designer |\n\nAfter\r\n";
    const anchor = source.indexOf("x|y") + 3,
      focus = anchor - 3;
    const expected = {
      tableRowAbove: source.replace("| A\\|B", "|   |   |\r| A\\|B"),
      tableRowBelow: source.replace("\r| Sam", "\r|   |   |\r| Sam"),
      tableRowRemove: source.replace("| A\\|B | `x|y` |\r", ""),
      tableColumnLeft: source.replace("| Role |", "| Column 2 | Role |").replace("| ---: |", "| --- | ---: |").replace("| `x|y` |", "|  | `x|y` |").replace("| Designer |", "|  | Designer |"),
      tableColumnRight: source.replace("| Role |", "| Role | Column 3 |").replace("| ---: |", "| ---: | --- |").replace("| `x|y` |", "| `x|y` |  |").replace("| Designer |", "| Designer |  |"),
      tableColumnRemove: source.replace(" Role |", "").replace(" ---: |", "").replace(" `x|y` |", "").replace(" Designer |", "")
    };
    for (const syntax of ["no-code", "clean", "assisted"]) {
      for (const [action, markdown] of Object.entries(expected)) {
        await page.evaluate(
          ({ source, syntax, anchor, focus }) => {
            window.changes = [];
            window.editor = byMDeditor(root, source, {
              syntax,
              language: "en",
              animations: false,
              onChange: (value) => changes.push(value)
            });
            editor.setSelection(anchor, focus);
          },
          { source, syntax, anchor, focus }
        );
        assert.equal(await page.evaluate((action) => editor.command(action), action), true, `${syntax}: ${action}`);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), markdown, `${syntax}: ${action}`);
        assert.equal(await page.evaluate(() => changes.length), 1, "One callback per action");
        await page.evaluate(() => editor.command("undo"));
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor, focus });
        await page.evaluate(() => editor.command("redo"));
        assert.equal(await page.evaluate(() => editor.getMarkdown()), markdown);
      }
    }
  });

  await t.test("table controls follow the current cell, support keyboards, and guard the header and final column", async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    const source = "Before\n\n| A | B |\n| --- | --- |\n| one | two |\n\nAfter";
    await page.evaluate((source) => {
      window.editor = byMDeditor(root, source, { syntax: "no-code", animations: false });
      editor.setSelection(source.indexOf("two"));
    }, source);
    const popup = page.locator(".byEDcontextToolbar"),
      surface = page.locator(".byEDsurface");
    await popup.getByRole("button", { name: "Column left", exact: true }).click();
    assert.equal(await page.locator('[data-type="tableHeader"] th').count(), 3);
    assert.equal(await page.locator('[data-type="tableRow"] td').count(), 3);
    await popup.getByRole("button", { name: "Remove Column", exact: true }).click();
    assert.equal(await page.evaluate(() => editor.getMarkdown()), source, "Adding/removing a column retains existing padding exactly");
    await surface.press("Alt+F10");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Row above");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Row below");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Column right");
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Remove Column");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator('[data-type="tableHeader"] th').count(), 1);
    assert.equal(await popup.getByRole("button", { name: "Remove Column", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await surface.evaluate((element) => element === document.activeElement), true);
    await page.evaluate(() => editor.command("tableRowRemove"));
    assert.equal(await page.locator('[data-type="tableRow"]').count(), 0);
    assert.equal(await popup.getByRole("button", { name: "Remove Row", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => editor.command("tableRowRemove")), false);
    assert.equal(await page.evaluate(() => editor.command("tableColumnRemove")), false);
    await page.evaluate(() => editor.setLanguage("es"));
    await popup.getByRole("button", { name: "Fila abajo", exact: true }).click();
    assert.equal(await page.locator('[data-type="tableRow"]').count(), 1);
    const bounds = await popup.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 361, "Controls fit the narrow viewport");
    await page.evaluate(() => editor.setPreview(true));
    assert.equal(await popup.isVisible(), false);
    assert.equal(await page.evaluate(() => editor.command("tableColumnRight")), false);
    await page.evaluate(() => {
      editor.setPreview(false);
      editor.setSyntaxMode("source");
    });
    assert.equal(await popup.isVisible(), false);
    assert.equal(await page.evaluate(() => editor.command("tableRowBelow")), false);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await t.test("table popup follows the caret and edits the actual cell after pointer and keyboard moves", async () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n|   |   | last |\n| one | two | three |\n| four | five | six |\n\nAfter";
    const inserted = source
      .replace("| A | B | C |", "| A | Column 2 | B | C |")
      .replace("| --- | --- | --- |", "| --- | --- | --- | --- |")
      .replace("|   |   | last |", "|   |  |   | last |")
      .replace("| one | two | three |", "| one |  | two | three |")
      .replace("| four | five | six |", "| four |  | five | six |");
    const popup = page.locator(".byEDcontextToolbar");
    for (const syntax of ["no-code", "clean", "assisted"]) {
      await page.evaluate(
        ({ source, syntax }) => {
          window.editor = byMDeditor(root, source, {
            syntax,
            language: "en",
            animations: false,
            toolbar: false
          });
        },
        { source, syntax }
      );
      const cells = page.locator('[data-type="tableRow"]').first().locator("td");
      await cells.nth(0).click();
      assert.equal(await page.evaluate(() => editor.getSelection().focus), source.indexOf("|   |   | last |") + 4);
      const left = await popup.boundingBox();
      await cells.nth(1).click();
      assert.equal(await page.evaluate(() => editor.getSelection().focus), source.indexOf("|   |   | last |") + 8);
      const middle = await popup.boundingBox();
      assert.ok(middle.x > left.x + 100, `${syntax}: popup follows columns within one row`);
      const grid = await popup.locator("button").evaluateAll((buttons) =>
        buttons.map((button) => ({
          label: button.getAttribute("aria-label"),
          x: button.offsetLeft,
          y: button.offsetTop
        }))
      );
      assert.deepEqual(
        grid.map((button) => button.label),
        ["Row above", "Column left", "Row below", "Column right", "Remove Row", "Remove Column"]
      );
      assert.equal(grid[0].y, grid[1].y);
      assert.equal(grid[2].y, grid[3].y);
      assert.equal(grid[4].y, grid[5].y);
      assert.ok(grid[0].y < grid[2].y && grid[2].y < grid[4].y && grid[0].x < grid[1].x);
      await page.keyboard.type("X");
      assert.deepEqual(await cells.locator(".byEDcell").allTextContents(), ["", "X", "last"], `${syntax}: the empty cell owns typing`);
      await page.evaluate(() => editor.command("undo"));
      await popup.getByRole("button", { name: "Column left", exact: true }).click();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), inserted, `${syntax}: insert beside the clicked empty cell`);
      await page.keyboard.press("Tab");
      await popup.getByRole("button", { name: "Column right", exact: true }).click();
      assert.deepEqual(await page.locator('[data-type="tableHeader"] .byEDcell').allTextContents(), ["A", "Column 2", "B", "Column 4", "C"], `${syntax}: use the cell reached by Tab`);
      await page.evaluate(() => {
        editor.command("undo");
        editor.command("undo");
      });
      for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
      const nextRow = await popup.boundingBox();
      assert.ok(nextRow.y > middle.y, `${syntax}: popup follows the caret to another row`);
      await popup.getByRole("button", { name: "Remove Row", exact: true }).click();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source.replace("| one | two | three |\n", ""), `${syntax}: remove the caret's row`);
      await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("last") + 1));
      const beforeArrow = await popup.boundingBox();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction((x) => document.querySelector(".byEDcontextToolbar").getBoundingClientRect().x > x, beforeArrow.x);
      assert.ok((await popup.boundingBox()).x > beforeArrow.x, `${syntax}: popup follows the caret inside one cell`);
      await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("After")));
      assert.equal(await popup.isVisible(), false, "Leaving the table dismisses its controls");
    }
  });

  await t.test("column edits handle borderless tables, short rows, and adjacent tables", async () => {
    const source = "A | B | C\r\n:--- | ---: | :---:\n`x|y` | v\\|w\r\n| only |\n\n| Keep |\n| --- |\n| exact |";
    await page.evaluate((source) => {
      window.editor = byMDeditor(root, source, { animations: false });
      editor.setSelection(source.indexOf("C"));
      editor.command("tableColumnRight");
    }, source);
    assert.deepEqual(
      await page
        .locator(".byEDgroup-table")
        .first()
        .locator("tr:not([data-type=tableDelimiter])")
        .evaluateAll((rows) => rows.map((row) => row.cells.length)),
      [4, 4, 4]
    );
    assert.ok((await page.evaluate(() => editor.getMarkdown())).endsWith("\n\n| Keep |\n| --- |\n| exact |"));
    await page.evaluate(() => {
      editor.command("undo");
      editor.setSelection(editor.getMarkdown().indexOf("B"));
      editor.command("tableColumnRemove");
      editor.command("tableColumnRemove");
    });
    assert.equal(await page.locator(".byEDgroup-table").count(), 2);
    assert.equal(await page.locator(".byEDgroup-table").first().locator("th .byEDcell").textContent(), "A");
    assert.ok((await page.evaluate(() => editor.getMarkdown())).includes("`x|y`"), "Code-span pipes remain inside their cell");
    const limits = await page.evaluate(() => {
      editor.setMarkdown("");
      editor.command("table", { rows: 100, columns: 20 });
      editor.setSelection(editor.getMarkdown().indexOf("Column 1"));
      return ["tableRowAbove", "tableRowBelow", "tableColumnLeft", "tableColumnRight"].map((action) => editor.command(action));
    });
    assert.deepEqual(limits, [false, false, false, false], "Structural controls respect the existing insertion limits");
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
      return {
        supported: CSS.supports("interpolate-size", "allow-keywords"),
        collapsed,
        opening,
        closing,
        immediate: group.getBoundingClientRect().height,
        source: editor.getMarkdown(),
        expected: source
      };
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
