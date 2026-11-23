import { memo, useMemo } from "react";
import { type DrawnShape, kindWord, shapeName } from "~/lib/geo/mapShapes";
import { measureText, shapeMeasure } from "~/lib/geo/measure";
import { useMeasureSystem } from "./useMeasureSystem";

export const SHAPE_ROWS = 100;

const MapShapesTable = memo(function MapShapesTable({
  shapes,
}: {
  shapes: readonly DrawnShape[];
}) {
  const [system] = useMeasureSystem();
  const rows = useMemo(
    () =>
      shapes.slice(0, SHAPE_ROWS).map((shape) => ({
        id: shape.id,
        name: shapeName(shape, shapes),
        kind: kindWord(shape.kind),
        measure: measureText(shapeMeasure(shape), system),
        note: shape.note ?? "",
      })),
    [shapes, system],
  );
  const noted = useMemo(() => rows.some((row) => row.note), [rows]);
  if (!rows.length) return null;
  return (
    <div
      data-map-shapes
      className="max-h-[40%] shrink-0 overflow-auto rounded border border-surface-divider"
    >
      <table className="w-full border-collapse text-left">
        <caption className="sticky top-0 bg-general-bg-secondary px-2 py-1 text-left font-medium text-ds-text-heading">
          {`My shapes (${shapes.length.toLocaleString("en-US")})`}
          {shapes.length > rows.length && (
            <span className="font-normal text-ds-text-caption">{`: the first ${rows.length}`}</span>
          )}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Measure</th>
            {noted && <th scope="col">Note</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-surface-divider align-top">
              <td className="px-2 py-1 text-ds-text-heading">{row.name}</td>
              <td className="px-2 py-1">{row.kind}</td>
              <td className="px-2 py-1 tabular-nums">{row.measure}</td>
              {noted && <td className="px-2 py-1 break-words">{row.note}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default MapShapesTable;
