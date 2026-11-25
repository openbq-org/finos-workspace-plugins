import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const WIDGETS = {
  text: "E2E marquee text",
  polled: "E2E marquee polled",
  live: "E2E marquee live",
  click: "E2E marquee click",
  vertical: "E2E marquee vertical",
};

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const GRID = { w: 40, h: 3, minH: 3 };
const STRIP = { w: 40, h: 4, minH: 3 };
const PANEL = { w: 10, h: 16 };

const series = (end, move) => Array.from({ length: 12 }, (_, i) => Number((end - move * (11 - i) + Math.sin(i * 1.7) * Math.abs(move) * 2).toFixed(2)));

export const STOCKS = [
  { ticker: "AAPL", label: "Apple Inc.", value: 185.32, change: 1.2, spark: series(185.32, 0.4) },
  { ticker: "GOOGL", label: "Alphabet Inc.", value: 141.8, change: -0.5, spark: series(141.8, -0.2) },
  { ticker: "MSFT", label: "Microsoft Corporation", value: 378.91, change: 0.8, spark: series(378.91, 0.7) },
  { ticker: "AMZN", label: "Amazon.com, Inc.", value: 178.25, change: 2.1, spark: series(178.25, 0.9) },
];

export const BOARD = [
  ...STOCKS,
  { ticker: "NVDA", label: "NVIDIA Corporation", value: 480, change: -1.4, spark: series(480, -1.6) },
  { ticker: "TSLA", label: "Tesla, Inc.", value: 242.5, change: 3.1, spark: series(242.5, 1.4) },
];

export const quoteItem = ({ ticker, label, value, change, spark }) => ({
  ticker,
  label,
  value: value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  change: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
  tone: change > 0 ? "up" : change < 0 ? "down" : "neutral",
  spark,
});

export const quoteText = (item) => [item.ticker, item.label, item.value, item.change].join(" ");

function frame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x80 | opcode, length]) : Buffer.from([0x80 | opcode, 126, length >> 8, length & 255]);
  return Buffer.concat([header, payload]);
}

export function startBackend({ port, listen = "127.0.0.1" }) {
  const answers = {
    text: "Breaking: markets rally as tech earnings beat expectations",
    polled: 0,
    live: { items: STOCKS.map(quoteItem) },
    vertical: { direction: "up", speed: 30, items: BOARD.map(quoteItem) },
  };
  const requests = [];
  const sockets = new Set();
  const connections = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    requests.push(`${url.pathname}${url.search}`);
    const send = (status, body) => response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname === "/widgets.json") {
      send(200, {
        marquee_text: { name: WIDGETS.text, description: "A line of text that the test chooses", category: "E2E Marquee", type: "marquee", endpoint: "/text", gridData: GRID },
        marquee_polled: {
          name: WIDGETS.polled,
          description: "Asks the endpoint again every second",
          category: "E2E Marquee",
          type: "marquee",
          endpoint: "/polled",
          refetchInterval: 1000,
          staleTime: 1000,
          gridData: GRID,
        },
        marquee_live: {
          name: WIDGETS.live,
          description: "Prices, kept current by a WebSocket",
          category: "E2E Marquee",
          type: "marquee",
          endpoint: "/live",
          data: { streamEndpoint: "/ws/ticker" },
          gridData: STRIP,
        },
        marquee_click: {
          name: WIDGETS.click,
          description: "A click writes its value parameter",
          category: "E2E Marquee",
          type: "marquee",
          endpoint: "/click",
          params: [{ paramName: "value", type: "text", label: "Clicked", value: "", show: true }],
          gridData: GRID,
        },
        marquee_vertical: {
          name: WIDGETS.vertical,
          description: "Prices in a column that scrolls up, kept current by a WebSocket",
          category: "E2E Marquee",
          type: "marquee",
          endpoint: "/vertical",
          data: { streamEndpoint: "/ws/ticker" },
          gridData: PANEL,
        },
      });
    } else if (url.pathname === "/text") {
      send(200, answers.text);
    } else if (url.pathname === "/polled") {
      answers.polled += 1;
      send(200, { items: [{ ticker: "N", text: `Answer number ${answers.polled}` }], separator: " • " });
    } else if (url.pathname === "/live") {
      send(200, answers.live);
    } else if (url.pathname === "/vertical") {
      send(200, answers.vertical);
    } else if (url.pathname === "/click") {
      const value = url.searchParams.get("value");
      send(200, {
        items: [
          { ticker: "A", text: "AAPL up", tone: "up" },
          { ticker: "B", text: "GOOGL down", tone: "down", clickValue: "GOOGL" },
          { ticker: "C", text: value ? `You clicked ${value}` : "Nothing clicked yet" },
        ],
        clickable: true,
        separator: " • ",
      });
    } else {
      send(404, { detail: "not found" });
    }
  });

  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    const key = request.headers["sec-websocket-key"];
    if (url.pathname !== "/ws/ticker" || typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    connections.push(url.search);
    socket.on("data", (data) => {
      const opcode = data[0] & 0x0f;
      if (opcode === 8) socket.end(frame(8));
      else if (opcode === 9) socket.write(frame(10));
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  return new Promise((resolve) =>
    server.listen(port, listen, () =>
      resolve({
        server,
        requests,
        connections,
        sockets,
        serve(name, body) {
          answers[name] = body;
        },
        broadcast(message) {
          const bytes = frame(1, Buffer.from(typeof message === "string" ? message : JSON.stringify(message)));
          for (const socket of sockets) socket.write(bytes);
        },
        dropSockets() {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
        },
        close() {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      }),
    ),
  );
}

async function demo(port) {
  const backend = await startBackend({ port, listen: "0.0.0.0" });
  const board = new Map(BOARD.map((stock) => [stock.ticker, { ...stock, spark: [...stock.spark] }]));
  const headlines = [
    "Breaking: markets rally as tech earnings beat expectations",
    "Fed signals steady rates through the second quarter",
    "New AI rules proposed in Congress",
    "Oil slips as inventories build",
  ];
  let tick = 0;
  setInterval(() => {
    tick += 1;
    const stock = [...board.values()][tick % board.size];
    const move = (Math.random() - 0.5) * 2;
    stock.value = Math.max(1, stock.value * (1 + move / 100));
    stock.change = Number((stock.change + move / 4).toFixed(1));
    stock.spark = [...stock.spark.slice(1), Number(stock.value.toFixed(2))];
    backend.broadcast({ op: "set-item", ...quoteItem(stock) });
    const all = [...board.values()].map(quoteItem);
    backend.serve("live", { items: all.slice(0, STOCKS.length) });
    backend.serve("vertical", { direction: "up", speed: 30, items: all });
    if (tick % 12 === 0) backend.serve("text", headlines[(tick / 12) % headlines.length]);
  }, 900);
  console.log(`marquee demo backend on http://0.0.0.0:${port} (widgets.json, /ws/ticker)`);
  setInterval(() => console.log(`tick ${tick}, ${backend.sockets.size} sockets, ${backend.requests.length} requests`), 15000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await demo(Number(process.argv[2] ?? process.env.PORT ?? 8012));
}
