const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

const percentile = (values, fraction) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0).toFixed(3));
};
const summary = (values) => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95), max: percentile(values, 1) });

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route("https://cdn.jsdelivr.net/**", async (route) => {
      if (route.request().url().endsWith("fontawesome.min.css")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.abort();
    });
    await page.setContent('<style>body{margin:1rem}#editor{max-width:60rem}</style><div id="editor"></div>');
    for (const file of ["../../easy-md-viewer/md.css", "../../easy-code-viewer/code.css", "../md.edit.css"]) await page.addStyleTag({ path: path.join(__dirname, file) });
    for (const file of ["../../easy-code-viewer/code.js", "../../easy-md-viewer/md.js", "../md.edit.js"]) await page.addScriptTag({ path: path.join(__dirname, file) });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const fixtures = [1000, 5000, 10000].map((count) => ({
      name: `${count} lines`,
      source: Array.from({ length: count }, (_, index) => (index === Math.floor(count / 2) ? "Target paragraph **bold**." : `Paragraph ${index} with **bold** and *emphasis*.`)).join("\n")
    }));
    fixtures.push({ name: "large table", source: "| Name | Value | Notes |\n| --- | --- | --- |\n" + Array.from({ length: 1500 }, (_, index) => `| ${index === 750 ? "Target" : `Row ${index}`} | value | some notes |`).join("\n") });
    fixtures.push({ name: "nested lists", source: Array.from({ length: 5000 }, (_, index) => (index === 2500 ? "  - Target nested item" : `${"  ".repeat(index % 3)}- Item ${index}`)).join("\n") });
    fixtures.push({ name: "fenced code", source: "~~~js\n" + Array.from({ length: 5000 }, (_, index) => `const ${index === 2500 ? "Target" : `value${index}`} = ${index};`).join("\n") + "\n~~~" });
    for (const rate of [1, 6]) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      for (const fixture of fixtures) {
        await page.evaluate((source) => {
          window.samples = [];
          window.longTasks = [];
          window.observer?.disconnect();
          window.observer = new PerformanceObserver((entries) => longTasks.push(...entries.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration }))));
          observer.observe({ type: "longtask" });
          window.editor = byMDeditor(document.getElementById("editor"), source, { onMeasure: (sample) => samples.push(sample) });
          editor.setSelection(source.indexOf("Target") + 6);
          document.getSelection().focusNode.parentElement.scrollIntoView({ block: "center" });
          window.lastNode = document.querySelector(".byEDsurface").lastElementChild;
        }, fixture.source);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => {
          samples.length = 0;
          longTasks.length = 0;
          window.typingStarted = performance.now();
        });
        await page.keyboard.type(" writes, a little more text.");
        await page.keyboard.press("Backspace");
        await page.keyboard.type("!");
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
        const measured = await page.evaluate(() => ({
          samples,
          longTasks: longTasks.filter((entry) => entry.start >= typingStarted),
          stable: lastNode === document.querySelector(".byEDsurface").lastElementChild,
          source: editor.getMarkdown()
        }));
        assert.equal(measured.stable, true, "Unrelated DOM was replaced");
        assert.ok(measured.source.includes("Target writes, a little more text!"));
        const edits = measured.samples.filter((sample) => sample.operation === "edit");
        const parses = measured.samples.filter((sample) => sample.operation === "parse");
        assert.ok(parses.filter((sample) => sample.scope === "line").length <= edits.length * 4, "A local edit reparsed unrelated lines");
        const record = {
          fixture: fixture.name,
          cpu: rate,
          edit: summary(edits.map((sample) => sample.duration)),
          parse: summary(parses.map((sample) => sample.duration)),
          patch: summary(measured.samples.filter((sample) => sample.operation === "patch").map((sample) => sample.duration)),
          selection: summary(measured.samples.filter((sample) => sample.operation === "selection").map((sample) => sample.duration)),
          longTasks: measured.longTasks
        };
        // These are measured engineering targets. Report misses rather than disguising them.
        record.targetMet = record.edit.p95 < 5 && record.selection.p95 < 1 && record.longTasks.length === 0;
        results.push(record);
        await page.evaluate(() => {
          samples.length = 0;
          editor.setSelection(editor.getMarkdown().indexOf("Target"), editor.getMarkdown().indexOf("Target") + 6);
          editor.command("bold");
        });
        const formatting = await page.evaluate(() => samples.filter((sample) => sample.operation === "edit").map((sample) => sample.duration));
        record.formatting = summary(formatting);
        await page.evaluate(() => {
          samples.length = 0;
          editor.setPreview(true);
        });
        record.preview = await page.evaluate(() => samples.filter((sample) => sample.operation === "preview").at(-1)?.duration);
        console.log(JSON.stringify(record));
      }
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.evaluate(() => {
      editor.setPreview(false);
      samples.length = 0;
    });
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = async () => (await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "JSHeapUsedSize").value;
    const before = await heap();
    await page.evaluate(async () => {
      for (let i = 0; i < 200; i++) {
        document.querySelector(".byEDsurface").dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "x" }));
        if (i % 10 === 0) await new Promise(requestAnimationFrame);
      }
      samples.length = 0;
    });
    await cdp.send("HeapProfiler.collectGarbage");
    const after = await heap();
    await page.evaluate(() => editor.destroy());
    await cdp.send("HeapProfiler.collectGarbage");
    const destroyed = await heap();
    const memory = { before, after, destroyed, retainedGrowthBytes: after - before, edits: 200 };
    console.log(JSON.stringify({ memory }));
    if (process.env.BENCHMARK_OUTPUT) await fs.writeFile(process.env.BENCHMARK_OUTPUT, JSON.stringify({ results, memory }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
