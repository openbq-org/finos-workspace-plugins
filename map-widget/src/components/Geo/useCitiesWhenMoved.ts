import { useEffect, useState } from "react";
import { loadCities, loadedCities } from "~/lib/geo/regions/cities";

export function useCitiesWhenMoved(moved: boolean): boolean {
  const [cities, setCities] = useState(() => loadedCities() !== null);
  useEffect(() => {
    if (!moved || cities) return;
    let current = true;
    void loadCities()
      .then(() => {
        if (current) setCities(true);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [moved, cities]);
  return cities;
}
