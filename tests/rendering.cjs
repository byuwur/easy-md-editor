/*
 * File: tests/rendering.cjs
 * Desc: Editor library contracts using real companions; playground checks live in playground.cjs.
 */
// --- DEPENDENCIES AND LOCAL FIXTURES ---
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const test = require("node:test");
const { chromium } = require("playwright");

const launch = () => chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const root = path.join(__dirname, "..");
async function install(page, viewer = true) {
  await page.route("https://cdn.jsdelivr.net/**", async (route) => {
    if (route.request().url().endsWith("fontawesome.min.css")) return route.fulfill({ body: "", contentType: "text/css" });
    return route.abort();
  });
  await page.setContent('<div id="editor"></div><div id="other"></div>');
  if (viewer) {
    await page.addStyleTag({ path: path.join(root, "../easy-md-viewer/md.css") });
    await page.addScriptTag({ path: path.join(root, "../easy-md-viewer/md.js") });
    await page.addStyleTag({ path: path.join(root, "../easy-code-viewer/code.css") });
    await page.addScriptTag({ path: path.join(root, "../easy-code-viewer/code.js") });
  }
  await page.addStyleTag({ path: path.join(root, "md.edit.css") });
  await page.addScriptTag({ path: path.join(root, "md.edit.js") });
  await page.evaluate(() => {
    window.changes = [];
    window.render = (source, options = {}) => {
      changes.length = 0;
      window.editor = byMDeditor(document.getElementById("editor"), source, { animations: false, onChange: (value) => changes.push(value), ...options });
    };
  });
}

