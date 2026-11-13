const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

// Exported local starters resolve companion files from sibling checkouts.
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/md.edit.js": "md.edit.js",
  "/md.edit.css": "md.edit.css",
  "/LICENSE": "LICENSE",
  "/md.js": "../easy-md-viewer/md.js",
  "/md.css": "../easy-md-viewer/md.css",
  "/md.themes.css": "../easy-md-viewer/md.themes.css",
  "/code.js": "../easy-code-viewer/code.js",
  "/code.css": "../easy-code-viewer/code.css"
};
for (const [name, repo] of [
  ["md", "easy-md-viewer"],
  ["code", "easy-code-viewer"]
]) {
  for (const extension of ["js", "css", "themes.css"]) files[`/${repo}/${name}.${extension}`] = `../${repo}/${name}.${extension}`;
}
const server = http.createServer(async (request, response) => {
  const file = files[new URL(request.url, "http://localhost").pathname];
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const content = await fs.readFile(path.join(__dirname, "..", file));
    response.writeHead(200, { "Content-Type": file.endsWith("html") ? "text/html; charset=utf-8" : file.endsWith("css") ? "text/css" : file === "LICENSE" ? "text/plain; charset=utf-8" : "text/javascript", "Cache-Control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(500);
    response.end("Development companion files are unavailable.");
  }
});
if (require.main === module) server.listen(Number(process.env.PORT) || 4173, "127.0.0.1", () => console.log(`Editor playground at http://127.0.0.1:${server.address().port}`));
module.exports = server;
