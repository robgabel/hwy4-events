"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TOWN_INFO } from "@/lib/towns";
import { resolveDisplayAddress } from "@/lib/address";
import DirectionsLink from "./DirectionsLink";

interface EventMapProps {
  town: string;
  venueName: string;
  address: string | null;
  /** Geocoded venue coordinates; falls back to the town centroid when absent. */
  lat?: number | null;
  lng?: number | null;
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

export default function EventMap({ town, venueName, address, lat, lng }: EventMapProps) {
  const townData = TOWN_INFO[town];
  // Prefer the geocoded venue point; fall back to the town centroid.
  const center: [number, number] | null =
    lat != null && lng != null
      ? [lat, lng]
      : townData?.lat != null && townData?.lng != null
        ? [townData.lat, townData.lng]
        : null;
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
