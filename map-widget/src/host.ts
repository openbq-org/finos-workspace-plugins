type Invoke = (
  name: string,
  message: Record<string, unknown>,
  options?: { buffers?: ArrayBuffer[]; timeout?: number; signal?: AbortSignal },
) => Promise<[unknown, DataView[]]>;

let invoke: Invoke | null = null;

export function bindHost(next: Invoke | null): void {
  invoke = next;
}

const ASSET_TIMEOUT_MS = 60_000;

async function call(
  name: string,
  message: Record<string, unknown>,
  options?: Parameters<Invoke>[2],
): Promise<[unknown, DataView[]]> {
  if (!invoke) throw new Error("The map is not connected to the host.");
  return invoke(name, message, options);
}

export async function readAsset(path: string): Promise<DataView> {
  const [, [bytes]] = await call(
    "core:asset:read",
    { path: `assets/${path}` },
    { timeout: ASSET_TIMEOUT_MS },
  );
  return bytes;
}

export async function readAssetJson<T>(path: string): Promise<T> {
  const bytes = await readAsset(path);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const copyText = async (text: string): Promise<void> => {
  await call("core:clipboard:write", { text });
};

export const notify = (
  level: "info" | "success" | "warning" | "error",
  text: string,
): void => {
  void call("core:ui:notify", { level, text }).catch(() => {});
};

export const addWidget = async (widget: string, data: unknown): Promise<void> => {
  await call("core:dashboard:add-widget", { widget, data });
};

export const saveFile = async (
  filename: string,
  mime: string,
  content: string | Uint8Array,
): Promise<void> => {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await call("core:download:save", { filename, mime }, { buffers: [copy as ArrayBuffer] });
};
