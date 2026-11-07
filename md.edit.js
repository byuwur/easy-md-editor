"use strict";
/*
 * File: md.edit.js
 * Desc: Source-driven Markdown editing with easy-md-viewer parsing and easy-code-viewer colors.
 * Copyright (c) 2026 Andres Trujillo [Mateus] byUwUr
 * MIT License (see LICENSE).
 */
(function (global) {
  // --- INITIALIZATION ---
  if (global.byMDeditor?.initialized) return;

  // --- METADATA ---
  byMDeditor.VERSION = "1.6"; // 2026-11-05

  // --- CONSTANTS ---
  const tools = [
    ["undo", "rotate-left"],
    ["redo", "rotate-right"],
    ["bold", "bold"],
    ["italic", "italic"],
    ["strikethrough", "strikethrough"],
    ["inlineCode", "code"],
    ["bulletList", "list-ul"],
    ["orderedList", "list-ol"],
    ["checklist", "list-check"],
    ["link", "link"],
    ["image", "image"],
    ["table", "table"],
    ["codeBlock", "file-code"],
    ["blockquote", "quote-left"],
    ["horizontalRule", "minus"]
  ];
  const shortcutKeys = { bold: "B", italic: "I", undo: "Z", redo: "Shift + Z" };
  const wraps = { bold: "**", italic: "*", strikethrough: "~~", inlineCode: "`" };
  const modes = ["no-code", "clean", "assisted", "source"];
  const modeDescriptions = {
    "no-code": "descriptionNoCode",
    clean: "descriptionClean",
    assisted: "descriptionAssisted",
    source: "descriptionSource"
  };
  const palettes = {
    paletteEssentials: {
      monokai: "Monokai",
      github: "GitHub",
      solarized: "Solarized",
      "high-contrast": "High Contrast"
    },
    paletteEditorClassics: {
      dracula: "Dracula",
      darcula: "Darcula",
      nord: "Nord",
      catppuccin: "Catppuccin",
      "catppuccin-frappe": "Catppuccin Frappé",
      "catppuccin-macchiato": "Catppuccin Macchiato",
      "rose-pine": "Rosé Pine",
      "rose-pine-moon": "Rosé Pine Moon",
      gruvbox: "Gruvbox",
      "gruvbox-material": "Gruvbox Material",
      "tokyo-night": "Tokyo Night",
      "tokyo-storm": "Tokyo Storm",
      "tokyo-moon": "Tokyo Moon",
      one: "One",
      material: "Material",
      "material-ocean": "Material Ocean",
      "night-owl": "Night Owl",
      synthwave: "Synthwave",
      ayu: "Ayu",
      everforest: "Everforest",
      kanagawa: "Kanagawa",
      selenized: "Selenized",
      vscode: "VS Code",
      "monokai-dimmed": "Monokai Dimmed"
    },
    paletteAppInspired: {
      discord: "Discord",
      slack: "Slack"
    },
    paletteColorful: {
      bonyur: "BONYUR",
      sakura: "Sakura",
      bubblegum: "Bubblegum",
      candy: "Candy",
      "rose-gold": "Rose Gold",
      lavender: "Lavender",
      cyberpunk: "Cyberpunk",
      sunset: "Sunset",
      volcano: "Volcano",
      amber: "Amber",
      terminal: "Terminal"
    },
    paletteReadingNature: {
      paper: "Paper",
      ink: "Ink",
      ocean: "Ocean",
      forest: "Forest",
      mint: "Mint",
      ice: "Ice",
      sepia: "Sepia"
    }
  };

  // --- STATE ---
  const instances = new WeakMap();
  const warnedLanguages = new Set();
  const warnedPalettes = new Set();
  let segmenter;

  // --- HELPERS ---
  const node = (tag, className = "", text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
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

  // --- APPEARANCE ---
  const warnMissingThemes = (element, palette = element.dataset.theme) => {
    if (!Object.values(palettes).some((choices) => Object.hasOwn(choices, palette)) || ["monokai", "github", "solarized", "high-contrast"].includes(palette) || warnedPalettes.has(palette)) return;
    const document = element.ownerDocument;
    if (document.defaultView.getComputedStyle(document.documentElement).getPropertyValue("--by-md-themes-loaded").trim() === "1") return;
    warnedPalettes.add(palette);
    console.warn(`easy-md-editor: Palette "${palette}" requires md.themes.css. Import it after md.css. https://byuwur.github.io/easy-md-viewer/`);
  };

  // Explicit appearance options override markup; omitted values preserve the container's state.
  const applyAppearance = (element, options) => {
    const { theme, palette, fontSize } = options;
    if (theme != null && !["light", "dark"].includes(theme)) throw new RangeError("Theme must be light or dark.");
    if (palette != null && (typeof palette !== "string" || !/^[a-z][\w-]*$/i.test(palette) || ["light", "dark"].includes(palette))) throw new RangeError("Palette must be a CSS theme name; use theme for light or dark.");
    warnMissingThemes(element, palette ?? element.dataset.theme);
    const size = typeof fontSize === "number" ? `${Math.max(0.5, Math.min(3, fontSize))}rem` : typeof fontSize === "string" ? `clamp(0.5rem, ${fontSize}, 3rem)` : "";
    if (fontSize != null && (typeof fontSize === "number" ? !Number.isFinite(fontSize) : typeof fontSize !== "string" || !CSS.supports("font-size", size))) throw new RangeError("Font size must be a finite multiplier or a CSS size.");
    if (theme != null || palette != null) {
      const mode = theme ?? (["light", "dark"].includes(element.dataset.theme) ? element.dataset.theme : element.classList.contains("dark") ? "dark" : "light");
      element.classList.toggle("light", mode === "light");
      element.classList.toggle("dark", mode === "dark");
      if (palette != null) element.dataset.theme = palette;
      else if (["light", "dark"].includes(element.dataset.theme)) element.dataset.theme = mode;
    }
    if (fontSize != null) {
      element.style.fontSize = size;
      element.dataset.byViewDefaultFontSize = element.style.fontSize;
    }
  };

  // --- LOCALIZATION ---
  byMDeditor.locales = {
    en: {
      document: "Document",
      placeholder: "Start writing…",
      sourceLabel: "{document} — Markdown source",
      documentFormatting: "Document formatting",
      formatting: "Formatting",
      syntaxVisibility: "Syntax visibility",
      modeNoCode: "No-code",
      modeClean: "Clean",
      modeAssisted: "Assisted",
      modeSource: "Source",
      descriptionNoCode: "Keep Markdown syntax hidden while editing. Use the toolbar to format text.",
      descriptionClean: "Hide Markdown syntax outside the active line or code block.",
      descriptionAssisted: "Keep Markdown syntax visible beside formatted text.",
      descriptionSource: "Edit the complete Markdown source as plain text.",
      colorPalette: "Color palette",
      paletteEssentials: "Essentials",
      paletteEditorClassics: "Editor classics",
      paletteAppInspired: "App inspired",
      paletteColorful: "Colorful",
      paletteReadingNature: "Reading & nature",
      customPalette: "Custom ({palette})",
      preview: "Preview",
      paragraphStyle: "Paragraph style",
      paragraph: "Paragraph",
      heading: "Heading {level}",
      lightTheme: "Switch to light theme",
      darkTheme: "Switch to dark theme",
      undo: "Undo",
      redo: "Redo",
      bold: "Bold",
      italic: "Italic",
      strikethrough: "Strike",
      inlineCode: "Code",
      bulletList: "Bullets",
      orderedList: "Numbered",
      checklist: "Checklist",
      link: "Link",
      image: "Image",
      table: "Table",
      codeBlock: "Code block",
      blockquote: "Quote",
      horizontalRule: "Divider",
      readOnlyBlock: "Edit this block in Source mode.",
      completeTask: "Complete {task}",
      task: "task",
      oneTableCell: "Edit one table cell at a time. Use Tab to move between cells.",
      hiddenFences: "Code fences stay hidden. Use Source mode to change the block structure.",
      documentLimit: "This document has reached the two-million-character limit.",
      inlineSelection: "Select text within one paragraph or table cell to apply inline formatting.",
      paragraphOutsideTable: "Paragraph styles apply outside tables. Edit cell text directly.",
      validUrl: "Use a web, email, or relative URL.",
      text: "Text",
      imageDescription: "Image description",
      linkText: "Link text",
      column: "Column {number}",
      insertTable: "Insert table",
      insertLink: "Insert link",
      insertImage: "Insert image",
      insertCodeBlock: "Insert code block",
      dataRows: "Data rows",
      columns: "Columns",
      codeLanguage: "Language (optional)",
      imageUrl: "Image URL",
      url: "URL",
      cancel: "Cancel",
      insert: "Insert",
      oneTableLine: "Markdown table cells use one line. Press Enter for the next row, or Tab for the next cell.",
      pasteTableLine: "Paste one line into a table cell, or use Source for multiple rows.",
      pasteText: "Paste text here, or use Image to insert an image URL.",
      visualNeedsParser: "Visual editing requires the updated easy-md-viewer parser. Source editing remains available.",
      previewNeedsViewer: "Load easy-md-viewer to enable Preview.",
      readOnlyPreview: "Read-only preview.",
      editingDocument: "Editing document.",
      sourceOnlyWarning: "Visual editing needs easy-md-viewer with parseInline() and scanLine(). You can edit Markdown in Source mode."
    },
    es: {
      document: "Documento",
      placeholder: "Empieza a escribir…",
      sourceLabel: "{document} — Fuente Markdown",
      documentFormatting: "Formato del documento",
      formatting: "Formato",
      syntaxVisibility: "Visibilidad de la sintaxis",
      modeNoCode: "Sin código",
      modeClean: "Limpio",
      modeAssisted: "Asistido",
      modeSource: "Fuente",
      descriptionNoCode: "Oculta la sintaxis Markdown al editar. Usa la barra de herramientas para dar formato al texto.",
      descriptionClean: "Oculta la sintaxis Markdown fuera de la línea o el bloque de código activos.",
      descriptionAssisted: "Muestra la sintaxis Markdown junto al texto con formato.",
      descriptionSource: "Edita todo el código fuente Markdown como texto sin formato.",
      colorPalette: "Paleta de colores",
      paletteEssentials: "Esenciales",
      paletteEditorClassics: "Clásicos de editores",
      paletteAppInspired: "Inspirados en aplicaciones",
      paletteColorful: "Coloridos",
      paletteReadingNature: "Lectura y naturaleza",
      customPalette: "Personalizado ({palette})",
      preview: "Vista previa",
      paragraphStyle: "Estilo de párrafo",
      paragraph: "Párrafo",
      heading: "Título {level}",
      lightTheme: "Cambiar al tema claro",
      darkTheme: "Cambiar al tema oscuro",
      undo: "Deshacer",
      redo: "Rehacer",
      bold: "Negrita",
      italic: "Cursiva",
      strikethrough: "Tachado",
      inlineCode: "Código",
      bulletList: "Viñetas",
      orderedList: "Numerada",
      checklist: "Lista de tareas",
      link: "Enlace",
      image: "Imagen",
      table: "Tabla",
      codeBlock: "Bloque de código",
      blockquote: "Cita",
      horizontalRule: "Separador",
      readOnlyBlock: "Edita este bloque en el modo Fuente.",
      completeTask: "Completar {task}",
      task: "tarea",
      oneTableCell: "Edita una celda a la vez. Usa Tab para moverte entre celdas.",
      hiddenFences: "Los delimitadores de código permanecen ocultos. Usa el modo Fuente para cambiar la estructura del bloque.",
      documentLimit: "Este documento ha alcanzado el límite de dos millones de caracteres.",
      inlineSelection: "Selecciona texto dentro de un mismo párrafo o celda para aplicar formato en línea.",
      paragraphOutsideTable: "Los estilos de párrafo se aplican fuera de las tablas. Edita el texto de las celdas directamente.",
      validUrl: "Usa una URL web, de correo electrónico o relativa.",
      text: "Texto",
      imageDescription: "Descripción de la imagen",
      linkText: "Texto del enlace",
      column: "Columna {number}",
      insertTable: "Insertar tabla",
      insertLink: "Insertar enlace",
      insertImage: "Insertar imagen",
      insertCodeBlock: "Insertar bloque de código",
      dataRows: "Filas de datos",
      columns: "Columnas",
      codeLanguage: "Lenguaje (opcional)",
      imageUrl: "URL de la imagen",
      url: "URL",
      cancel: "Cancelar",
      insert: "Insertar",
      oneTableLine: "Las celdas Markdown usan una sola línea. Pulsa Enter para pasar a la siguiente fila o Tab para la siguiente celda.",
      pasteTableLine: "Pega una sola línea en una celda o usa Fuente para varias filas.",
      pasteText: "Pega texto aquí o usa Imagen para insertar la URL de una imagen.",
      visualNeedsParser: "La edición visual requiere el analizador actualizado de easy-md-viewer. Puedes seguir editando en Fuente.",
      previewNeedsViewer: "Carga easy-md-viewer para habilitar la vista previa.",
      readOnlyPreview: "Vista previa de solo lectura.",
      editingDocument: "Editando el documento.",
      sourceOnlyWarning: "La edición visual necesita easy-md-viewer con parseInline() y scanLine(). Puedes editar Markdown en el modo Fuente."
    },
    pt: {
      document: "Documento",
      placeholder: "Comece a escrever…",
      sourceLabel: "{document} — Código-fonte Markdown",
      documentFormatting: "Formatação do documento",
      formatting: "Formatação",
      syntaxVisibility: "Visibilidade da sintaxe",
      modeNoCode: "Sem código",
      modeClean: "Limpo",
      modeAssisted: "Assistido",
      modeSource: "Fonte",
      descriptionNoCode: "Oculta a sintaxe Markdown durante a edição. Use a barra de ferramentas para formatar o texto.",
      descriptionClean: "Oculta a sintaxe Markdown fora da linha ou do bloco de código ativo.",
      descriptionAssisted: "Mostra a sintaxe Markdown ao lado do texto formatado.",
      descriptionSource: "Edita todo o código-fonte Markdown como texto simples.",
      colorPalette: "Paleta de cores",
      paletteEssentials: "Essenciais",
      paletteEditorClassics: "Clássicos de editores",
      paletteAppInspired: "Inspirados em aplicativos",
      paletteColorful: "Coloridos",
      paletteReadingNature: "Leitura e natureza",
      customPalette: "Personalizado ({palette})",
      preview: "Prévia",
      paragraphStyle: "Estilo do parágrafo",
      paragraph: "Parágrafo",
      heading: "Título {level}",
      lightTheme: "Mudar para o tema claro",
      darkTheme: "Mudar para o tema escuro",
      undo: "Desfazer",
      redo: "Refazer",
      bold: "Negrito",
      italic: "Itálico",
      strikethrough: "Tachado",
      inlineCode: "Código",
      bulletList: "Marcadores",
      orderedList: "Numerada",
      checklist: "Lista de tarefas",
      link: "Link",
      image: "Imagem",
      table: "Tabela",
      codeBlock: "Bloco de código",
      blockquote: "Citação",
      horizontalRule: "Divisor",
      readOnlyBlock: "Edite este bloco no modo Fonte.",
      completeTask: "Concluir {task}",
      task: "tarefa",
      oneTableCell: "Edite uma célula por vez. Use Tab para navegar entre as células.",
      hiddenFences: "Os delimitadores de código ficam ocultos. Use o modo Fonte para alterar a estrutura do bloco.",
      documentLimit: "Este documento atingiu o limite de dois milhões de caracteres.",
      inlineSelection: "Selecione texto dentro de um único parágrafo ou célula para aplicar formatação em linha.",
      paragraphOutsideTable: "Os estilos de parágrafo se aplicam fora das tabelas. Edite o texto das células diretamente.",
      validUrl: "Use uma URL da web, de e-mail ou relativa.",
      text: "Texto",
      imageDescription: "Descrição da imagem",
      linkText: "Texto do link",
      column: "Coluna {number}",
      insertTable: "Inserir tabela",
      insertLink: "Inserir link",
      insertImage: "Inserir imagem",
      insertCodeBlock: "Inserir bloco de código",
      dataRows: "Linhas de dados",
      columns: "Colunas",
      codeLanguage: "Linguagem (opcional)",
      imageUrl: "URL da imagem",
      url: "URL",
      cancel: "Cancelar",
      insert: "Inserir",
      oneTableLine: "As células Markdown usam uma só linha. Pressione Enter para ir à próxima linha ou Tab para a próxima célula.",
      pasteTableLine: "Cole uma só linha em uma célula ou use Fonte para várias linhas da tabela.",
      pasteText: "Cole texto aqui ou use Imagem para inserir a URL de uma imagem.",
      visualNeedsParser: "A edição visual requer o analisador atualizado do easy-md-viewer. A edição em Fonte continua disponível.",
      previewNeedsViewer: "Carregue easy-md-viewer para habilitar a prévia.",
      readOnlyPreview: "Prévia somente para leitura.",
      editingDocument: "Editando o documento.",
      sourceOnlyWarning: "A edição visual precisa do easy-md-viewer com parseInline() e scanLine(). Você pode editar Markdown no modo Fonte."
    },
    fr: {
      document: "Document",
      placeholder: "Commencez à écrire…",
      sourceLabel: "{document} — Source Markdown",
      documentFormatting: "Mise en forme du document",
      formatting: "Mise en forme",
      syntaxVisibility: "Visibilité de la syntaxe",
      modeNoCode: "Sans code",
      modeClean: "Épuré",
      modeAssisted: "Assisté",
      modeSource: "Source",
      descriptionNoCode: "Masque la syntaxe Markdown pendant la rédaction. Utilisez la barre d’outils pour mettre le texte en forme.",
      descriptionClean: "Masque la syntaxe Markdown hors de la ligne ou du bloc de code actif.",
      descriptionAssisted: "Affiche la syntaxe Markdown à côté du texte mis en forme.",
      descriptionSource: "Modifie toute la source Markdown en texte brut.",
      colorPalette: "Palette de couleurs",
      paletteEssentials: "Essentielles",
      paletteEditorClassics: "Classiques des éditeurs",
      paletteAppInspired: "Inspirées des applications",
      paletteColorful: "Colorées",
      paletteReadingNature: "Lecture et nature",
      customPalette: "Personnalisée ({palette})",
      preview: "Aperçu",
      paragraphStyle: "Style de paragraphe",
      paragraph: "Paragraphe",
      heading: "Titre {level}",
      lightTheme: "Passer au thème clair",
      darkTheme: "Passer au thème sombre",
      undo: "Annuler",
      redo: "Rétablir",
      bold: "Gras",
      italic: "Italique",
      strikethrough: "Barré",
      inlineCode: "Code",
      bulletList: "Puces",
      orderedList: "Numérotation",
      checklist: "Liste de tâches",
      link: "Lien",
      image: "Image",
      table: "Tableau",
      codeBlock: "Bloc de code",
      blockquote: "Citation",
      horizontalRule: "Séparateur",
      readOnlyBlock: "Modifiez ce bloc en mode Source.",
      completeTask: "Terminer {task}",
      task: "la tâche",
      oneTableCell: "Modifiez une cellule à la fois. Utilisez Tab pour passer d’une cellule à l’autre.",
      hiddenFences: "Les délimiteurs de code restent masqués. Utilisez le mode Source pour modifier la structure du bloc.",
      documentLimit: "Ce document a atteint la limite de deux millions de caractères.",
      inlineSelection: "Sélectionnez du texte dans un même paragraphe ou une même cellule pour appliquer une mise en forme en ligne.",
      paragraphOutsideTable: "Les styles de paragraphe s’appliquent hors des tableaux. Modifiez directement le texte des cellules.",
      validUrl: "Utilisez une URL web, de courriel ou relative.",
      text: "Texte",
      imageDescription: "Description de l’image",
      linkText: "Texte du lien",
      column: "Colonne {number}",
      insertTable: "Insérer un tableau",
      insertLink: "Insérer un lien",
      insertImage: "Insérer une image",
      insertCodeBlock: "Insérer un bloc de code",
      dataRows: "Lignes de données",
      columns: "Colonnes",
      codeLanguage: "Langage (facultatif)",
      imageUrl: "URL de l’image",
      url: "URL",
      cancel: "Annuler",
      insert: "Insérer",
      oneTableLine: "Une cellule Markdown tient sur une ligne. Appuyez sur Entrée pour passer à la ligne suivante ou sur Tab pour la cellule suivante.",
      pasteTableLine: "Collez une seule ligne dans une cellule ou utilisez Source pour plusieurs lignes du tableau.",
      pasteText: "Collez du texte ici ou utilisez Image pour insérer l’URL d’une image.",
      visualNeedsParser: "L’édition visuelle nécessite l’analyseur à jour d’easy-md-viewer. L’édition en mode Source reste disponible.",
      previewNeedsViewer: "Chargez easy-md-viewer pour activer l’aperçu.",
      readOnlyPreview: "Aperçu en lecture seule.",
      editingDocument: "Modification du document.",
      sourceOnlyWarning: "L’édition visuelle nécessite easy-md-viewer avec parseInline() et scanLine(). Vous pouvez modifier le Markdown en mode Source."
    },
    de: {
      document: "Dokument",
      placeholder: "Beginne zu schreiben…",
      sourceLabel: "{document} — Markdown-Quelltext",
      documentFormatting: "Dokumentformatierung",
      formatting: "Formatierung",
      syntaxVisibility: "Sichtbarkeit der Syntax",
      modeNoCode: "Ohne Code",
      modeClean: "Bereinigt",
      modeAssisted: "Unterstützt",
      modeSource: "Quelltext",
      descriptionNoCode: "Blendet die Markdown-Syntax beim Bearbeiten aus. Formatiere den Text mit der Werkzeugleiste.",
      descriptionClean: "Blendet Markdown-Syntax außerhalb der aktiven Zeile oder des aktiven Codeblocks aus.",
      descriptionAssisted: "Zeigt die Markdown-Syntax neben dem formatierten Text an.",
      descriptionSource: "Bearbeitet den gesamten Markdown-Quelltext als reinen Text.",
      colorPalette: "Farbpalette",
      paletteEssentials: "Grundauswahl",
      paletteEditorClassics: "Editor-Klassiker",
      paletteAppInspired: "Von Apps inspiriert",
      paletteColorful: "Farbenfroh",
      paletteReadingNature: "Lesen und Natur",
      customPalette: "Benutzerdefiniert ({palette})",
      preview: "Vorschau",
      paragraphStyle: "Absatzstil",
      paragraph: "Absatz",
      heading: "Überschrift {level}",
      lightTheme: "Zum hellen Design wechseln",
      darkTheme: "Zum dunklen Design wechseln",
      undo: "Rückgängig",
      redo: "Wiederholen",
      bold: "Fett",
      italic: "Kursiv",
      strikethrough: "Durchgestrichen",
      inlineCode: "Code",
      bulletList: "Aufzählung",
      orderedList: "Nummerierung",
      checklist: "Checkliste",
      link: "Link",
      image: "Bild",
      table: "Tabelle",
      codeBlock: "Codeblock",
      blockquote: "Zitat",
      horizontalRule: "Trennlinie",
      readOnlyBlock: "Bearbeite diesen Block im Quelltextmodus.",
      completeTask: "{task} abschließen",
      task: "Aufgabe",
      oneTableCell: "Bearbeite eine Zelle nach der anderen. Mit Tab wechselst du zwischen den Zellen.",
      hiddenFences: "Codebegrenzungen bleiben ausgeblendet. Ändere die Blockstruktur im Quelltextmodus.",
      documentLimit: "Dieses Dokument hat die Grenze von zwei Millionen Zeichen erreicht.",
      inlineSelection: "Wähle Text innerhalb eines Absatzes oder einer Tabellenzelle für die Inline-Formatierung aus.",
      paragraphOutsideTable: "Absatzstile gelten außerhalb von Tabellen. Bearbeite den Zellentext direkt.",
      validUrl: "Verwende eine Web-, E-Mail- oder relative URL.",
      text: "Text",
      imageDescription: "Bildbeschreibung",
      linkText: "Linktext",
      column: "Spalte {number}",
      insertTable: "Tabelle einfügen",
      insertLink: "Link einfügen",
      insertImage: "Bild einfügen",
      insertCodeBlock: "Codeblock einfügen",
      dataRows: "Datenzeilen",
      columns: "Spalten",
      codeLanguage: "Programmiersprache (optional)",
      imageUrl: "Bild-URL",
      url: "URL",
      cancel: "Abbrechen",
      insert: "Einfügen",
      oneTableLine: "Markdown-Tabellenzellen bestehen aus einer Zeile. Mit Eingabe wechselst du zur nächsten Zeile, mit Tab zur nächsten Zelle.",
      pasteTableLine: "Füge eine Zeile in eine Tabellenzelle ein oder verwende den Quelltextmodus für mehrere Tabellenzeilen.",
      pasteText: "Füge hier Text ein oder verwende Bild, um eine Bild-URL einzufügen.",
      visualNeedsParser: "Die visuelle Bearbeitung benötigt den aktuellen Parser von easy-md-viewer. Die Quelltextbearbeitung bleibt verfügbar.",
      previewNeedsViewer: "Lade easy-md-viewer, um die Vorschau zu aktivieren.",
      readOnlyPreview: "Schreibgeschützte Vorschau.",
      editingDocument: "Dokument wird bearbeitet.",
      sourceOnlyWarning: "Die visuelle Bearbeitung benötigt easy-md-viewer mit parseInline() und scanLine(). Du kannst Markdown im Quelltextmodus bearbeiten."
    },
    it: {
      document: "Documento",
      placeholder: "Inizia a scrivere…",
      sourceLabel: "{document} — Sorgente Markdown",
      documentFormatting: "Formattazione del documento",
      formatting: "Formattazione",
      syntaxVisibility: "Visibilità della sintassi",
      modeNoCode: "Senza codice",
      modeClean: "Pulito",
      modeAssisted: "Assistito",
      modeSource: "Sorgente",
      descriptionNoCode: "Nascondi la sintassi Markdown durante la scrittura. Usa la barra degli strumenti per formattare il testo.",
      descriptionClean: "Nascondi la sintassi Markdown fuori dalla riga o dal blocco di codice attivo.",
      descriptionAssisted: "Mostra la sintassi Markdown accanto al testo formattato.",
      descriptionSource: "Modifica l’intero sorgente Markdown come testo semplice.",
      colorPalette: "Palette di colori",
      paletteEssentials: "Essenziali",
      paletteEditorClassics: "Classici degli editor",
      paletteAppInspired: "Ispirate alle app",
      paletteColorful: "Colorate",
      paletteReadingNature: "Lettura e natura",
      customPalette: "Personalizzata ({palette})",
      preview: "Anteprima",
      paragraphStyle: "Stile del paragrafo",
      paragraph: "Paragrafo",
      heading: "Titolo {level}",
      lightTheme: "Passa al tema chiaro",
      darkTheme: "Passa al tema scuro",
      undo: "Annulla",
      redo: "Ripeti",
      bold: "Grassetto",
      italic: "Corsivo",
      strikethrough: "Barrato",
      inlineCode: "Codice",
      bulletList: "Elenco puntato",
      orderedList: "Elenco numerato",
      checklist: "Elenco di attività",
      link: "Collegamento",
      image: "Immagine",
      table: "Tabella",
      codeBlock: "Blocco di codice",
      blockquote: "Citazione",
      horizontalRule: "Separatore",
      readOnlyBlock: "Modifica questo blocco in modalità Sorgente.",
      completeTask: "Completa {task}",
      task: "attività",
      oneTableCell: "Modifica una cella alla volta. Usa Tab per passare da una cella all’altra.",
      hiddenFences: "I delimitatori del codice restano nascosti. Usa la modalità Sorgente per cambiare la struttura del blocco.",
      documentLimit: "Questo documento ha raggiunto il limite di due milioni di caratteri.",
      inlineSelection: "Seleziona il testo all’interno di un paragrafo o di una cella per applicare la formattazione in linea.",
      paragraphOutsideTable: "Gli stili di paragrafo si applicano fuori dalle tabelle. Modifica direttamente il testo delle celle.",
      validUrl: "Usa un URL web, email o relativo.",
      text: "Testo",
      imageDescription: "Descrizione dell’immagine",
      linkText: "Testo del collegamento",
      column: "Colonna {number}",
      insertTable: "Inserisci tabella",
      insertLink: "Inserisci collegamento",
      insertImage: "Inserisci immagine",
      insertCodeBlock: "Inserisci blocco di codice",
      dataRows: "Righe di dati",
      columns: "Colonne",
      codeLanguage: "Linguaggio (facoltativo)",
      imageUrl: "URL dell’immagine",
      url: "URL",
      cancel: "Annulla",
      insert: "Inserisci",
      oneTableLine: "Le celle Markdown occupano una sola riga. Premi Invio per la riga successiva o Tab per la cella successiva.",
      pasteTableLine: "Incolla una sola riga in una cella o usa Sorgente per più righe della tabella.",
      pasteText: "Incolla il testo qui o usa Immagine per inserire l’URL di un’immagine.",
      visualNeedsParser: "La modifica visuale richiede il parser aggiornato di easy-md-viewer. La modifica in Sorgente resta disponibile.",
      previewNeedsViewer: "Carica easy-md-viewer per abilitare l’anteprima.",
      readOnlyPreview: "Anteprima di sola lettura.",
      editingDocument: "Modifica del documento.",
      sourceOnlyWarning: "La modifica visuale richiede easy-md-viewer con parseInline() e scanLine(). Puoi modificare Markdown in modalità Sorgente."
    },
    ja: {
      document: "ドキュメント",
      placeholder: "書き始めましょう…",
      sourceLabel: "{document} — Markdownソース",
      documentFormatting: "ドキュメントの書式設定",
      formatting: "書式設定",
      syntaxVisibility: "構文の表示",
      modeNoCode: "構文非表示",
      modeClean: "クリーン",
      modeAssisted: "アシスト",
      modeSource: "ソース",
      descriptionNoCode: "編集中もMarkdownの記号を非表示にします。ツールバーで書式を設定できます。",
      descriptionClean: "編集中の行やコードブロック以外ではMarkdownの記号を非表示にします。",
      descriptionAssisted: "書式付きのテキストとともにMarkdownの記号を表示します。",
      descriptionSource: "Markdownソース全体をプレーンテキストとして編集します。",
      colorPalette: "カラーパレット",
      paletteEssentials: "基本",
      paletteEditorClassics: "定番のエディター",
      paletteAppInspired: "アプリ風",
      paletteColorful: "カラフル",
      paletteReadingNature: "読書と自然",
      customPalette: "カスタム（{palette}）",
      preview: "プレビュー",
      paragraphStyle: "段落のスタイル",
      paragraph: "段落",
      heading: "見出し{level}",
      lightTheme: "ライトテーマに切り替え",
      darkTheme: "ダークテーマに切り替え",
      undo: "元に戻す",
      redo: "やり直す",
      bold: "太字",
      italic: "斜体",
      strikethrough: "取り消し線",
      inlineCode: "コード",
      bulletList: "箇条書き",
      orderedList: "番号付きリスト",
      checklist: "チェックリスト",
      link: "リンク",
      image: "画像",
      table: "表",
      codeBlock: "コードブロック",
      blockquote: "引用",
      horizontalRule: "区切り線",
      readOnlyBlock: "このブロックはソースモードで編集できます。",
      completeTask: "「{task}」を完了",
      task: "タスク",
      oneTableCell: "表のセルは1つずつ編集してください。Tabキーでセルを移動できます。",
      hiddenFences: "コードの区切り記号は非表示です。ブロックの構造はソースモードで変更できます。",
      documentLimit: "ドキュメントが200万文字の上限に達しました。",
      inlineSelection: "同じ段落または表のセル内でテキストを選択して、書式を設定してください。",
      paragraphOutsideTable: "段落スタイルは表の外に適用されます。セルのテキストは直接編集してください。",
      validUrl: "ウェブ、メール、または相対URLを使用してください。",
      text: "テキスト",
      imageDescription: "画像の説明",
      linkText: "リンクのテキスト",
      column: "列{number}",
      insertTable: "表を挿入",
      insertLink: "リンクを挿入",
      insertImage: "画像を挿入",
      insertCodeBlock: "コードブロックを挿入",
      dataRows: "データの行数",
      columns: "列数",
      codeLanguage: "プログラミング言語（任意）",
      imageUrl: "画像のURL",
      url: "URL",
      cancel: "キャンセル",
      insert: "挿入",
      oneTableLine: "Markdownの表のセルは1行です。Enterで次の行、Tabで次のセルに移動します。",
      pasteTableLine: "セルには1行だけ貼り付けてください。複数行にはソースモードを使用してください。",
      pasteText: "ここにテキストを貼り付けるか、「画像」で画像のURLを挿入してください。",
      visualNeedsParser: "ビジュアル編集には最新版のeasy-md-viewerパーサーが必要です。ソース編集は引き続き使用できます。",
      previewNeedsViewer: "プレビューにはeasy-md-viewerを読み込んでください。",
      readOnlyPreview: "読み取り専用のプレビューです。",
      editingDocument: "ドキュメントを編集中です。",
      sourceOnlyWarning: "ビジュアル編集にはparseInline()とscanLine()を備えたeasy-md-viewerが必要です。ソースモードでMarkdownを編集できます。"
    },
    zh: {
      document: "文档",
      placeholder: "开始写作…",
      sourceLabel: "{document} — Markdown源码",
      documentFormatting: "文档格式",
      formatting: "格式",
      syntaxVisibility: "语法显示",
      modeNoCode: "隐藏语法",
      modeClean: "简洁",
      modeAssisted: "辅助",
      modeSource: "源码",
      descriptionNoCode: "编辑时隐藏Markdown语法。使用工具栏设置文本格式。",
      descriptionClean: "隐藏当前行或代码块以外的Markdown语法。",
      descriptionAssisted: "在带格式的文本旁显示Markdown语法。",
      descriptionSource: "以纯文本形式编辑完整的Markdown源码。",
      colorPalette: "配色方案",
      paletteEssentials: "基础",
      paletteEditorClassics: "经典编辑器",
      paletteAppInspired: "应用风格",
      paletteColorful: "多彩",
      paletteReadingNature: "阅读与自然",
      customPalette: "自定义（{palette}）",
      preview: "预览",
      paragraphStyle: "段落样式",
      paragraph: "正文",
      heading: "{level}级标题",
      lightTheme: "切换到浅色主题",
      darkTheme: "切换到深色主题",
      undo: "撤销",
      redo: "重做",
      bold: "粗体",
      italic: "斜体",
      strikethrough: "删除线",
      inlineCode: "代码",
      bulletList: "无序列表",
      orderedList: "有序列表",
      checklist: "任务列表",
      link: "链接",
      image: "图片",
      table: "表格",
      codeBlock: "代码块",
      blockquote: "引用",
      horizontalRule: "分隔线",
      readOnlyBlock: "请在源码模式下编辑此块。",
      completeTask: "完成{task}",
      task: "任务",
      oneTableCell: "请一次编辑一个单元格。使用Tab键在单元格之间移动。",
      hiddenFences: "代码围栏保持隐藏。请使用源码模式更改代码块结构。",
      documentLimit: "文档已达到两百万字符的上限。",
      inlineSelection: "请在同一段落或表格单元格内选择文本，再设置行内格式。",
      paragraphOutsideTable: "段落样式只适用于表格之外。请直接编辑单元格文本。",
      validUrl: "请使用网页、电子邮件或相对URL。",
      text: "文本",
      imageDescription: "图片说明",
      linkText: "链接文本",
      column: "第{number}列",
      insertTable: "插入表格",
      insertLink: "插入链接",
      insertImage: "插入图片",
      insertCodeBlock: "插入代码块",
      dataRows: "数据行数",
      columns: "列数",
      codeLanguage: "编程语言（可选）",
      imageUrl: "图片URL",
      url: "URL",
      cancel: "取消",
      insert: "插入",
      oneTableLine: "Markdown表格的单元格只能有一行。按Enter移至下一行，按Tab移至下一个单元格。",
      pasteTableLine: "请在单元格中粘贴单行文本，或使用源码模式粘贴多行表格。",
      pasteText: "在此处粘贴文本，或使用“图片”插入图片URL。",
      visualNeedsParser: "可视化编辑需要最新版easy-md-viewer解析器。源码编辑仍然可用。",
      previewNeedsViewer: "请加载easy-md-viewer以启用预览。",
      readOnlyPreview: "只读预览。",
      editingDocument: "正在编辑文档。",
      sourceOnlyWarning: "可视化编辑需要支持parseInline()和scanLine()的easy-md-viewer。您可以在源码模式下编辑Markdown。"
    }
  };

  // Resolve regional tags against loaded dictionaries; automatic detection may fall back quietly.
  const resolveLanguage = (element, requested) => {
    if (typeof requested !== "string" || !requested.trim()) throw new RangeError("Language must be a language tag or auto.");
    const automatic = requested.toLowerCase() === "auto";
    const tag = automatic ? element.closest("[lang]")?.getAttribute("lang") || global.navigator?.language || "en" : requested;
    let canonical;
    try {
      canonical = Intl.getCanonicalLocales(tag)[0].toLowerCase();
    } catch {
      if (!automatic) throw new RangeError("Language must be a valid language tag or auto.");
      canonical = "en";
    }
    let candidate = canonical;
    const available = Object.keys(byMDeditor.locales);
    while (candidate) {
      const matched = available.find((code) => code.toLowerCase() === candidate);
      if (matched) return matched;
      const split = candidate.lastIndexOf("-");
      candidate = split < 0 ? "" : candidate.slice(0, split);
    }
    if (!automatic && !warnedLanguages.has(canonical)) {
      warnedLanguages.add(canonical);
      console.warn(`easy-md-editor: Translations for "${canonical}" are unavailable. Add a dictionary to byMDeditor.locales. Using English.`);
    }
    return "en";
  };

  // --- PUBLIC API ---
  // Mount an editor with caller-owned persistence; all selections use UTF-16 source offsets.
  function byMDeditor(element, markdown, options = {}) {
    // --- OPTIONS AND INSTANCE STATE ---
    if (!(element instanceof HTMLElement)) throw new TypeError("byMDeditor: element must be an HTMLElement.");
    // Markdown owns the document. Editable DOM, line records, and Preview are derived views.
    let source = markdown instanceof HTMLElement ? markdown.textContent : (markdown ?? element.textContent);
    if (typeof source !== "string") throw new TypeError("byMDeditor: Markdown must be a string or HTMLElement.");
    if (source.length > 2000000) throw new RangeError("byMDeditor: maximum document size is 2,000,000 characters.");
    let language = resolveLanguage(element, options.language ?? "auto");
    const translations = options.translations ?? {};
    if (typeof translations !== "object" || Array.isArray(translations) || Object.values(translations).some((value) => typeof value !== "string")) throw new TypeError("Translations must be an object of text labels.");
    applyAppearance(element, options);
    const painted = element.classList.contains("byVIEWready");
    instances.get(element)?.destroy();
    options = {
      syntax: "clean",
      language: "auto",
      animations: true,
      appearAnimation: false,
      toolbar: true,
      toolbarToggle: true,
      controlsCompact: false,
      syntaxSelect: true,
      previewToggle: true,
      themeToggle: true,
      paletteSelect: true,
      statusBar: true,
      shortcuts: true,
      codeHighlighting: true,
      label: null,
      placeholder: null,
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
      active = null,
      announcement = null;
    let lines = [],
      groups = [],
      position = { anchor: 0, focus: 0 },
      savedPosition = position,
      fullSelection = null;
    let history = [],
      historyIndex = 0,
      historyBytes = 0,
      toolbarFrame = 0,
      motionFrame = 0;
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

    // --- LOCALIZATION ---
    const languageText = {};
    for (const [key, englishText] of Object.entries(byMDeditor.locales.en)) {
      languageText[key] = String(translations[key] ?? byMDeditor.locales[language]?.[key] ?? englishText);
    }
    const shortcutModifier = /Mac|iPhone|iPad|iPod/.test(global.navigator?.platform || "") ? "Cmd" : "Ctrl";
    const buttonTitle = (key) => (options.shortcuts && shortcutKeys[key] ? `${languageText[key]} (${shortcutModifier} + ${shortcutKeys[key]})` : languageText[key]);
    const announce = (key) => {
      announcement = key;
      status.textContent = languageText[key];
    };
    // Update only UI labels; source nodes, selection, composition, and history keep their owners.
    const translateControls = () => {
      for (const root of [bar, toolbar, dialog]) {
        if (!root) continue;
        root.lang = language;
        for (const text of root.querySelectorAll("[data-message]")) {
          const key = text.dataset.message;
          let message = languageText[key];
          if (key === "heading") message = message.replaceAll("{level}", text.closest("option").value);
          if (key === "customPalette") message = message.replaceAll("{palette}", text.value);
          text.textContent = message;
        }
        for (const control of root.querySelectorAll("[data-message-label]")) {
          const key = control.dataset.messageLabel;
          control.title = buttonTitle(key);
          control.setAttribute("aria-label", languageText[key]);
        }
      }
      status.lang = language;
      if (announcement) status.textContent = languageText[announcement];
      surface.setAttribute("aria-label", options.label ?? languageText.document);
      surface.dataset.placeholder = options.placeholder ?? languageText.placeholder;
      raw.setAttribute(
        "aria-label",
        languageText.sourceLabel.replaceAll("{document}", () => options.label ?? languageText.document)
      );
      raw.placeholder = options.placeholder ?? languageText.placeholder;
      toolbar.setAttribute("aria-label", languageText.documentFormatting);
      picker.setAttribute("aria-label", languageText.syntaxVisibility);
      picker.title = languageText[modeDescriptions[syntax]];
      palettePicker.setAttribute("aria-label", languageText.colorPalette);
      for (const group of palettePicker.querySelectorAll("optgroup")) group.label = languageText[group.dataset.messageGroup];
      heading.setAttribute("aria-label", languageText.paragraphStyle);
      themeButton.title = languageText[isDark() ? "lightTheme" : "darkTheme"];
      themeButton.setAttribute("aria-label", themeButton.title);
      for (const record of lines) {
        if (record.meta.type === "task")
          record.view.querySelector(".byEDtask")?.setAttribute(
            "aria-label",
            languageText.completeTask.replaceAll("{task}", () => record.text.slice(record.meta.bodyFrom) || languageText.task)
          );
        if (record.meta.type === "source") {
          const readOnly = record.view.querySelector(".byEDunsupported");
          if (readOnly) readOnly.title = languageText.readOnlyBlock;
        }
      }
    };

    // --- CONTROLS ---
    element.replaceChildren();
    element.classList.add("byMDeditor", "byMDdocument");
    element.classList.toggle("byVIEWmotion", options.animations !== false);
    element.classList.toggle("byVIEWappear", options.appearAnimation === true);
    if (painted) element.classList.add("byVIEWready");
    else {
      motionFrame = requestAnimationFrame(() => {
        motionFrame = requestAnimationFrame(() => {
          if (alive) element.classList.add("byVIEWready");
        });
      });
    }
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
    surface.setAttribute("aria-label", options.label ?? languageText.document);
    surface.dataset.placeholder = options.placeholder ?? languageText.placeholder;
    raw.setAttribute(
      "aria-label",
      languageText.sourceLabel.replaceAll("{document}", () => options.label ?? languageText.document)
    );
    raw.placeholder = options.placeholder ?? languageText.placeholder;
    raw.spellcheck = true;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", languageText.documentFormatting);
    const button = (key, icon, action, parent = toolbar) => {
      const label = languageText[key];
      const result = node("button", "byEDbutton");
      result.type = "button";
      const glyph = node("i", `fa-solid fa-${icon}`);
      glyph.setAttribute("aria-hidden", "true");
      const caption = node("span", "", label);
      caption.dataset.message = key;
      result.append(glyph, caption);
      result.dataset.messageLabel = key;
      result.setAttribute("aria-label", label);
      result.title = buttonTitle(key);
      listen(result, "click", action);
      parent.appendChild(result);
      return result;
    };
    const toggle = button("formatting", "sliders", () => api.setToolbar(toolbar.hidden), bar);
    toggle.dataset.control = "toolbar";
    const picker = node("select", "byEDselect");
    picker.dataset.control = "syntax";
    picker.setAttribute("aria-label", languageText.syntaxVisibility);
    for (const mode of modes) {
      const key = { "no-code": "modeNoCode", clean: "modeClean", assisted: "modeAssisted", source: "modeSource" }[mode];
      const option = node("option", "", languageText[key]);
      option.dataset.message = key;
      option.value = mode;
      option.disabled = !rich && mode !== "source";
      picker.append(option);
    }
    listen(picker, "change", () => api.setSyntaxMode(picker.value));
    const palettePicker = node("select", "byEDselect");
    palettePicker.setAttribute("aria-label", languageText.colorPalette);
    for (const [label, choices] of Object.entries(palettes)) {
      const group = node("optgroup");
      group.dataset.messageGroup = label;
      group.label = languageText[label];
      for (const [value, caption] of Object.entries(choices)) {
        const option = node("option", "", caption);
        option.value = value;
        group.append(option);
      }
      palettePicker.append(group);
    }
    const selectPalette = (palette) => {
      if (![...palettePicker.options].some((option) => option.value === palette)) {
        const option = node("option", "", languageText.customPalette.replaceAll("{palette}", palette));
        option.dataset.message = "customPalette";
        option.value = palette;
        palettePicker.append(option);
      }
      palettePicker.value = palette;
    };
    listen(palettePicker, "change", () => api.setPalette(palettePicker.value));
    controls.append(palettePicker);
    const previewButton = button("preview", "eye", () => api.setPreview(!previewing), controls);
    previewButton.setAttribute("aria-pressed", "false");
    const themeButton = node("button", "byVIEWthemeToggle");
    themeButton.type = "button";
    themeButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    listen(themeButton, "click", () => api.setTheme(isDark() ? "light" : "dark"));
    controls.append(themeButton);
    bar.append(picker, controls);
    const heading = node("select", "byEDselect byEDheading");
    heading.setAttribute("aria-label", languageText.paragraphStyle);
    for (let level = 0; level <= 6; level++) {
      const option = node("option");
      const caption = node(level ? `h${level}` : "span", "", level ? languageText.heading.replaceAll("{level}", String(level)) : languageText.paragraph);
      caption.dataset.message = level ? "heading" : "paragraph";
      caption.setAttribute("role", "presentation");
      option.value = String(level);
      option.append(caption);
      heading.append(option);
    }
    listen(heading, "change", () => {
      api.command("heading", Number(heading.value));
    });
    if (!options.tools || options.tools.includes("heading")) toolbar.appendChild(heading);
    const commandButtons = new Map();
    for (const [name, icon] of tools) {
      if (options.tools && !options.tools.includes(name)) continue;
      const control = button(name, icon, () => (["link", "image", "table", "codeBlock"].includes(name) ? openDialog(name) : api.command(name)));
      control.dataset.command = name;
      commandButtons.set(name, control);
      if (wraps[name]) control.setAttribute("aria-pressed", "false");
    }
    element.append(bar, toolbar, surface, raw, preview, status);
    const controlVisibility = { toolbarToggle: toggle, syntaxSelect: picker, previewToggle: previewButton, themeToggle: themeButton, paletteSelect: palettePicker, statusBar: status };
    const isDark = () => element.dataset.theme === "dark" || (element.dataset.theme !== "light" && element.classList.contains("dark"));

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
      // Source input stays plain; parse it only when a formatting command needs the grammar.
      const formatting = syntax === "source" ? null : formattingAt(from);
      for (const [name, marker] of Object.entries(wraps)) {
        const tokenType = { bold: "strong", italic: "em", strikethrough: "del", inlineCode: "code" }[name];
        const pressed = formatting
          ? formatting.formats.some((token) => (token.type === tokenType || (token.type === "strongEm" && ["strong", "em"].includes(tokenType))) && formatting.from + token.bodyFrom <= from && formatting.from + token.bodyTo >= to)
          : hasWrapper(from, to, marker);
        const button = commandButtons.get(name);
        if (button && button.getAttribute("aria-pressed") !== String(pressed)) button.setAttribute("aria-pressed", String(pressed));
      }
    };
    const scheduleToolbar = () => {
      if (!toolbarFrame) toolbarFrame = requestAnimationFrame(updateToolbar);
    };

    // --- SOURCE MAPPING ---
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
    // Find the physical line owning a source offset without scanning the entire document.
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
    // Translate textarea-normalized offsets to/from canonical source positions, accounting for CRLF pairs.
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
    // Associate rendered text nodes with source slices so selections never depend on HTML serialization.
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
    // Translate a native DOM boundary into a source offset, including empty-line placeholder nodes.
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
        // Empty visible bodies still own a caret after their hidden heading/list prefix.
        const record = lineMap.get(target.closest(".byEDline"));
        if (record && record.meta.bodyFrom === record.meta.bodyTo) return record.from + record.meta.bodyFrom;
      }
      return null;
    };
    // --- SELECTION ---
    // Read the active mode's selection as directed UTF-16 source offsets; toolbar focus retains the last range.
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
    // Restore a directed source selection in either editing surface without replacing document content.
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
      if (focus && document.activeElement !== surface) surface.focus({ preventScroll: true });
      // Focusing may restore an old native range; reveal the requested line after its focus handler.
      activate(lines[lineAt(position.focus)]);
      const anchor = point(position.anchor),
        end = point(position.focus);
      document.getSelection()?.setBaseAndExtent(...anchor, ...end);
      if (syntax === "no-code" && position.anchor !== position.focus && Math.min(position.anchor, position.focus) === 0 && Math.max(position.anchor, position.focus) === source.length) {
        const current = document.getSelection();
        fullSelection = { anchorNode: current.anchorNode, anchorOffset: current.anchorOffset, focusNode: current.focusNode, focusOffset: current.focusOffset };
      }
    };

    // --- INCREMENTAL RENDERING ---
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
    // Keep existing inline nodes attached so CSS can finish a marker's closing transition after a reparse.
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
    // Render one physical line; ambiguous source mappings deliberately retain literal Markdown.
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
        readOnly.title = languageText.readOnlyBlock;
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
          box.setAttribute(
            "aria-label",
            languageText.completeTask.replaceAll("{task}", () => record.text.slice(meta.bodyFrom) || languageText.task)
          );
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
    // Carry the previous line's parser state forward and inspect the next line only for table headers.
    const classify = (record, previous, next) => {
      const started = metrics ? performance.now() : 0;
      record.meta = global.byMDviewer.scanLine(record.text, previous?.meta.state, next?.text || "");
      measure("parse", started, { characters: record.text.length, scope: "line" });
    };
    // Reuse structural groups and editable children so unrelated edits retain DOM identity and selection.
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

    // Rebuild the derived line/group index from canonical source after initialization or source replacement.
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
    // Replace affected lines, shift later offsets, and reclassify only until fence/table context converges.
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

    // --- CODE HIGHLIGHTING ---
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
    // Consume CODE tokens in short frames and restore selection only if coloring moved its DOM boundary.
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
    // Cancel obsolete timers, frames, and the current iterator before another highlight pass takes ownership.
    const cancelCode = () => {
      clearTimeout(codeTimer);
      cancelAnimationFrame(codeFrame);
      codeTimer = codeFrame = 0;
      codeJob?.iterator.return?.();
      codeJob = null;
      codeQueue = [];
    };
    // Debounce code coloring independently of text input and skip it while IME owns the active DOM.
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

    // --- TRANSACTIONS AND HISTORY ---
    // Accept an unchanged native text node after input while updating its source offsets and history data.
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
      if (record.meta.type === "task")
        record.view.querySelector(".byEDtask").setAttribute(
          "aria-label",
          languageText.completeTask.replaceAll("{task}", () => record.text.slice(record.meta.bodyFrom) || languageText.task)
        );
    };
    // All committed edits pass here so source, ranges, undo history, and callbacks stay in agreement.
    // Commit one source edit, update derived views and undo state, then notify the application synchronously.
    const change = (from, to, inserted, next, type = "command", remember = true, native = null) => {
      if (!alive || previewing) return false;
      if (remember && syntax !== "source" && from === to && inserted && !/^[#\s]/.test(inserted)) {
        const record = lines[lineAt(from)];
        // Add the heading separator in the source transaction so typing, paste, and IME agree.
        if (record.meta.type === "heading" && from === record.from + record.text.length && /^ {0,3}#{1,6}$/.test(record.text)) {
          inserted = ` ${inserted}`;
          if (next) next = { anchor: next.anchor + 1, focus: next.focus + 1 };
        }
      }
      // Text edits stay inside visible structure; explicit commands and undo can change that structure.
      if (syntax === "no-code" && remember && (type.startsWith("insert") || type.startsWith("delete") || ["paste", "cut", "composition"].includes(type)) && !(from === 0 && to === source.length && from < to)) {
        const first = lineAt(from),
          last = lineAt(to),
          record = lines[first];
        if (record.meta.type === "source") {
          announce("readOnlyBlock");
          return false;
        }
        if (record.meta.cells && (first !== last || !record.meta.cells.some((cell) => from >= record.from + cell.from && to <= record.from + cell.to))) {
          // A native text node can include newly typed spaces that the Markdown parser trims.
          const startPoint = first === last ? record.points.find((point) => from >= record.from + point.from && from <= record.from + point.to && point.node.parentElement.closest(".byEDcell")) : null;
          const cell = startPoint?.node.parentElement.closest(".byEDcell");
          if (!cell || !record.points.some((point) => to >= record.from + point.from && to <= record.from + point.to && cell.contains(point.node))) {
            announce("oneTableCell");
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
          announce("hiddenFences");
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
        announce("documentLimit");
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
    // Replay the recorded source delta and directed selection without recording a second history entry.
    const undo = (redo = false) => {
      if ((redo && historyIndex >= history.length) || (!redo && historyIndex === 0)) return;
      const entry = history[redo ? historyIndex++ : --historyIndex];
      change(entry.from, entry.from + (redo ? entry.removed.length : entry.inserted.length), redo ? entry.inserted : entry.removed, redo ? entry.after : entry.before, "history", false);
    };
    // Commit only the browser-owned composition delta before normal rendering and history resume.
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
    // Reconcile native input through the source transaction; HTML is never converted back into Markdown.
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

    // --- FORMATTING ---
    const formattingAt = (offset) => {
      if (syntax !== "source" && !dirty) return lines[lineAt(offset)];
      if (!rich) return null;
      const from = offset ? Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1 : 0;
      const text = source.slice(from, from + 8193).split(/[\r\n]/, 1)[0];
      // Match the visual renderer's inline limit, including in Source mode.
      if (text.length > 8192) return null;
      const formats = [];
      const collect = (tokens) => {
        for (const token of tokens) {
          formats.push(token);
          if (token.children) collect(token.children);
        }
      };
      collect(global.byMDviewer.parseInline(text));
      return { from, formats };
    };
    const hasWrapper = (from, to, marker) => {
      if (source.slice(Math.max(0, from - marker.length), from) !== marker || source.slice(to, to + marker.length) !== marker) return false;
      if (marker !== "*") return true;
      // The parser-free Source fallback must not treat Bold's two stars as Italic.
      const starRun = (offset) => {
        let start = offset,
          end = offset;
        while (source[start - 1] === "*") start--;
        while (source[end] === "*") end++;
        return end - start;
      };
      return starRun(from) % 2 === 1 && starRun(to) % 2 === 1;
    };
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
        announce("readOnlyBlock");
        return false;
      }
      if (wraps[name]) {
        let marker = wraps[name];
        const selected = source.slice(from, to);
        if (/[\r\n]/.test(selected) || (syntax !== "source" && lines[lineAt(from)]?.meta.cells?.some((cell) => from - lines[lineAt(from)].from <= cell.to && to - lines[lineAt(from)].from > cell.to))) {
          announce("inlineSelection");
          return false;
        }
        const formatting = formattingAt(from);
        if (formatting) {
          const type = { bold: "strong", italic: "em", strikethrough: "del", inlineCode: "code" }[name];
          const token = formatting.formats.find((item) => {
            if (item.type !== type && !(item.type === "strongEm" && ["strong", "em"].includes(type))) return false;
            const bodyFrom = formatting.from + item.bodyFrom,
              bodyTo = formatting.from + item.bodyTo;
            return from === to ? syntax !== "source" && bodyFrom <= from && bodyTo >= from : (bodyFrom === from && bodyTo === to) || (formatting.from + item.from === from && formatting.from + item.to === to);
          });
          if (token) {
            const start = formatting.from + token.from,
              end = formatting.from + token.to,
              body = formatting.from + token.bodyFrom,
              text = source.slice(body, formatting.from + token.bodyTo);
            const remaining = token.type === "strongEm" ? source.slice(start, start + (name === "bold" ? 1 : 2)) : "";
            const anchor = start + remaining.length + Math.max(0, Math.min(text.length, position.anchor - body)),
              focus = start + remaining.length + Math.max(0, Math.min(text.length, position.focus - body));
            return change(start, end, remaining + text + remaining, { anchor, focus }, name);
          }
        }
        if (name === "inlineCode" && selected.includes("`")) marker = "`".repeat(Math.max(...[...selected.matchAll(/`+/g)].map((match) => match[0].length)) + 1);
        if (!formatting && hasWrapper(from, to, marker)) return change(from - marker.length, to + marker.length, selected, { anchor: from - marker.length, focus: to - marker.length }, name);
        if (!formatting && selected.length >= marker.length * 2 && hasWrapper(from + marker.length, to - marker.length, marker))
          return change(from, to, selected.slice(marker.length, -marker.length), { anchor: from, focus: to - marker.length * 2 }, name);
        const body = selected || (syntax === "no-code" ? languageText.text : "");
        return change(from, to, marker + body + marker, { anchor: from + marker.length, focus: from + marker.length + body.length }, name);
      }
      if (["heading", "paragraph", "bulletList", "orderedList", "checklist", "blockquote"].includes(name)) {
        const start = Math.max(source.lastIndexOf("\n", from - 1), source.lastIndexOf("\r", from - 1)) + 1;
        const remainder = source.slice(to).search(/[\r\n]/);
        const end = remainder < 0 ? source.length : to + remainder;
        if (syntax !== "source" && lines[lineAt(from)].meta.cells) {
          announce("paragraphOutsideTable");
          return false;
        }
        const prefix = name === "heading" && Number(value) > 0 ? "#".repeat(Math.min(6, Math.max(1, Number(value)))) + " " : { bulletList: "- ", orderedList: "1. ", checklist: "- [ ] ", blockquote: "> " }[name] || "";
        const original = source.slice(start, end);
        const output = original
          .split(/(\r\n|\r|\n)/)
          .map((line, index) => (index % 2 || (!line.trim() && /[\r\n]/.test(original)) ? line : prefix + line.replace(/^(?: {0,3}#{1,6}(?:\s+|$)|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|> ?)/, "")))
          .join("");
        return change(start, end, output, { anchor: start + prefix.length, focus: start + output.length }, name);
      }
      if (name === "link" || name === "image") {
        if (!value?.url) return openDialog(name);
        if (/^[\s\u0000-\u0020]*(?:javascript|data|vbscript):/i.test(value.url.replace(/[\u0000-\u0020]/g, ""))) {
          announce("validUrl");
          return false;
        }
        const label = source.slice(from, to) || value.label || languageText[name === "image" ? "imageDescription" : "linkText"];
        const url = value.url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
        const opening = name === "image" ? "![" : "[";
        return change(from, to, `${opening}${label}](${url})`, { anchor: from + opening.length, focus: from + opening.length + label.length }, name);
      }
      if (name === "table" || name === "insertTable") {
        if (!value) return openDialog("table");
        const rows = Math.min(100, Math.max(1, Math.trunc(Number(value.rows) || 2))),
          columns = Math.min(20, Math.max(1, Math.trunc(Number(value.columns) || 2)));
        const header = `| ${Array.from({ length: columns }, (_, i) => languageText.column.replaceAll("{number}", String(i + 1))).join(" | ")} |`;
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
    // Insert a block with surrounding Markdown line boundaries while preserving the document's newline style.
    const insertBlock = (value, from, to, name) => {
      const left = source.slice(Math.max(0, from - 4), from).replace(/\r\n?/g, "\n"),
        right = source.slice(to, to + 4).replace(/\r\n?/g, "\n");
      const before = from ? eol.repeat(Math.max(0, 2 - left.match(/\n*$/)[0].length)) : "";
      const after = eol.repeat(Math.max(0, 2 - right.match(/^\n*/)[0].length));
      return change(from, to, before + value + after, { anchor: from + before.length, focus: from + before.length + value.length }, name);
    };
    // Own one insertion dialog at a time and retain the source selection while focus is inside it.
    const openDialog = (name) => {
      if (dialog) return;
      savedPosition = selection();
      dialogAbort = new AbortController();
      const dialogListen = (target, type, handler) => listen(target, type, handler, { signal: dialogAbort.signal });
      dialog = node("dialog", "byEDdialog");
      const form = node("form");
      form.method = "dialog";
      const titleKey = { table: "insertTable", link: "insertLink", image: "insertImage", codeBlock: "insertCodeBlock" }[name];
      const title = node("h2");
      const titleIcon = node("i", `fa-solid fa-${tools.find(([key]) => key === name)[1]}`);
      titleIcon.setAttribute("aria-hidden", "true");
      const titleCaption = node("span", "", languageText[titleKey]);
      titleCaption.dataset.message = titleKey;
      title.append(titleIcon, titleCaption);
      const titleId = `byEDdialog-${Math.random().toString(36).slice(2)}`;
      title.id = titleId;
      dialog.setAttribute("aria-labelledby", titleId);
      form.append(title);
      const fields = {};
      const field = (key, label, type, value, max) => {
        const wrapper = node("label", "byEDfield"),
          input = node("input");
        input.name = key;
        input.type = type;
        input.value = value;
        input.required = true;
        if (type === "number") {
          input.min = "1";
          input.max = String(max);
        }
        const caption = node("span", "", languageText[label]);
        caption.dataset.message = label;
        wrapper.append(caption, input);
        form.append(wrapper);
        fields[key] = input;
      };
      if (name === "table") {
        field("rows", "dataRows", "number", "2", 100);
        field("columns", "columns", "number", "2", 20);
      } else if (name === "codeBlock") {
        field("language", "codeLanguage", "text", "javascript");
        fields.language.required = false;
      } else {
        field("url", name === "image" ? "imageUrl" : "url", "text", "https://");
        field("label", name === "image" ? "imageDescription" : "linkText", "text", source.slice(Math.min(savedPosition.anchor, savedPosition.focus), Math.max(savedPosition.anchor, savedPosition.focus)));
      }
      const actions = node("div", "byEDdialogActions"),
        cancel = node("button", "byEDdialogCancel"),
        submit = node("button", "byEDdialogConfirm");
      for (const [control, key, icon] of [
        [cancel, "cancel", "xmark"],
        [submit, "insert", "check"]
      ]) {
        const glyph = node("i", `fa-solid fa-${icon}`);
        glyph.setAttribute("aria-hidden", "true");
        const caption = node("span", "", languageText[key]);
        caption.dataset.message = key;
        control.append(glyph, caption);
      }
      cancel.type = "button";
      submit.type = "submit";
      actions.append(cancel, submit);
      form.append(actions);
      dialog.append(form);
      dialog.lang = language;
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
      // Native dialogs use viewport coordinates even when their owner is an editor.
      const area = syntax === "source" ? raw : surface;
      const positionDialog = () => {
        const rect = area.getBoundingClientRect();
        const top = Math.max(0, rect.top),
          left = Math.max(0, rect.left);
        Object.assign(dialog.style, {
          top: `${top}px`,
          left: `${left}px`,
          width: `${Math.max(0, Math.min(global.innerWidth, rect.right) - left)}px`,
          height: `${Math.max(0, Math.min(global.innerHeight, rect.bottom) - top)}px`
        });
      };
      dialogListen(global, "resize", positionDialog);
      listen(document, "scroll", positionDialog, { capture: true, signal: dialogAbort.signal });
      const resizeObserver = new ResizeObserver(positionDialog);
      resizeObserver.observe(area);
      resizeObserver.observe(element);
      dialogAbort.signal.addEventListener("abort", () => resizeObserver.disconnect(), { once: true });
      positionDialog();
      dialog.showModal();
      Object.values(fields)[0].focus();
    };

    // --- INPUT ---
    const beforeInput = (event) => {
      if (composing || event.isComposing || !event.cancelable) return;
      const started = metrics ? performance.now() : 0;
      nativeEdit = null;
      const type = event.inputType;
      position = selection();
      if (syntax === "no-code" && position.anchor === position.focus && lines[lineAt(position.focus)]?.meta.type === "source") {
        event.preventDefault();
        announce("readOnlyBlock");
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
              announce("oneTableLine");
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
            announce("pasteTableLine");
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
        announce("pasteText");
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
    // --- SELECTION AND TOOLBAR EVENTS ---
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

    // --- MODES AND LIFECYCLE ---
    const api = {
      // Return the last committed Markdown; active IME text commits on compositionend.
      getMarkdown() {
        return source;
      },
      // Replace source, reset history, and notify onChange even while Preview is visible.
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
      // Change presentation while retaining source and the directed selection.
      setSyntaxMode(mode) {
        if (!alive) return;
        if (!modes.includes(mode)) throw new RangeError("Syntax mode must be no-code, clean, assisted, or source.");
        if (mode !== "source" && !rich) {
          announce("visualNeedsParser");
          return;
        }
        finishComposition();
        if (!previewing) position = selection();
        // Source mode can retain a hidden visual document built in a different mode.
        const rebuild = renderedNoCode !== (mode === "no-code");
        syntax = mode;
        picker.value = mode;
        element.dataset.syntax = mode;
        picker.title = languageText[modeDescriptions[mode]];
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
      // Change control visibility without replacing the document, selection, or history.
      setControls(visibility = {}) {
        if (!alive) return;
        if (Object.hasOwn(visibility, "controlsCompact")) options.controlsCompact = Boolean(visibility.controlsCompact);
        element.classList.toggle("byEDcompact", options.controlsCompact);
        for (const [name, control] of Object.entries(controlVisibility)) {
          if (Object.hasOwn(visibility, name)) options[name] = visibility[name] !== false;
          control.hidden = options[name] === false;
        }
        if (palettePicker.hidden) palettePicker.remove();
        else if (palettePicker.parentNode !== controls) controls.prepend(palettePicker);
        controls.hidden = palettePicker.hidden && previewButton.hidden && themeButton.hidden;
        bar.hidden = toggle.hidden && picker.hidden && controls.hidden;
      },
      // Render the actual MD viewer on demand; returning to editing restores its saved selection.
      setPreview(visible) {
        if (!alive) return;
        finishComposition();
        if (!previewing) savedPosition = selection();
        if (visible && typeof global.byMDviewer !== "function") {
          announce("previewNeedsViewer");
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
          preview.dataset.theme = element.dataset.theme || "github";
          preview.classList.toggle("dark", isDark());
          global.byMDviewer(preview, source, { toolbar: false, animations: options.animations, codeHighlighting: options.codeHighlighting !== false && typeof global.byCODEviewer?.highlight === "function" });
          measure("preview", started);
          announce("readOnlyPreview");
        } else {
          if (dirty && syntax !== "source") build();
          restore(savedPosition);
          queueCode();
          announce("editingDocument");
        }
      },
      // Change motion without rebuilding the document or disturbing its selection/history.
      setAnimations(enabled) {
        if (!alive) return;
        options.animations = Boolean(enabled);
        element.classList.toggle("byVIEWmotion", options.animations);
        preview.classList.toggle("byVIEWmotion", options.animations);
      },
      setAppearAnimation(enabled) {
        if (!alive) return;
        options.appearAnimation = Boolean(enabled);
        element.classList.toggle("byVIEWappear", options.appearAnimation);
      },
      getLanguage() {
        return language;
      },
      // Change the UI language without rebuilding the document or ending native composition.
      setLanguage(value) {
        if (!alive) return;
        language = resolveLanguage(element, value);
        options.language = value;
        for (const [key, englishText] of Object.entries(byMDeditor.locales.en)) {
          languageText[key] = String(translations[key] ?? byMDeditor.locales[language]?.[key] ?? englishText);
        }
        translateControls();
      },
      setTheme(mode) {
        if (!alive) return;
        if (!["light", "dark"].includes(mode)) throw new RangeError("Theme must be light or dark.");
        if (["light", "dark"].includes(element.dataset.theme || "")) element.dataset.theme = mode;
        element.classList.toggle("dark", mode === "dark");
        element.classList.toggle("light", mode === "light");
        themeButton.title = languageText[mode === "dark" ? "lightTheme" : "darkTheme"];
        themeButton.setAttribute("aria-label", themeButton.title);
        if (previewing) api.setPreview(true);
      },
      setPalette(palette) {
        if (!alive) return;
        if (typeof palette !== "string" || !/^[a-z][\w-]*$/i.test(palette) || ["light", "dark"].includes(palette)) throw new RangeError("Palette must be a CSS theme name; use setTheme() for light or dark.");
        warnMissingThemes(element, palette);
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
      // Commit composition, cancel owned work, and clear the host only while this instance owns it.
      destroy() {
        if (!alive) return;
        // Commit browser-owned IME text before releasing listeners; this may call onChange during teardown.
        finishComposition();
        alive = false;
        abort.abort();
        dialogAbort?.abort();
        cancelAnimationFrame(toolbarFrame);
        cancelAnimationFrame(motionFrame);
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
          element.classList.remove("byMDeditor", "byMDdocument", "byEDcompact", "byVIEWmotion", "byVIEWappear", "byVIEWready");
          element.removeAttribute("data-syntax");
        }
      }
    };
    // --- MOUNT ---
    instances.set(element, api);
    translateControls();
    syncRawBreaks();
    if (rich && syntax !== "source") build();
    else {
      dirty = true;
      if (!rich) announce("sourceOnlyWarning");
    }
    raw.value = source;
    picker.value = syntax;
    picker.title = languageText[modeDescriptions[syntax]];
    element.dataset.syntax = syntax;
    raw.hidden = syntax !== "source";
    surface.hidden = syntax === "source";
    preview.hidden = true;
    api.setToolbar(options.toolbar);
    api.setControls(options);
    toolbar.classList.remove("byVIEWreveal");
    api.setPalette(["light", "dark"].includes(element.dataset.theme) ? "github" : element.dataset.theme || "github");
    updateToolbar();
    return api;
  }
  // --- EXPORT ---
  global.byMDeditor = byMDeditor;
  byMDeditor.initialized = true;
})(typeof window !== "undefined" ? window : this);
