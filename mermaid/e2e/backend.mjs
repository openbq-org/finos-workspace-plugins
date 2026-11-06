import { createServer } from "node:http";

export const WIDGET = "E2E hostile diagram";

export function startBackend({ port, listen }) {
  let current = "flowchart LR\n  A --> B";
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    requests.push(url.pathname);
    const send = (status, body) => response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname === "/widgets.json") {
      send(200, { hostile_diagram: { name: WIDGET, description: "A diagram that the test chooses", category: "E2E Mermaid", type: "mermaid", endpoint: "/diagram" } });
    } else if (url.pathname === "/diagram") {
      send(200, { diagram: current });
    } else {
      send(404, { detail: "not found" });
    }
  });
  return new Promise((resolve) =>
    server.listen(port, listen, () =>
      resolve({
        server,
        requests,
        serve: (diagram) => {
          current = diagram;
        },
      }),
    ),
  );
}
