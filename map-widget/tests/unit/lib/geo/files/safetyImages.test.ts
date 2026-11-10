import { describe, expect, it } from "vitest";
import { imageHeader } from "~/lib/geo/files/images";
import {
  jpegHeader,
  png,
  utf8,
  webpHeader,
} from "../../../../fixtures/geo/files/builders";

describe("safety: images", () => {
  it("reads the kind and the size of an image from its header", () => {
    expect(imageHeader(png(64, 48))).toEqual({
      mime: "image/png",
      width: 64,
      height: 48,
    });
    expect(imageHeader(jpegHeader(300, 200))).toEqual({
      mime: "image/jpeg",
      width: 300,
      height: 200,
    });
    expect(imageHeader(webpHeader(640, 480))).toEqual({
      mime: "image/webp",
      width: 640,
      height: 480,
    });
  });

  it("gives nothing for bytes that are no image, cut short or of no size", () => {
    const whole = png(8, 8);
    for (let length = 0; length < 24; length++)
      expect(imageHeader(whole.subarray(0, length))).toBeNull();
    const jpeg = jpegHeader(10, 10);
    for (let length = 0; length < jpeg.length - 6; length++)
      expect(imageHeader(jpeg.subarray(0, length))).toBeNull();
    const webp = webpHeader(10, 10);
    for (let length = 0; length < 30; length++)
      expect(imageHeader(webp.subarray(0, length))).toBeNull();
    expect(imageHeader(png(0, 5, 0))).toBeNull();
    expect(imageHeader(utf8("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageHeader(utf8("GIF89a..........................."))).toBeNull();
    const stuck = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      0,
      ...new Array(64).fill(0xff),
    ]);
    expect(imageHeader(stuck)).toBeNull();
  });
});
