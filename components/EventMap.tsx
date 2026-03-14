"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TOWN_INFO } from "@/lib/towns";

interface EventMapProps {
  town: string;
  venueName: string;
  address: string | null;
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

export default function EventMap({ town, venueName, address }: EventMapProps) {
  const townData = TOWN_INFO[town];
  if (!townData?.lat || !townData?.lng) return null;

  const directionsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address + ", " + town + ", CA")}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venueName + ", " + town + ", CA")}`;

  return (
    <section className="mb-6">
      <div className="overflow-hidden rounded-lg border border-stone-light/30 card-warm">
        <MapContainer
          center={[townData.lat, townData.lng]}
          zoom={13}
          scrollWheelZoom={false}
          className="h-[240px] sm:h-[300px] w-full z-0"
          attributionControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            maxZoom={17}
          />
          <Marker position={[townData.lat, townData.lng]} icon={markerIcon}>
            <Popup>
              <strong className="text-forest">{venueName}</strong>
              <br />
              <span className="text-stone text-xs">
                {address && <>{address}<br /></>}
                {town}, California
              </span>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-pine hover:underline"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Get Directions
      </a>
    </section>
  );
}
