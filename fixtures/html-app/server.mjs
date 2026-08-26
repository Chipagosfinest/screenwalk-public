import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const root = resolve(fileURLToPath(new URL("./public", import.meta.url)));
const port = Number(process.env.SCREENWALK_HTML_PORT ?? "3111");

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const route = url.pathname === "/" || url.pathname === "/mirror.html" ? "/index.html" : url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  const candidate = resolve(root, `.${route}`);
  if (!candidate.startsWith(root)) return send(response, 403, "Forbidden");
  try {
    if (!(await stat(candidate)).isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": contentType(candidate) });
    createReadStream(candidate).pipe(response);
  } catch {
    send(response, 404, "<!doctype html><title>Not found</title><h1>Not found</h1><p>This HTML route does not exist.</p>", "text/html; charset=utf-8");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`HTML fixture listening on http://127.0.0.1:${port}`));

function contentType(path) {
  return extname(path) === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
}

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": type });
  response.end(body);
}