// --- LOCALIZED CONTROLS ---
test("control languages preserve source, native editing, and instance state", async (t) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ locale: "pt-BR" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await install(page);
    await t.test("core languages work without extra imports and unknown languages warn once", async () => {
      const warnings = [];
      page.on("console", (message) => {
        if (message.type() === "warning") warnings.push(message.text());
      });
      await page.evaluate(() => {
        document.documentElement.lang = "nl-NL";
        render("Original");
        document.documentElement.removeAttribute("lang");
        editor.setLanguage("nl-NL");
        editor.setLanguage("nl-NL");
      });
      assert.equal(await page.evaluate(() => editor.getLanguage()), "en");
      assert.equal(await page.getByRole("button", { name: "Formatting", exact: true }).count(), 1);
      assert.equal(warnings.length, 1, "Automatic fallback does not warn; explicit fallback warns once");
      assert.match(warnings[0], /Add a dictionary to byMDeditor\.locales/);
      await page.evaluate(() => editor.setLanguage("es-MX"));
      assert.equal(await page.evaluate(() => editor.getLanguage()), "es");
      await page.addScriptTag({ path: path.join(root, "md.edit.js") });
      assert.equal(await page.evaluate(() => editor.getLanguage()), "es", "Duplicate core imports retain dictionaries and instances");
    });
    await t.test("all eight dictionaries have complete messages and matching placeholders", async () => {
      const locales = await page.evaluate(() => byMDeditor.locales);
      assert.deepEqual(Object.keys(locales), ["en", "es", "pt", "fr", "de", "it", "ja", "zh"]);
      const source = "# Heading\n\n- [ ] Write\n\n  - Nested\n\n~~~js\nconst value = 1;\n~~~";
      for (const [code, messages] of Object.entries(locales)) {
        assert.deepEqual(Object.keys(messages).sort(), Object.keys(locales.en).sort(), code);
        for (const [key, value] of Object.entries(messages)) {
          assert.equal(typeof value, "string");
          assert.ok(value.length, `${code}.${key}`);
          assert.deepEqual((value.match(/\{\w+\}/g) || []).sort(), (locales.en[key].match(/\{\w+\}/g) || []).sort(), `${code}.${key}`);
        }
        await page.evaluate(({ source, code }) => render(source, { language: code, syntax: "no-code", theme: "light", palette: "monokai" }), { source, code });
        assert.equal(await page.locator('[data-control="toolbar"]').getAttribute("aria-label"), messages.formatting);
        assert.equal(await page.locator('[data-command="bold"]').getAttribute("title"), messages.bold);
        assert.equal(await page.locator('[data-command="bold"] span').textContent(), messages.bold);
        assert.equal(await page.locator('[data-control="syntax"] option[value="no-code"]').textContent(), messages.modeNoCode);
        assert.equal(await page.locator('[data-control="syntax"]').getAttribute("title"), messages.descriptionNoCode);
        assert.equal(await page.locator('.byEDtoolbar option[value="2"]').textContent(), messages.heading.replace("{level}", "2"));
        assert.equal(await page.locator(".byEDcontrols optgroup").first().getAttribute("label"), messages.paletteEssentials);
        assert.equal(await page.locator(".byEDtask").getAttribute("aria-label"), messages.completeTask.replace("{task}", "Write"));
        assert.equal(await page.locator(".byEDunsupported").getAttribute("title"), messages.readOnlyBlock);
        assert.equal(await page.locator(".byEDsurface").getAttribute("data-placeholder"), messages.placeholder);
        assert.equal(await page.locator(".byEDbar").getAttribute("lang"), code);
        await page.locator(".byVIEWthemeToggle").click();
        assert.equal(await page.locator(".byVIEWthemeToggle").getAttribute("aria-label"), messages.lightTheme);
        await page.locator('[data-command="table"]').click();
        assert.equal(await page.locator("dialog h2").textContent(), messages.insertTable);
        assert.equal(await page.locator("dialog label span").first().textContent(), messages.dataRows);
        assert.equal(await page.locator("dialog button[type=submit]").textContent(), messages.insert);
        assert.equal(await page.locator("dialog").getAttribute("lang"), code);
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        assert.deepEqual(await page.evaluate(() => changes), []);
      }
    });
    await t.test("automatic and regional tags resolve locally with independent instances", async () => {
      await page.evaluate(() => render("Original"));
      assert.equal(await page.evaluate(() => editor.getLanguage()), "pt", "Uses browser locale without a lang attribute");
      await page.evaluate(() => {
        document.documentElement.lang = "fr-CA";
        document.getElementById("editor").lang = "es-MX";
        editor.setLanguage("auto");
        window.otherEditor = byMDeditor(document.getElementById("other"), "Other", { language: "de-DE" });
      });
      assert.equal(await page.evaluate(() => editor.getLanguage()), "es");
      assert.equal(await page.locator('#other [data-command="bold"]').getAttribute("aria-label"), "Fett");
      await page.evaluate(() => {
        document.getElementById("editor").removeAttribute("lang");
        editor.setLanguage("auto");
      });
      assert.equal(await page.evaluate(() => editor.getLanguage()), "fr");
      await page.evaluate(() => editor.setLanguage("zh-Hans-CN"));
      assert.equal(await page.evaluate(() => editor.getLanguage()), "zh");
      assert.equal(await page.evaluate(() => otherEditor.getLanguage()), "de");
      await page.evaluate(() => {
        otherEditor.destroy();
        document.documentElement.removeAttribute("lang");
      });
    });
    await t.test("live switching retains nodes, selection, history, and open dialog values", async () => {
      await page.evaluate(() => {
        render("Hello\n\n- [ ] Write", { language: "en", palette: "github" });
        editor.setSelection(0, 5);
        editor.command("bold");
        editor.setSelection(3, 5);
        window.beforeLanguage = { source: editor.getMarkdown(), selection: editor.getSelection(), changes: changes.length, line: document.querySelector(".byEDline"), task: document.querySelector(".byEDtask") };
        editor.setLanguage("ja");
      });
      assert.deepEqual(
        await page.evaluate(() => [
          editor.getMarkdown() === beforeLanguage.source,
          JSON.stringify(editor.getSelection()) === JSON.stringify(beforeLanguage.selection),
          changes.length === beforeLanguage.changes,
          document.querySelector(".byEDline") === beforeLanguage.line
        ]),
        [true, true, true, true]
      );
      assert.equal(await page.locator(".byEDtask").getAttribute("aria-label"), "「Write」を完了");
      assert.equal(await page.evaluate(() => document.querySelector(".byEDtask") === beforeLanguage.task), true);
      assert.equal(await page.locator(".byEDcontrols select").inputValue(), "github");
      await page.locator('[data-command="link"]').click();
      await page.locator('dialog input[name="url"]').fill("https://example.com");
      await page.locator('dialog input[name="label"]').fill("Application text");
      await page.evaluate(() => {
        window.dialogInput = document.activeElement;
        editor.setLanguage("de");
      });
      assert.equal(await page.locator("dialog h2").textContent(), "Link einfügen");
      assert.equal(await page.locator('dialog input[name="url"]').inputValue(), "https://example.com");
      assert.equal(await page.locator('dialog input[name="label"]').inputValue(), "Application text");
      assert.equal(await page.evaluate(() => document.activeElement === dialogInput), true);
      await page.keyboard.press("Escape");
      await page.evaluate(() => editor.command("undo"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello\n\n- [ ] Write");
      await page.evaluate(() => editor.setPreview(true));
      await page.evaluate(() => {
        window.previewNode = document.querySelector(".byEDpreview p");
        editor.setLanguage("it");
      });
      assert.equal(await page.evaluate(() => document.querySelector(".byEDpreview p") === previewNode), true);
      assert.equal(await page.locator(".byEDstatus").textContent(), "Anteprima di sola lettura.");
      await page.evaluate(() => editor.setPreview(false));
      assert.equal(await page.locator(".byEDstatus").textContent(), "Modifica del documento.");
    });
    await t.test("custom text stays plain text and missing dictionary keys use English", async () => {
      await page.evaluate(() => {
        byMDeditor.locales["en-GB"] = { formatting: "Format text" };
        render("Hello", { language: "en-GB", label: "Notes", placeholder: "Your notes", translations: { bold: "<img src=x onerror=alert(1)>" } });
      });
      assert.equal(await page.locator('[data-control="toolbar"]').textContent(), "Format text");
      assert.equal(await page.locator('[data-command="italic"]').getAttribute("aria-label"), "Italic");
      assert.equal(await page.locator('[data-command="bold"] span').textContent(), "<img src=x onerror=alert(1)>");
      assert.equal(await page.locator('[data-command="bold"] img').count(), 0);
      await page.evaluate(() => editor.setLanguage("fr"));
      assert.equal(await page.locator(".byEDsurface").getAttribute("aria-label"), "Notes");
      assert.equal(await page.locator(".byEDsurface").getAttribute("data-placeholder"), "Your notes");
      assert.equal(await page.locator(".byEDsource").getAttribute("aria-label"), "Notes — Source Markdown");
      assert.equal(await page.locator('[data-command="bold"]').getAttribute("aria-label"), "<img src=x onerror=alert(1)>");
      await page.evaluate(() => {
        render("- [ ] Price $&", { language: "en", label: "Notes $&", translations: { sourceLabel: "{document} / {document}", completeTask: "{task} / {task}" } });
      });
      assert.equal(await page.locator(".byEDsource").getAttribute("aria-label"), "Notes $& / Notes $&");
      assert.equal(await page.locator(".byEDtask").getAttribute("aria-label"), "Price $& / Price $&");
      await page.evaluate(() => editor.setLanguage("fr"));
      assert.equal(await page.locator(".byEDsource").getAttribute("aria-label"), "Notes $& / Notes $&");
      assert.equal(await page.locator(".byEDtask").getAttribute("aria-label"), "Price $& / Price $&");
      await page.evaluate(() => {
        render("", { language: "es", syntax: "no-code" });
        editor.command("table", { rows: 1, columns: 2 });
      });
      assert.match(await page.evaluate(() => editor.getMarkdown()), /\| Columna 1 \| Columna 2 \|/);
      await page.evaluate(() => editor.setLanguage("ja"));
      assert.match(await page.evaluate(() => editor.getMarkdown()), /Columna 1/, "Switching does not translate existing document text");
    });
    await t.test("locale validation leaves the existing editor and language intact", async () => {
      for (const options of [{ language: "not a tag" }, { language: "" }, { language: 12 }, { translations: [] }, { translations: { bold: 5 } }]) {
        const result = await page.evaluate((options) => {
          const current = document.getElementById("editor").innerHTML;
          try {
            byMDeditor(document.getElementById("editor"), "Replacement", options);
          } catch (error) {
            return [error.name, current === document.getElementById("editor").innerHTML];
          }
        }, options);
        assert.deepEqual(result, [options.translations ? "TypeError" : "RangeError", true]);
      }
      assert.deepEqual(
        await page.evaluate(() => {
          const before = editor.getLanguage();
          try {
            editor.setLanguage("not a tag");
          } catch (error) {
            return [error.name, editor.getLanguage() === before];
          }
        }),
        ["RangeError", true]
      );
    });
    await t.test("switching languages leaves IME text under browser ownership", async () => {
      const result = await page.evaluate(() => {
        render("Hello ", { language: "en" });
        editor.setSelection(6);
        const surface = document.querySelector(".byEDsurface"),
          text = surface.querySelector(".byEDline").firstChild;
        surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        text.appendData("日本語");
        surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "日本語" }));
        editor.setLanguage("ja");
        const during = { source: editor.getMarkdown(), nodeRetained: text === surface.querySelector(".byEDline").firstChild, changes: changes.length };
        surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
        return { during, source: editor.getMarkdown(), changes: changes.length };
      });
      assert.deepEqual(result, { during: { source: "Hello ", nodeRetained: true, changes: 0 }, source: "Hello 日本語", changes: 1 });
    });
    await t.test("long labels wrap inside a narrow editor", async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const code of ["de", "ja", "zh"]) {
        await page.evaluate((language) => render("Hello", { language }), code);
        assert.equal(await page.locator("#editor").evaluate((element) => element.scrollWidth <= element.clientWidth), true, code);
      }
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

