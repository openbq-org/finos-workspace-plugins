import { memo, useMemo } from "react";
import { mapRows } from "~/lib/geo/mapRows";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { FOCUS } from "./mapControlStyles";
import { requiredCredits } from "./mapWords";

const ROWS_SHOWN = 200;

const MapFallback = memo(function MapFallback({
  spec,
  name,
  reason,
  onRetry,
}: {
  spec: MapSpec;
  name: string;
  reason: string;
  onRetry?: () => void;
}) {
  const rows = useMemo(() => mapRows(spec), [spec]);
  const shown = useMemo(() => rows.slice(0, ROWS_SHOWN), [rows]);
  const credits = useMemo(() => requiredCredits(spec), [spec]);
  const headings = useMemo(
    () => [
      { id: "place", text: "Place" },
      { id: "label", text: "Label" },
      { id: "value", text: spec.valueLabel ?? "Value" },
      { id: "tag", text: "Tag" },
    ],
    [spec.valueLabel],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2 text-xs text-ds-text-body">
      <div className="flex items-start gap-2">
        <p role="status" className="m-0 min-w-0 flex-1">
          {reason}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={`shrink-0 rounded border border-general-border-primary px-1.5 py-0.5 font-medium text-ds-text-heading hover:bg-general-bg-primary-hover ${FOCUS}`}
          >
            Reload map
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-surface-divider">
        <table
          className="w-full border-collapse text-left"
          aria-label={`Data of map ${name}`}
        >
          <thead className="sticky top-0 bg-general-bg-secondary text-ds-text-heading">
            <tr>
              {headings.map(({ id, text }) => (
                <th key={id} scope="col" className="px-2 py-1 font-medium">
                  {text}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, at) => (
              <tr key={at} className="border-t border-surface-divider">
                <td className="px-2 py-1 tabular-nums">{row.place}</td>
                <td className="px-2 py-1">{row.label}</td>
                <td className="px-2 py-1 tabular-nums">{row.value ?? ""}</td>
                <td className="px-2 py-1">{row.tag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {credits.map((credit) => (
        <p key={credit} data-map-credit className="m-0 text-ds-text-caption">
          {credit}
        </p>
      ))}
      {rows.length > shown.length && (
        <p className="m-0 text-ds-text-caption">
          The first {shown.length} of {rows.length.toLocaleString("en-US")} marks are
          shown.
        </p>
      )}
    </div>
  );
});

export default MapFallback;
