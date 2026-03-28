import { useEffect, useMemo, useRef } from "react";
import type { TimelineNode } from "@planit/shared-schema";
import { Map, MapPinned } from "lucide-react";

type MapPanelProps = {
  nodes: TimelineNode[];
};

function normalizePositions(nodes: TimelineNode[]) {
  const validNodes = nodes.filter((node) => node.coords);

  if (validNodes.length === 0) {
    return [];
  }

  const latValues = validNodes.map((node) => node.coords!.lat);
  const lngValues = validNodes.map((node) => node.coords!.lng);
  const minLat = Math.min(...latValues);
  const maxLat = Math.max(...latValues);
  const minLng = Math.min(...lngValues);
  const maxLng = Math.max(...lngValues);

  return validNodes.map((node, index) => {
    const latRange = maxLat - minLat || 1;
    const lngRange = maxLng - minLng || 1;

    return {
      id: node.id,
      title: node.title,
      index,
      top: 18 + (((maxLat - node.coords!.lat) / latRange) * 58),
      left: 12 + (((node.coords!.lng - minLng) / lngRange) * 74),
    };
  });
}

export function MapPanel({ nodes }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  const fallbackPositions = useMemo(() => normalizePositions(nodes), [nodes]);

  useEffect(() => {
    if (!token || !containerRef.current || nodes.filter((node) => node.coords).length === 0) {
      return;
    }

    let mounted = true;
    let cleanup = () => undefined;

    void import("mapbox-gl").then((mapboxgl) => {
      if (!mounted || !containerRef.current) {
        return;
      }

      mapboxgl.default.accessToken = token;

      const validNodes = nodes.filter((node) => node.coords);
      const map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [validNodes[0].coords!.lng, validNodes[0].coords!.lat],
        zoom: validNodes.length > 1 ? 8 : 10.5,
      });

      map.addControl(new mapboxgl.default.NavigationControl(), "top-right");

      map.on("load", () => {
        const coordinates = validNodes.map((node) => [node.coords!.lng, node.coords!.lat]);

        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates,
            },
            properties: {},
          },
        });

        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#0f172a",
            "line-width": 4,
            "line-opacity": 0.78,
          },
        });

        validNodes.forEach((node, index) => {
          const markerEl = document.createElement("div");
          markerEl.className = "mapbox-marker-shell";
          markerEl.textContent = String(index + 1);
          new mapboxgl.default.Marker(markerEl)
            .setLngLat([node.coords!.lng, node.coords!.lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 18 }).setText(node.title))
            .addTo(map);
        });
      });

      cleanup = () => {
        map.remove();
      };
    });

    return () => {
      mounted = false;
      cleanup();
    };
  }, [nodes, token]);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Map / canvas</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">A subtle route view stays beside the schedule.</h3>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-500">
          <Map className="h-5 w-5" />
        </div>
      </div>

      {token ? (
        <div ref={containerRef} className="mt-5 h-[19rem] overflow-hidden rounded-[24px] border border-slate-200" />
      ) : (
        <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(226,232,240,0.94))]">
          <div className="relative h-[19rem] bg-[linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:34px_34px]">
            {fallbackPositions.length ? (
              <>
                {fallbackPositions.map((point) => (
                  <div
                    key={point.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ top: `${point.top}%`, left: `${point.left}%` }}
                  >
                    <div className="flex items-center gap-2 rounded-full border border-white/80 bg-white/92 px-3 py-2 shadow-lg">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                        {point.index + 1}
                      </span>
                      <span className="max-w-[8rem] truncate text-xs font-semibold text-slate-900">{point.title}</span>
                    </div>
                  </div>
                ))}
                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-white/92 px-3 py-2 text-xs font-semibold text-slate-600 shadow-lg">
                  <MapPinned className="h-3.5 w-3.5" />
                  Add `VITE_MAPBOX_TOKEN` for a live map
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-500">
                Add timeline stops with coordinates to sketch the route here.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