// --- SOURCE, EDITING, AND LIFECYCLE ---
test("source-driven editor browser contracts", async (t) => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await install(page);
    await t.test("completed syntax renders inline and unrelated document nodes survive typing", async () => {
      await page.evaluate(() => {
        render("First paragraph\n\nSecond paragraph");
        window.unaffected = document.querySelectorAll(".byEDline")[2];
        editor.setSelection(15);
      });
      await page.keyboard.type(" **bold** and *italic* and ~~gone~~");
      assert.match(await page.locator(".byEDsurface strong").textContent(), /bold/);
      assert.match(await page.locator(".byEDsurface em").textContent(), /italic/);
      assert.match(await page.locator(".byEDsurface del").textContent(), /gone/);
      assert.equal(await page.locator(".byEDsurface strong").evaluate((node) => Number(getComputedStyle(node).fontWeight) >= 600), true);
      assert.equal(await page.evaluate(() => unaffected === document.querySelectorAll(".byEDline")[2]), true);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "First paragraph **bold** and *italic* and ~~gone~~\n\nSecond paragraph");
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      assert.equal(
        await page
          .locator(".byEDsurface strong .byEDsyntax")
          .first()
          .evaluate((node) => getComputedStyle(node).display),
        "none"
      );
    });
    await t.test("modes preserve exact source, CRLF, escapes, entities, comments and unknown constructs", async () => {
      const source = "\uFEFF# Heading\r\n\r\n**bold** &amp; \\*literal*\r\n\r\n- Parent\r\n  - Child\r\n\r\n<!-- hidden -->\r\n";
      await page.evaluate((source) => render(source), source);
      for (const mode of ["assisted", "source", "clean", "source", "clean"]) {
        await page.evaluate((mode) => editor.setSyntaxMode(mode), mode);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      }
      assert.equal((await page.locator('.byEDline[data-type="source"]').count()) > 0, true);
      assert.equal(await page.evaluate(() => changes.at(-1)), undefined);
    });
    await t.test("Clean, Assisted, and Source switch through the picker and share editing history", async () => {
      const source = "# Heading\n\nA **bold** word.";
      await page.evaluate((source) => {
        render(source);
        editor.setSelection(3);
      }, source);
      assert.equal(await page.locator('.byEDline[data-type="heading"] .byEDsyntax').evaluate((node) => getComputedStyle(node).display), "inline");
      assert.equal(
        await page
          .locator("strong .byEDsyntax")
          .first()
          .evaluate((node) => getComputedStyle(node).display),
        "none"
      );
      await page.getByLabel("Syntax visibility", { exact: true }).selectOption("assisted");
      assert.equal(await page.locator(".byEDsyntax").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === "inline")), true);
      assert.equal(
        await page
          .locator("strong .byEDsyntax")
          .first()
          .evaluate((node) => getComputedStyle(node).color !== getComputedStyle(node.closest(".byEDline")).color),
        true
      );
      await page.getByLabel("Syntax visibility", { exact: true }).selectOption("source");
      assert.equal(await page.locator(".byEDsource").isVisible(), true);
      assert.equal(await page.locator(".byEDsurface").isVisible(), false);
      assert.equal(await page.locator(".byEDsource").inputValue(), source);
      await page.evaluate(() => editor.setSelection(editor.getMarkdown().length));
      await page.keyboard.type(" More text.");
      await page.getByLabel("Syntax visibility", { exact: true }).selectOption("clean");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), `${source} More text.`);
      await page.evaluate(() => {
        editor.focus();
        editor.command("undo");
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      assert.equal(await page.locator(".byEDsurface").isVisible(), true);
    });
    await t.test("Source editing maps normalized textarea offsets back to mixed source endings", async () => {
      await page.evaluate(() => {
        render("One\r\nTwo\rThree\nFour", { syntax: "source" });
        editor.setSelection(5, 8);
      });
      await page.keyboard.type("New");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "One\r\nNew\rThree\nFour");
      await page.keyboard.press("Control+z");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "One\r\nTwo\rThree\nFour");
      await page.evaluate(() => editor.setSelection(5, 8));
      await page.keyboard.press("Control+b");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "One\r\n**Two**\rThree\nFour");
      await page.evaluate(() => {
        editor.setSelection(3, 5);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "One**Two**\rThree\nFour");
      await page.evaluate(() => {
        editor.setMarkdown("A\r\nB\r\nC");
        editor.setSelection(4);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("x");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A\r\nB\r\nx\r\nC");
      await page.evaluate(() => editor.setSyntaxMode("clean"));
      assert.deepEqual(await page.locator(".byEDline").allTextContents(), ["A", "B", "x", "C"]);
    });
    await t.test("clicking empty lines updates the caret, active line, and typing destination", async () => {
      for (const eol of ["\n", "\r\n"]) {
        const source = ["Before", "", "## Heading", "", "After", ""].join(eol);
        for (const index of [0, 1, 2]) {
          await page.evaluate((source) => {
            render(source);
            editor.setSelection(source.indexOf("Heading") + 2);
          }, source);
          await page
            .locator('.byEDline[data-type="blank"]')
            .nth(index)
            .click({ position: { x: 2, y: 2 } });
          const offset = [source.indexOf(eol) + eol.length, source.indexOf("After") - eol.length, source.length][index];
          assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: offset, focus: offset });
          await page.waitForFunction(() => document.querySelector(".byEDline.is-active")?.dataset.type === "blank");
          assert.equal(await page.locator(".byEDline.is-active").getAttribute("data-type"), "blank");
          await page.keyboard.type("New");
          assert.equal(await page.evaluate(() => editor.getMarkdown()), `${source.slice(0, offset)}New${source.slice(offset)}`);
          await page.keyboard.press("Control+z");
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        }
      }
      const source = "## Heading\n\n~~~js\n\n~~~";
      await page.evaluate((source) => {
        render(source);
        editor.setSelection(5);
      }, source);
      await page.locator('.byEDline[data-type="code"]').click({ position: { x: 2, y: 2 } });
      await page.keyboard.type("value");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source.replace("~~~js\n", "~~~js\nvalue"));
      await page.evaluate(() => {
        render("\n## Heading");
        editor.setSelection(5);
      });
      await page.keyboard.press("ArrowUp");
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 0, focus: 0 });
      await page.keyboard.type("First");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "First\n## Heading");
    });
    await t.test("selection formatting, toolbar focus and undo/redo share one source history", async () => {
      await page.evaluate(() => {
        render("Hello world");
        editor.setSelection(6, 11);
      });
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **world**");
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 8, focus: 13 });
      await page.keyboard.press("Control+b");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello world");
      await page.keyboard.press("Control+z");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **world**");
      await page.keyboard.press("Control+Shift+z");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello world");
      await page.evaluate(() => editor.setSelection(5, 0));
      await page.keyboard.press("Control+i");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "*Hello* world");
    });
    await t.test("deleting a formatting boundary preserves letters and Unicode graphemes", async () => {
      await page.evaluate(() => {
        render("**word**");
        editor.setSelection(6);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "**word*");
      await page.evaluate(() => {
        render("A👨‍👩‍👧‍👦");
        editor.setSelection(editor.getMarkdown().length);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A");
      await page.evaluate(() => {
        render("5 * 4");
        editor.setSelection(2);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "5* 4");
    });
    await t.test("native Select All replaces the complete document including hidden syntax", async () => {
      await page.evaluate(() => {
        render("# Title\n\n**bold**");
        editor.focus();
      });
      await page.keyboard.press("Control+a");
      await page.keyboard.type("Replacement");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
      await page.keyboard.press("Control+z");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "# Title\n\n**bold**");
    });
    await t.test("Enter adds one source break in every mode and preserves line endings and undo", async () => {
      for (const syntax of ["no-code", "clean", "assisted", "source"]) {
        for (const [source, from, to, eol] of [
          ["Hello", 5, 5, "\n"],
          ["Hello\r\nTail", 2, 2, "\r\n"],
          ["Hello\nTail", 1, 4, "\n"]
        ]) {
          await page.evaluate(
            ({ source, syntax, from, to }) => {
              render(source, { syntax });
              editor.setSelection(from, to);
            },
            { source, syntax, from, to }
          );
          await page.keyboard.press("Enter");
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source.slice(0, from) + eol + source.slice(to), syntax);
          const caret = from + eol.length;
          assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: caret, focus: caret });
          await page.evaluate(() => editor.command("undo"));
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
          await page.evaluate(() => editor.command("redo"));
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source.slice(0, from) + eol + source.slice(to));
        }
      }
    });
    await t.test("Enter continues lists and exits empty list items", async () => {
      await page.evaluate(() => {
        render("Hello");
        editor.setSelection(5);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("World");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello\nWorld");
      await page.evaluate(() => {
        render("- One");
        editor.setSelection(5);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Two");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "- One\n- Two");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "- One\n- Two\n");
      await page.evaluate(() => {
        render("First\nSecond\nThird");
        editor.setSelection(5);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Between");
      assert.deepEqual(await page.locator(".byEDline").allTextContents(), ["First", "Between", "Second", "Third"]);
    });
    await t.test("headings, lists, quote and divider commands produce viewer-compatible Markdown", async () => {
      await page.evaluate(() => {
        render("Document");
        editor.setSelection(0, 8);
        editor.command("heading", 2);
      });
      assert.equal(await page.locator(".byEDsurface h2").count(), 1);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "## Document");
      await page.evaluate(() => editor.command("paragraph"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Document");
      await page.evaluate(() => editor.command("checklist"));
      await page.locator(".byEDtask").check();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "- [x] Document");
      await page.evaluate(() => editor.command("blockquote"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "> Document");
      await page.evaluate(() => {
        editor.setSelection(editor.getMarkdown().length);
        editor.command("horizontalRule");
      });
      assert.match(await page.evaluate(() => editor.getMarkdown()), /---/);
    });
    await t.test("task checkboxes stay in the gutter when focused syntax appears", async () => {
      const source = "- [x] First task\n- [ ] Second task\n- [ ] Third task";
      for (const syntax of ["clean", "assisted"]) {
        for (const size of ["1rem", "1.5rem"]) {
          await page.evaluate(
            ({ source, syntax, size }) => {
              render(source, { syntax });
              document.getElementById("editor").style.fontSize = size;
            },
            { source, syntax, size }
          );
          const before = await page.locator(".byEDtask").evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().x));
          await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("Third") + 2));
          const geometry = await page.locator(".byEDtask").evaluateAll((boxes) =>
            boxes.map((box) => {
              const rect = box.getBoundingClientRect(),
                line = box.closest(".byEDline"),
                prefix = line.querySelector(".byEDsyntax");
              return {
                x: rect.x,
                right: rect.right,
                prefixX: prefix.getBoundingClientRect().x,
                prefixVisible: getComputedStyle(prefix).display !== "none",
                center: rect.y + rect.height / 2 - line.getBoundingClientRect().y,
                lineHeight: parseFloat(getComputedStyle(line).lineHeight)
              };
            })
          );
          assert.deepEqual(
            geometry.map((box) => box.x),
            before
          );
          for (const box of geometry) {
            if (box.prefixVisible) assert.ok(box.right <= box.prefixX, "checkbox must not cover the Markdown task prefix");
            assert.ok(Math.abs(box.center - box.lineHeight / 2) < 0.5, "checkbox must align with the first text line");
          }
          await page.locator(".byEDtask").nth(2).focus();
          await page.keyboard.press("Space");
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source.replace("- [ ] Third", "- [x] Third"));
          assert.equal(
            await page
              .locator(".byEDtask")
              .nth(2)
              .evaluate((box) => document.activeElement === box),
            true
          );
        }
      }
      await page.locator("#editor").evaluate((element) => element.style.removeProperty("font-size"));
    });
    await t.test("table dialog, direct cell editing, Tab navigation and stable surrounding rows", async () => {
      await page.evaluate(() => {
        render("");
        editor.focus();
      });
      await page.getByRole("button", { name: "Table", exact: true }).click();
      await page.getByLabel("Data rows", { exact: true }).fill("3");
      await page.getByLabel("Columns", { exact: true }).fill("2");
      await page.getByRole("button", { name: "Insert", exact: true }).click();
      assert.equal(await page.locator(".byEDsurface table").count(), 1);
      assert.equal(await page.locator('.byEDline[data-type="tableRow"]').count(), 3);
      await page.getByRole("button", { name: "Table", exact: true }).focus();
      const selectedRowActive = await page.evaluate(() => {
        const source = editor.getMarkdown();
        editor.setSelection(source.indexOf("|   |") + 2);
        window.lastRow = document.querySelectorAll('.byEDline[data-type="tableRow"]')[2];
        return document.getSelection().focusNode.parentElement.closest(".byEDline").classList.contains("is-active");
      });
      assert.equal(selectedRowActive, true);
      await page.keyboard.type("Andres");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /Andres/);
      assert.equal(await page.evaluate(() => lastRow === document.querySelectorAll('.byEDline[data-type="tableRow"]')[2]), true);
      await page.keyboard.press("Tab");
      await page.keyboard.type("Developer");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /^\| [^\n]*Andres[^\n]*Developer[^\n]*\|$/m);
    });
    await t.test("links, image descriptions and code fences preserve selected content", async () => {
      await page.evaluate(() => {
        render("hello");
        editor.setSelection(0, 5);
        editor.command("link", { url: "https://example.com" });
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "[hello](https://example.com)");
      await page.evaluate(() => {
        render("photo");
        editor.setSelection(0, 5);
        editor.command("image", { url: "https://example.com/photo.png" });
      });
      assert.equal(await page.locator(".byEDimage").getAttribute("alt"), "photo");
      await page.evaluate(() => {
        render("const x = `value`;");
        editor.setSelection(0, editor.getMarkdown().length);
        editor.command("codeBlock", "javascript");
      });
      assert.match(await page.evaluate(() => editor.getMarkdown()), /```javascript\nconst x = `value`;\n```/);
    });
    await t.test("editable code uses CODE's multiline scanner and preserves source and caret", async () => {
      const source = "~~~js\n/* A comment\nconst hidden = 1;\n*/\nconst value = `Hello ${name}`;\n~~~\n\nAfter";
      await page.evaluate((source) => render(source), source);
      await page.locator(".byEDsurface .byCODEkeyword").waitFor();
      assert.equal(await page.locator('.byEDline[data-type="code"]').nth(1).locator(".byCODEkeyword").count(), 0);
      assert.equal(await page.locator('.byEDline[data-type="code"]').nth(1).locator(".byCODEcomment").textContent(), "const hidden = 1;");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      const caret = source.indexOf("value") + 2;
      await page.evaluate((caret) => {
        editor.setSelection(caret);
        window.codeText = document.getSelection().focusNode;
      }, caret);
      await page.keyboard.type("X");
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
      assert.equal(await page.evaluate(() => codeText.isConnected), true);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: caret + 1, focus: caret + 1 });
      const edited = `${source.slice(0, caret)}X${source.slice(caret)}`;
      assert.equal(await page.evaluate(() => editor.getMarkdown()), edited);
      const copied = await page.evaluate(() => {
        editor.setSelection(0, editor.getMarkdown().length);
        const clipboard = new DataTransfer();
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: clipboard }));
        return clipboard.getData("text/plain");
      });
      assert.equal(copied, edited);
      await page.evaluate(() => {
        editor.setSyntaxMode("source");
        editor.setSelection(3, 5);
      });
      await page.keyboard.type("plain");
      await page.evaluate(() => editor.setSyntaxMode("clean"));
      await page.waitForFunction(() => document.querySelectorAll(".byEDsurface .byCODEtoken").length === 0);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), edited.replace("~~~js", "~~~plain"));
      await page.evaluate((source) => render(source, { codeHighlighting: false }), source);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      assert.equal(await page.locator(".byEDsurface .byCODEtoken").count(), 0);
      await page.evaluate(() => render("~~~js\n" + Array.from({ length: 2000 }, (_, index) => `const value${index} = ${index};`).join("\n") + "\n~~~"));
      await page.locator(".byEDsurface .byCODEkeyword").first().waitFor();
      await page.evaluate(() => editor.setMarkdown("Replacement"));
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      assert.equal(await page.locator(".byEDsurface .byCODEtoken").count(), 0);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
    });
    await t.test("Clean reveals both fences only for the code block being edited", async () => {
      const source = "~~~javascript\nconst value = 1;\n~~~\n\nOutside\n\n```python\nprint(value)\n```";
      await page.evaluate((source) => render(source), source);
      const first = page.locator(".byEDgroup-fence").nth(0),
        second = page.locator(".byEDgroup-fence").nth(1);
      const fences = '[data-type="fenceOpen"], [data-type="fenceClose"]';
      assert.equal(await first.locator(fences).first().isVisible(), false);
      assert.equal(await second.locator(fences).first().isVisible(), false);
      const caret = source.indexOf("value");
      await page.evaluate((caret) => editor.setSelection(caret), caret);
      assert.deepEqual(await first.locator(fences).allTextContents(), ["~~~javascript", "~~~"]);
      assert.equal(await first.locator(fences).evaluateAll((lines) => lines.every((line) => getComputedStyle(line).display !== "none" && getComputedStyle(line.querySelector(".byEDsyntax")).display !== "none")), true);
      assert.equal(await second.locator(fences).first().isVisible(), false);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: caret, focus: caret });
      await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("print")));
      assert.equal(await first.locator(fences).first().isVisible(), false);
      assert.equal(await second.locator(fences).last().isVisible(), true);
      await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("Outside")));
      assert.equal(await first.locator(fences).first().isVisible(), false);
      assert.equal(await second.locator(fences).last().isVisible(), false);
      await first.locator('[data-type="code"]').click();
      await first.locator('[data-type="fenceOpen"]').waitFor({ state: "visible" });
      assert.equal(await first.locator('[data-type="fenceClose"]').isVisible(), true);
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await first.locator('[data-type="fenceOpen"]').waitFor({ state: "hidden" });
      assert.equal(await first.locator('[data-type="fenceClose"]').isVisible(), false);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    });
    await t.test("native word input preserves mapped nodes, inline formatting and history", async () => {
      await page.evaluate(() => {
        render("A **word** and a tail\n\nUnchanged");
        editor.setSelection(7);
        window.keptText = document.querySelector(".byEDsurface strong").childNodes[1];
      });
      await page.keyboard.type("123 more");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A **wor123 mored** and a tail\n\nUnchanged");
      assert.equal(await page.evaluate(() => keptText === document.querySelector(".byEDsurface strong").childNodes[1]), true);
      await page.keyboard.press("Control+z");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A **word** and a tail\n\nUnchanged");
      await page.keyboard.press("Control+Shift+z");
      await page.evaluate(() => editor.setSelection(4, 16));
      await page.keyboard.press("Control+b");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A wor123 mored and a tail\n\nUnchanged");
      await page.evaluate(() => {
        render("**word**");
        editor.setSelection(3);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "**ord**");
      await page.keyboard.type("w");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "**word**");
      await page.evaluate(() => editor.setSelection(4));
      await page.keyboard.press("Control+b");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "word");
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 2, focus: 2 });
    });
    await t.test("table Enter navigates rows, appends safely, and refuses multiline formatting", async () => {
      await page.evaluate(() => {
        render("| A | B |\n| --- | --- |\n| One | Two |\n\nOutside");
        editor.setSelection(2);
      });
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => editor.getSelection().focus), 26);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator('.byEDline[data-type="tableRow"]').count(), 2);
      const source = await page.evaluate(() => editor.getMarkdown());
      await page.keyboard.press("Shift+Enter");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      await page.evaluate(() => {
        editor.setSelection(2, 7);
        editor.command("bold");
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      await page.evaluate(() => {
        render("| A | B |\n| --- | --- |");
        editor.setSelection(2);
      });
      await page.keyboard.press("Enter");
      assert.equal(await page.locator('.byEDline[data-type="tableRow"]').count(), 1);
      assert.match(await page.evaluate(() => editor.getMarkdown()), /\| --- \| --- \|\n\|/);
      await page.keyboard.type("a|b");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /a\\\|b/);
      assert.equal(await page.locator('[data-type="tableRow"] td').count(), 2);
    });
    await t.test("formatting retains mixed line endings and rejects cross-paragraph wrapping", async () => {
      const result = await page.evaluate(() => {
        render("One\r\n\r\nTwo\rThree\nFour");
        editor.setSelection(0, editor.getMarkdown().length);
        editor.command("bulletList");
        const listed = editor.getMarkdown();
        editor.command("bold");
        return { listed, after: editor.getMarkdown() };
      });
      assert.equal(result.listed, "- One\r\n\r\n- Two\r- Three\n- Four");
      assert.equal(result.after, result.listed);
    });
    await t.test("plain-text paste and copy are safe and do not round-trip through HTML", async () => {
      const result = await page.evaluate(() => {
        render("Hello");
        editor.setSelection(5);
        const clipboard = new DataTransfer();
        clipboard.setData("text/plain", '<img src=x onerror="window.injected=1"> **safe**');
        clipboard.setData("text/html", '<img src=x onerror="window.injected=1">');
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
        const value = editor.getMarkdown();
        editor.setSelection(0, value.length);
        const copy = new DataTransfer();
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: copy }));
        return { value, copied: copy.getData("text/plain"), injected: Boolean(window.injected), images: document.querySelectorAll(".byEDsurface img").length };
      });
      assert.equal(result.value, result.copied);
      assert.equal(result.injected, false);
      assert.equal(result.images, 0);
    });
    await t.test("IME owns the active DOM until composition commits", async () => {
      const result = await page.evaluate(() => {
        render("Hello ");
        editor.setSelection(6);
        const surface = document.querySelector(".byEDsurface"),
          text = surface.querySelector(".byEDline").firstChild;
        surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        text.appendData("日本語");
        surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "日本語" }));
        const before = editor.getSelection();
        const during = editor.getMarkdown();
        surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
        return { source: editor.getMarkdown(), changes: changes.at(-1), before, during };
      });
      assert.equal(result.source, "Hello 日本語");
      assert.equal(result.changes, result.source);
      assert.equal(result.during, "Hello ");
    });
    await t.test("preview uses the actual MD and CODE renderers and restores the caret", async () => {
      await page.addScriptTag({ path: path.join(root, "../easy-code-viewer/code.js") });
      await page.addStyleTag({ path: path.join(root, "../easy-code-viewer/code.css") });
      const source = "# Title\n\n~~~js\nconst value = 1;\n~~~";
      await page.evaluate((source) => {
        render(source);
        editor.setSelection(5);
        editor.setPreview(true);
      }, source);
      assert.equal(await page.locator(".byEDpreview h1").textContent(), "Title");
      assert.equal(await page.locator(".byEDpreview .byCODEkeyword").textContent(), "const");
      assert.equal(await page.locator(".byEDsurface").isVisible(), false);
      await page.evaluate(() => editor.setPreview(false));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 5, focus: 5 });
    });
    await t.test("keyboard dialogs, toolbar visibility, themes and instance teardown", async () => {
      await page.evaluate(() => {
        render("**Text**");
        editor.setSelection(2, 6);
      });
      await page.getByRole("button", { name: "Link", exact: true }).click();
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 2, focus: 6 });
      await page.evaluate(() => editor.setToolbar(false));
      assert.equal(await page.locator(".byEDtoolbar").isVisible(), false);
      await page.getByRole("button", { name: "Formatting", exact: true }).click();
      assert.equal(await page.locator(".byEDtoolbar").isVisible(), true);
      await page.getByLabel("Paragraph style", { exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.command), "bold");
      assert.equal(await page.locator('.byEDtoolbar [tabindex="0"]').count(), 1);
      await page.evaluate(() => editor.setTheme("dark"));
      assert.equal(await page.locator("#editor").getAttribute("data-theme"), "github");
      assert.equal(await page.locator("#editor").evaluate((root) => root.classList.contains("dark")), true);
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      assert.equal(await page.locator(".byEDsurface").isVisible(), true);
      await page.emulateMedia({ forcedColors: "none" });
      await page.evaluate(() => {
        window.previous = editor;
        render("Replacement");
        previous.destroy();
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
      await page.evaluate(() => editor.destroy());
      assert.equal(await page.locator("#editor > *").count(), 0);
    });
    await t.test("theme switch and Formatting underline reflect their current state", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => render("**Text**", { palette: "github", theme: "light" }));
      const formatting = page.getByRole("button", { name: "Formatting", exact: true });
      assert.notEqual(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
      await formatting.click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "false");
      assert.equal(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
      await formatting.click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "true");
      const theme = page.locator("#editor .byVIEWthemeToggle");
      assert.equal(await theme.locator('svg[aria-hidden="true"]').count(), 2);
      await theme.click();
      assert.equal(await theme.getAttribute("aria-label"), "Switch to light theme");
      assert.equal(await page.locator("#editor").getAttribute("data-theme"), "github");
      assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-toggle-position").trim()), "0%");
      await theme.press("Space");
      assert.equal(await theme.getAttribute("aria-label"), "Switch to dark theme");
      assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-toggle-position").trim()), "-100%");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "false");
      assert.equal(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "true");
      assert.notEqual(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
    });
    await t.test("palettes match the viewer in every mode and preserve document state", async () => {
      await page.addStyleTag({ path: path.join(__dirname, "../../easy-md-viewer/md.themes.css") });
      const source = "# Palette\n\n**Text**\n\n~~~js\nconst value = 1;\n~~~";
      await page.evaluate((source) => {
        render(source, { palette: "github", theme: "dark" });
        editor.setSelection(4, 7);
      }, source);
      assert.equal(await page.getByLabel("Color palette", { exact: true }).inputValue(), "github");
      const names = await page
        .getByLabel("Color palette", { exact: true })
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.value));
      assert.equal(names.length, 48);
      assert.equal(await page.getByLabel("Color palette", { exact: true }).locator("optgroup").count(), 5);
      for (const palette of names) {
        await page.getByLabel("Color palette", { exact: true }).selectOption(palette);
        assert.equal(await page.locator("#editor").evaluate((element) => element.classList.contains("dark")), true);
        for (const mode of ["light", "dark"]) {
          await page.evaluate(
            ({ mode, palette }) => {
              editor.setTheme(mode);
              const reference = document.getElementById("other");
              reference.className = `byMDdocument ${mode}`;
              reference.dataset.theme = palette;
            },
            { mode, palette }
          );
          for (const syntax of ["no-code", "clean", "assisted", "source"]) {
            await page.getByLabel("Syntax visibility", { exact: true }).selectOption(syntax);
            assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).backgroundColor === getComputedStyle(document.getElementById("other")).backgroundColor), true);
            if (syntax === "source") assert.equal(await page.locator(".byEDsource").evaluate((element) => getComputedStyle(element).backgroundColor === getComputedStyle(document.getElementById("editor")).backgroundColor), true);
          }
          await page.evaluate(() => editor.setPreview(true));
          assert.equal(await page.locator(".byEDpreview").evaluate((element) => getComputedStyle(element).backgroundColor === getComputedStyle(document.getElementById("editor")).backgroundColor), true);
          await page.evaluate(() => editor.setPreview(false));
          assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
          assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 4, focus: 7 });
        }
      }
      assert.deepEqual(await page.evaluate(() => changes), []);
      await page.addStyleTag({ content: '.byMDdocument[data-theme="custom-paper"] { --by-md-bg: #fff8ee; --by-md-text: #382b20; } .byMDdocument.dark[data-theme="custom-paper"] { --by-md-bg: #201a16; --by-md-text: #fff8ee; }' });
      await page.evaluate(() => editor.setPalette("custom-paper"));
      assert.equal(await page.getByLabel("Color palette", { exact: true }).inputValue(), "custom-paper");
      assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(32, 26, 22)");
      await page.evaluate(() => {
        editor.setTheme("light");
        editor.setPreview(true);
      });
      assert.equal(await page.locator(".byEDpreview").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 248, 238)");
      await page.evaluate(() => render("Minimal", { paletteSelect: false, palette: "solarized" }));
      assert.equal(await page.getByLabel("Color palette", { exact: true }).count(), 0);
      assert.equal(await page.locator("#editor").getAttribute("data-theme"), "solarized");
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

