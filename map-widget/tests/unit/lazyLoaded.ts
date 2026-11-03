import { act, waitFor } from "@testing-library/react";
import { vi } from "vitest";

export async function lazyLoaded(): Promise<boolean> {
  let drew = false;
  for (;;) {
    const before = document.body.innerHTML;
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    if (document.body.innerHTML === before) return drew;
    drew = true;
  }
}

export async function findLoaded<T>(read: () => T | Promise<T>): Promise<T> {
  for (;;) {
    await lazyLoaded();
    try {
      return await waitFor(read);
    } catch (error) {
      if (!(await lazyLoaded())) throw error;
    }
  }
}
