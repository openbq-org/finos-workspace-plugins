export const CANARY = "evil.example";

const bipartite = (left, right) => {
  const lines = ["flowchart LR"];
  for (let i = 0; i < left; i++) for (let j = 0; j < right; j++) lines.push(`  L${i} --> R${j}`);
  return lines.join("\n");
};

export const CASES = [
  {
    id: "html-labels",
    name: "HTML in flowchart labels",
    diagram: 'flowchart LR\n  A["<img src=x onerror=window.__pwned=1>"] --> B["<script>window.__pwned=2</script>"]\n  B --> C["<iframe src=https://evil.example/frame></iframe>"]',
  },
  {
    id: "svg-handlers",
    name: "SVG and HTML handlers in sequence, class and mindmap text",
    diagram: "sequenceDiagram\n  A->>B: <svg onload=window.__pwned=3>\n  Note over A: <img src=x onerror=window.__pwned=4>\n  B->>A: <a href=javascript:window.__pwned=5>x</a>",
  },
  {
    id: "class-label",
    name: "class diagram label and javascript link",
    diagram: 'classDiagram\n  class A["<svg onload=window.__pwned=6>"]\n  class B\n  link B "javascript:window.__pwned=7"\n  A --> B',
    links: [],
  },
  {
    id: "mindmap",
    name: "mindmap with handlers",
    diagram: 'mindmap\n  root(<svg onload=window.__pwned=8>)\n    child("<img src=x onerror=window.__pwned=9>")',
  },
  {
    id: "entities",
    name: "entity-encoded script",
    diagram: 'flowchart LR\n  A["&lt;script&gt;window.__pwned=10&lt;/script&gt;"] --> B["&#60;img src=x onerror=window.__pwned=11&#62;"]',
  },
  {
    id: "click-javascript",
    name: "click href with a javascript: URL",
    diagram: 'flowchart LR\n  A --> B\n  click A href "javascript:window.__pwned=12"\n  click B href "javascript:window.__pwned=13" _blank',
    links: [],
  },
  {
    id: "click-tab-split",
    name: "click href with a tab inside the scheme",
    diagram: 'flowchart LR\n  A --> B\n  click A href "java&#9;script:window.__pwned=14"\n  click B href " javascript:window.__pwned=15"',
    links: [],
  },
  {
    id: "click-callback",
    name: "click callback",
    diagram: "flowchart LR\n  A --> B\n  click A call window.__pwned=16()\n  click B call callback(16)",
    links: [],
  },
  {
    id: "click-data",
    name: "click href with a data: URL",
    diagram: 'flowchart LR\n  A --> B\n  click A "data:text/html,<script>window.__pwned=17</script>"',
    links: [],
  },
  {
    id: "click-http-and-relative",
    name: "click href with http, protocol-relative and relative URLs",
    diagram: 'flowchart LR\n  A --> B --> C\n  click A "http://evil.example/a"\n  click B "//evil.example/b"\n  click C "/relative"',
    links: [],
  },
  {
    id: "click-safe",
    name: "click href with https and mailto links",
    diagram: 'flowchart LR\n  A --> B\n  click A "https://example.com/docs" "docs"\n  click B "mailto:docs@example.com" "mail"',
    links: ["https://example.com/docs", "mailto:docs@example.com"],
  },
  {
    id: "directive-loose",
    name: "init directive: loose, themeCSS with @import, htmlLabels, fontFamily",
    diagram: '%%{init: {"securityLevel":"loose","themeCSS":"@import url(https://evil.example/x.css); .node{background:url(https://evil.example/y)}","htmlLabels":true,"fontFamily":"x} body{background:url(https://evil.example/f)","flowchart":{"htmlLabels":true}}}%%\nflowchart LR\n  A["<img src=https://evil.example/z.png onerror=window.__pwned=18>"] --> B',
  },
  {
    id: "front-matter",
    name: "front matter config: loose, themeCSS, layout",
    diagram: '---\nconfig:\n  securityLevel: loose\n  layout: elk\n  themeCSS: "@import url(https://evil.example/x.css);"\n  flowchart:\n    htmlLabels: true\n---\nflowchart LR\n  A["<img src=https://evil.example/z.png onerror=window.__pwned=19>"] --> B',
  },
  {
    id: "markdown-label",
    name: "markdown label with a javascript: link",
    diagram: 'flowchart LR\n  A["`**bold** [x](javascript:window.__pwned=20) ![i](https://evil.example/i.png)`"] --> B',
  },
  {
    id: "journey",
    name: "user journey, whose labels Mermaid draws in foreignObject",
    diagram: "journey\n  title Day\n  section Work\n    Code: 5: Me\n    Meet: 2: Me, Bob",
  },
  {
    id: "icon-pack",
    name: "architecture diagram naming a remote icon",
    diagram: "architecture-beta\n  group g(cloud)[G]\n  service a(logos:aws)[A] in g\n  service b(server)[B] in g\n  a:R -- L:b",
    optional: true,
  },
  {
    id: "pie-hostile",
    name: "pie with markup in its title and labels and an attribute break-out",
    diagram: 'pie showData title <img src=x onerror=window.__pwned=21>\n  "<script>window.__pwned=22</script>" : 1\n  "a\\" onmouseover=\\"window.__pwned=23" : 2\n  "b\' autofocus onfocus=\'window.__pwned=24" : 3',
  },
  {
    id: "pie-slices",
    name: "pie with 201 slices",
    diagram: `pie\n${Array.from({ length: 201 }, (_, i) => `  "s${i}" : 1`).join("\n")}`,
    refused: /at most 200 slices/,
  },
  {
    id: "pie-value",
    name: "pie with an absurd value",
    diagram: 'pie\n  "a" : 1000000000000000000',
    refused: /slice is at most/,
  },
  {
    id: "text-cap",
    name: "diagram text over 50,000 characters",
    diagram: `flowchart LR\n${"  A --> B\n".repeat(6000)}`,
    refused: /limit is 50000/,
  },
  {
    id: "edge-cap",
    name: "more than 300 edges",
    diagram: `flowchart LR\n${Array.from({ length: 400 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n")}`,
    refused: /edge/i,
  },
  {
    id: "dense",
    name: "289 edges between 34 nodes",
    diagram: bipartite(17, 17),
    settles: true,
  },
  {
    id: "syntax-error",
    name: "syntax error with a long tail",
    diagram: `flowchart LR\n  A--> --> [[[ ${"x".repeat(5000)}`,
    refused: /could not be drawn/,
  },
];
