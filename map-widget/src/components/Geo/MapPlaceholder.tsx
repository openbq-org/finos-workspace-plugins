import { memo } from "react";

const MapPlaceholder = memo(function MapPlaceholder({
  title,
  loading,
}: {
  title: string;

  loading: boolean;
}) {
  return (

    <div
      role="group"
      aria-label={`Map ${title}`}
      aria-busy={loading}
      data-map-placeholder={loading ? "loading" : "waiting"}
      className="relative min-h-0 flex-1"
    >
      <div className="absolute inset-1 flex flex-col items-center justify-center gap-1 overflow-hidden rounded-sm px-3 py-2 text-center text-xs text-ds-text-caption">
        <div className="max-w-full truncate font-medium text-ds-text-heading">
          {title}
        </div>
        {loading && (
          <p role="status" className="m-0">
            Loading the map...
          </p>
        )}
      </div>
    </div>
  );
});

export default MapPlaceholder;
