"use strict";
/*
 * File: md.edit.js
 * Desc: Source-driven Markdown editing with easy-md-viewer parsing and easy-code-viewer colors.
 * Copyright (c) 2026 Andres Trujillo [Mateus] byUwUr
 * MIT License (see LICENSE).
 */
(function (global) {
  /* --- INITIALIZATION --- */
  if (global.byMDeditor?.initialized) return;

  /* --- METADATA --- */
  byMDeditor.VERSION = "1.3"; // 2026-11-05

  /* --- CONSTANTS --- */
  const tools = [
    ["undo", "Undo", "rotate-left"],
    ["redo", "Redo", "rotate-right"],
    ["bold", "Bold", "bold"],
    ["italic", "Italic", "italic"],
    ["strikethrough", "Strike", "strikethrough"],
    ["inlineCode", "Code", "code"],
    ["bulletList", "Bullets", "list-ul"],
    ["orderedList", "Numbered", "list-ol"],
    ["checklist", "Checklist", "list-check"],
    ["link", "Link", "link"],
    ["image", "Image", "image"],
    ["table", "Table", "table"],
    ["codeBlock", "Code block", "file-code"],
    ["blockquote", "Quote", "quote-left"],
    ["horizontalRule", "Divider", "minus"]
  ];
  const wraps = { bold: "**", italic: "*", strikethrough: "~~", inlineCode: "`" };
  const modes = ["no-code", "clean", "assisted", "source"];
  const modeDescriptions = {
    "no-code": "Keep Markdown syntax hidden while editing. Use the toolbar to format text.",
    clean: "Hide Markdown syntax outside the active line or code block.",
    assisted: "Keep Markdown syntax visible beside formatted text.",
    source: "Edit the complete Markdown source as plain text."
  };
  const palettes = { monokai: "Monokai", github: "GitHub", solarized: "Solarized", "high-contrast": "High Contrast" };

  /* --- STATE --- */
  const instances = new WeakMap();

  /* --- HELPERS --- */
  const node = (tag, className = "", text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let segmenter;
  const stateKey = (state) => `${state?.fence?.marker || ""}${state?.fence?.length || 0}:${state?.table || 0}`;
  const groupKind = (type) => {
    if (["tableHeader", "tableDelimiter", "tableRow"].includes(type)) return "table";
    if (["fenceOpen", "fenceClose", "code"].includes(type)) return "fence";
    if (["bullet", "task"].includes(type)) return "bullet";
    if (type === "ordered") return "ordered";
    return "single";
  };
  const boundary = (text, index, direction) => {
    if (global.Intl?.Segmenter) {
      segmenter ||= new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const start = Math.max(0, index - 64),
        end = Math.min(text.length, index + 64);
      const offsets = [...segmenter.segment(text.slice(start, end))].map((part) => start + part.index);
      offsets.push(end);
      return direction < 0 ? (offsets.filter((offset) => offset < index).at(-1) ?? 0) : (offsets.find((offset) => offset > index) ?? text.length);
    }
    let next = index + direction;
    if (direction < 0 && /[\uDC00-\uDFFF]/.test(text[next] || "") && /[\uD800-\uDBFF]/.test(text[next - 1] || "")) next--;
    if (direction > 0 && /[\uD800-\uDBFF]/.test(text[index] || "") && /[\uDC00-\uDFFF]/.test(text[next] || "")) next++;
    return Math.max(0, Math.min(text.length, next));
  };

  /* --- PUBLIC API --- */
  /** Mount an editor with caller-owned persistence; all selections use UTF-16 source offsets. */
  function byMDeditor(element, markdown, options = {}) {
    if (!(element instanceof HTMLElement)) throw new TypeError("byMDeditor: element must be an HTMLElement.");
    // Markdown owns the document. Editable DOM, line records, and Preview are derived views.
    let source = markdown instanceof HTMLElement ? markdown.textContent : (markdown ?? element.textContent);
    if (typeof source !== "string") throw new TypeError("byMDeditor: Markdown must be a string or HTMLElement.");
    if (source.length > 2000000) throw new RangeError("byMDeditor: maximum document size is 2,000,000 characters.");
    instances.get(element)?.destroy();
    options = {
      syntax: "clean",
      animations: true,
      toolbar: true,
      toolbarToggle: true,
      syntaxSelect: true,
      previewToggle: true,
      themeToggle: true,
      paletteSelect: true,
      statusBar: true,
      shortcuts: true,
      codeHighlighting: true,
      label: "Document",
      placeholder: "Start writing…",
      historyLimit: 200,
      ...options
    };
    options.historyLimit = Math.max(0, Math.min(1000, Math.trunc(Number(options.historyLimit)) || 0));
    let syntax = modes.includes(options.syntax) ? options.syntax : "clean";
    // Companion capabilities are captured at mount; loading a newer MD viewer requires reinitialization.
    const rich = typeof global.byMDviewer?.parseInline === "function" && typeof global.byMDviewer?.scanLine === "function";
    if (!rich) {
      console.warn("easy-md-editor: Visual editing requires easy-md-viewer with parseInline() and scanLine(). Source editing remains available. https://byuwur.github.io/easy-md-viewer/");
      syntax = "source";
    }
    const abort = new AbortController(),
      signal = abort.signal;
    let alive = true,
      previewing = false,
      dirty = false,
      renderedNoCode = false,
      composing = null,
      nativeEdit = null,
      dialog = null,
      dialogAbort = null,
      active = null;
    let lines = [],
      groups = [],
      position = { anchor: 0, focus: 0 },
      savedPosition = position,
      fullSelection = null;
    let history = [],
      historyIndex = 0,
      historyBytes = 0,
      toolbarFrame = 0;
    let codeTimer = 0,
      codeFrame = 0,
      codeJob = null,
      codeQueue = [];
    let eol = source.match(/\r\n|\r|\n/)?.[0] || "\n",
      rawBreaks = [];
    let textMap = new WeakMap(),
      lineMap = new WeakMap();
    const metrics = options.onMeasure ? options.onMeasure : null;
    const measure = (operation, started, extra = {}) => metrics?.({ operation, duration: performance.now() - started, ...extra });
    const listen = (target, type, handler, extra = {}) => target.addEventListener(type, handler, { signal, ...extra });
    element.replaceChildren();
    element.classList.add("byMDeditor", "byMDdocument");
    element.classList.toggle("byVIEWmotion", options.animations !== false);
    if (options.theme) element.dataset.theme = options.theme;
    if (!element.dataset.theme && !element.classList.contains("dark")) element.dataset.theme = "light";
    const bar = node("div", "byEDbar"),
      toolbar = node("div", "byEDtoolbar"),
      surface = node("div", "byEDsurface"),
      raw = node("textarea", "byEDsource"),
      preview = node("div", "byEDpreview");
    const status = node("p", "byEDstatus"),
      controls = node("div", "byEDcontrols");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    surface.contentEditable = "true";
    surface.setAttribute("role", "textbox");
    surface.setAttribute("aria-multiline", "true");
    surface.setAttribute("aria-label", options.label);
    surface.dataset.placeholder = options.placeholder;
    raw.setAttribute("aria-label", `${options.label} — Markdown source`);
    raw.spellcheck = true;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Document formatting");
    const button = (label, icon, action, parent = toolbar) => {
      const result = node("button", "byEDbutton");
      result.type = "button";
      const glyph = node("i", `fa-solid fa-${icon}`);
      glyph.setAttribute("aria-hidden", "true");
      result.append(glyph, node("span", "", label));
      result.setAttribute("aria-label", label);
      result.title = label;
      listen(result, "click", action);
      parent.appendChild(result);
      return result;
    };
    const toggle = button("Formatting", "sliders", () => api.setToolbar(toolbar.hidden), bar);
    const picker = node("select", "byEDselect");
    picker.setAttribute("aria-label", "Syntax visibility");
    for (const mode of modes) {
      const option = node("option", "", { "no-code": "No-code", clean: "Clean", assisted: "Assisted", source: "Source" }[mode]);
      option.value = mode;
      option.disabled = !rich && mode !== "source";
      picker.append(option);
    }
    listen(picker, "change", () => api.setSyntaxMode(picker.value));
    const palettePicker = node("select", "byEDselect");
    palettePicker.setAttribute("aria-label", "Color palette");
    for (const [value, label] of Object.entries(palettes)) {
      const option = node("option", "", label);
      option.value = value;
      palettePicker.append(option);
    }
    const selectPalette = (palette) => {
      if (![...palettePicker.options].some((option) => option.value === palette)) {
        const option = node("option", "", `Custom (${palette})`);
        option.value = palette;
        palettePicker.append(option);
      }
      palettePicker.value = palette;
    };
    listen(palettePicker, "change", () => api.setPalette(palettePicker.value));
    controls.append(palettePicker);
    const previewButton = button("Preview", "eye", () => api.setPreview(!previewing), controls);
    previewButton.setAttribute("aria-pressed", "false");
    const themeButton = node("button", "byVIEWthemeToggle");
    themeButton.type = "button";
    themeButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    listen(themeButton, "click", () => api.setTheme(isDark() ? "light" : "dark"));
    controls.append(themeButton);
    bar.append(picker, controls);
    const heading = node("select", "byEDselect");
    heading.setAttribute("aria-label", "Paragraph style");
    for (let level = 0; level <= 6; level++) {
      const option = node("option", "", level ? `Heading ${level}` : "Paragraph");
      option.value = String(level);
      heading.append(option);
    }
    listen(heading, "change", () => {
      api.command("heading", Number(heading.value));
    });
    if (!options.tools || options.tools.includes("heading")) toolbar.appendChild(heading);
    const commandButtons = new Map();
    for (const [name, label, icon] of tools) {
      if (options.tools && !options.tools.includes(name)) continue;
      const control = button(label, icon, () => (["link", "image", "table", "codeBlock"].includes(name) ? openDialog(name) : api.command(name)));
      control.dataset.command = name;
      commandButtons.set(name, control);
      if (wraps[name]) control.setAttribute("aria-pressed", "false");
    }
    element.append(bar, toolbar, surface, raw, preview, status);
    const controlVisibility = { toolbarToggle: toggle, syntaxSelect: picker, previewToggle: previewButton, themeToggle: themeButton, paletteSelect: palettePicker, statusBar: status };
    const isDark = () => element.dataset.theme === "dark" || (element.dataset.theme !== "light" && element.classList.contains("dark"));

    /* --- SOURCE MAPPING --- */
    const split = (text, from = 0) => {
      const result = [];
      const pattern = /\r\n|\r|\n/g;
      let cursor = 0,
        match;
      while ((match = pattern.exec(text))) {
        result.push({ text: text.slice(cursor, match.index), eol: match[0], from: from + cursor });
        cursor = pattern.lastIndex;
      }
      result.push({ text: text.slice(cursor), eol: "", from: from + cursor });
      return result;
    };
    /** Find the physical line owning a source offset without scanning the entire document. */
    const lineAt = (offset) => {
      let low = 0,
        high = lines.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lines[middle].from <= offset) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    // Textareas normalize CRLF to LF. Keep their offsets separate from canonical source.
    const syncRawBreaks = () => {
      rawBreaks = [...source.matchAll(/\r\n/g)].map((match) => match.index);
    };
    /** Translate textarea-normalized offsets to/from canonical source positions, accounting for CRLF pairs. */
    const rawOffset = (offset, toSource = false) => {
      let low = 0,
        high = rawBreaks.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (rawBreaks[middle] - (toSource ? middle : 0) < offset) low = middle + 1;
        else high = middle;
      }
      return offset + (toSource ? low : -low);
    };
    const updateRawBreaks = (from, to, inserted) => {
      if (!rawBreaks.length && !inserted.includes("\r") && source[from - 1] !== "\r") return;
      const start = Math.max(0, from - 1),
        end = from + inserted.length;
      const changed = [...source.slice(start, end + 2).matchAll(/\r\n/g)].map((match) => start + match.index).filter((offset) => offset <= end);
      const first = start - rawOffset(start),
        last = to + 1 - rawOffset(to + 1),
        delta = inserted.length - (to - from);
      if (changed.length > 10000) rawBreaks = rawBreaks.slice(0, first).concat(changed, rawBreaks.slice(last));
      else rawBreaks.splice(first, last - first, ...changed);
      for (let i = first + changed.length; i < rawBreaks.length; i++) rawBreaks[i] += delta;
    };
    /** Associate rendered text nodes with source slices so selections never depend on HTML serialization. */
    const mappedText = (parent, record, from, to, className = "") => {
      if (to <= from) return;
      const text = document.createTextNode(record.text.slice(from, to));
      textMap.set(text, { record, from, to });
      record.points.push({ node: text, from, to });
      if (className) {
        const span = node("span", className);
        span.append(text);
        if (className === "byEDsyntax") span.setAttribute("aria-hidden", "true");
        parent.appendChild(span);
      } else parent.appendChild(text);
    };
    const firstPoint = (target, end) => {
      if (!target) return null;
      if (syntax === "no-code" && target.nodeType === Node.ELEMENT_NODE && target.matches(".byEDsyntax,.byEDescape,.byEDhardBreak,.byEDunsupportedSource,.byEDunsupported")) return null;
      if (textMap.has(target)) {
        const point = textMap.get(target);
        return point.record.from + (end ? point.to : point.from);
      }
      const children = [...target.childNodes];
      if (end) children.reverse();
      for (const child of children) {
        const found = firstPoint(child, end);
        if (found !== null) return found;
      }
      const record = lineMap.get(target);
      return record ? record.from : null;
    };
    /** Translate a native DOM boundary into a source offset, including empty-line placeholder nodes. */
    const offsetOf = (target, offset) => {
      if (syntax === "no-code") {
        const readOnly = (target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement)?.closest(".byEDunsupported");
        if (readOnly) {
          const record = lineMap.get(readOnly.closest(".byEDline"));
          return record.from + (offset ? record.text.length : 0);
        }
      }
      if (textMap.has(target)) {
        const item = textMap.get(target);
        return item.record.from + item.from + Math.min(offset, target.length);
      }
      if (target.nodeType === Node.ELEMENT_NODE) {
        const line = lineMap.get(target);
        if (syntax === "no-code" && line?.meta.type === "source") return line.from + (offset ? line.text.length : 0);
        const point = offset < target.childNodes.length ? firstPoint(target.childNodes[offset], false) : firstPoint(target, true);
        if (point !== null) return point;
        // A blank line's placeholder <br> still belongs to a canonical source position.
        const record = lineMap.get(target.closest(".byEDline"));
        if (record && !record.text.length) return record.from;
      }
      return null;
    };
    /** Read the active mode's selection as directed UTF-16 source offsets; toolbar focus retains the last range. */
    /* --- SELECTION --- */
    const selection = () => {
      if (syntax === "source")
        return { anchor: rawOffset(raw.selectionDirection === "backward" ? raw.selectionEnd : raw.selectionStart, true), focus: rawOffset(raw.selectionDirection === "backward" ? raw.selectionStart : raw.selectionEnd, true) };
      const current = document.getSelection();
      if (current && surface.contains(current.anchorNode) && surface.contains(current.focusNode)) {
        // Select All includes source that has no visible caret boundary, such as headings and closing fences.
        if (
          syntax === "no-code" &&
          fullSelection &&
          current.anchorNode === fullSelection.anchorNode &&
          current.anchorOffset === fullSelection.anchorOffset &&
          current.focusNode === fullSelection.focusNode &&
          current.focusOffset === fullSelection.focusOffset
        )
          return position;
        const anchor = offsetOf(current.anchorNode, current.anchorOffset),
          focus = offsetOf(current.focusNode, current.focusOffset);
        if (anchor !== null && focus !== null) return { anchor, focus };
      }
      return position;
    };
    const activate = (record) => {
      if (active === record) return;
      const previous = active?.group?.kind === "fence" ? active.group.node : null;
      const next = record?.group?.kind === "fence" ? record.group.node : null;
      if (previous !== next) {
        previous?.classList.remove("is-active");
        next?.classList.add("is-active");
      }
      active?.view?.classList.remove("is-active");
      active = record;
      active?.view?.classList.add("is-active");
      active?.view?.classList.add("byEDvisited");
    };
    /** Restore a directed source selection in either editing surface without replacing document content. */
    const restore = (next = position, focus = true) => {
      fullSelection = null;
      position = { anchor: Math.max(0, Math.min(source.length, next.anchor)), focus: Math.max(0, Math.min(source.length, next.focus)) };
      if (previewing) return;
      if (syntax === "source") {
        if (focus && document.activeElement !== raw) raw.focus({ preventScroll: true });
        raw.setSelectionRange(rawOffset(Math.min(position.anchor, position.focus)), rawOffset(Math.max(position.anchor, position.focus)), position.anchor > position.focus ? "backward" : "forward");
        return;
      }
      const point = (offset) => {
        let index = lineAt(offset),
          record = lines[index];
        // Hidden fences and table separators cannot own a visible caret in No-code mode.
        if (syntax === "no-code" && ["fenceOpen", "fenceClose", "tableDelimiter"].includes(record.meta.type)) {
          const step = record.meta.type === "fenceClose" ? -1 : 1;
          while (lines[index + step] && ["fenceOpen", "fenceClose", "tableDelimiter"].includes(lines[index].meta.type)) index += step;
          record = lines[index];
        }
        const relative = Math.max(0, Math.min(record.text.length, offset - record.from));
        const points = syntax === "no-code" ? record.points.filter((item) => !item.node.parentElement.closest(".byEDsyntax,.byEDescape,.byEDhardBreak,.byEDunsupportedSource")) : record.points;
        const found = points.find((item) => item.from <= relative && item.to >= relative) || (relative <= (points[0]?.from ?? 0) ? points[0] : points.at(-1));
        return found ? [found.node, Math.max(0, Math.min(found.node.length, relative - found.from))] : [record.view, relative ? record.view.childNodes.length : 0];
      };
      activate(lines[lineAt(position.focus)]);
      if (focus && document.activeElement !== surface) surface.focus({ preventScroll: true });
      const anchor = point(position.anchor),
        end = point(position.focus);
      document.getSelection()?.setBaseAndExtent(...anchor, ...end);
      if (syntax === "no-code" && position.anchor !== position.focus && Math.min(position.anchor, position.focus) === 0 && Math.max(position.anchor, position.focus) === source.length) {
        const current = document.getSelection();
        fullSelection = { anchorNode: current.anchorNode, anchorOffset: current.anchorOffset, focusNode: current.focusNode, focusOffset: current.focusOffset };
      }
    };

    /* --- INCREMENTAL RENDERING --- */
    const renderInline = (target, record, from, to) => {
      const value = record.text.slice(from, to);
      if (value.length > 8192 || record.meta.type === "source") {
        mappedText(target, record, from, to);
        return;
      }
      const render = (parent, tokens) => {
        for (const token of tokens) {
          const start = from + token.from,
            end = from + token.to;
          if (token.type === "text") {
            mappedText(parent, record, start, end);
            continue;
          }
          if (token.type === "escape") {
            const literal = node("span", "byEDliteral");
            mappedText(literal, record, start, from + token.bodyFrom, "byEDescape");
            mappedText(literal, record, from + token.bodyFrom, end);
            record.formats.push({ type: "escape", from: start, to: end, bodyFrom: from + token.bodyFrom, bodyTo: end });
            parent.append(literal);
            continue;
          }
          // Entities retain their source spelling; other modes also keep normalized code spans literal.
          if (token.type === "entity" || (syntax !== "no-code" && token.type === "code" && token.text !== value.slice(token.bodyFrom, token.bodyTo))) {
            mappedText(parent, record, start, end, "byEDliteral");
            continue;
          }
          const tag = { strongEm: "strong", link: "span", image: "span" }[token.type] || token.type;
          const wrapper = node(tag, token.type === "code" ? "byMDinlineCode" : token.type === "link" ? "byMDlink" : "");
          if (["strong", "strongEm", "em", "del", "code"].includes(token.type) || (syntax === "no-code" && !token.auto && ["link", "image"].includes(token.type)))
            record.formats.push({ ...token, from: start, to: end, bodyFrom: from + token.bodyFrom, bodyTo: from + token.bodyTo });
          mappedText(wrapper, record, start, from + token.bodyFrom, "byEDsyntax");
          if (token.children && !token.auto) render(wrapper, token.children);
          else mappedText(wrapper, record, from + token.bodyFrom, from + token.bodyTo);
          mappedText(wrapper, record, from + token.bodyTo, end, "byEDsyntax");
          if (token.type === "strongEm") {
            const em = node("em");
            em.append(...wrapper.childNodes);
            wrapper.append(em);
          }
          if (token.type === "image") {
            const img = node("img", "byEDimage");
            img.src = token.url;
            img.alt = token.text;
            img.loading = "lazy";
            img.contentEditable = "false";
            wrapper.append(img);
            wrapper.classList.add("byEDimageSource");
          }
          parent.appendChild(wrapper);
        }
      };
      const started = metrics ? performance.now() : 0,
        tokens = global.byMDviewer.parseInline(value);
      measure("parse", started, { characters: value.length, scope: "inline" });
      render(target, tokens);
    };
    /** Keep existing inline nodes attached so CSS can finish a marker's closing transition after a reparse. */
    const patchLineContent = (target, content, record) => {
      const retained = new WeakMap();
      const sync = (parent, replacement) => {
        let current = parent.firstChild;
        for (const child of [...replacement.childNodes]) {
          const next = current?.nextSibling;
          if (current?.nodeType === Node.TEXT_NODE && child.nodeType === Node.TEXT_NODE) {
            current.data = child.data;
            const mapping = textMap.get(child);
            if (mapping) textMap.set(current, mapping);
            retained.set(child, current);
          } else if (
            current?.nodeType === Node.ELEMENT_NODE &&
            child.nodeType === Node.ELEMENT_NODE &&
            current.tagName === child.tagName &&
            current.className === child.className &&
            ["SPAN", "STRONG", "EM", "DEL", "CODE", "TH", "TD"].includes(child.tagName)
          ) {
            sync(current, child);
          } else if (current) current.replaceWith(child);
          else parent.append(child);
          current = next;
        }
        while (current) {
          const next = current.nextSibling;
          current.remove();
          current = next;
        }
      };
      sync(target, content);
      for (const point of record.points) point.node = retained.get(point.node) || point.node;
    };
    /** Render one physical line; ambiguous source mappings deliberately retain literal Markdown. */
    const renderLine = (record) => {
      const meta = record.meta,
        type = meta.type;
      const tag =
        type === "heading" ? `h${meta.level}` : ["bullet", "ordered", "task"].includes(type) ? "li" : type.startsWith("table") ? "tr" : type === "quote" ? "blockquote" : ["code", "fenceOpen", "fenceClose"].includes(type) ? "span" : "div";
      let view = record.view;
      if (!view || view.tagName.toLowerCase() !== tag) {
        const replacement = node(tag, "byEDline");
        view?.replaceWith(replacement);
        view = replacement;
        record.view = view;
      }
      const target = view;
      const preserveMotion = options.animations && syntax === "clean" && target.classList.contains("byEDvisited") && target.querySelector(".byEDsyntax");
      lineMap.set(target, record);
      if (preserveMotion) view = node(tag);
      else view.replaceChildren();
      target.dataset.type = type;
      target.classList.toggle("byCODEhighlight", type === "code");
      if (record.group?.kind === "fence") record.group.codeCache = null;
      record.points = [];
      record.formats = [];
      if (type === "tableHeader" || type === "tableRow") {
        let cursor = 0;
        for (const [index, cell] of meta.cells.entries()) {
          const td = node(type === "tableHeader" ? "th" : "td");
          if (type === "tableHeader") td.scope = "col";
          mappedText(td, record, cursor, cell.from, "byEDsyntax");
          const body = node("span", "byEDcell");
          renderInline(body, record, cell.from, cell.to);
          if (!body.childNodes.length) {
            const empty = document.createTextNode("");
            body.appendChild(empty);
            textMap.set(empty, { record, from: cell.from, to: cell.from });
            record.points.push({ node: empty, from: cell.from, to: cell.from });
          }
          td.appendChild(body);
          cursor = cell.to;
          if (index === meta.cells.length - 1) mappedText(td, record, cursor, record.text.length, "byEDsyntax");
          if (!td.childNodes.length) td.appendChild(document.createElement("br"));
          view.append(td);
        }
      } else if (type === "tableDelimiter") {
        const td = node("td");
        td.colSpan = meta.state.table;
        mappedText(td, record, 0, record.text.length, "byEDsyntax");
        view.append(td);
      } else if (type === "rule") {
        mappedText(view, record, 0, record.text.length, "byEDsyntax");
        const hr = node("hr");
        hr.contentEditable = "false";
        view.append(hr);
      } else if (type === "source" && syntax === "no-code") {
        // Unsupported structures remain readable without exposing source or pretending their DOM is editable.
        mappedText(view, record, 0, record.text.length, "byEDunsupportedSource");
        const readOnly = node("div", "byEDunsupported");
        readOnly.contentEditable = "false";
        readOnly.title = "Edit this block in Source mode.";
        view.append(readOnly);
        global.byMDviewer(readOnly, record.text, { toolbar: false, statusBar: false, animations: false, codeHighlighting: false });
        // The editor owns the palette; this fragment inherits it instead of starting a nested theme.
        readOnly.classList.remove("byMDdocument");
      } else if (["code", "source", "fenceOpen", "fenceClose"].includes(type)) {
        mappedText(view, record, 0, record.text.length, type.startsWith("fence") ? "byEDsyntax" : "");
      } else {
        mappedText(view, record, 0, meta.bodyFrom, "byEDsyntax");
        if (type === "task") {
          const box = node("input", "byEDtask");
          box.type = "checkbox";
          box.checked = meta.checked;
          box.contentEditable = "false";
          box.setAttribute("aria-label", `Complete ${record.text.slice(meta.bodyFrom) || "task"}`);
          view.append(box);
        }
        const hardBreak = record.text.slice(meta.bodyFrom, meta.bodyTo).match(/\\+$/);
        const bodyTo = hardBreak?.[0].length % 2 ? meta.bodyTo - 1 : meta.bodyTo;
        renderInline(view, record, meta.bodyFrom, bodyTo);
        mappedText(view, record, bodyTo, meta.bodyTo, "byEDhardBreak");
        mappedText(view, record, meta.bodyTo, record.text.length, "byEDsyntax");
      }
      if (!record.points.length || (meta.bodyFrom === meta.bodyTo && !meta.cells && record.points.every((item) => item.node.parentElement.closest(".byEDsyntax")))) {
        const offset = meta.bodyFrom || 0;
        const empty = document.createTextNode("");
        textMap.set(empty, { record, from: offset, to: offset });
        record.points.push({ node: empty, from: offset, to: offset });
        view.append(empty, document.createElement("br"));
      }
      if (preserveMotion) patchLineContent(target, view, record);
      if (active === record) target.classList.add("is-active");
    };
    /** Carry the previous line's parser state forward and inspect the next line only for table headers. */
    const classify = (record, previous, next) => {
      const started = metrics ? performance.now() : 0;
      record.meta = global.byMDviewer.scanLine(record.text, previous?.meta.state, next?.text || "");
      measure("parse", started, { characters: record.text.length, scope: "line" });
    };
    /** Reuse structural groups and editable children so unrelated edits retain DOM identity and selection. */
    const reconcile = () => {
      const nextGroups = [],
        used = new Set();
      let current = null;
      for (const record of lines) {
        const kind = groupKind(record.meta.type);
        const join = current && current.kind === kind && (kind !== "single" || current.count < 32) && !(kind === "table" && record.meta.type === "tableHeader") && !(kind === "fence" && record.meta.type === "fenceOpen");
        if (!join) {
          const old = record.group;
          current = old && old.kind === kind && !used.has(old) ? old : { kind, node: null, content: null };
          if (!current.node) {
            current.node = node(kind === "bullet" ? "ul" : kind === "ordered" ? "ol" : kind === "fence" ? "pre" : "div", `byEDgroup byEDgroup-${kind}`);
            if (kind === "table") {
              const table = node("table", "byMDtable");
              current.content = node("tbody");
              table.append(current.content);
              current.node.append(table);
            } else if (kind === "fence") {
              current.content = node("code");
              current.node.spellcheck = false;
              current.node.append(current.content);
            } else current.content = current.node;
          }
          if (kind === "ordered") current.node.start = record.meta.number;
          current.count = 0;
          current.cursor = current.content.firstChild;
          nextGroups.push(current);
          used.add(current);
        }
        current.count++;
        if (record.view !== current.cursor) current.content.insertBefore(record.view, current.cursor);
        current.cursor = record.view.nextSibling;
        record.group = current;
      }
      // Move existing groups only when structure changed. Their editable children retain identity.
      let cursor = surface.firstChild;
      for (const group of nextGroups) {
        if (group.node !== cursor) surface.insertBefore(group.node, cursor);
        cursor = group.node.nextSibling;
      }
      for (const old of groups) if (!used.has(old)) old.node.remove();
      for (const group of nextGroups) {
        delete group.cursor;
        group.node.classList.toggle("is-active", group.kind === "fence" && active?.group === group);
      }
      groups = nextGroups;
    };

    /* --- CODE HIGHLIGHTING --- */
    const paintCodeLine = (record, parts) => {
      if (!record?.text.length) return false;
      const children = [...record.view.childNodes];
      if (
        children.length === parts.length &&
        parts.every((part, index) => {
          const child = children[index],
            className = part.type === "plain" ? "" : `byCODEtoken byCODE${part.type}`;
          return (child.nodeType === Node.TEXT_NODE ? "" : child.className) === className && child.textContent === record.text.slice(part.from, part.to);
        })
      )
        return false;
      record.points = [];
      record.view.replaceChildren();
      for (const part of parts) mappedText(record.view, record, part.from, part.to, part.type === "plain" ? "" : `byCODEtoken byCODE${part.type}`);
      return true;
    };
    /** Consume CODE tokens in short frames and restore selection only if coloring moved its DOM boundary. */
    const colorCode = () => {
      codeFrame = 0;
      if (!alive || composing || dirty || previewing || syntax === "source") return;
      const started = performance.now();
      const saved = element.contains(document.activeElement) && surface.contains(document.getSelection()?.focusNode) ? selection() : null;
      let changed = false;
      try {
        // Budget lexical work per frame; one unusually long token can still exceed this slice.
        while ((codeJob || codeQueue.length) && performance.now() - started < 4) {
          if (!codeJob) {
            const group = codeQueue.shift();
            const records = [...group.content.children].map((view) => lineMap.get(view)).filter((record) => record?.meta.type === "code");
            const language = lineMap.get(group.content.firstElementChild)?.meta.language || "plain";
            const text = records.map((record) => record.text).join("\n");
            if (!records.length || (group.codeCache?.text === text && group.codeCache.language === language)) continue;
            codeJob = { group, records, text, language, iterator: global.byCODEviewer.tokenize(text, language), row: 0, column: 0, parts: [], token: null, offset: 0 };
          }
          const job = codeJob;
          if (!job.token) {
            const step = job.iterator.next();
            if (step.done) {
              changed = paintCodeLine(job.records[job.row], job.parts) || changed;
              job.group.codeCache = { text: job.text, language: job.language };
              codeJob = null;
              continue;
            }
            job.token = step.value;
            job.offset = 0;
          }
          const newline = job.token.text.indexOf("\n", job.offset),
            end = newline < 0 ? job.token.text.length : newline;
          const length = end - job.offset;
          if (length) job.parts.push({ type: job.token.type, from: job.column, to: job.column + length });
          job.column += length;
          job.offset = end + (newline < 0 ? 0 : 1);
          if (newline >= 0) {
            changed = paintCodeLine(job.records[job.row++], job.parts) || changed;
            job.column = 0;
            job.parts = [];
          }
          if (job.offset >= job.token.text.length) job.token = null;
        }
      } catch {
        // Highlighting limits or companion failures must not interrupt editable source.
        if (codeJob) {
          codeJob.group.codeCache = { text: codeJob.text, language: codeJob.language };
          codeJob = null;
        }
      }
      if (changed && saved) {
        const current = selection();
        if (current.anchor !== saved.anchor || current.focus !== saved.focus) restore(saved, false);
      }
      measure("highlight", started);
      if (codeJob || codeQueue.length) codeFrame = requestAnimationFrame(colorCode);
    };
    /** Cancel obsolete timers, frames, and the current iterator before another highlight pass takes ownership. */
    const cancelCode = () => {
      clearTimeout(codeTimer);
      cancelAnimationFrame(codeFrame);
      codeTimer = codeFrame = 0;
      codeJob?.iterator.return?.();
      codeJob = null;
      codeQueue = [];
    };
    /** Debounce code coloring independently of text input and skip it while IME owns the active DOM. */
    const queueCode = () => {
      cancelCode();
      if (options.codeHighlighting === false || typeof global.byCODEviewer?.tokenize !== "function") return;
      codeTimer = setTimeout(() => {
        codeTimer = 0;
        if (!alive || composing || dirty || previewing || syntax === "source") return;
        codeQueue = groups.filter((group) => group.kind === "fence");
        if (codeQueue.length) codeFrame = requestAnimationFrame(colorCode);
      }, 80);
    };

    /** Rebuild the derived line/group index from canonical source after initialization or source replacement. */
    const build = () => {
      renderedNoCode = syntax === "no-code";
      textMap = new WeakMap();
      lineMap = new WeakMap();
      active = null;
      lines = split(source);
      surface.replaceChildren();
      groups = [];
      for (let i = 0; i < lines.length; i++) {
        classify(lines[i], lines[i - 1], lines[i + 1]);
        renderLine(lines[i]);
      }
      reconcile();
      dirty = false;
      surface.dataset.empty = String(!source);
      queueCode();
    };
    /** Replace affected lines, shift later offsets, and reclassify only until fence/table context converges. */
    const patch = (from, to, inserted) => {
      const started = metrics ? performance.now() : 0;
      const first = lineAt(from),
        last = lineAt(to),
        original = lines[first];
      const combined = original.text.slice(0, from - original.from) + inserted + lines[last].text.slice(to - lines[last].from) + lines[last].eol;
      const replacement = split(combined, original.from);
      if (lines[last].eol) replacement.pop();
      const deleted = lines.slice(first, last + 1);
      if (replacement.length > 10000) lines = lines.slice(0, first).concat(replacement, lines.slice(last + 1));
      else lines.splice(first, last - first + 1, ...replacement);
      for (let i = 0; i < Math.min(deleted.length, replacement.length); i++) {
        replacement[i].view = deleted[i].view;
        replacement[i].group = deleted[i].group;
        replacement[i].meta = deleted[i].meta;
        if (active === deleted[i]) active = replacement[i];
      }
      for (const record of deleted.slice(replacement.length)) record.view.remove();
      const delta = inserted.length - (to - from);
      for (let i = first + replacement.length; i < lines.length; i++) lines[i].from += delta;
      let structural = deleted.length !== replacement.length;
      for (let i = Math.max(0, first - 1); i < lines.length; i++) {
        const record = lines[i],
          old = record.meta,
          previousKey = stateKey(old?.state);
        classify(record, lines[i - 1], lines[i + 1]);
        const changed = i >= first && i < first + replacement.length;
        if (changed || JSON.stringify(old) !== JSON.stringify(record.meta)) {
          structural ||= old?.type !== record.meta.type;
          renderLine(record);
        }
        // Reclassification can stop once fence/table context converges beyond the edited lines.
        if (i >= first + replacement.length && previousKey === stateKey(record.meta.state)) break;
      }
      if (structural || replacement.some((record) => !record.view.parentNode)) reconcile();
      measure("patch", started, { lines: replacement.length });
    };

    /* --- TRANSACTIONS AND HISTORY --- */
    const announce = (text) => {
      status.textContent = text;
    };
    const updateToolbar = () => {
      toolbarFrame = 0;
      if (!alive) return;
      commandButtons.get("undo")?.toggleAttribute("disabled", historyIndex === 0);
      commandButtons.get("redo")?.toggleAttribute("disabled", historyIndex === history.length);
      const controls = [...toolbar.querySelectorAll("button:not(:disabled), select")];
      const entry = controls.find((control) => control.tabIndex === 0) || controls[0];
      for (const control of toolbar.querySelectorAll("button, select")) {
        const index = control === entry ? 0 : -1;
        if (control.tabIndex !== index) control.tabIndex = index;
      }
      if (!dirty && lines.length) heading.value = String(lines[lineAt(position.focus)].meta.level || 0);
      const from = Math.min(position.anchor, position.focus),
        to = Math.max(position.anchor, position.focus);
      for (const [name, marker] of Object.entries(wraps)) {
        const tokenType = { bold: "strong", italic: "em", strikethrough: "del", inlineCode: "code" }[name];
        const record = !dirty && lines[lineAt(from)];
        const pressed =
          (source.slice(Math.max(0, from - marker.length), from) === marker && source.slice(to, to + marker.length) === marker) ||
          Boolean(record?.formats?.some((token) => (token.type === tokenType || (token.type === "strongEm" && ["strong", "em"].includes(tokenType))) && record.from + token.bodyFrom <= from && record.from + token.bodyTo >= to));
        const button = commandButtons.get(name);
        if (button && button.getAttribute("aria-pressed") !== String(pressed)) button.setAttribute("aria-pressed", String(pressed));
      }
    };
    const scheduleToolbar = () => {
      if (!toolbarFrame) toolbarFrame = requestAnimationFrame(updateToolbar);
    };
    /** Accept an unchanged native text node after input while updating its source offsets and history data. */
    const acceptNativeText = (edit) => {
      const { record, point, from, to, inserted } = edit,
        delta = inserted.length - (to - from),
        local = from - record.from;
      record.text = record.text.slice(0, local) + inserted + record.text.slice(to - record.from);
      for (const item of record.points) {
        if (item.node === point.node) item.to += delta;
        else if (item.from >= local) {
          item.from += delta;
          item.to += delta;
        }
        textMap.set(item.node, { record, from: item.from, to: item.to });
      }
      for (const token of record.formats) for (const key of ["from", "to", "bodyFrom", "bodyTo"]) if (token[key] > local || (token[key] === local && (key === "to" || key === "bodyTo"))) token[key] += delta;
      const index = lineAt(from);
      for (let i = index + 1; i < lines.length; i++) lines[i].from += delta;
      record.meta = edit.meta;
      if (record.meta.type === "task") record.view.querySelector(".byEDtask").setAttribute("aria-label", `Complete ${record.text.slice(record.meta.bodyFrom) || "task"}`);
    };
    // All committed edits pass here so source, ranges, undo history, and callbacks stay in agreement.
    /** Commit one source edit, update derived views and undo state, then notify the application synchronously. */
    const change = (from, to, inserted, next, type = "command", remember = true, native = null) => {
      if (!alive || previewing) return false;
      // Text edits stay inside visible structure; explicit commands and undo can change that structure.
      if (syntax === "no-code" && remember && (type.startsWith("insert") || type.startsWith("delete") || ["paste", "cut", "composition"].includes(type)) && !(from === 0 && to === source.length && from < to)) {
        const first = lineAt(from),
          last = lineAt(to),
          record = lines[first];
        if (record.meta.type === "source") {
          announce("Edit this block in Source mode.");
          return false;
        }
        if (record.meta.cells && (first !== last || !record.meta.cells.some((cell) => from >= record.from + cell.from && to <= record.from + cell.to))) {
          // A native text node can include newly typed spaces that the Markdown parser trims.
          const startPoint = first === last ? record.points.find((point) => from >= record.from + point.from && from <= record.from + point.to && point.node.parentElement.closest(".byEDcell")) : null;
          const cell = startPoint?.node.parentElement.closest(".byEDcell");
          if (!cell || !record.points.some((point) => to >= record.from + point.from && to <= record.from + point.to && cell.contains(point.node))) {
            announce("Edit one table cell at a time. Use Tab to move between cells.");
            return false;
          }
        }
        for (let index = first; index <= last; index++) {
          if (!["fenceOpen", "fenceClose"].includes(lines[index].meta.type)) continue;
          const opening = record.meta.type === "fenceOpen" ? record : lines[first - 1];
          const closing = record.meta.type === "fenceClose" ? record : lines[first + 1];
          if (from === to && inserted && opening?.meta.type === "fenceOpen" && closing?.meta.type === "fenceClose" && opening.group === closing.group) {
            // Materialize an empty code line only when it is edited; untouched Markdown stays exact.
            from = to = closing.from;
            next = { anchor: from + inserted.length, focus: from + inserted.length };
            inserted += opening.eol || eol;
            break;
          }
          announce("Code fences stay hidden. Use Source mode to change the block structure.");
          return false;
        }
      }
      if (syntax === "no-code" && !inserted && (type.startsWith("delete") || type === "cut")) {
        // Deleting all visible text in a format must not leave orphaned hidden delimiters.
        const record = lines[lineAt(from)];
        let token;
        while ((token = record.formats.find((item) => record.from + item.bodyFrom === from && record.from + item.bodyTo === to))) {
          from = record.from + token.from;
          to = record.from + token.to;
        }
      }
      if (source.length - (to - from) + inserted.length > 2000000) {
        announce("This document has reached the two-million-character limit.");
        return false;
      }
      const started = metrics ? performance.now() : 0;
      const before = native?.before || { ...selection() },
        removed = source.slice(from, to);
      if (removed === inserted) {
        if (next) restore(next);
        return true;
      }
      const rawFrom = syntax === "source" ? rawOffset(from) : 0,
        rawTo = syntax === "source" ? rawOffset(to) : 0;
      source = source.slice(0, from) + inserted + source.slice(to);
      updateRawBreaks(from, to, inserted);
      if (surface.dataset.empty !== String(!source)) surface.dataset.empty = String(!source);
      const after = next || { anchor: from + inserted.length, focus: from + inserted.length };
      if (syntax === "source") {
        raw.setRangeText(inserted, rawFrom, rawTo, "end");
        dirty = true;
      } else if (native?.stable) acceptNativeText(native);
      else patch(from, to, inserted);
      if (remember) {
        const discarded = history.splice(historyIndex);
        for (const entry of discarded) historyBytes -= entry.removed.length + entry.inserted.length;
        const prior = history.at(-1),
          time = performance.now();
        if (type === "insertText" && !removed && !/[\r\n]/.test(inserted) && prior?.type === type && prior.from + prior.inserted.length === from && time - prior.time < 750) {
          prior.inserted += inserted;
          prior.after = after;
          prior.time = time;
        } else history.push({ from, removed, inserted, before, after, type, time });
        historyBytes += removed.length + inserted.length;
        while (history.length > options.historyLimit || (historyBytes > 2000000 && history.length > 1)) {
          const entry = history.shift();
          historyBytes -= entry.removed.length + entry.inserted.length;
        }
        historyIndex = history.length;
      }
      if (native?.stable) position = after;
      else restore(after);
      queueCode();
      scheduleToolbar();
      measure("edit", (native?.started ?? started) - (native?.inputCost || 0), { characters: inserted.length });
      options.onChange?.(source);
      return true;
    };
    /** Replay the recorded source delta and directed selection without recording a second history entry. */
    const undo = (redo = false) => {
      if ((redo && historyIndex >= history.length) || (!redo && historyIndex === 0)) return;
      const entry = history[redo ? historyIndex++ : --historyIndex];
      change(entry.from, entry.from + (redo ? entry.removed.length : entry.inserted.length), redo ? entry.inserted : entry.removed, redo ? entry.after : entry.before, "history", false);
    };
    /** Commit only the browser-owned composition delta before normal rendering and history resume. */
    const finishComposition = () => {
      if (!composing) return;
      const session = composing;
      composing = null;
      const next = syntax === "source" ? raw.value : session.record.view.textContent;
      const before = session.value;
      let from = 0,
        oldEnd = before.length,
        newEnd = next.length;
      while (from < oldEnd && from < newEnd && before[from] === next[from]) from++;
      while (oldEnd > from && newEnd > from && before[oldEnd - 1] === next[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const inserted = next.slice(from, newEnd),
        start = syntax === "source" ? rawOffset(from, true) : session.from + from;
      const end = syntax === "source" ? rawOffset(oldEnd, true) : session.from + oldEnd;
      // Native composition owns its DOM until commit; restore the canonical textarea before patching it.
      if (syntax === "source") raw.value = source;
      change(start, end, inserted, { anchor: start + inserted.length, focus: start + inserted.length }, "composition", true, { before: session.before });
      queueCode();
    };
    /** Reconcile native input through the source transaction; HTML is never converted back into Markdown. */
    const acceptNativeInput = () => {
      if (composing || !alive || previewing) return;
      if (nativeEdit) {
        const edit = nativeEdit;
        nativeEdit = null;
        edit.started = metrics ? performance.now() : 0;
        const local = edit.from - edit.record.from;
        const expected = edit.record.text.slice(0, local) + edit.inserted + edit.record.text.slice(edit.to - edit.record.from);
        const index = lineAt(edit.from),
          started = metrics ? performance.now() : 0;
        const meta = global.byMDviewer.scanLine(expected, lines[index - 1]?.meta.state, lines[index + 1]?.text || "");
        measure("parse", started, { characters: expected.length, scope: "line" });
        edit.meta = meta;
        edit.stable = edit.point.node.isConnected && edit.record.view.textContent === expected && meta.type === edit.record.meta.type && meta.bodyFrom === edit.record.meta.bodyFrom;
        const offset = edit.from + edit.inserted.length;
        change(edit.from, edit.to, edit.inserted, { anchor: offset, focus: offset }, edit.type, true, edit);
        return;
      }
      const record = lines[lineAt(position.focus)];
      const before = syntax === "source" ? source.replace(/\r\n?/g, "\n") : record?.text;
      const value = syntax === "source" ? raw.value : record?.view.textContent;
      if (value === undefined || value === before) return;
      let from = 0,
        end = before.length,
        nextEnd = value.length;
      while (from < end && from < nextEnd && before[from] === value[from]) from++;
      while (end > from && nextEnd > from && before[end - 1] === value[nextEnd - 1]) {
        end--;
        nextEnd--;
      }
      if (syntax === "source") raw.value = source;
      const start = syntax === "source" ? rawOffset(from, true) : record.from + from,
        stop = syntax === "source" ? rawOffset(end, true) : record.from + end;
      const inserted = value.slice(from, nextEnd),
        caret = start + inserted.length;
      if (!change(start, stop, inserted, { anchor: caret, focus: caret }, "native")) {
        if (syntax === "source") raw.value = source;
        else renderLine(record);
      }
    };

    /* --- FORMATTING --- */
    const command = (name, value) => {
      if (!alive || previewing) return false;
      finishComposition();
      position = selection();
      const from = Math.min(position.anchor, position.focus),
        to = Math.max(position.anchor, position.focus);
      if (name === "undo" || name === "redo") {
        undo(name === "redo");
        return true;
      }
      if (syntax === "no-code" && lines[lineAt(from)]?.meta.type === "source") {
        announce("Edit this block in Source mode.");
        return false;
      }
      if (wraps[name]) {
        let marker = wraps[name];
        const selected = source.slice(from, to);
        if (/[\r\n]/.test(selected) || (syntax !== "source" && lines[lineAt(from)]?.meta.cells?.some((cell) => from - lines[lineAt(from)].from <= cell.to && to - lines[lineAt(from)].from > cell.to))) {
          announce("Select text within one paragraph or table cell to apply inline formatting.");
          return false;
        }
        if (from === to && syntax !== "source" && !dirty) {
          const record = lines[lineAt(from)],
            type = { bold: "strong", italic: "em", strikethrough: "del", inlineCode: "code" }[name];
          const token = record.formats.find((item) => (item.type === type || (item.type === "strongEm" && ["strong", "em"].includes(type))) && record.from + item.bodyFrom <= from && record.from + item.bodyTo >= from);
          if (token) {
            const start = record.from + token.from,
              end = record.from + token.to,
              body = record.from + token.bodyFrom;
            const remaining = token.type === "strongEm" ? source.slice(start, start + (name === "bold" ? 1 : 2)) : "";
            const caret = from - (body - start) + remaining.length;
            return change(start, end, remaining + source.slice(body, record.from + token.bodyTo) + remaining, { anchor: caret, focus: caret }, name);
          }
        }
        if (name === "inlineCode" && selected.includes("`")) marker = "`".repeat(Math.max(...[...selected.matchAll(/`+/g)].map((match) => match[0].length)) + 1);
        if (source.slice(from - marker.length, from) === marker && source.slice(to, to + marker.length) === marker)
          return change(from - marker.length, to + marker.length, selected, { anchor: from - marker.length, focus: to - marker.length }, name);
        if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) return change(from, to, selected.slice(marker.length, -marker.length), { anchor: from, focus: to - marker.length * 2 }, name);
        const body = selected || (syntax === "no-code" ? "Text" : "");
        return change(from, to, marker + body + marker, { anchor: from + marker.length, focus: from + marker.length + body.length }, name);
      }
      if (["heading", "paragraph", "bulletList", "orderedList", "checklist", "blockquote"].includes(name)) {
        const start = Math.max(source.lastIndexOf("\n", from - 1), source.lastIndexOf("\r", from - 1)) + 1;
        const remainder = source.slice(to).search(/[\r\n]/);
        const end = remainder < 0 ? source.length : to + remainder;
        if (syntax !== "source" && lines[lineAt(from)].meta.cells) {
          announce("Paragraph styles apply outside tables. Edit cell text directly.");
          return false;
        }
        const prefix = name === "heading" && Number(value) > 0 ? "#".repeat(Math.min(6, Math.max(1, Number(value)))) + " " : { bulletList: "- ", orderedList: "1. ", checklist: "- [ ] ", blockquote: "> " }[name] || "";
        const original = source.slice(start, end);
        const output = original
          .split(/(\r\n|\r|\n)/)
          .map((line, index) => (index % 2 || (!line.trim() && /[\r\n]/.test(original)) ? line : prefix + line.replace(/^(?: {0,3}#{1,6}\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|> ?)/, "")))
          .join("");
        return change(start, end, output, { anchor: start + prefix.length, focus: start + output.length }, name);
      }
      if (name === "link" || name === "image") {
        if (!value?.url) return openDialog(name);
        if (/^[\s\u0000-\u0020]*(?:javascript|data|vbscript):/i.test(value.url.replace(/[\u0000-\u0020]/g, ""))) {
          announce("Use a web, email, or relative URL.");
          return false;
        }
        const label = source.slice(from, to) || value.label || (name === "image" ? "Image description" : "Link text");
        const url = value.url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
        const opening = name === "image" ? "![" : "[";
        return change(from, to, `${opening}${label}](${url})`, { anchor: from + opening.length, focus: from + opening.length + label.length }, name);
      }
      if (name === "table" || name === "insertTable") {
        if (!value) return openDialog("table");
        const rows = Math.min(100, Math.max(1, Math.trunc(Number(value.rows) || 2))),
          columns = Math.min(20, Math.max(1, Math.trunc(Number(value.columns) || 2)));
        const header = `| ${Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
        const separator = `| ${Array(columns).fill("---").join(" | ")} |`;
        const row = `| ${Array(columns).fill(" ").join(" | ")} |`;
        return insertBlock([header, separator, ...Array(rows).fill(row)].join(eol), from, to, name);
      }
      if (name === "codeBlock") {
        if (value === undefined) return openDialog(name);
        const body = source.slice(from, to),
          runs = [...body.matchAll(/`+/g)].map((match) => match[0].length);
        const marker = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
        return insertBlock(`${marker}${String(value || "").replace(/[^\w+#.-]/g, "")}${eol}${body}${eol}${marker}`, from, to, name);
      }
      if (name === "horizontalRule") return insertBlock("---", from, to, name);
      return false;
    };
    /** Insert a block with surrounding Markdown line boundaries while preserving the document's newline style. */
    const insertBlock = (value, from, to, name) => {
      const left = source.slice(Math.max(0, from - 4), from).replace(/\r\n?/g, "\n"),
        right = source.slice(to, to + 4).replace(/\r\n?/g, "\n");
      const before = from ? eol.repeat(Math.max(0, 2 - left.match(/\n*$/)[0].length)) : "";
      const after = eol.repeat(Math.max(0, 2 - right.match(/^\n*/)[0].length));
      return change(from, to, before + value + after, { anchor: from + before.length, focus: from + before.length + value.length }, name);
    };
    /** Own one insertion dialog at a time and retain the source selection while focus is inside it. */
    const openDialog = (name) => {
      if (dialog) return;
      savedPosition = selection();
      dialogAbort = new AbortController();
      const dialogListen = (target, type, handler) => listen(target, type, handler, { signal: dialogAbort.signal });
      dialog = node("dialog", "byEDdialog");
      const form = node("form");
      form.method = "dialog";
      const title = node("h2", "", { table: "Insert table", link: "Insert link", image: "Insert image", codeBlock: "Insert code block" }[name]);
      const titleId = `byEDdialog-${Math.random().toString(36).slice(2)}`;
      title.id = titleId;
      dialog.setAttribute("aria-labelledby", titleId);
      form.append(title);
      const fields = {};
      const field = (key, label, type, value, max) => {
        const wrapper = node("label", "byEDfield", label),
          input = node("input");
        input.name = key;
        input.type = type;
        input.value = value;
        input.required = true;
        if (type === "number") {
          input.min = "1";
          input.max = String(max);
        }
        wrapper.append(input);
        form.append(wrapper);
        fields[key] = input;
      };
      if (name === "table") {
        field("rows", "Data rows", "number", "2", 100);
        field("columns", "Columns", "number", "2", 20);
      } else if (name === "codeBlock") {
        field("language", "Language (optional)", "text", "javascript");
        fields.language.required = false;
      } else {
        field("url", name === "image" ? "Image URL" : "URL", "text", "https://");
        field("label", name === "image" ? "Image description" : "Link text", "text", source.slice(Math.min(savedPosition.anchor, savedPosition.focus), Math.max(savedPosition.anchor, savedPosition.focus)));
      }
      const actions = node("div", "byEDdialogActions"),
        cancel = node("button", "", "Cancel"),
        submit = node("button", "", "Insert");
      cancel.type = "button";
      submit.type = "submit";
      actions.append(cancel, submit);
      form.append(actions);
      dialog.append(form);
      element.append(dialog);
      const close = () => {
        const current = dialog;
        dialog = null;
        dialogAbort.abort();
        dialogAbort = null;
        current?.close();
        current?.remove();
        restore(savedPosition);
      };
      dialogListen(cancel, "click", close);
      dialogListen(dialog, "cancel", (event) => {
        event.preventDefault();
        close();
      });
      dialogListen(form, "submit", (event) => {
        event.preventDefault();
        const value = name === "table" ? { rows: Number(fields.rows.value), columns: Number(fields.columns.value) } : name === "codeBlock" ? fields.language.value : { url: fields.url.value, label: fields.label.value };
        close();
        command(name, value);
      });
      dialog.showModal();
      Object.values(fields)[0].focus();
    };

    /* --- INPUT --- */
    const beforeInput = (event) => {
      if (composing || event.isComposing || !event.cancelable) return;
      const started = metrics ? performance.now() : 0;
      nativeEdit = null;
      const type = event.inputType;
      position = selection();
      if (syntax === "no-code" && position.anchor === position.focus && lines[lineAt(position.focus)]?.meta.type === "source") {
        event.preventDefault();
        announce("Edit this block in Source mode.");
        return;
      }
      let from = Math.min(position.anchor, position.focus),
        to = Math.max(position.anchor, position.focus),
        inserted = null;
      if (syntax === "no-code" && from === to && ["deleteContentBackward", "deleteContentForward"].includes(type)) {
        const record = lines[lineAt(from)],
          backward = type === "deleteContentBackward";
        let edge = from,
          token;
        // Walk through every enclosing format, not just the innermost delimiter.
        while ((token = record.formats.find((item) => (backward ? edge === record.from + item.bodyFrom || edge === record.from + item.to : edge === record.from + item.bodyTo || edge === record.from + item.from)))) {
          const next = record.from + (backward ? (edge === record.from + token.to ? token.bodyTo : token.from) : token.to);
          if (next === edge) break;
          edge = next;
        }
        if (backward && record.meta.bodyFrom > 0 && edge === record.from + record.meta.bodyFrom && ["heading", "quote", "bullet", "ordered", "task"].includes(record.meta.type)) {
          event.preventDefault();
          change(record.from, edge, "", { anchor: record.from, focus: record.from }, type);
          return;
        }
        // Cross hidden inline delimiters without deleting the formatting itself.
        if (edge !== from) {
          event.preventDefault();
          change(backward ? boundary(source, edge, -1) : edge, backward ? edge : boundary(source, edge, 1), "", null, type);
          return;
        }
      }
      if (type === "deleteContentBackward" && from === to && syntax !== "source" && syntax !== "no-code") {
        const record = lines[lineAt(from)];
        if (record.formats.some((token) => record.from + token.bodyTo === from && token.to > token.bodyTo)) {
          event.preventDefault();
          change(from, from + 1, "", null, type);
          return;
        }
      }
      const targetRange = syntax !== "source" && event.getTargetRanges?.()[0];
      if (targetRange && !(from === 0 && to === source.length)) {
        const start = offsetOf(targetRange.startContainer, targetRange.startOffset),
          end = offsetOf(targetRange.endContainer, targetRange.endOffset);
        if (start !== null && end !== null) {
          from = start;
          to = end;
        }
      }
      // Keep native caret movement and text nodes for ordinary word input. Punctuation
      // and structural edits still pass through the parser and the mapped DOM patch.
      const wordInput = type === "insertText" && from === to && /^[\p{L}\p{N} ,.;?!'-]+$/u.test(event.data || "") && !(event.data.endsWith("!") && source[to] === "[");
      const wordDelete = ["deleteContentBackward", "deleteContentForward"].includes(type) && from < to && position.anchor === position.focus && /^[\p{L}\p{N} ,.;?!'-]+$/u.test(source.slice(from, to));
      if (syntax !== "source" && event.isTrusted && (wordInput || wordDelete) && source.length + (event.data?.length || 0) <= 2000000 && !(/ $/.test(event.data || "") && /[*_~`]/.test(source[to] || ""))) {
        const selected = document.getSelection(),
          target = wordDelete ? targetRange?.startContainer : selected?.focusNode,
          mapped = textMap.get(target);
        const offset = wordDelete ? targetRange.startOffset : selected.focusOffset;
        if (
          mapped &&
          mapped.record.from + mapped.from + offset === from &&
          to <= mapped.record.from + mapped.to &&
          target.length > to - from &&
          !target.parentElement.closest(".byEDsyntax,.byEDliteral,.byEDimageSource") &&
          (wordDelete || /[\p{L}\p{N} ,.;?!'-]$/u.test(target.data.slice(0, offset))) &&
          !/[&@]|:\/\/|\bwww\b/.test(mapped.record.text)
        ) {
          const point = mapped.record.points.find((item) => item.node === target);
          nativeEdit = { record: mapped.record, point, from, to, type, inserted: wordDelete ? "" : event.data, before: { ...position }, inputCost: metrics ? performance.now() - started : 0 };
          return;
        }
      }
      if (type === "historyUndo" || type === "historyRedo") {
        event.preventDefault();
        undo(type === "historyRedo");
        return;
      }
      if (type === "formatBold" || type === "formatItalic") {
        event.preventDefault();
        command(type === "formatBold" ? "bold" : "italic");
        return;
      }
      if (type === "insertText" || type === "insertReplacementText") {
        inserted = event.data ?? "";
        if (inserted === "|" && syntax !== "source") {
          const record = lines[lineAt(from)];
          if (record.meta.cells && !record.formats.some((token) => token.type === "code" && record.from + token.bodyFrom <= from && record.from + token.bodyTo >= to) && source.slice(record.from, from).match(/\\*$/)[0].length % 2 === 0)
            inserted = "\\|";
        }
      } else if (type === "insertParagraph" || type === "insertLineBreak") {
        inserted = eol;
        if (syntax !== "source") {
          const record = lines[lineAt(from)],
            meta = record.meta;
          if (meta.cells) {
            event.preventDefault();
            if (type === "insertLineBreak") {
              announce("Markdown table cells use one line. Press Enter for the next row, or Tab for the next cell.");
              return;
            }
            const column = Math.max(
              0,
              meta.cells.findIndex((cell) => from - record.from <= cell.to)
            );
            const next = lines.slice(lineAt(from) + 1).find((line) => line.meta.type !== "tableDelimiter");
            if (next?.group === record.group && next.meta.cells) {
              const offset = next.from + next.meta.cells[Math.min(column, next.meta.cells.length - 1)].from;
              restore({ anchor: offset, focus: offset });
            } else {
              const row = `| ${Array(meta.cells.length).fill(" ").join(" | ")} |`;
              const last = lines[lineAt(from) + 1]?.meta.type === "tableDelimiter" ? lines[lineAt(from) + 1] : record;
              const end = last.from + last.text.length,
                offset = end + eol.length + 2;
              change(end, end, eol + row, { anchor: offset, focus: offset }, "tableRow");
            }
            return;
          }
          if (["bullet", "ordered", "task"].includes(meta.type) && from === to) {
            if (!record.text.slice(meta.bodyFrom).trim()) {
              from = record.from;
              to = record.from + record.text.length;
              inserted = "";
            } else inserted += meta.type === "task" ? "- [ ] " : meta.type === "ordered" ? `${meta.number + 1}. ` : record.text.slice(0, meta.bodyFrom);
          } else if (type === "insertLineBreak" && !["code", "fenceOpen", "fenceClose"].includes(meta.type)) inserted = "  " + eol;
        }
      } else if (type.startsWith("delete")) {
        inserted = "";
        if (from === to) {
          const backward = /Backward$/.test(type);
          if (/Word/.test(type)) {
            if (backward) from = source.slice(0, from).search(/\S+\s*$/);
            else to += source.slice(to).match(/^\s*\S*/)[0].length;
            from = Math.max(0, from);
          } else if (/Line/.test(type)) {
            if (backward) from = Math.max(source.lastIndexOf("\n", from - 1) + 1, 0);
            else {
              const next = source.indexOf("\n", to);
              to = next < 0 ? source.length : next;
            }
          } else if (backward) {
            from = boundary(source, from, -1);
            if (source.slice(from - 1, to) === "\r\n") from--;
          } else {
            to = boundary(source, to, 1);
            if (source.slice(from, to + 1) === "\r\n") to++;
          }
        }
      }
      if (inserted !== null) {
        event.preventDefault();
        change(from, to, inserted, null, type);
      } else if (type.startsWith("format") || type.startsWith("insert")) event.preventDefault();
    };
    listen(surface, "beforeinput", beforeInput);
    listen(raw, "beforeinput", beforeInput);
    listen(surface, "change", (event) => {
      if (!event.target.matches(".byEDtask")) return;
      const record = lineMap.get(event.target.closest(".byEDline"));
      const focused = document.activeElement === event.target;
      change(record.from + record.meta.checkFrom, record.from + record.meta.checkFrom + 1, event.target.checked ? "x" : " ", position, "checklist");
      if (focused) record.view.querySelector(".byEDtask")?.focus();
    });
    for (const target of [surface, raw]) {
      listen(target, "input", acceptNativeInput);
      listen(target, "compositionstart", () => {
        position = selection();
        const record = lines[lineAt(position.focus)];
        composing = syntax === "source" ? { value: raw.value, from: 0, before: { ...position } } : { record, value: record.text, from: record.from, before: { ...position } };
      });
      listen(target, "compositionend", finishComposition);
      listen(target, "paste", (event) => {
        if (previewing) return;
        event.preventDefault();
        finishComposition();
        position = selection();
        const text = event.clipboardData.getData("text/plain");
        const from = Math.min(position.anchor, position.focus),
          to = Math.max(position.anchor, position.focus);
        if (syntax !== "source" && lines[lineAt(from)].meta.cells) {
          if (/[\r\n]/.test(text)) {
            announce("Paste one line into a table cell, or use Source for multiple rows.");
            return;
          }
          change(
            from,
            to,
            text.replace(/(\\*)\|/g, (value, slashes) => (slashes.length % 2 ? value : `${slashes}\\|`)),
            null,
            "paste"
          );
        } else change(from, to, text, null, "paste");
      });
      listen(target, "copy", (event) => {
        position = selection();
        const from = Math.min(position.anchor, position.focus),
          to = Math.max(position.anchor, position.focus);
        if (from === to) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", source.slice(from, to));
      });
      listen(target, "cut", (event) => {
        position = selection();
        const from = Math.min(position.anchor, position.focus),
          to = Math.max(position.anchor, position.focus);
        if (from === to) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", source.slice(from, to));
        change(from, to, "", null, "cut");
      });
      listen(target, "drop", (event) => {
        event.preventDefault();
        announce("Paste text here, or use Image to insert an image URL.");
      });
      listen(target, "keydown", (event) => {
        if (event.isComposing || composing) return;
        if (syntax !== "source" && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a") {
          event.preventDefault();
          restore({ anchor: 0, focus: source.length });
          return;
        }
        if (options.shortcuts && (event.ctrlKey || event.metaKey) && !event.altKey) {
          const key = event.key.toLowerCase();
          const name = key === "b" ? "bold" : key === "i" ? "italic" : key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
          if (name) {
            event.preventDefault();
            command(name);
            return;
          }
        }
        if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          position = selection();
          if (syntax !== "source") {
            const cell = document.getSelection()?.focusNode?.parentElement?.closest("td,th");
            if (cell) {
              const cells = [...cell.closest("table").querySelectorAll("tr:not([data-type=tableDelimiter]) > :is(td,th)")],
                index = cells.indexOf(cell) + (event.shiftKey ? -1 : 1);
              if (cells[index]) {
                event.preventDefault();
                const offset = firstPoint(cells[index].querySelector(".byEDcell"), false);
                restore({ anchor: offset, focus: offset });
              }
              return;
            }
          }
          // Tab leaves prose normally. Code and Source use a literal tab only with Alt+Tab avoided.
        }
      });
    }
    /* --- SELECTION AND TOOLBAR EVENTS --- */
    listen(document, "selectionchange", () => {
      if (!alive || previewing || composing || !element.contains(document.activeElement)) return;
      const started = metrics ? performance.now() : 0;
      position = selection();
      if (syntax !== "source" && surface.contains(document.getSelection()?.focusNode)) activate(lines[lineAt(position.focus)]);
      scheduleToolbar();
      measure("selection", started);
    });
    listen(surface, "focus", () => {
      if (!dirty) activate(lines[lineAt(selection().focus)]);
    });
    listen(element, "focusout", (event) => {
      if (!element.contains(event.relatedTarget)) activate(null);
    });
    listen(toolbar, "pointerdown", (event) => {
      if (event.target.closest("button")) {
        position = selection();
        event.preventDefault();
      }
    });
    listen(toolbar, "focusin", (event) => {
      if (!event.target.matches("button, select")) return;
      for (const control of toolbar.querySelectorAll("button, select")) control.tabIndex = control === event.target ? 0 : -1;
    });
    listen(toolbar, "keydown", (event) => {
      if (!event.target.matches("button, select") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...toolbar.querySelectorAll("button:not(:disabled), select")],
        current = buttons.indexOf(event.target);
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[index]?.focus();
    });

    /* --- MODES AND LIFECYCLE --- */
    const api = {
      /** Return the last committed Markdown; active IME text commits on compositionend. */
      getMarkdown() {
        return source;
      },
      /** Replace source, reset history, and notify onChange even while Preview is visible. */
      setMarkdown(value) {
        if (!alive) return;
        if (typeof value !== "string") throw new TypeError("byMDeditor.setMarkdown: value must be a string.");
        if (value.length > 2000000) throw new RangeError("Document exceeds 2,000,000 characters.");
        finishComposition();
        source = value;
        eol = source.match(/\r\n|\r|\n/)?.[0] || "\n";
        syncRawBreaks();
        history = [];
        historyIndex = 0;
        historyBytes = 0;
        position = { anchor: 0, focus: 0 };
        savedPosition = position;
        raw.value = source;
        dirty = true;
        if (syntax !== "source" && !previewing) build();
        if (previewing) api.setPreview(true);
        scheduleToolbar();
        options.onChange?.(source);
      },
      /** Change presentation while retaining source and the directed selection. */
      setSyntaxMode(mode) {
        if (!alive) return;
        if (!modes.includes(mode)) throw new RangeError("Syntax mode must be no-code, clean, assisted, or source.");
        if (mode !== "source" && !rich) {
          announce("Visual editing requires the updated easy-md-viewer parser. Source editing remains available.");
          return;
        }
        finishComposition();
        if (!previewing) position = selection();
        // Source mode can retain a hidden visual document built in a different mode.
        const rebuild = renderedNoCode !== (mode === "no-code");
        syntax = mode;
        picker.value = mode;
        element.dataset.syntax = mode;
        picker.title = modeDescriptions[mode];
        raw.value = source;
        raw.classList.add("byVIEWreveal");
        surface.classList.add("byVIEWreveal");
        raw.hidden = mode !== "source" || previewing;
        surface.hidden = mode === "source" || previewing;
        if (mode !== "source" && (dirty || rebuild)) build();
        queueCode();
        if (!previewing) restore(position, false);
        scheduleToolbar();
        announce(modeDescriptions[mode]);
      },
      setToolbar(visible) {
        if (!alive) return;
        toolbar.classList.add("byVIEWreveal");
        toolbar.hidden = !visible || previewing;
        toggle.setAttribute("aria-expanded", String(!toolbar.hidden));
        options.toolbar = Boolean(visible);
      },
      /** Change control visibility without replacing the document, selection, or history. */
      setControls(visibility = {}) {
        if (!alive) return;
        for (const [name, control] of Object.entries(controlVisibility)) {
          if (Object.hasOwn(visibility, name)) options[name] = visibility[name] !== false;
          control.hidden = options[name] === false;
        }
        if (palettePicker.hidden) palettePicker.remove();
        else if (palettePicker.parentNode !== controls) controls.prepend(palettePicker);
        controls.hidden = palettePicker.hidden && previewButton.hidden && themeButton.hidden;
        bar.hidden = toggle.hidden && picker.hidden && controls.hidden;
      },
      /** Render the actual MD viewer on demand; returning to editing restores its saved selection. */
      setPreview(visible) {
        if (!alive) return;
        finishComposition();
        if (!previewing) savedPosition = selection();
        if (visible && typeof global.byMDviewer !== "function") {
          announce("Load easy-md-viewer to enable Preview.");
          return;
        }
        previewing = Boolean(visible);
        preview.classList.add("byVIEWreveal");
        surface.classList.add("byVIEWreveal");
        raw.classList.add("byVIEWreveal");
        preview.hidden = !previewing;
        previewButton.setAttribute("aria-pressed", String(previewing));
        toggle.disabled = previewing;
        raw.hidden = previewing || syntax !== "source";
        surface.hidden = previewing || syntax === "source";
        toolbar.hidden = previewing || !options.toolbar;
        toggle.setAttribute("aria-expanded", String(!toolbar.hidden));
        if (previewing) {
          const started = metrics ? performance.now() : 0;
          preview.dataset.theme = element.dataset.theme || "monokai";
          preview.classList.toggle("dark", isDark());
          global.byMDviewer(preview, source, { toolbar: false, animations: options.animations, codeHighlighting: options.codeHighlighting !== false && typeof global.byCODEviewer?.highlight === "function" });
          measure("preview", started);
          announce("Read-only preview.");
        } else {
          if (dirty && syntax !== "source") build();
          restore(savedPosition);
          queueCode();
          announce("Editing document.");
        }
      },
      /** Change motion without rebuilding the document or disturbing its selection/history. */
      setAnimations(enabled) {
        if (!alive) return;
        options.animations = Boolean(enabled);
        element.classList.toggle("byVIEWmotion", options.animations);
        preview.classList.toggle("byVIEWmotion", options.animations);
      },
      setTheme(mode) {
        if (!alive) return;
        if (!["light", "dark"].includes(mode)) throw new RangeError("Theme must be light or dark.");
        if (["light", "dark"].includes(element.dataset.theme || "")) element.dataset.theme = mode;
        element.classList.toggle("dark", mode === "dark");
        element.classList.toggle("light", mode === "light");
        themeButton.title = `Switch to ${mode === "dark" ? "light" : "dark"} theme`;
        themeButton.setAttribute("aria-label", themeButton.title);
        if (previewing) api.setPreview(true);
      },
      setPalette(palette) {
        if (!alive) return;
        if (typeof palette !== "string" || !/^[a-z][\w-]*$/i.test(palette) || ["light", "dark"].includes(palette)) throw new RangeError("Palette must be a CSS theme name; use setTheme() for light or dark.");
        const mode = isDark() ? "dark" : "light";
        element.dataset.theme = palette;
        selectPalette(palette);
        api.setTheme(mode);
      },
      command,
      focus() {
        if (alive && !previewing) restore(position);
      },
      getSelection() {
        return { ...selection() };
      },
      setSelection(anchor, focus = anchor) {
        if (alive) restore({ anchor, focus });
      },
      /** Commit composition, cancel owned work, and clear the host only while this instance owns it. */
      destroy() {
        if (!alive) return;
        // Commit browser-owned IME text before releasing listeners; this may call onChange during teardown.
        finishComposition();
        alive = false;
        abort.abort();
        dialogAbort?.abort();
        cancelAnimationFrame(toolbarFrame);
        dialog?.close();
        cancelCode();
        history = [];
        lines = [];
        groups = [];
        active = null;
        composing = null;
        fullSelection = null;
        dialog = null;
        textMap = new WeakMap();
        lineMap = new WeakMap();
        source = "";
        rawBreaks = [];
        raw.value = "";
        surface.replaceChildren();
        preview.replaceChildren();
        if (instances.get(element) === api) {
          instances.delete(element);
          element.replaceChildren();
          element.classList.remove("byMDeditor", "byMDdocument", "byVIEWmotion");
          element.removeAttribute("data-syntax");
        }
      }
    };
    /* --- MOUNT --- */
    instances.set(element, api);
    syncRawBreaks();
    if (rich && syntax !== "source") build();
    else {
      dirty = true;
      if (!rich) announce("Visual editing needs easy-md-viewer with parseInline() and scanLine(). You can edit Markdown in Source mode.");
    }
    raw.value = source;
    picker.value = syntax;
    picker.title = modeDescriptions[syntax];
    element.dataset.syntax = syntax;
    raw.hidden = syntax !== "source";
    surface.hidden = syntax === "source";
    preview.hidden = true;
    api.setToolbar(options.toolbar);
    api.setControls(options);
    toolbar.classList.remove("byVIEWreveal");
    if (options.palette) api.setPalette(options.palette);
    else {
      selectPalette(["light", "dark"].includes(element.dataset.theme) ? "monokai" : element.dataset.theme || "monokai");
      api.setTheme(isDark() ? "dark" : "light");
    }
    updateToolbar();
    return api;
  }
  /* --- EXPORT --- */
  global.byMDeditor = byMDeditor;
  byMDeditor.initialized = true;
})(typeof window !== "undefined" ? window : this);