// --- COMPANION FALLBACK ---
test("without companions, source editing and formatting remain usable", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await install(page, false);
    await page.evaluate(() => {
      render("Hello");
      editor.setSelection(0, 5);
      editor.command("bold");
    });
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "**Hello**");
    await page.locator('[data-command="italic"]').click();
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "***Hello***");
    await page.locator('[data-command="bold"]').click();
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "*Hello*");
    await page.locator('[data-command="italic"]').click();
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello");
    assert.equal(await page.locator(".byEDsource").isVisible(), true);
    await page.evaluate(() => editor.setPreview(true));
    assert.equal(await page.locator(".byEDsource").isVisible(), true);
    assert.equal(warnings.length, 1, "Missing MD is reported once per editor initialization");
    assert.match(warnings[0], /easy-md-editor:.*easy-md-viewer.*Source editing remains available\. https:\/\/byuwur\.github\.io\/easy-md-viewer\//);
  } finally {
    await browser.close();
  }
});

// --- SURFACES ---
test("document and content backgrounds stay independent through theme and toolbar changes", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, channel: process.env.BROWSER_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) => (route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ body: "", contentType: "text/css" }) : route.abort()));
    await page.setContent('<div id="viewer" data-theme="light"></div><div id="neighbor" data-theme="light"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../../easy-md-viewer/md.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../../easy-md-viewer/md.js") });
    await page.addStyleTag({ path: path.join(__dirname, "../md.edit.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../md.edit.js") });
    await page.evaluate(async () => {
      for (const id of ["viewer", "neighbor"]) {
        const result = byMDeditor(document.getElementById(id), "# Heading");
        await result?.ready;
      }
    });
    const root = page.locator("#viewer");
    const neighbor = await page.locator("#neighbor").evaluate((element) => getComputedStyle(element).backgroundColor);
    await root.evaluate((element) => {
      element.style.setProperty("--by-view-document-bg", "transparent");
      element.style.setProperty("--by-view-container-bg", "#123456");
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#viewer .byEDcontrols .byEDbutton")).backgroundColor === "rgb(18, 52, 86)");
    for (const changeMode of [false, true]) {
      if (changeMode) await root.locator(".byVIEWthemeToggle").click();
      await page.waitForFunction(() => getComputedStyle(document.getElementById("viewer")).backgroundColor === "rgba(0, 0, 0, 0)");
      assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
      assert.equal(await root.locator(".byEDsurface").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(18, 52, 86)");
      assert.equal(
        await root
          .locator(".byEDcontrols .byEDbutton")
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgb(18, 52, 86)"
      );
      assert.equal(await root.locator(".byEDbar").evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
    }
    assert.equal(await page.locator("#neighbor").evaluate((element) => getComputedStyle(element).backgroundColor), neighbor);
    await root.evaluate((element) => element.style.removeProperty("--by-view-container-bg"));
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#viewer .byEDcontrols .byEDbutton")).backgroundColor === "rgb(13, 17, 23)");
    assert.notEqual(
      await root
        .locator(".byEDcontrols .byEDbutton")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(0, 0, 0, 0)"
    );
  } finally {
    await browser.close();
  }
});

// --- INTERACTION MOTION ---
test("Clean markers animate closed after line breaks and local reparses", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await install(page);
    for (const [source, offset, key, expected] of [
      ["# Heading\n\nOther", 9, "Enter", "# Heading\n\n\nOther"],
      ["# Heading\n\nOther", 5, "Enter", "# Hea\nding\n\nOther"],
      ["# Heading\n\nOther", 9, "Shift+Enter", "# Heading  \n\n\nOther"],
      ["A **bold** word.\n\nOther", 16, "Enter", "A **bold** word.\n\n\nOther"]
    ]) {
      await page.evaluate(
        ({ source, offset }) => {
          render(source, { syntax: "clean", animations: true });
          editor.setSelection(offset);
          window.leavingMarker = document.querySelector(".byEDline.is-active .byEDsyntax");
          window.markerTransitions = [];
        },
        { source, offset }
      );
      await page.evaluate(() => Promise.allSettled(leavingMarker.getAnimations().map((animation) => animation.finished)));
      await page.evaluate(() =>
        leavingMarker.addEventListener("transitionrun", (event) => {
          markerTransitions.push({ property: event.propertyName, active: leavingMarker.closest(".byEDline").classList.contains("is-active") });
        })
      );
      await page.keyboard.press(key);
      await page.waitForFunction(() => markerTransitions.some((event) => ["inline-size", "width"].includes(event.property) && !event.active), null, { timeout: 2000 });
      await page.evaluate(() => Promise.allSettled(leavingMarker.getAnimations().map((animation) => animation.finished)));
      assert.equal(await page.evaluate(() => getComputedStyle(leavingMarker).opacity), "0");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), expected);
      const caret = offset + (key === "Shift+Enter" ? 3 : 1);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: caret, focus: caret });
      await page.keyboard.type("Next");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), expected.slice(0, caret) + "Next" + expected.slice(caret));
      await page.evaluate(() => {
        editor.command("undo");
        editor.command("undo");
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    }
  } finally {
    await browser.close();
  }
});

