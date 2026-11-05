/*
 * File: tests/playground.cjs
 * Desc: Editor playground configuration, document actions, and starter exports.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const test = require("node:test");
const { chromium } = require("playwright");
const launch = () => chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const root = path.join(__dirname, "..");

// Read the displayed source without line numbers or status text.
const readStarter = async (page) => {
  await page.locator('#integration-code[aria-busy="false"]').waitFor();
  return (await page.locator("#integration-code .byCODEtext").allTextContents()).join("\n");
};

/* --- PINNED PLAYGROUND DEPENDENCIES --- */
let assetsPromise;
const getAssets = () =>
  (assetsPromise ||= (async () => {
    const files = ["css/pickr.min.css", "js/pickr.min.js", "css/bootstrap.min.css", "css/shards.css", "css/fontawesome.min.css", "js/bootstrap.min.js"];
    return new Map(
      await Promise.all(
        files.map(async (file) => {
          const url = `https://cdn.jsdelivr.net/gh/byuwur/spa.js@v20.7/${file}`;
          const body =
            file === "css/bootstrap.min.css" && process.env.BOOTSTRAP_CSS_PATH
              ? await fs.readFile(process.env.BOOTSTRAP_CSS_PATH, "utf8")
              : await fetch(url).then(async (response) => {
                  assert.ok(response.ok, `Unable to load pinned playground asset: ${url}`);
                  return response.text();
                });
          return [url, { body, contentType: file.endsWith("css") ? "text/css" : "text/javascript" }];
        })
      )
    );
  })());

/* --- LOCAL COMPANIONS BEHIND PINNED CDN URLS --- */
async function routeAssets(page, assets) {
  await page.route("https://cdn.jsdelivr.net/**", async (route) => {
    const url = new URL(route.request().url());
    if (assets.has(url.href)) return route.fulfill(assets.get(url.href));
    const companion = url.pathname.match(/^\/gh\/byuwur\/(easy-(?:md|code)-viewer)@v\d+(?:\.\d+)*\/((?:md|code)\.(?:css|js))$/);
    if (companion) return route.fulfill({ path: path.join(root, "..", companion[1], companion[2]), contentType: companion[2].endsWith("css") ? "text/css" : "text/javascript" });
    return route.abort();
  });
}

