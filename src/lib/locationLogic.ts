export const LOCATION_INTERVAL_MS = 180_000;
export interface SharedLocation {
  classNo: number;
  groupNo: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  measuredAt: number;
  publisherUid: string;
  inviteId: string;
}
export function validCoordinates(latitude: number, longitude: number, accuracy: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy >= 0;
}
export function locationLabel(location: SharedLocation, now = Date.now()) {
  const age = Math.max(0, Math.floor((now - location.measuredAt) / 60_000));
  return `${age === 0 ? "방금" : `${age}분 전`} · 오차 ±${Math.round(location.accuracy)}m`;
}
export function isStale(location: SharedLocation, now = Date.now()) {
  return now - location.measuredAt >= LOCATION_INTERVAL_MS * 2;
}
