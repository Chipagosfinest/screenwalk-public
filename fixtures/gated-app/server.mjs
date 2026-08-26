import { createServer } from "node:http";

const port = Number(process.env.SCREENWALK_GATE_PORT ?? process.env.SCREENBRANCH_GATE_PORT ?? "3109");
const password = process.env.SCREENWALK_GATE_PASSWORD ?? process.env.SCREENBRANCH_GATE_PASSWORD ?? "fixture-only";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const allowed = request.headers.cookie?.split(";").some((cookie) => cookie.trim() === "fixture_access=allowed") ?? false;

  if (request.method === "POST" && url.pathname === "/access") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const submitted = new URLSearchParams(body).get("password");
      if (submitted !== password) return html(response, accessPage("That password did not work."), 401);
      response.writeHead(303, { location: "/", "set-cookie": "fixture_access=allowed; HttpOnly; SameSite=Lax; Path=/" });
      response.end();
    });
    return;
  }

  if (url.pathname === "/access") return html(response, accessPage());
  if (!allowed) {
    response.writeHead(307, { location: "/access" });
    response.end();
    return;
  }
  if (url.pathname === "/inside") return html(response, page("Inside", "This screen only appears after access is established.", '<a href="/">Back home</a>'));
  return html(response, page("Member home", "The allowed flow starts here.", '<a href="/inside">Open the protected screen</a>'));
});

server.listen(port, "127.0.0.1", () => console.log(`gated fixture listening on http://127.0.0.1:${port}`));

function accessPage(error = "") {
  return `<!doctype html><html><head><title>Access required</title></head><body><main><h1>Access required</h1><p>The public experience stops here.</p>${error ? `<p role="alert">${error}</p>` : ""}<form method="post" action="/access"><label>Password <input name="password" type="password" /></label><button type="submit">Come in</button></form></main></body></html>`;
}

function page(title, description, navigation) {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${description}</p><nav>${navigation}</nav></main></body></html>`;
}

function html(response, body, status = 200) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}