test("animation options preserve initial visibility and override system motion preferences", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("https://cdn.jsdelivr.net/**", (route) => (route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ body: "", contentType: "text/css" }) : route.abort()));
    await page.setContent('<div id="motion-viewer" data-theme="light"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../../easy-md-viewer/md.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../../easy-md-viewer/md.js") });
    await page.addStyleTag({ path: path.join(__dirname, "../md.edit.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../md.edit.js") });
    await page.evaluate(() => {
      window.renderMotion = async (animations, appearAnimation = false) => {
        window.motionController = byMDeditor(document.getElementById("motion-viewer"), "# Heading\n\nUseful text.", { animations, appearAnimation });
        await motionController?.ready;
      };
    });
    await page.evaluate(() => renderMotion());
    const root = page.locator("#motion-viewer");
    assert.equal(await root.evaluate((element) => element.classList.contains("byVIEWmotion")), true);
    assert.equal(await root.evaluate((element) => getComputedStyle(element).opacity), "1");
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0, "Initial content does not animate");
    assert.equal(
      await root
        .locator("button")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration.split(",")[0]),
      "0.18s"
    );
    const disclosure = await root.evaluateHandle((element) => {
      const details = document.createElement("details");
      details.id = "motion-disclosure";
      details.innerHTML = "<summary>Details</summary><p>Already available content</p>";
      element.append(details);
      getComputedStyle(details, "::details-content").blockSize;
      return details;
    });
    await disclosure.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "0");
    const opening = await disclosure.evaluate(async (details) => {
      details.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Number(getComputedStyle(details, "::details-content").opacity);
    });
    assert.ok(opening > 0 && opening < 1, "A deliberate disclosure eases in even with reduced motion requested");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "1");
    await disclosure.evaluate((details) => {
      details.open = false;
    });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "0");
    assert.equal(await disclosure.evaluate((details) => details.open), false);
    const before = await page.evaluate(() => ({ markdown: motionController.getMarkdown(), selection: motionController.getSelection() }));
    await page.evaluate(() => motionController.setAnimations(false));
    assert.deepEqual(await page.evaluate(() => ({ markdown: motionController.getMarkdown(), selection: motionController.getSelection() })), before);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await root.evaluate((element) => element.classList.contains("byVIEWmotion")), false);
    assert.equal(
      await root
        .locator("button")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      "0s"
    );
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
    await page.evaluate(() => {
      motionController.setAnimations(true);
      motionController.setSelection(2);
      window.unchangedMotionLine = document.querySelectorAll(".byEDline")[2];
    });
    const syntax = root.locator(".byEDline.byEDvisited.is-active .byEDsyntax").first();
    await syntax.waitFor();
    assert.equal(await syntax.evaluate((element) => element.getAnimations().some((animation) => ["inline-size", "width"].includes(animation.transitionProperty))), true, "Only the active markers ease into place");
    await syntax.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)));
    assert.deepEqual(await page.evaluate(() => motionController.getSelection()), { anchor: 2, focus: 2 });
    await page.keyboard.type("New ");
    assert.equal(await page.evaluate(() => motionController.getMarkdown()), before.markdown.replace("Heading", "New Heading"));
    assert.equal(await page.evaluate(() => unchangedMotionLine === document.querySelectorAll(".byEDline")[2]), true);
    await page.evaluate(() => motionController.command("undo"));
    assert.equal(await page.evaluate(() => motionController.getMarkdown()), before.markdown);
    await page.evaluate(() => motionController.setPreview(true));
    await page.emulateMedia({ media: "print" });
    assert.equal(await root.locator(".byEDpreview").evaluate((element) => getComputedStyle(element).opacity), "1", "Print never captures a partially faded document");
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await page.evaluate(() => renderMotion(true));
    await page.waitForFunction(() => document.getElementById("motion-viewer").classList.contains("byVIEWready"));
    const fade = await root.evaluate((element) => {
      const before = getComputedStyle(element).backgroundColor;
      element.querySelector('[aria-label^="Switch to"]').click();
      const transition = element.getAnimations().find((animation) => animation.transitionProperty === "background-color");
      if (!transition)
        return {
          active: false,
          before,
          after: getComputedStyle(element).backgroundColor,
          property: getComputedStyle(element).transitionProperty,
          duration: getComputedStyle(element).transitionDuration,
          classes: element.className,
          palette: element.dataset.theme
        };
      transition.pause();
      transition.currentTime = 90;
      const middle = getComputedStyle(element).backgroundColor;
      transition.finish();
      return { active: true, before, middle, after: getComputedStyle(element).backgroundColor, fontTransition: getComputedStyle(element).transitionProperty.includes("font-size") };
    });
    assert.equal(fade.active, true, "Theme backgrounds fade after the first paint " + JSON.stringify(fade));
    assert.notEqual(fade.middle, fade.before);
    assert.notEqual(fade.middle, fade.after);
    assert.equal(fade.fontTransition, false);
    await root.evaluate((element) => {
      element.dataset.theme = "high-contrast";
    });
    assert.equal(await root.evaluate((element) => element.getAnimations().filter((animation) => animation.transitionProperty === "background-color").length), 0);
    const entrance = await page.evaluate(async () => {
      await renderMotion(true, true);
      const element = document.getElementById("motion-viewer");
      const animation = element.getAnimations().find((animation) => animation.animationName === "byVIEWappear");
      if (!animation) return { active: false };
      animation.pause();
      animation.currentTime = 90;
      return { active: true, opacity: Number(getComputedStyle(element).opacity), content: element.textContent.length };
    });
    assert.equal(entrance.active, true, "Entrance motion is explicit even when the system requests reduced motion");
    assert.ok(entrance.opacity > 0 && entrance.opacity < 1);
    assert.ok(entrance.content > 0, "Rendering completes without waiting for the animation");
    await page.evaluate(() => renderMotion(false, true));
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0, "Animations off overrides the requested entrance");
  } finally {
    await browser.close();
  }
});

