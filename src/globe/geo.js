import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Locations closer than this are treated as "the same place" and fanned apart. */
export const DUPLICATE_RADIUS_KM = 25;
/** Distance between the two Geneva markers (and any other shared location). */
export const DUPLICATE_SEPARATION_KM = 110;

/**
 * Latitude/longitude → point on a sphere. Matches THREE.SphereGeometry's UV layout,
 * so an equirectangular texture drawn with x = (lon + 180) / 360 lines up exactly.
 */
export function latLonToVector3(lat, lon, radius = 1, target = new THREE.Vector3()) {
  const polar = (90 - lat) * DEG;
  const azimuth = (lon + 180) * DEG;
  return target.set(
    -Math.cos(azimuth) * Math.sin(polar) * radius,
    Math.cos(polar) * radius,
    Math.sin(azimuth) * Math.sin(polar) * radius,
  );
}

export function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function offsetLatLon(lat, lon, km, bearing) {
  return {
    lat: lat + (km / 111.32) * Math.cos(bearing),
    lon: lon + (km / (111.32 * Math.cos(lat * DEG))) * Math.sin(bearing),
  };
}

/**
 * Gives every location a `display` { lat, lon } used for its marker, camera focus
 * and journey arcs. world.json keeps the true coordinates; locations that share a
 * place (the two Geneva scenes) are fanned out west → east in story order.
 */
export function spreadDuplicates(locations) {
  const groups = [];
  for (const loc of locations) {
    const p = { lat: loc.latitude, lon: loc.longitude };
    const group = groups.find((g) => haversineKm(g.center, p) < DUPLICATE_RADIUS_KM);
    if (group) group.members.push(loc);
    else groups.push({ center: p, members: [loc] });
  }
  for (const { center, members } of groups) {
    if (members.length === 1) {
      members[0].display = { ...center, labelSide: 'center' };
      continue;
    }
    members.forEach((loc, i) => {
      const bearing = -Math.PI / 2 + (i * 2 * Math.PI) / members.length;
      // Labels open away from each other so the two names never overlap.
      const side = Math.sin(bearing) < -0.3 ? 'left' : Math.sin(bearing) > 0.3 ? 'right' : 'center';
      loc.display = { ...offsetLatLon(center.lat, center.lon, DUPLICATE_SEPARATION_KM / 2, bearing), labelSide: side };
    });
  }
}
