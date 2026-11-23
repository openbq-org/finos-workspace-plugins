import { memo } from "react";

interface MapCategoryKeyProps {
  label?: string;
  categories: readonly { name: string; color: string }[];
  compact?: boolean;
}

const MapCategoryKey = memo(function MapCategoryKey({
  label,
  categories,
  compact = false,
}: MapCategoryKeyProps) {
  return (
    <div className="min-w-0">
      {label && (
        <div title={label} className="truncate text-ds-text-caption">
          {label}
        </div>
      )}
      <ul
        aria-label={label ?? "Categories"}
        className={`m-0 list-none gap-y-0.5 p-0 ${compact ? "flex max-w-[min(100%,420px)] flex-wrap gap-x-2.5" : "grid grid-cols-2 gap-x-2"}`}
      >
        {categories.map(({ name, color }) => (
          <li
            key={name}
            className={`flex min-w-0 items-center gap-1.5 ${compact ? "max-w-32" : ""}`}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm border border-general-border-primary"
              style={{ background: color }}
            />
            <span
              title={name}
              className={`min-w-0 ${compact ? "truncate" : "break-words"}`}
            >
              {name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export default MapCategoryKey;
