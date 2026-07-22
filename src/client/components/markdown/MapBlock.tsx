import { MaterialIcon } from "../MaterialIcon.tsx";

export interface MarkdownMapLocation {
  lat: number;
  lng: number;
  location?: string;
  title: string;
  zoom: number;
}

export function MapBlock({ location }: { location: MarkdownMapLocation }) {
  const embedUrl = openStreetMapEmbedUrl(location);
  const externalUrl = openStreetMapExternalUrl(location);

  return (
    <section className="truss-map-block" aria-label={`Map for ${location.title}`}>
      <div className="truss-map-header">
        <div className="truss-map-title">
          <MaterialIcon name="map" size={18} />
          <span>{location.title}</span>
        </div>
        <a href={externalUrl} rel="noreferrer noopener" target="_blank">
          Open map
          <MaterialIcon name="open_in_new" size={15} />
        </a>
      </div>
      <iframe
        className="truss-map-frame"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={embedUrl}
        title={`Map for ${location.title}`}
      />
      <div className="truss-map-footer">
        <span>{location.location ?? `${location.lat}, ${location.lng}`}</span>
        <a href="https://www.openstreetmap.org/copyright" rel="noreferrer noopener" target="_blank">
          OpenStreetMap
        </a>
      </div>
    </section>
  );
}

function openStreetMapEmbedUrl(location: MarkdownMapLocation): string {
  const url = new URL("https://www.openstreetmap.org/export/embed.html");
  const [west, south, east, north] = bbox(location);

  url.searchParams.set("bbox", `${west},${south},${east},${north}`);
  url.searchParams.set("layer", "mapnik");
  url.searchParams.set("marker", `${location.lat},${location.lng}`);

  return url.toString();
}

function openStreetMapExternalUrl(location: MarkdownMapLocation): string {
  const url = new URL("https://www.openstreetmap.org/");

  url.searchParams.set("mlat", String(location.lat));
  url.searchParams.set("mlon", String(location.lng));
  url.hash = `map=${location.zoom}/${location.lat}/${location.lng}`;

  return url.toString();
}

function bbox(location: MarkdownMapLocation): [number, number, number, number] {
  const zoom = Math.max(1, Math.min(18, location.zoom));
  const scale = 2 ** (14 - zoom);
  const latDelta = Math.max(0.002, Math.min(45, 0.035 * scale));
  const lngDelta = Math.max(0.002, Math.min(90, 0.055 * scale));
  const south = clamp(location.lat - latDelta, -90, 90);
  const north = clamp(location.lat + latDelta, -90, 90);
  const west = clamp(location.lng - lngDelta, -180, 180);
  const east = clamp(location.lng + lngDelta, -180, 180);

  return [west, south, east, north];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
