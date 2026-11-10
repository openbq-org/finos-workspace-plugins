import { memo, useMemo } from "react";
import { CopyButton } from "~/components/ds/atoms/CopyButton";
import { areaText, lengthText, placeText, type ShapeMeasure } from "~/lib/geo/measure";
import { FOCUS } from "../mapControlStyles";
import { useMeasureSystem } from "../useMeasureSystem";

const STRETCHES = 6;

export const UnitsButton = memo(function UnitsButton({
  className = "",
}: {
  className?: string;
}) {
  const [system, toggle] = useMeasureSystem();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Units: ${system === "metric" ? "kilometres" : "miles"}. Change to ${system === "metric" ? "miles" : "kilometres"}`}
      title={
        system === "metric"
          ? "Kilometres and hectares. Change to miles and acres"
          : "Miles and acres. Change to kilometres and hectares"
      }
      className={`shrink-0 rounded px-1 text-2xs font-medium uppercase leading-4 tracking-wide text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover ${FOCUS} ${className}`}
    >
      {system === "metric" ? "km" : "mi"}
    </button>
  );
});

const MeasureReadout = memo(function MeasureReadout({
  measure,
  units = false,
}: {
  measure: ShapeMeasure;
  units?: boolean;
}) {
  const [system] = useMeasureSystem();
  const rows = useMemo<[string, string][]>(() => {
    if (measure.place) return [["Place", placeText(measure.place)]];
    if (measure.kind === "line") {
      const stretches = measure.segmentsKm ?? [];
      const first = Math.max(0, stretches.length - STRETCHES);
      return [
        ["Length", lengthText(measure.lengthKm ?? 0, system)],
        ...(stretches.length > 1
          ? stretches
              .slice(first)
              .map((km, at): [string, string] => [
                `Stretch ${first + at + 1}`,
                lengthText(km, system),
              ])
          : []),
      ];
    }
    if (measure.kind === "circle")
      return [
        ["Radius", lengthText(measure.radiusKm ?? 0, system)],
        ["Area", areaText(measure.areaKm2 ?? 0, system)],
      ];
    return [
      ["Area", areaText(measure.areaKm2 ?? 0, system)],
      ["Perimeter", lengthText(measure.roundKm ?? 0, system)],
    ];
  }, [measure, system]);
  return (
    <dl
      data-map-measure
      className="m-0 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 text-xs leading-4"
    >
      {rows.map(([name, value], at) => (
        <div key={name} className="contents">
          <dt className="text-ds-text-caption">{name}</dt>
          <dd className="m-0 text-right font-medium tabular-nums text-ds-text-heading">
            {value}
          </dd>
          <span className="flex justify-end">
            {measure.place ? (
              <CopyButton
                text={value}
                inlineFeedback
                aria-label="Copy the latitude and the longitude"
                className="size-5 p-0.5"
              />
            ) : (
              at === 0 && units && <UnitsButton />
            )}
          </span>
        </div>
      ))}
    </dl>
  );
});

export default MeasureReadout;
