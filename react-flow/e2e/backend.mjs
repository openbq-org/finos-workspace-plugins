import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { widgets, flows } = JSON.parse(readFileSync(join(here, "../backend/flows.json"), "utf8"));

export const WIDGETS = widgets;
export const FLOWS = flows;
export const CATEGORY = Object.values(widgets)[0].category;

export function startBackend({ port, listen }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    const send = (status, body) =>
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname === "/widgets.json") return send(200, widgets);
    const flow = flows[url.pathname.replace(/^\//, "")];
    return flow ? send(200, flow) : send(404, { detail: "not found" });
  });
  return new Promise((resolve) => server.listen(port, listen, () => resolve({ server })));
}
