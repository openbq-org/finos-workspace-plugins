import {
  type KeyboardEvent,
  memo,
  type RefObject,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { MapNotes } from "~/lib/geo/mapNotes";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import DataRow, { BUTTON, type Columns } from "./MapDataRow";
import MapShapesTable from "./MapShapesTable";
import { markNumbers } from "./markNumbers";
import type { SceneMark } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";
import { usePanelFocus } from "./usePanelFocus";

export const DATA_PAGE_ROWS = 100;

const MapDataTable = memo(function MapDataTable({
  name,
  marks,
  shown,
  layers,
  notes,
  onNote,
  onClose,
  step,
  opener,
  credits,
  shapes,
}: {
  name: string;
  marks: readonly SceneMark[];
  shown: (mark: SceneMark) => boolean;
  layers: readonly SceneLayer[];
  notes: MapNotes;
  onNote?: (key: string, text: string) => void;
  onClose: () => void;
  step?: string;
  opener?: RefObject<HTMLElement | null>;
  credits?: readonly string[];
  shapes?: readonly DrawnShape[];
}) {
  const { panel, first } = usePanelFocus<HTMLElement, HTMLHeadingElement>(opener);
  const rows = useMemo(
    () => marks.flatMap((mark, index) => (shown(mark) ? [{ mark, index }] : [])),
    [marks, shown],
  );
  const numbers = useMemo(() => markNumbers(marks), [marks]);
  const [asked, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / DATA_PAGE_ROWS));
  const page = Math.min(asked, pages - 1);
  const from = page * DATA_PAGE_ROWS;
  const listed = useMemo(() => rows.slice(from, from + DATA_PAGE_ROWS), [rows, from]);
  const names = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer.name])),
    [layers],
  );
  const valueLabels = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer.valueLabel])),
    [layers],
  );
  const several = useMemo(
    () => new Set(rows.map(({ mark }) => mark.layer)).size > 1,
    [rows],
  );
  const valueLabel = useMemo(() => {
    const labels = new Set(
      layers.flatMap((layer) => (layer.valueLabel ? [layer.valueLabel] : [])),
    );
    return labels.size === 1 ? [...labels][0] : "Value";
  }, [layers]);
  const sizeLabels = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer.sizeLabel])),
    [layers],
  );
  const sizeLabel = useMemo(() => {
    const labels = new Set(
      layers.flatMap((layer) => (layer.sizeLabel ? [layer.sizeLabel] : [])),
    );
    return labels.size === 1 ? [...labels][0] : "Size";
  }, [layers]);
  const columns = useMemo<Columns>(() => {
    const found: Columns = {
      code: false,
      place: false,
      value: false,
      size: false,
      tag: false,
      sign: false,
      other: false,
      note: Boolean(onNote),
    };
    for (const { mark } of rows) {
      found.code ||= mark.code !== undefined;
      found.place ||= mark.kind === "point" && Boolean(mark.at);
      found.value ||= mark.value !== undefined;
      found.size ||=
        mark.size !== undefined &&
        (mark.size !== mark.value ||
          sizeLabels.get(mark.layer) !== valueLabels.get(mark.layer));
      found.tag ||= Boolean(mark.tag);
      found.sign ||= mark.marker !== undefined || Boolean(mark.highlight);
      if (!found.other && mark.props)
        for (const _key in mark.props) {
          found.other = true;
          break;
        }
      found.note ||= Boolean(mark.key && notes[mark.key]);
      if (
        found.code &&
        found.place &&
        found.value &&
        found.size &&
        found.tag &&
        found.sign &&
        found.other &&
        found.note
      )
        break;
    }
    return found;
  }, [rows, onNote, notes, sizeLabels, valueLabels]);
  const previous = useCallback(() => setPage(Math.max(0, page - 1)), [page]);
  const next = useCallback(() => setPage(page + 1), [page]);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
  return (
    <section
      ref={panel}
      aria-label={`Data of map ${name}`}
      data-map-data
      onKeyDown={onKey}
      className="absolute inset-0 flex flex-col gap-1.5 bg-general-bg-primary py-2 pl-2 pr-11 text-xs leading-4 text-ds-text-body"
    >
      <h3 ref={first} tabIndex={-1} className="sr-only">
        {step === undefined ? "Data of the map" : `Data of the map at ${step}`}
      </h3>
      {step !== undefined && (
        <p className="m-0 shrink-0 break-words text-ds-text-caption">{`At ${step}`}</p>
      )}
      {rows.length === 0 ? (
        <p role="status" className="m-0 text-ds-text-caption">
          No mark is on the map as it is shown.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-surface-divider">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              {`Marks ${from + 1} to ${from + listed.length} of ${rows.length.toLocaleString("en-US")}`}
            </caption>
            <thead className="sticky top-0 bg-general-bg-secondary text-ds-text-heading">
              <tr>
                {several && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Layer
                  </th>
                )}
                <th scope="col" className="px-2 py-1 font-medium">
                  Label
                </th>
                {columns.code && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Region code
                  </th>
                )}
                {columns.place && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Place
                  </th>
                )}
                {columns.value && (
                  <th scope="col" className="px-2 py-1 text-right font-medium">
                    {valueLabel}
                  </th>
                )}
                {columns.size && (
                  <th scope="col" className="px-2 py-1 text-right font-medium">
                    {sizeLabel}
                  </th>
                )}
                {columns.tag && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Tag
                  </th>
                )}
                {columns.sign && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Marker
                  </th>
                )}
                {columns.other && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Other values
                  </th>
                )}
                {columns.note && (
                  <th scope="col" className="px-2 py-1 font-medium">
                    Your tag
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {listed.map(({ mark, index }) => (
                <DataRow
                  key={`${index}:${mark.key ?? ""}`}
                  mark={mark}
                  layer={several ? (names.get(mark.layer) ?? mark.layer) : undefined}
                  valueLabel={valueLabels.get(mark.layer)}
                  sizeLabel={sizeLabels.get(mark.layer)}
                  numbers={numbers}
                  note={mark.key ? notes[mark.key] : undefined}
                  onNote={onNote}
                  columns={columns}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shapes && shapes.length > 0 && <MapShapesTable shapes={shapes} />}
      {pages > 1 && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={previous}
            disabled={page === 0}
            className={BUTTON}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={next}
            disabled={page >= pages - 1}
            className={BUTTON}
          >
            Next
          </button>
          <span role="status" className="tabular-nums text-ds-text-caption">
            {`Marks ${(from + 1).toLocaleString("en-US")} to ${(from + listed.length).toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`}
          </span>
        </div>
      )}
      {credits?.map((credit) => (
        <p key={credit} data-map-credit className="m-0 shrink-0 text-ds-text-caption">
          {credit}
        </p>
      ))}
    </section>
  );
});

export default MapDataTable;
