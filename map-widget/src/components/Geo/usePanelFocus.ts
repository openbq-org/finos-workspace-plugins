import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

export function usePanelFocus<Panel extends HTMLElement, First extends HTMLElement>(
  opener?: RefObject<HTMLElement | null>,
): { panel: RefObject<Panel>; first: RefObject<First> } {
  const panel = useRef<Panel>(null);
  const first = useRef<First>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  useLayoutEffect(
    () => () => {
      if (panel.current?.contains(document.activeElement))
        opener?.current?.focus({ preventScroll: true });
    },
    [opener],
  );
  return { panel, first };
}
