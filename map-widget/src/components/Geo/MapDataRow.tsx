import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { humanLabel } from "~/lib/geo/mapValues";
import { displayNumber } from "~/lib/utils/displayNumber";
import { FOCUS } from "./mapControlStyles";
import { signWord } from "./mapSigns";
import { shortNumber } from "./mapTheme";
import type { MarkNumbers } from "./markNumbers";
import type { SceneMark } from "./scene/sceneTypes";

export const BUTTON = `rounded border border-general-border-primary px-1.5 py-0.5 font-medium text-ds-text-heading hover:bg-general-bg-primary-hover disabled:text-general-label-disabled disabled:hover:bg-transparent ${FOCUS}`;
const CELL = "px-2 py-1 align-top";
const KIND = {
  point: "Point",
  region: "Region",
  shape: "Shape",
  flow: "Flow",
} as const;

const nameOf = (mark: SceneMark) => mark.label ?? KIND[mark.kind];
const placeOf = (mark: SceneMark) =>
  mark.kind === "point" && mark.at
    ? `${mark.at[1].toFixed(4)}, ${mark.at[0].toFixed(4)}`
    : "";
const signOf = (mark: SceneMark) =>
  [
    ...(mark.marker === undefined ? [] : [signWord(mark.marker)]),
    ...(mark.highlight ? ["highlight"] : []),
  ].join(", ");
const otherValues = (mark: SceneMark, numbers: MarkNumbers) =>
  Object.entries(mark.props ?? {})
    .map(
      ([key, value]) =>
        `${humanLabel(key)}: ${displayNumber(value, { column: key, kind: numbers.prop(mark, key), quantity: shortNumber })}`,
    )
    .join("; ");

export interface Columns {
  code: boolean;
  place: boolean;
  value: boolean;
  size: boolean;
  tag: boolean;
  sign: boolean;
  other: boolean;
  note: boolean;
}

const DataRow = memo(function DataRow({
  mark,
  layer,
  valueLabel,
  sizeLabel,
  numbers,
  note,
  onNote,
  columns,
}: {
  columns: Columns;
  mark: SceneMark;
  numbers: MarkNumbers;
  layer?: string;
  valueLabel?: string;
  sizeLabel?: string;
  note?: string;
  onNote?: (key: string, text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (draft === null && editing.current) button.current?.focus();
    editing.current = draft !== null;
  }, [draft]);
  const name = nameOf(mark);
  const key = mark.key;
  const edit = useCallback(() => setDraft(note ?? ""), [note]);
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [],
  );
  const cancel = useCallback(() => setDraft(null), []);
  const save = useCallback(() => {
    if (key && draft !== null) onNote?.(key, draft);
    setDraft(null);
  }, [key, draft, onNote]);
  const remove = useCallback(() => {
    if (key) onNote?.(key, "");
    setDraft(null);
  }, [key, onNote]);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancel();
    },
    [save, cancel],
  );
  return (
    <tr className="border-t border-surface-divider">
      {layer !== undefined && <td className={CELL}>{layer}</td>}
      <th scope="row" className={`${CELL} text-left font-medium text-ds-text-heading`}>
        {name}
      </th>
      {columns.code && <td className={`${CELL} tabular-nums`}>{mark.code ?? ""}</td>}
      {columns.place && <td className={`${CELL} tabular-nums`}>{placeOf(mark)}</td>}
      {columns.value && (
        <td className={`${CELL} text-right tabular-nums`}>
          {mark.value === undefined
            ? ""
            : displayNumber(mark.value, {
                column: valueLabel,
                kind: numbers.value(mark, valueLabel),
                quantity: shortNumber,
              })}
        </td>
      )}
      {columns.size && (
        <td className={`${CELL} text-right tabular-nums`}>
          {mark.size === undefined
            ? ""
            : displayNumber(mark.size, {
                column: sizeLabel,
                kind: numbers.size(mark, sizeLabel),
                quantity: shortNumber,
              })}
        </td>
      )}
      {columns.tag && <td className={CELL}>{mark.tag ?? ""}</td>}
      {columns.sign && <td className={CELL}>{signOf(mark)}</td>}
      {columns.other && (
        <td className={`${CELL} min-w-40`}>{otherValues(mark, numbers)}</td>
      )}
      {columns.note && (
        <td className={CELL}>
          {draft === null ? (
            <div className="flex items-center gap-1.5">
              {note && <span className="min-w-0 break-words">{note}</span>}
              {onNote && key && (
                <button
                  ref={button}
                  type="button"
                  onClick={edit}
                  aria-label={`${note ? "Change the tag of" : "Add tag to"} ${name}`}
                  className={`shrink-0 ${BUTTON}`}
                >
                  {note ? "Change" : "Add tag"}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="text"
                // biome-ignore lint/a11y/noAutofocus: the field replaces the button that had the focus.
                autoFocus
                value={draft}
                maxLength={MAP_LIMITS.noteChars}
                onChange={change}
                onKeyDown={onKey}
                aria-label={`Your tag for ${name}`}
                className={`min-w-0 flex-1 rounded border border-general-border-primary bg-general-bg-primary px-1.5 py-0.5 text-ds-text-heading ${FOCUS}`}
              />
              <button type="button" onClick={save} className={BUTTON}>
                Save
              </button>
              {note && (
                <button
                  type="button"
                  onClick={remove}
                  aria-label={`Remove the tag of ${name}`}
                  className={BUTTON}
                >
                  Remove
                </button>
              )}
              <button type="button" onClick={cancel} className={BUTTON}>
                Cancel
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
});

export default DataRow;