// --- INITIAL APPEARANCE ---
test("appearance options override markup and preserve independent viewer state", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ body: "", contentType: "text/css" }));
    await page.setContent('<style>html{font-size:20px}</style><div id="appearance" class="host light" data-theme="light"></div><div id="neighbor" class="dark" data-theme="monokai" style="font-size:2rem">Neighbor</div>');
    await page.addStyleTag({ path: path.join(__dirname, "../../easy-md-viewer/md.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../../easy-md-viewer/md.js") });
    await page.addStyleTag({ path: path.join(__dirname, "../md.edit.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../md.edit.js") });
    await page.evaluate(() => {
      window.appearanceTarget = document.getElementById("appearance");
      window.renderAppearance = async (options = {}) => {
        window.appearanceInstance = byMDeditor(appearanceTarget, "# Heading\n\nText", options);
        await appearanceInstance?.ready;
      };
    });
    const neighbor = await page.locator("#neighbor").evaluate((element) => element.outerHTML);
    await page.evaluate(() => renderAppearance({ theme: "dark", palette: "github", fontSize: 1.5, animations: false }));
    assert.deepEqual(
      await page
        .locator("#appearance")
        .evaluate((element) => [element.classList.contains("host"), element.classList.contains("dark"), element.classList.contains("light"), element.dataset.theme, element.style.fontSize, getComputedStyle(element).fontSize]),
      [true, true, false, "github", "1.5rem", "30px"]
    );
    const controls = page.locator("#appearance .byVIEWthemeToggle");
    assert.equal(await controls.getAttribute("aria-label"), "Switch to light theme");
    await controls.click();
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.classList.contains("light"), element.dataset.theme, element.style.fontSize]), [true, "github", "1.5rem"]);

    await page.evaluate(() => renderAppearance({ fontSize: 1.25 }));
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "25px");

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "30px", "The multiplier follows root text-size changes");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    for (const [fontSize, expected] of [
      ["1.25rem", 25],
      ["1.25em", 25],
      ["20px", 20],
      ["125%", 25],
      ["1px", 10],
      ["100px", 60],
      ["4em", 60]
    ]) {
      await page.evaluate((fontSize) => renderAppearance({ fontSize }), fontSize);
      assert.equal(await page.locator("#appearance").evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), expected, fontSize);
      const preset = await page.locator("#appearance").evaluate((element) => [element.style.fontSize, element.dataset.byViewDefaultFontSize]);
      assert.equal(preset[0], preset[1]);
    }
    await page.evaluate(() => {
      document.body.style.fontSize = "1.5rem";
      return renderAppearance({ fontSize: "1em" });
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "30px", "em remains relative to the parent");
    await page.evaluate(() => {
      document.body.style.fontSize = "";
      document.documentElement.style.fontSize = "24px";
      return renderAppearance({ fontSize: "100px" });
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "72px", "CSS values retain the rem limit when the root size changes");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    for (const [requested, expected] of [
      [-1, 0.5],
      [0, 0.5],
      [0.25, 0.5],
      [0.5, 0.5],
      [3, 3],
      [4, 3]
    ]) {
      await page.evaluate((fontSize) => renderAppearance({ fontSize }), requested);
      assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), `${expected}rem`);
      assert.equal(await page.locator("#appearance").evaluate((element) => element.dataset.byViewDefaultFontSize), `${expected}rem`);
    }
    await page.evaluate(() => {
      appearanceTarget.dataset.theme = "dark";
      appearanceTarget.classList.remove("dark");
      appearanceTarget.classList.add("light");
      return renderAppearance({ palette: "high-contrast", toolbar: false });
    });
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), getComputedStyle(element).colorScheme]), ["high-contrast", true, "dark"]);
    await page.evaluate(() => {
      appearanceTarget.dataset.theme = "dark";
      return renderAppearance({ theme: "light", toolbar: false });
    });
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), element.classList.contains("light")]), ["github", false, true]);
    await page.evaluate(() => renderAppearance({ theme: "dark", palette: "custom-ocean", fontSize: 1.125, toolbar: false }));
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), element.style.fontSize]), ["custom-ocean", true, "1.125rem"]);
    const preserved = await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]);
    await page.evaluate(() => renderAppearance());
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]), preserved);
    await page.evaluate(() => renderAppearance({ theme: null, palette: null, fontSize: null }));
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]), preserved, "Blank exported appearance fields retain the container settings");
    for (const options of [
      { theme: "sepia" },
      { palette: "dark" },
      { palette: "bad name" },
      { fontSize: NaN },
      { fontSize: Infinity },
      { fontSize: "wrong" },
      { fontSize: "inherit" },
      { fontSize: true },
      { theme: "light", palette: "github", fontSize: "1.25" }
    ]) {
      const before = await page.locator("#appearance").evaluate((element) => element.outerHTML);
      const name = await page.evaluate(async (options) => {
        try {
          await renderAppearance(options);
        } catch (error) {
          return error.name;
        }
      }, options);
      assert.equal(name, "RangeError");
      assert.equal(await page.locator("#appearance").evaluate((element) => element.outerHTML), before, "Invalid appearance must not replace the current document");
    }
    await page.evaluate(() => appearanceInstance.setPreview(true));
    assert.equal(await page.locator("#appearance .byEDpreview").evaluate((element) => getComputedStyle(element).fontSize), "22.5px");
    assert.equal(await page.locator("#neighbor").evaluate((element) => element.outerHTML), neighbor);
  } finally {
    await browser.close();
  }
});
