import { useEffect, useMemo, useState } from "react";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";

import { getIpLocation, getOwnLocation } from "../api";
import { isPrivateOrLocalIp } from "../utils/ip";
import type { GeoLocation, GeoMarker, NetworkEvent } from "../types";

type WorldMapProps = {
  /** Live/sample connection events to plot. */
  events: NetworkEvent[];
};

const MARKER_COLORS = {
  device: "#2563eb",
  remote: "#dc2626",
};

/** Custom colored pin (Leaflet's default icons are broken under Vite). */
function createColoredIcon(color: string) {
  return L.divIcon({
    className: "geo-marker",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: ${color}; border: 2px solid white;
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
  });
}

function buildPopup(location: GeoLocation): string {
  const parts = [location.city, location.region, location.country]
    .filter(Boolean)
    .join(", ");

  return parts || location.ip;
}

function WorldMap({ events }: WorldMapProps) {
  const [markers, setMarkers] = useState<GeoMarker[]>([]);
  const [deviceMarker, setDeviceMarker] = useState<GeoMarker | null>(null);

  // ------------------------------------------------------------
  // DESTINATION MARKERS
  //
  // One marker per unique destination IP. Lookups hit the backend
  // /geo/{ip} endpoint, which caches each IP for 24 hours, so a
  // busy event stream does not mean busy geolocation API traffic.
  // ------------------------------------------------------------

  const destinationIps = useMemo(
    () =>
      [
        ...new Set(
          events
            .map((event) => event.destination_ip.trim())
            .filter(
              (ip) =>
                ip &&
                ip !== "Unknown" &&
                !isPrivateOrLocalIp(ip),
            ),
        ),
      ].sort(),
    [events],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMarkers() {
      const results = await Promise.all(
        destinationIps.map(async (ip) => {
          try {
            const location = await getIpLocation(ip);

            if (!location.success) {
              return null;
            }

            const { latitude, longitude } = location;

            if (latitude === null || longitude === null) {
              return null;
            }

            return {
              id: ip,
              position: [latitude, longitude] as [number, number],
              color: MARKER_COLORS.remote,
              popup: buildPopup(location),
            };
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setMarkers(
        results.filter(
          (marker): marker is GeoMarker => marker !== null,
        ),
      );
    }

    loadMarkers();

    return () => {
      cancelled = true;
    };
  }, [destinationIps]);

  // ------------------------------------------------------------
  // DEVICE MARKER
  // ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    getOwnLocation()
      .then((location) => {
        if (cancelled || !location.success) {
          return;
        }

        const { latitude, longitude } = location;

        if (latitude === null || longitude === null) {
          return;
        }

        setDeviceMarker({
          id: "self",
          position: [latitude, longitude],
          color: MARKER_COLORS.device,
          popup: `Your device — ${buildPopup(location)}`,
        });
      })
      .catch((error) => {
        console.error("Failed to load device location:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------

  return (
    <section className="card world-map-section">
      <div className="card-header">
        <h2 className="card-title">Global Network Activity</h2>
        <span className="card-meta">
          {deviceMarker ? markers.length + 1 : markers.length} locations
        </span>
      </div>

      <div className="world-map-container">
        <MapContainer
          center={[20, 0]}
          zoom={2}
          minZoom={2}
          className="world-map-leaflet"
        >
          {/* Esri's World Dark Gray Canvas — a genuinely dark, keyless
              raster basemap. Carto's dark tiles now watermark without
              an API key, and OSM's standard tiles are light-only. */}
          <TileLayer
            attribution='Tiles &copy; Esri — Source: Esri, HERE, Garmin, FAO, NOAA, USGS'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          />

          {deviceMarker && (
            <Marker
              position={deviceMarker.position}
              icon={createColoredIcon(deviceMarker.color)}
            >
              <Popup>{deviceMarker.popup}</Popup>
            </Marker>
          )}

          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={marker.position}
              icon={createColoredIcon(marker.color)}
            >
              <Popup>{marker.popup}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  );
}

export default WorldMap;
