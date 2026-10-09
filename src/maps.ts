export type LatLon = { lat: number; lon: number }

function pointParam(p: LatLon | string): string {
  if (typeof p === 'string') return p.trim()
  return `${p.lat},${p.lon}`
}

/** Open place in Google Maps (search / pin). */
export function mapsPlaceUrl(place: LatLon | string): string {
  const q = encodeURIComponent(pointParam(place))
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/**
 * Multi-stop driving directions in Google Maps.
 * origin → waypoints → destination (Google supports up to 10 waypoints in the URL).
 */
export function mapsDrivingUrl(
  origin: LatLon | string,
  stops: Array<LatLon | string>,
): string | null {
  if (stops.length === 0) return null
  const dest = stops[stops.length - 1]!
  const waypoints = stops.slice(0, -1).slice(0, 9)
  const params = new URLSearchParams({
    api: '1',
    origin: pointParam(origin),
    destination: pointParam(dest),
    travelmode: 'driving',
  })
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(pointParam).join('|'))
  }
  return `https://www.google.com/maps/dir/?${params}`
}

/** Single-leg directions from A to B. */
export function mapsDirectionsUrl(
  origin: LatLon | string,
  destination: LatLon | string,
): string {
  return mapsDrivingUrl(origin, [destination])!
}
