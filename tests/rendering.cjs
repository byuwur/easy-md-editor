const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const test = require("node:test");
const { chromium } = require("playwright");

const launch = () => chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const root = path.join(__dirname, "..");
async function install(page, viewer = true) {
  await page.route("https://cdn.jsdelivr.net/**", async (route) => {
    if (route.request().url().endsWith("fontawesome.min.css")) return route.fulfill({ body: await fs.readFile(path.join(root, "../spa.js/css/fontawesome.min.css")), contentType: "text/css" });
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
      window.editor = byMDeditor(document.getElementById("editor"), source, { onChange: (value) => changes.push(value), ...options });
    };
  });
}

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
    await t.test("Enter creates paragraphs, continues lists, and exits empty list items", async () => {
      await page.evaluate(() => {
        render("Hello");
        editor.setSelection(5);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("World");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello\n\nWorld");
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
      assert.deepEqual(await page.locator(".byEDline").allTextContents(), ["First", "", "Between", "Second", "Third"]);
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
      await page.evaluate(() => {
        const source = editor.getMarkdown();
        editor.setSelection(source.indexOf("|   |") + 2);
        window.lastRow = document.querySelectorAll('.byEDline[data-type="tableRow"]')[2];
      });
      await page.keyboard.type("Andres");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /Andres/);
      assert.equal(await page.evaluate(() => lastRow === document.querySelectorAll('.byEDline[data-type="tableRow"]')[2]), true);
      await page.keyboard.press("Tab");
      await page.keyboard.type("Developer");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /Andres[^\n]*Developer/);
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
      assert.equal(await page.locator("#editor").getAttribute("data-theme"), "dark");
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
      assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-toggle-position").trim()), "75%");
      await theme.press("Space");
      assert.equal(await theme.getAttribute("aria-label"), "Switch to dark theme");
      assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-toggle-position").trim()), "25%");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "false");
      assert.equal(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      assert.equal(await formatting.getAttribute("aria-expanded"), "true");
      assert.notEqual(await formatting.evaluate((button) => getComputedStyle(button).boxShadow), "none");
    });
    await t.test("palettes match the viewer in every mode and preserve document state", async () => {
      const source = "# Palette\n\n**Text**\n\n~~~js\nconst value = 1;\n~~~";
      await page.evaluate((source) => {
        render(source, { palette: "github", theme: "dark" });
        editor.setSelection(4, 7);
      }, source);
      assert.equal(await page.getByLabel("Color palette", { exact: true }).inputValue(), "github");
      for (const palette of ["monokai", "github", "solarized", "high-contrast"]) {
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
          for (const syntax of ["clean", "assisted", "source"]) {
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
      await page.addStyleTag({ content: '.byMDdocument[data-theme="paper"] { --by-md-bg: #fff8ee; --by-md-text: #382b20; } .byMDdocument.dark[data-theme="paper"] { --by-md-bg: #201a16; --by-md-text: #fff8ee; }' });
      await page.evaluate(() => editor.setPalette("paper"));
      assert.equal(await page.getByLabel("Color palette", { exact: true }).inputValue(), "paper");
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

test("without companions, source editing and formatting remain usable", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await install(page, false);
    await page.evaluate(() => {
      render("Hello");
      editor.setSelection(0, 5);
      editor.command("bold");
    });
    assert.equal(await page.evaluate(() => editor.getMarkdown()), "**Hello**");
    assert.equal(await page.locator(".byEDsource").isVisible(), true);
    await page.evaluate(() => editor.setPreview(true));
    assert.equal(await page.locator(".byEDsource").isVisible(), true);
  } finally {
    await browser.close();
  }
});

test("playground edits documents and exports exact Markdown", async () => {
  const server = require("./serve.cjs");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await launch();
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1100, height: 800 } });
    await page.route("https://cdn.jsdelivr.net/**", async (route) => {
      if (route.request().url().endsWith("bootstrap.min.css")) {
        const file = process.env.BOOTSTRAP_CSS_PATH || path.join(process.env.TEMP, "viewer-ecosystem-tests/bootstrap-v20.6.css");
        return route.fulfill({ body: await fs.readFile(file), contentType: "text/css" });
      }
      const companion = new URL(route.request().url()).pathname.match(/^\/gh\/byuwur\/(easy-(?:md|code)-viewer)@v\d+(?:\.\d+)*\/((?:md|code)\.(?:css|js))$/);
      if (companion) return route.fulfill({ path: path.join(root, "..", companion[1], companion[2]), contentType: companion[2].endsWith("css") ? "text/css" : "text/javascript" });
      const asset = new URL(route.request().url()).pathname.match(/\/spa\.js@v20\.6\/(css\/(?:shards|fontawesome\.min)\.css|js\/bootstrap\.min\.js)$/)?.[1];
      if (asset) return route.fulfill({ body: await fs.readFile(path.join(root, "../spa.js", asset)), contentType: asset.endsWith("css") ? "text/css" : "text/javascript" });
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".byEDsurface").waitFor();
    assert.equal(await page.locator(".byEDsurface").isVisible(), true);
    const releases = await page.evaluate(() => ({ md: byMDviewer.VERSION, code: byCODEviewer.VERSION }));
    assert.deepEqual(await page.locator('head [href*="easy-md-viewer"], head [href*="easy-code-viewer"], head [src*="easy-md-viewer"], head [src*="easy-code-viewer"]').evaluateAll((assets) => assets.map((asset) => asset.href || asset.src).sort()), [
      `https://cdn.jsdelivr.net/gh/byuwur/easy-code-viewer@v${releases.code}/code.css`,
      `https://cdn.jsdelivr.net/gh/byuwur/easy-code-viewer@v${releases.code}/code.js`,
      `https://cdn.jsdelivr.net/gh/byuwur/easy-md-viewer@v${releases.md}/md.css`,
      `https://cdn.jsdelivr.net/gh/byuwur/easy-md-viewer@v${releases.md}/md.js`
    ]);
    assert.equal(await page.locator(".navbar-brand").innerText(), "md↑easy-md-editor");
    assert.equal(await page.locator(".viewer-suite a").count(), 9);
    assert.equal(await page.locator(".viewer-suite").getByRole("link", { name: "MD.edit", exact: true }).getAttribute("href"), "https://byuwur.github.io/easy-md-editor/");
    assert.equal(await page.locator(".viewer-suite").getByRole("link", { name: "MD.edit", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#integration-cdn").isChecked(), true);
    const cdnHTML = await page.locator("#integration-code").inputValue();
    assert.match(cdnHTML, /easy-md-editor@latest\/md\.edit\.js/);
    assert.match(cdnHTML, /easy-md-editor@latest\/md\.edit\.css/);
    assert.equal(cdnHTML.includes("fontawesome"), false);
    assert.match(cdnHTML, /easy-md-viewer@latest\/md\.js/);
    assert.match(cdnHTML, /easy-code-viewer@latest\/code\.js/);
    assert.match(cdnHTML, /\n {2}<head>\n {4}<meta/);
    assert.equal((await page.locator("#source-size").textContent()) !== "", true);
    for (const level of [1, 2, 3, 4, 5, 6]) assert.ok((await page.locator(`.byEDsurface h${level}`).count()) > 0);
    for (const type of ["bullet", "ordered", "task", "tableHeader", "tableRow", "quote", "rule", "code"]) assert.ok((await page.locator(`.byEDsurface [data-type="${type}"]`).count()) > 0, `showcase must include ${type}`);
    for (const selector of ["strong", "em", "strong em", "del", ".byMDinlineCode", ".byMDlink", ".byEDimage"]) assert.ok((await page.locator(`.byEDsurface ${selector}`).count()) > 0, `showcase must include ${selector}`);
    await page.locator(".byEDsurface .byCODEkeyword").first().waitFor();
    const original = await page.evaluate(() => playgroundEditor.getMarkdown());
    for (const focused of [false, true]) {
      if (focused) await page.evaluate(() => playgroundEditor.setSelection(playgroundEditor.getMarkdown().indexOf("const markdown")));
      const spacing = await page.locator(".byEDgroup-fence").evaluate((block) => {
        const style = getComputedStyle(block),
          rect = block.getBoundingClientRect();
        const lines = [...block.querySelectorAll(".byEDline")].filter((line) => getComputedStyle(line).display !== "none");
        return { top: lines[0].getBoundingClientRect().top - rect.top, bottom: rect.bottom - lines.at(-1).getBoundingClientRect().bottom, expectedTop: parseFloat(style.paddingTop), expectedBottom: parseFloat(style.paddingBottom) };
      });
      assert.ok(Math.abs(spacing.top - spacing.expectedTop) < 0.5, "code must start at the container padding");
      assert.ok(Math.abs(spacing.bottom - spacing.expectedBottom) < 0.5, "code must end at the container padding");
    }
    await page.evaluate(() => playgroundEditor.setSelection(0));
    assert.notEqual(await page.locator("#copy-markdown i").evaluate((icon) => getComputedStyle(icon, "::before").content), "none");
    for (const mode of ["dark", "light"]) {
      await page.evaluate((mode) => {
        playgroundEditor.setTheme(mode);
        playgroundEditor.setPreview(true);
      }, mode);
      assert.equal(await page.locator(".byEDpreview .byMDcodeBlock code").evaluate((code) => getComputedStyle(code).color === getComputedStyle(code.closest(".byEDpreview")).color), true);
      assert.equal(
        await page
          .locator(".byEDpreview .byCODEkeyword")
          .first()
          .evaluate((token) => getComputedStyle(token).color !== getComputedStyle(token.closest("code")).color),
        true
      );
      await page.evaluate(() => playgroundEditor.setPreview(false));
      assert.equal(await page.locator(".byEDgroup-fence code").evaluate((code) => getComputedStyle(code).color === getComputedStyle(document.getElementById("editor")).color), true);
    }
    assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), original);
    await page.evaluate(() => {
      playgroundEditor.setSelection(0);
      playgroundEditor.command("bold");
    });
    assert.notEqual(await page.evaluate(() => playgroundEditor.getMarkdown()), original);
    await page.getByRole("button", { name: "Restore sample" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Markdown" }).click();
    assert.equal(await fs.readFile(await (await download).path(), "utf8"), original);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.copiedMarkdown = value;
          }
        }
      });
    });
    await page.locator(".source-output summary").click();
    const latest = "# Latest\r\n\r\n**Fresh** Markdown — not the delayed output.";
    await page.evaluate((source) => {
      playgroundEditor.setMarkdown(source);
      document.getElementById("copy-markdown").click();
    }, latest);
    assert.equal(await page.evaluate(() => copiedMarkdown), latest);
    assert.equal(await page.locator("#copy-markdown span").textContent(), "Copied!");
    assert.equal(await page.locator(".source-output details").getAttribute("open"), "");
    await page.locator("#copy-markdown").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".source-output details").getAttribute("open"), "");
    await page.locator(".source-output summary").click();
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
    });
    await page.locator("#copy-markdown").click();
    assert.equal(await page.locator(".source-output details").getAttribute("open"), "");
    assert.equal(await page.locator("#copy-markdown span").textContent(), "Failed");
    assert.match(await page.locator("#markdown-copy-feedback").textContent(), /Ctrl\+C/);
    assert.equal(await page.locator("#markdown-output").evaluate((element) => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), true);
    await page.getByRole("button", { name: "Restore sample", exact: true }).click();
    await page.locator("#document-source").selectOption("custom");
    assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), "");
    await page.evaluate(() => {
      playgroundEditor.focus();
    });
    await page.keyboard.type("A draft");
    await page.locator("#document-source").selectOption("showcase");
    assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), original);
    await page.locator("#document-source").selectOption("custom");
    assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), "A draft");
    const theme = page.getByRole("button", { name: "Switch website to light theme", exact: true });
    await theme.click();
    assert.equal(await page.locator("html").getAttribute("data-bs-theme"), "light");
    assert.equal(await page.locator("#site-theme span").textContent(), "Dark");
    assert.equal(await page.locator("#editor").getAttribute("data-theme"), "light");
    await page.getByRole("button", { name: "Switch website to dark theme", exact: true }).click();
    await page.getByText("Local files", { exact: true }).click();
    const localHTML = await page.locator("#integration-code").inputValue();
    assert.match(localHTML, /href="md\.edit\.css"/);
    assert.match(localHTML, /src="md\.js"/);
    assert.equal(localHTML.includes("https://"), false);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.copiedHTML = value;
          }
        }
      });
    });
    await page.getByRole("button", { name: "Copy HTML", exact: true }).click();
    assert.equal(await page.evaluate(() => copiedHTML), localHTML);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
    });
    await page.locator("#copy-integration").click();
    assert.equal(await page.locator("#copy-integration span").textContent(), "Failed");
    assert.equal(await page.locator("#integration-code").evaluate((element) => element.selectionStart === 0 && element.selectionEnd === element.value.length), true);
    const starterDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download HTML", exact: true }).click();
    assert.equal(await fs.readFile(await (await starterDownload).path(), "utf8"), localHTML);
    await page.locator("#file").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# File\n\nImported.") });
    await page.waitForFunction(() => playgroundEditor.getMarkdown() === "# File\n\nImported.");
    assert.equal(await page.locator("#document-source option:checked").textContent(), "notes.md");
    await page.getByRole("button", { name: "Restore sample", exact: true }).click();
    await page.setViewportSize({ width: 360, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("#site-menu").isVisible(), false);
    await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await page.locator("#site-menu.show").waitFor();
    assert.equal(await page.locator("#site-menu").isVisible(), true);
    await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await page.evaluate(() => playgroundEditor.setPreview(true));
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".byEDpreview").isVisible(), true);
    assert.equal(await page.locator(".byEDtoolbar").isVisible(), false);
    assert.equal(await page.locator(".byEDpreview").evaluate((element) => getComputedStyle(element).maxHeight), "none");
    await page.emulateMedia({ media: "screen" });
    await page.route("**/starter.html", (route) => route.fulfill({ body: localHTML, contentType: "text/html" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/starter.html`);
    await page.locator("#document .byEDsurface").waitFor();
    assert.equal(await page.locator("#document h1").textContent(), "# Hello");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("document and content backgrounds stay independent through theme and toolbar changes", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, channel: process.env.BROWSER_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ path: path.join(__dirname, "../../spa.js/css/fontawesome.min.css"), contentType: "text/css" }) : route.abort()
    );
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
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#viewer .byEDcontrols .byEDbutton")).backgroundColor === "rgb(39, 40, 34)");
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
