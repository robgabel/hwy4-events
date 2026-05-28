"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TOWN_INFO } from "@/lib/towns";
import { resolveDisplayAddress } from "@/lib/address";
import DirectionsLink from "./DirectionsLink";

interface EventMapProps {
  town: string;
  venueName: string;
  address: string | null;
  /** Clean address string; geocoded on mount to recenter on the actual venue. */
  geocodeQuery?: string | null;
}

const markerIcon = L.divIcon({
  html: `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#1B3A2D"/>
    <circle cx="16" cy="15" r="6" fill="#FDF8F3"/>
  </svg>`,
  className: "",
  iconSize: [32, 40],
  iconAnchor: [16, 40],
  popupAnchor: [0, -36],
});

/** Pans the map to a new center whenever it changes (e.g. after geocoding). */
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [map, center]);
  return null;
}

export default function EventMap({ town, venueName, address, geocodeQuery }: EventMapProps) {
  const townData = TOWN_INFO[town];
  const townCenter: [number, number] | null =
    townData?.lat != null && townData?.lng != null ? [townData.lat, townData.lng] : null;

  const [center, setCenter] = useState<[number, number] | null>(townCenter);

  // Geocode the venue after mount (off the page-load path) and recenter on it.
  useEffect(() => {
    if (!geocodeQuery) return;
    let cancelled = false;
    fetch(`/api/geocode?q=${encodeURIComponent(geocodeQuery)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((coords) => {
        if (!cancelled && coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
          setCenter([coords.lat, coords.lng]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [geocodeQuery]);

  if (!center) return null;

  const resolvedAddress = resolveDisplayAddress(address, town);

  return (
    <section className="mb-6">
      <div className="overflow-hidden rounded-lg border border-stone-light/30 card-warm">
        <MapContainer
          center={center}
          zoom={13}
          scrollWheelZoom={false}
          className="h-[240px] sm:h-[300px] w-full z-0"
          attributionControl={true}
        >
          <Recenter center={center} />
          <TileLayer
            attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            maxZoom={19}
          />
          <Marker position={center} icon={markerIcon}>
            <Popup>
              <strong className="text-forest">{venueName}</strong>
              <br />
              <span className="text-stone text-xs">
                {resolvedAddress && <>{resolvedAddress}<br /></>}
                {town}, California
              </span>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
      <DirectionsLink address={address} town={town} venueName={venueName} />
    </section>
  );
}