/* --- DOCUMENT ACTIONS AND EXPORTS --- */
test("playground configures No-code and individual controls without recreating the document", async () => {
  const assets = await getAssets();
  const server = require("./serve.cjs");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await routeAssets(page, assets);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".byEDsurface").waitFor();
    const source = await page.evaluate(() => playgroundEditor.getMarkdown());
    await page.locator("#viewer-settings").evaluate((details) => (details.open = true));
    await page.locator("#syntax-mode").selectOption("no-code");
    assert.equal(await page.locator("#editor").getAttribute("data-syntax"), "no-code");
    assert.equal(await page.locator("#editor .byEDsyntax:visible").count(), 0);
    await page.evaluate(() => (window.originalLine = document.querySelector(".byEDline")));
    const selectors = {
      toolbarToggle: '[aria-label="Formatting"]',
      syntaxSelect: '[aria-label="Syntax visibility"]',
      previewToggle: '[aria-label="Preview"]',
      themeToggle: ".byVIEWthemeToggle",
      paletteSelect: '[aria-label="Color palette"]',
      statusBar: ".byEDstatus"
    };
    for (const [name, selector] of Object.entries(selectors)) {
      await page.locator(`#${name}`).uncheck();
      assert.equal(await page.locator(`#editor ${selector}`).isHidden(), true, name);
      assert.equal(JSON.parse(await page.locator("#options-json").inputValue())[name], false);
    }
    assert.equal(await page.locator(".byEDbar").isHidden(), true);
    await page.locator("#toolbar").uncheck();
    await page.locator(".byEDtoolbar").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".byEDtoolbar").isHidden(), true);
    assert.equal(await page.evaluate(() => originalLine === document.querySelector(".byEDline")), true);
    assert.equal(await page.evaluate(() => playgroundEditor.getMarkdown()), source);
    for (const name of Object.keys(selectors)) await page.locator(`#${name}`).check();
    await page.locator("#toolbar").check();
    await page.getByLabel("Syntax visibility", { exact: true }).selectOption("assisted");
    assert.equal(await page.locator("#syntax-mode").inputValue(), "assisted");
    assert.equal(JSON.parse(await page.locator("#options-json").inputValue()).syntax, "assisted");
    await page.getByRole("button", { name: "Formatting", exact: true }).click();
    assert.equal(await page.locator("#toolbar").isChecked(), false);
    assert.equal(JSON.parse(await page.locator("#options-json").inputValue()).toolbar, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("playground edits documents and exports exact Markdown", async () => {
  const assets = await getAssets();
  const server = require("./serve.cjs");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await launch();
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1100, height: 800 } });
    await routeAssets(page, assets);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".byEDsurface").waitFor();
    assert.equal(await page.locator(".byEDsurface").isVisible(), true);
    const releases = await page.evaluate(() => ({ md: byMDviewer.VERSION, code: byCODEviewer.VERSION }));
    assert.deepEqual(
      await page.locator('head [href*="easy-md-viewer"], head [href*="easy-code-viewer"], head [src*="easy-md-viewer"], head [src*="easy-code-viewer"]').evaluateAll((assets) => assets.map((asset) => asset.href || asset.src).sort()),
      [
        `https://cdn.jsdelivr.net/gh/byuwur/easy-code-viewer@v${releases.code}/code.css`,
        `https://cdn.jsdelivr.net/gh/byuwur/easy-code-viewer@v${releases.code}/code.js`,
        `https://cdn.jsdelivr.net/gh/byuwur/easy-md-viewer@v${releases.md}/md.css`,
        `https://cdn.jsdelivr.net/gh/byuwur/easy-md-viewer@v${releases.md}/md.js`
      ]
    );
    assert.equal(await page.locator(".navbar-brand").innerText(), "md↑easy-md-editor");
    assert.equal(await page.locator(".viewer-suite a").count(), 9);
    assert.equal(await page.locator(".viewer-suite").getByRole("link", { name: "MD.edit", exact: true }).getAttribute("href"), "https://byuwur.github.io/easy-md-editor/");
    assert.equal(await page.locator(".viewer-suite").getByRole("link", { name: "MD.edit", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#integration-cdn").isChecked(), true);
    await page.locator("#preview-bg").evaluate((field) => (field.closest("details").open = true));
    await page.locator("#preview-bg").fill("transparent");
    await page.locator("#preview-bg").dispatchEvent("change");
    await page.locator('[data-color-picker="preview-container-bg"]').click();
    const picker = page.locator(".pcr-app.visible");
    await picker.locator('.pcr-type[data-type="HEXA"]').waitFor();
    assert.deepEqual(await picker.locator(".pcr-type:visible").evaluateAll((formats) => formats.map((format) => format.dataset.type)), ["HEXA"]);
    assert.match(await picker.locator(".pcr-result").inputValue(), /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
    assert.equal(await page.locator("#preview-container-bg").inputValue(), "", "Opening the picker retains the theme default");
    await picker.locator(".pcr-result").fill("#345678cc");
    await picker.locator(".pcr-result").press("Enter");
    await picker.locator(".pcr-save").click();
    assert.equal((await page.locator("#preview-container-bg").inputValue()).toLowerCase(), "#345678cc");
    await page.waitForFunction(() => {
      const document = window.document;
      return getComputedStyle(document.querySelector(".byEDcontrols .byEDbutton")).backgroundColor === "rgba(52, 86, 120, 0.8)";
    });
    assert.equal(await page.locator("#editor").evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
    await page.locator("#preview-bg").fill("not a color");
    await page.locator("#preview-bg").dispatchEvent("change");
    assert.equal(await page.locator("#preview-bg").evaluate((field) => field.checkValidity()), false);
    await page.locator("#reset-appearance").click();
    assert.equal(await page.locator("#preview-bg").evaluate((field) => field.checkValidity()), true);
    const cdnHTML = await readStarter(page);
    assert.match(cdnHTML, /^ {2}<head>$/m);
    assert.match(cdnHTML, /^ {4}<script>$/m);
    assert.match(cdnHTML, /^ {6}document\.addEventListener\("DOMContentLoaded", \(\) => \{$/m);
    const starterViewer = page.locator("#integration-code.byCODEdocument");
    assert.equal(await page.evaluate(() => byCODEviewer.VERSION), "1.5");
    assert.equal(await starterViewer.getAttribute("data-theme"), "dark");
    await starterViewer.locator(".byCODEtext").first().waitFor();
    assert.ok((await starterViewer.locator(".byCODElineNumber").count()) > 0);
    assert.equal(await starterViewer.locator(".byVIEWtoolbar, button, input, select").count(), 0);
    assert.equal(await starterViewer.locator(".byVIEWstatus:visible").count(), 0);
    assert.deepEqual(await starterViewer.evaluate((element) => [element, element.querySelector(".byVIEWpanel"), element.querySelector(".byCODElineNumber")].map((node) => getComputedStyle(node).backgroundColor)), [
      "rgba(0, 0, 0, 0)",
      "rgba(0, 0, 0, 0)",
      "rgba(0, 0, 0, 0)"
    ]);
    assert.ok((await starterViewer.locator(".byCODEtag").count()) > 0);
    assert.equal(await page.locator("#integration-code script").count(), 0);
    const starterTagColor = await starterViewer
      .locator(".byCODEtag")
      .first()
      .evaluate((token) => getComputedStyle(token).color);
    await page.locator("#site-theme").click();
    assert.equal(await starterViewer.getAttribute("data-theme"), "light");
    assert.notEqual(
      await starterViewer
        .locator(".byCODEtag")
        .first()
        .evaluate((token) => getComputedStyle(token).color),
      starterTagColor
    );
    await page.locator("#site-theme").click();
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
    const localHTML = await readStarter(page);
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
    assert.equal(
      await page.locator("#integration-code").evaluate((element) => document.activeElement === element && document.getSelection().toString() === [...element.querySelectorAll(".byCODEtext")].map((line) => line.textContent).join("\n")),
      true
    );
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
