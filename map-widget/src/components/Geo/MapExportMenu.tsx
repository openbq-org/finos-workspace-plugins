import {
  cloneElement,
  memo,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MapExportFormat } from "~/lib/geo/files/exportModel";
import { EXPORT_FORMATS } from "./mapDownload";

const MapExportMenu = memo(function MapExportMenu({
  onExport,
  children,
}: {
  onExport: (format: MapExportFormat) => void;
  children: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, right: 0 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      {cloneElement(children, {
        onClick: () => {
          const rect = box.current?.getBoundingClientRect();
          if (rect)
            setPlace({ top: rect.top, right: window.innerWidth - rect.left + 4 });
          setOpen((now) => !now);
        },
      })}
      {open && (
        <div
          role="menu"
          aria-label="Export the map as a file"
          style={{ position: "fixed", top: place.top, right: place.right }}
          className="z-20 flex flex-col rounded-sm border border-general-border-primary bg-general-bg-primary p-1 shadow-light-1"
        >
          {EXPORT_FORMATS.map(([format, label, title]) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              title={title}
              className="whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs text-ds-text-body hover:bg-general-bg-primary-hover"
              onClick={() => {
                setOpen(false);
                onExport(format);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MapExportMenu;
