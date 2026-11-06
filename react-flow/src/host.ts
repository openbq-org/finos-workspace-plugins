export interface AnyModel {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  save_changes(): void;
  on(event: string, callback: (content?: unknown, buffers?: unknown[]) => void): void;
  off(event?: string, callback?: (content?: unknown, buffers?: unknown[]) => void): void;
  send(content: unknown, callbacks?: unknown, buffers?: ArrayBuffer[]): void;
}

export interface Experimental {
  invoke(
    name: string,
    message?: unknown,
    options?: { buffers?: ArrayBuffer[]; signal?: AbortSignal; timeout?: number },
  ): Promise<[unknown, DataView[]]>;
}

export interface ExportOption {
  id: string;
  label: string;
  extension: string;
  mime: string;
}

export interface WidgetExports {
  exportOptions(): Promise<ExportOption[]>;
  exportData(id: string, context: { title?: string }): Promise<string | null>;
  copilotContext(): Promise<unknown>;
}

export interface InitializeContext {
  model: AnyModel;
  signal: AbortSignal;
  experimental: Experimental;
}

export interface RenderContext extends InitializeContext {
  el: HTMLElement;
}

export interface WidgetModule {
  initialize(context: InitializeContext): WidgetExports;
  render(context: RenderContext): void | Promise<void>;
}
