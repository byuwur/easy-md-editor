/*
 * File: tests/editor-options.cjs
 * Desc: No-code editing and independently configurable controls, without playground assets.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

// --- LOCAL LIBRARY FIXTURE ---
test("No-code editing and control visibility", async (t) => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://cdn.jsdelivr.net/**", (route) => (route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ body: "", contentType: "text/css" }) : route.abort()));
    await page.setContent('<div id="editor"></div>');
    for (const file of ["../../easy-md-viewer/md.css", "../../easy-code-viewer/code.css", "../md.edit.css"]) await page.addStyleTag({ path: path.join(__dirname, file) });
    for (const file of ["../../easy-code-viewer/code.js", "../../easy-md-viewer/md.js", "../md.edit.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    await page.evaluate(() => {
      window.changes = [];
      window.render = (markdown, options = {}) => {
        changes.length = 0;
        window.editor = byMDeditor(document.getElementById("editor"), markdown, { syntax: "no-code", animations: false, onChange: (value) => changes.push(value), ...options });
      };
    });

    // --- SYNTAX VISIBILITY AND SOURCE OWNERSHIP ---
    await t.test("active headings, inline formats, lists, tables and fences keep syntax hidden", async () => {
      const source = "# Heading\r\n\r\nA **bold** and *italic* [link](https://example.com).\r\n\r\n- [ ] Task\r\n\r\n| Name | Value |\r\n| --- | --- |\r\n| One | Two |\r\n\r\n~~~js\r\nconst value = 1;\r\n~~~";
      await page.evaluate((source) => render(source), source);
      for (const word of ["Heading", "bold", "italic", "link", "Task", "One", "value"]) {
        await page.evaluate((word) => editor.setSelection(editor.getMarkdown().indexOf(word) + 1), word);
        assert.equal(await page.locator(".byEDsyntax").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === "none")), true);
      }
      assert.equal(await page.locator('.byEDline:is([data-type="fenceOpen"], [data-type="fenceClose"], [data-type="tableDelimiter"]):visible').count(), 0);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      assert.deepEqual(await page.evaluate(() => changes), []);
      const position = await page.evaluate(() => editor.getSelection());
      for (const mode of ["source", "clean", "assisted", "no-code"]) await page.evaluate((mode) => editor.setSyntaxMode(mode), mode);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), position);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    });

    // --- TOOLBAR, CARET, AND HISTORY ---
    await t.test("toolbar formatting edits visible text and shares undo with Source", async () => {
      await page.evaluate(() => {
        render("Hello world");
        editor.setSelection(6, 11);
      });
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      await page.keyboard.type("reader");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **reader**");
      assert.equal(await page.locator(".byEDsurface").innerText(), "Hello reader");
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **reade**");
      await page.evaluate(() => editor.setSyntaxMode("source"));
      await page.evaluate(() => editor.command("undo"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **reader**");
      await page.evaluate(() => editor.setSyntaxMode("no-code"));
      await page.evaluate(() => editor.command("redo"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Hello **reade**");
    });
    await t.test("empty selections, complete deletion and heading insertion keep a usable caret", async () => {
      await page.evaluate(() => {
        render("");
        editor.focus();
      });
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      await page.keyboard.type("Word");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "**Word**");
      await page.evaluate(() => editor.setSelection(2, 6));
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
      await page.evaluate(() => editor.command("heading", 2));
      await page.keyboard.type("Title");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "## Title");
      assert.equal(await page.locator(".byEDsurface").innerText(), "Title");
    });
    await t.test("typing heading text adds its separator in every visual mode", async () => {
      for (const syntax of ["clean", "assisted", "no-code"]) {
        for (const level of [1, 3, 6]) {
          await page.evaluate((syntax) => {
            render("", { syntax });
            editor.focus();
          }, syntax);
          await page.keyboard.type("#".repeat(level));
          await page.keyboard.type("Title");
          const expected = `${"#".repeat(level)} Title`;
          assert.equal(await page.evaluate(() => editor.getMarkdown()), expected, `${syntax}, heading ${level}`);
          assert.equal(await page.locator(`.byEDsurface h${level}`).count(), 1);
          if (syntax === "no-code") assert.equal(await page.locator(".byEDsurface").innerText(), "Title");
          await page.evaluate(() => editor.command("undo"));
          assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
          await page.evaluate(() => editor.command("redo"));
          assert.equal(await page.evaluate(() => editor.getMarkdown()), expected);
        }
      }
    });
    await t.test("empty headings accept paste, IME, and toolbar changes without losing their prefix", async () => {
      const paste = await page.evaluate(() => {
        render("###");
        editor.setSelection(3);
        const data = new DataTransfer();
        data.setData("text/plain", "Title");
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        return [editor.getMarkdown(), editor.getSelection()];
      });
      assert.deepEqual(paste, ["### Title", { anchor: 9, focus: 9 }]);
      await page.evaluate(() => editor.command("undo"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "###", "Undo restores the untouched original marker");
      await page.evaluate(() => editor.command("heading", 1));
      await page.keyboard.type("Title");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "# Title");
      const composition = await page.evaluate(() => {
        render("###");
        editor.setSelection(3);
        const surface = document.querySelector(".byEDsurface"),
          text = document.getSelection().focusNode;
        surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        text.appendData("日本語");
        surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "日本語" }));
        const during = editor.getMarkdown();
        surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
        return { during, after: editor.getMarkdown(), selection: editor.getSelection() };
      });
      assert.deepEqual(composition, { during: "###", after: "### 日本語", selection: { anchor: 7, focus: 7 } });
      await page.evaluate(() => render("###"));
      await page.locator(".byEDsurface h3").click({ position: { x: 5, y: 5 } });
      await page.keyboard.type("Title");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "### Title");
    });
    await t.test("heading shortcuts preserve newlines, existing spaces, and literal source or code", async () => {
      const cases = [
        ["Before\r\n\r\n", "no-code", "###Title", "Before\r\n\r\n### Title"],
        ["###   ", "no-code", "Title", "###   Title"],
        ["", "source", "###Title", "###Title"],
        ["#######", "clean", "Title", "#######Title"],
        ["\\#", "no-code", "Title", "\\#Title"],
        ["~~~js\n", "no-code", "#Title", "~~~js\n#Title"]
      ];
      for (const [source, syntax, input, expected] of cases) {
        await page.evaluate(
          ({ source, syntax }) => {
            render(source, { syntax });
            editor.setSelection(source.length);
          },
          { source, syntax }
        );
        await page.keyboard.type(input);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), expected, `${syntax}: ${source}`);
      }
    });
    await t.test("lists and table cells remain editable without their source delimiters", async () => {
      await page.evaluate(() => {
        render("- Item");
        editor.setSelection(6);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Next");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "- Item\n- Next");
      await page.evaluate(() => {
        render("| Name | Value |\n| --- | --- |\n| One | Two |");
        editor.setSelection(editor.getMarkdown().indexOf("One"));
      });
      await page.keyboard.type("New ");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Other ");
      assert.match(await page.evaluate(() => editor.getMarkdown()), /\| New One \| Other Two \|/);
      assert.equal(await page.locator(".byEDsyntax:visible").count(), 0);
    });
    await t.test("deletion crosses formatting boundaries and removes block prefixes without exposing them", async () => {
      await page.evaluate(() => {
        render("A **bold** Z");
        editor.setSelection(4);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A**bold** Z");
      await page.evaluate(() => editor.setSelection(7));
      await page.keyboard.press("Delete");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "A**bold**Z");
      await page.evaluate(() => {
        render("## Title");
        editor.setSelection(3);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Title");
      await page.evaluate(() => {
        render("**👩‍💻**");
        editor.setSelection(7);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
    });
    await t.test("hard breaks, escaped characters and read-only fallback blocks keep their source intact", async () => {
      const source = "Hard break\\\nNext\n\nAn escaped \\* character\n\n  - Nested";
      await page.evaluate((source) => render(source), source);
      assert.equal((await page.locator(".byEDsurface").innerText()).includes("\\"), false);
      assert.equal((await page.locator(".byEDsurface").innerText()).includes("- Nested"), false);
      assert.equal(await page.locator(".byEDunsupported").getAttribute("contenteditable"), "false");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      assert.equal(
        await page.evaluate(() => {
          const walker = document.createTreeWalker(document.querySelector(".byEDunsupported"), NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode()) && !text.textContent.trim()) {}
          document.getSelection().setBaseAndExtent(text, 0, text, text.length);
          return editor.command("bold");
        }),
        false,
        "Toolbar commands do not rewrite read-only fallback blocks"
      );
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      await page.evaluate(() => {
        editor.setSyntaxMode("source");
        editor.setSyntaxMode("clean");
      });
      assert.equal(await page.locator(".byEDunsupported").count(), 0, "Returning through Source rebuilds the correct visual representation");
      await page.evaluate(() => editor.setSyntaxMode("no-code"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      await page.locator(".byEDsurface").focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("Replacement");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
    });
    await t.test("code inserted from the toolbar accepts typing with both fences hidden", async () => {
      await page.evaluate(() => {
        render("");
        editor.command("codeBlock", "js");
      });
      await page.keyboard.type("const value = 1;");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "```js\nconst value = 1;\n```\n\n");
      assert.equal(await page.locator('.byEDline:is([data-type="fenceOpen"], [data-type="fenceClose"]):visible').count(), 0);
    });
    await t.test("Select All includes hidden opening and closing syntax when replacing or cutting", async () => {
      for (const source of ["# Heading", "```js\ncode\n```", "**bold**", "- [ ] Task", "---"]) {
        await page.evaluate((source) => {
          render(source);
          editor.focus();
        }, source);
        await page.keyboard.press("Control+a");
        assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 0, focus: source.length });
        await page.keyboard.type("Replacement");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
        await page.evaluate(() => editor.command("undo"));
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        await page.keyboard.press("Control+a");
        const cut = await page.evaluate(() => {
          const data = new DataTransfer();
          document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
          return data.getData("text/plain");
        });
        assert.equal(cut, source);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
      }
    });

    await t.test("nested formatting boundaries do not delete hidden delimiters", async () => {
      for (const source of ["**`word`**", "**_word_**", "**[word](https://example.com)**"]) {
        await page.evaluate((source) => {
          render(source);
          editor.setSelection(source.indexOf("word"));
        }, source);
        await page.keyboard.press("Backspace");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        await page.evaluate(() => editor.setSelection(editor.getMarkdown().indexOf("word") + 4));
        await page.keyboard.press("Delete");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      }
      await page.evaluate(() => {
        render("# **`word`**");
        editor.setSelection(5);
      });
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "**`word`**");
    });
    await t.test("deleting a complete link label removes its hidden URL and keeps undo", async () => {
      for (const source of ["[Label](https://example.com)", "**[Label](https://example.com)**"]) {
        await page.evaluate((source) => {
          render(source);
          editor.setSelection(source.indexOf("Label"), source.indexOf("Label") + 5);
        }, source);
        await page.keyboard.press("Backspace");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
        await page.keyboard.type("Replacement");
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "Replacement");
        await page.evaluate(() => {
          editor.command("undo");
          editor.command("undo");
        });
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
      }
    });
    await t.test("selected bold and italic combine and toggle independently in either order", async () => {
      for (const syntax of ["no-code", "clean", "assisted", "source"]) {
        for (const order of [
          ["bold", "italic"],
          ["italic", "bold"]
        ]) {
          await page.evaluate((syntax) => {
            render("word", { syntax });
            editor.setSelection(0, 4);
          }, syntax);
          await page.locator(`[data-command="${order[0]}"]`).click();
          await page.waitForFunction((active) => ["bold", "italic"].every((name) => document.querySelector(`[data-command="${name}"]`).getAttribute("aria-pressed") === String(name === active)), order[0]);
          await page.locator(`[data-command="${order[1]}"]`).click();
          assert.equal(await page.evaluate(() => editor.getMarkdown()), "***word***", `${syntax}: ${order.join(" then ")}`);
          await page.waitForFunction(() => ["bold", "italic"].every((name) => document.querySelector(`[data-command="${name}"]`).getAttribute("aria-pressed") === "true"));
          await page.locator('[data-command="bold"]').click();
          assert.equal(await page.evaluate(() => editor.getMarkdown()), "*word*");
          await page.locator('[data-command="italic"]').click();
          assert.equal(await page.evaluate(() => editor.getMarkdown()), "word");
          await page.evaluate(() => {
            editor.command("undo");
            editor.command("undo");
          });
          assert.equal(await page.evaluate(() => editor.getMarkdown()), "***word***");
        }
      }
    });
    await t.test("whole selections and alternate delimiters preserve the other format", async () => {
      for (const syntax of ["no-code", "source"]) {
        for (const source of ["**word**", "__word__"]) {
          await page.evaluate(
            ({ source, syntax }) => {
              render(source, { syntax });
              editor.setSelection(0, source.length);
            },
            { source, syntax }
          );
          await page.locator('[data-command="italic"]').click();
          assert.equal(await page.evaluate(() => editor.getMarkdown()), `*${source}*`, `${syntax}: ${source}`);
        }
        await page.evaluate((syntax) => {
          render("___word___", { syntax });
          editor.setSelection(10, 0);
          editor.command("italic");
        }, syntax);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "__word__");
        assert.deepEqual(await page.evaluate(() => editor.getSelection()), { anchor: 6, focus: 2 });
        await page.locator('[data-command="bold"]').click();
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "word");
        await page.evaluate(() => {
          editor.command("undo");
          editor.command("undo");
        });
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "___word___");
      }
    });
    await t.test("combined bold and italic report both states and toggle independently", async () => {
      await page.evaluate(() => {
        render("***word***");
        editor.setSelection(5);
      });
      await page.waitForFunction(() => ["bold", "italic"].every((name) => document.querySelector(`[data-command="${name}"]`)?.getAttribute("aria-pressed") === "true"), null, { timeout: 1000 });
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "*word*");
      await page.getByRole("button", { name: "Italic", exact: true }).click();
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "word");
      await page.evaluate(() => {
        editor.command("undo");
        editor.command("undo");
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "***word***");
    });
    await t.test("ordinary deletion preserves hidden fences and table separators", async () => {
      const source = "~~~js\r\ncode\r\n~~~";
      for (const [offset, key] of [
        [7, "Backspace"],
        [11, "Delete"]
      ]) {
        await page.evaluate(
          ({ source, offset }) => {
            render(source);
            editor.setSelection(offset);
          },
          { source, offset }
        );
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
        assert.deepEqual(await page.evaluate(() => changes), []);
      }
      const table = "| A | B |\n| --- | --- |\n| C | D |";
      for (const [offset, key] of [
        [2, "Backspace"],
        [3, "Delete"]
      ]) {
        await page.evaluate(
          ({ table, offset }) => {
            render(table);
            editor.setSelection(offset);
          },
          { table, offset }
        );
        await page.keyboard.press(key);
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => editor.getMarkdown()), table);
      }
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "");
    });
    await t.test("empty fenced blocks accept typing and paste without exposing fences", async () => {
      await page.evaluate(() => {
        render("```js\n```");
        editor.focus();
      });
      await page.keyboard.type("const value = 1;");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "```js\nconst value = 1;\n```");
      await page.evaluate(() => {
        render("~~~js\r\n~~~");
        editor.focus();
        const data = new DataTransfer();
        data.setData("text/plain", "one\r\ntwo");
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "~~~js\r\none\r\ntwo\r\n~~~");
    });
    await t.test("typing at the end of a table cell keeps native spaces and formatting editable", async () => {
      await page.evaluate(() => {
        render("| Name | Value |\n| --- | --- |\n| Target | value |");
        editor.setSelection(editor.getMarkdown().indexOf("Target") + 6);
      });
      await page.keyboard.type(" writes, a little more text.");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("! *more*");
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "| Name | Value |\n| --- | --- |\n| Target writes, a little more text! *more* | value |");
      assert.equal(await page.locator(".byEDcell em").textContent(), "*more*");
      assert.equal(await page.locator(".byEDcell em").innerText(), "more");
    });
    await t.test("paste does not rewrite a read-only fallback block", async () => {
      const source = "Before\n\n  - Nested\n\nAfter";
      await page.evaluate((source) => {
        render(source);
        editor.setSelection(source.indexOf("Nested"));
        const data = new DataTransfer();
        data.setData("text/plain", "Replacement");
        document.querySelector(".byEDsurface").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, source);
      assert.equal(await page.evaluate(() => editor.getMarkdown()), source);
    });

    // --- OPTIONAL CONTROLS ---
    const selectors = {
      toolbarToggle: '[aria-label="Formatting"]',
      syntaxSelect: '[aria-label="Syntax visibility"]',
      previewToggle: '[aria-label="Preview"]',
      themeToggle: ".byVIEWthemeToggle",
      paletteSelect: '[aria-label="Color palette"]',
      statusBar: ".byEDstatus"
    };
    await t.test("each control can be disabled at initialization without disabling its API", async () => {
      for (const [name, selector] of Object.entries(selectors)) {
        await page.evaluate((name) => render("# Heading", { [name]: false }), name);
        assert.equal(await page.locator(selector).isHidden(), true, name);
        await page.evaluate(() => {
          editor.setSyntaxMode("source");
          editor.setPreview(true);
          editor.setPreview(false);
          editor.setTheme("dark");
          editor.setPalette("github");
        });
        assert.equal(await page.evaluate(() => editor.getMarkdown()), "# Heading");
        assert.equal(await page.locator(selector).isHidden(), true, name);
      }
    });
    await t.test("live visibility changes preserve selection and undo history", async () => {
      await page.evaluate(() => {
        render("Text");
        editor.setSelection(0, 4);
        editor.command("bold");
      });
      const selection = await page.evaluate(() => editor.getSelection());
      await page.evaluate(() => editor.setControls({ toolbarToggle: false, syntaxSelect: false, previewToggle: false, themeToggle: false, paletteSelect: false, statusBar: false }));
      assert.equal(await page.locator(".byEDbar").isHidden(), true);
      assert.equal(await page.locator(".byEDtoolbar").isVisible(), true);
      assert.deepEqual(await page.evaluate(() => editor.getSelection()), selection);
      await page.evaluate(() => editor.setControls({ toolbarToggle: true, syntaxSelect: true, previewToggle: true, themeToggle: true, paletteSelect: true, statusBar: true }));
      assert.equal(await page.locator(".byEDbar").isVisible(), true);
      await page.evaluate(() => editor.command("undo"));
      assert.equal(await page.evaluate(() => editor.getMarkdown()), "Text");
    });
    await t.test("visibility changes leave IME text under browser ownership until composition ends", async () => {
      const result = await page.evaluate(() => {
        render("**Hello**");
        editor.setSelection(7);
        const surface = document.querySelector(".byEDsurface");
        surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        document.getSelection().focusNode.data += "日本語";
        editor.setControls({ syntaxSelect: false, previewToggle: false });
        const during = editor.getMarkdown();
        surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
        return { during, after: editor.getMarkdown() };
      });
      assert.deepEqual(result, { during: "**Hello**", after: "**Hello日本語**" });
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
