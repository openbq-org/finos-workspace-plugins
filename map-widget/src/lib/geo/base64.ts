const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function bytesOf(base64: string): Uint8Array<ArrayBuffer> | null {
  const packed = /\s/.test(base64) ? base64.replace(/\s+/g, "") : base64;
  if (packed.length % 4 !== 0 || !BASE64.test(packed)) return null;
  try {
    const binary = atob(packed);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
    return bytes;
  } catch {
    return null;
  }
}

export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
