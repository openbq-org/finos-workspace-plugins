export function audit(root, fromFile) {
  const found = [];
  const forbidden = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select", "img", "image", "picture", "video", "audio", "source", "track", "link", "meta", "base", "animate", "animatemotion", "animatetransform", "set", "use", "foreignobject", "handler", "listener"]);
  const safe = (value) => /^(#|https:\/\/|mailto:)/.test(value) && !/[\s\u0000-\u001f\u007f]/.test(value);
  for (const node of root.querySelectorAll("*")) {
    if (forbidden.has(node.localName.toLowerCase())) found.push(`element <${node.localName}>`);
    for (const attr of node.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) found.push(`attribute ${attr.name}`);
      if ((name === "href" || name === "xlink:href") && !safe(attr.value)) found.push(`${attr.name}="${attr.value.slice(0, 60)}"`);
      if (/^(src|srcdoc|action|formaction|ping|poster|srcset|data)$/.test(name)) found.push(`attribute ${attr.name}`);
      if (/url\(\s*["']?(?!#)|@import|expression\(|javascript:|vbscript:/i.test(attr.value)) found.push(`${attr.name}="${attr.value.slice(0, 60)}"`);
    }
    if (node.localName === "style" && /@import|url\(\s*["']?(?!#)|expression\(|behavior\s*:|-moz-binding/i.test(node.textContent)) found.push("<style> reaches outside the document");
  }
  if (fromFile && !root.querySelector("svg")) found.push("no svg element");
  return found;
}
