import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  type Ref,
  useCallback,
  useMemo,
  useState,
} from "react";
import Icon from "~/components/Icon";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { humanLabel } from "~/lib/geo/mapValues";
import { displayNumber, type NumberKind } from "~/lib/utils/displayNumber";
import { FOCUS } from "./mapControlStyles";
import { signWord } from "./mapSigns";
import { shortNumber } from "./mapTheme";
import { type MarkNumbers, markNumbers } from "./markNumbers";
import type { SceneMark } from "./scene/sceneTypes";

const shownValue = (value: unknown, column: string | undefined, kind: NumberKind) =>
  displayNumber(value, { column, kind, quantity: shortNumber });

export const MapCard = memo(function MapCard({
  mark,
  valueLabel,
  sizeLabel,
  numbers,
  pinned,
  note,
  onNote,
  onClose,
  cardRef,
}: {
  mark: SceneMark;
  valueLabel?: string;
  sizeLabel?: string;
  numbers?: MarkNumbers;
  pinned: boolean;
  note?: string;
  onNote?: (text: string) => void;
  onClose: () => void;
  cardRef?: Ref<HTMLDivElement>;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const submit = useCallback(() => onNote?.(draft), [draft, onNote]);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter") onNote?.(draft);
    },
    [draft, onNote],
  );
  const remove = useCallback(() => {
    setDraft("");
    onNote?.("");
  }, [onNote]);
  const edit = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [],
  );
  const kinds = useMemo(() => numbers ?? markNumbers([mark]), [numbers, mark]);
  const rows = useMemo(
    () =>
      Object.entries(mark.props ?? {}).map(
        ([key, value]) =>
          [humanLabel(key), shownValue(value, key, kinds.prop(mark, key))] as const,
      ),
    [mark, kinds],
  );
  return (
    <div
      role="group"
      ref={cardRef}
      aria-label={`Details of ${mark.label ?? "a mark of the map"}`}
      className={`absolute left-0 top-0 z-20 w-56 max-w-[calc(100%-16px)] rounded border border-general-border-primary bg-general-bg-primary p-2 text-xs leading-4 text-ds-text-body shadow-light-2 ${pinned ? "" : "pointer-events-none"}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: mark.color }}
        />
        <div className="min-w-0 flex-1 break-words font-medium text-ds-text-heading">
          {mark.label ??
            (mark.kind === "point"
              ? "Point"
              : mark.kind === "region"
                ? "Region"
                : "Shape")}
        </div>
        {pinned && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`-mr-1 -mt-1 flex size-5 shrink-0 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover ${FOCUS}`}
          >
            <Icon id="x-close" className="size-3" />
          </button>
        )}
      </div>
      <dl className="m-0 mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
        {mark.value !== undefined && (
          <>
            <dt className="max-w-28 text-ds-text-caption">{valueLabel ?? "Value"}</dt>
            <dd className="m-0 text-right tabular-nums text-ds-text-heading">
              {shownValue(mark.value, valueLabel, kinds.value(mark, valueLabel))}
            </dd>
          </>
        )}
        {mark.size !== undefined && sizeLabel !== valueLabel && (
          <>
            <dt className="max-w-28 text-ds-text-caption">{sizeLabel ?? "Size"}</dt>
            <dd className="m-0 text-right tabular-nums text-ds-text-heading">
              {shownValue(mark.size, sizeLabel, kinds.size(mark, sizeLabel))}
            </dd>
          </>
        )}
        {(mark.marker !== undefined || mark.highlight) && (
          <>
            <dt className="text-ds-text-caption">Marked</dt>
            <dd className="m-0 text-right">
              {[
                ...(mark.marker === undefined ? [] : [signWord(mark.marker)]),
                ...(mark.highlight ? ["highlight"] : []),
              ].join(", ")}
            </dd>
          </>
        )}
        {mark.tag !== undefined && (
          <>
            <dt className="text-ds-text-caption">Tag</dt>
            <dd className="m-0 break-words text-right">{mark.tag}</dd>
          </>
        )}
        {note && !pinned && (
          <>
            <dt className="text-ds-text-caption">Your tag</dt>
            <dd className="m-0 break-words text-right">{note}</dd>
          </>
        )}
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="max-w-24 truncate text-ds-text-caption">{key}</dt>
            <dd className="m-0 line-clamp-3 break-words text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {pinned && onNote && mark.key && (
        <div className="mt-2 flex items-center gap-1">
          <input
            type="text"
            value={draft}
            maxLength={MAP_LIMITS.noteChars}
            onChange={edit}
            onKeyDown={onKey}
            aria-label="Your tag for this place"
            placeholder="Add tag"
            className={`min-w-0 flex-1 rounded border border-general-border-primary bg-general-bg-primary px-1.5 py-0.5 text-xs text-ds-text-heading placeholder:text-ds-text-caption ${FOCUS}`}
          />
          <button
            type="button"
            onClick={submit}
            disabled={draft.trim() === (note ?? "")}
            className={`rounded border border-general-border-primary px-1.5 py-0.5 font-medium text-ds-text-heading hover:bg-general-bg-primary-hover disabled:text-general-label-disabled ${FOCUS}`}
          >
            {note ? "Save" : "Add tag"}
          </button>
          {note && (
            <button
              type="button"
              onClick={remove}
              aria-label="Remove your tag"
              title="Remove your tag"
              className={`flex size-5 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover ${FOCUS}`}
            >
              <Icon id="trash-02" className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
