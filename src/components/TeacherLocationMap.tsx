import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { LearningEvent } from "../types";
import { numbers } from "../lib/eventLogic";
import { isStale, locationLabel, type SharedLocation } from "../lib/locationLogic";
import { createLocationInvite, isLocationTeacher, locationAuth, watchLocations } from "../lib/locationStore";

interface Coordinate { lat(): number; lng(): number }
interface MapInstance { fitBounds(bounds: Bounds): void; destroy(): void }
interface Bounds { extend(point: Coordinate): void }
interface Marker { setMap(map: MapInstance | null): void }
interface MapsSdk {
  Map: new (element: HTMLElement, options: object) => MapInstance;
  LatLng: new (lat: number, lng: number) => Coordinate;
  LatLngBounds: new () => Bounds;
  Marker: new (options: object) => Marker;
  Point: new (x: number, y: number) => object;
}
declare global { interface Window { naver?: { maps: MapsSdk }; navermap_authFailure?: () => void } }
let sdkPromise: Promise<MapsSdk> | null = null;
function loadMapSdk(): Promise<MapsSdk> {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const key = import.meta.env.VITE_NAVER_MAP_CLIENT_ID || "cj23saxp69";
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`;
    script.async = true;
    const fail = () => { script.remove(); sdkPromise = null; reject(new Error("지도를 불러오지 못했습니다. 네이버 지도 키와 등록 주소를 확인해 주세요.")); };
    const timeout = window.setTimeout(fail, 15_000);
    window.navermap_authFailure = () => { window.clearTimeout(timeout); fail(); };
    script.onerror = () => { window.clearTimeout(timeout); fail(); };
    script.onload = () => { window.clearTimeout(timeout); if (window.naver?.maps) resolve(window.naver.maps); else fail(); };
    document.head.append(script);
  });
  return sdkPromise;
}

function LocationMap({ locations, now }: { locations: SharedLocation[]; now: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const sdk = useRef<MapsSdk | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadMapSdk().then(maps => {
      if (!active || !container.current) return;
      sdk.current = maps;
      map.current = new maps.Map(container.current, { center: new maps.LatLng(36.3, 127.8), zoom: 7, zoomControl: true });
      window.navermap_authFailure = () => { if (active) setError("지도 인증에 실패했습니다. 네이버 콘솔의 등록 주소를 확인해 주세요."); };
      setReady(true);
    }).catch(error => { if (active) setError(error.message); });
    return () => {
      active = false;
      markers.current.forEach(marker => marker.setMap(null));
      // The SDK may already destroy an unauthenticated map before React unmounts it.
      try { map.current?.destroy(); } catch { /* Already disposed by the SDK. */ }
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const maps = sdk.current, instance = map.current;
    if (!ready || !maps || !instance) return;
    markers.current.forEach(marker => marker.setMap(null));
    markers.current = locations.map(location => new maps.Marker({
      map: instance, position: new maps.LatLng(location.latitude, location.longitude),
      title: `${location.classNo}반 ${location.groupNo}모둠 · ${locationLabel(location, now)}`,
      icon: { content: `<span class="location-pin${isStale(location, now) ? " stale" : ""}">${location.classNo}-${location.groupNo}</span>`, anchor: new maps.Point(25, 15) },
    }));
  }, [locations, now, ready]);
  const fit = () => {
    if (!sdk.current || !map.current || !locations.length) return;
    const bounds = new sdk.current.LatLngBounds();
    locations.forEach(location => bounds.extend(new sdk.current!.LatLng(location.latitude, location.longitude)));
    map.current.fitBounds(bounds);
  };
  useEffect(() => { if (ready && locations.length) fit(); }, [ready, locations.length]);
  return <><div className="location-heading"><p className="muted">최근 확인된 위치입니다. 6분 이상 지난 위치는 흐리게 표시합니다.</p><button className="secondary-button" type="button" disabled={!ready || !locations.length} onClick={fit}>전체 위치</button></div>{error && <p role="alert">{error}</p>}<div ref={container} className="teacher-location-map" aria-label="모둠별 마지막 위치 지도" />{!locations.length && <p className="muted">아직 공유된 위치가 없습니다.</p>}<ul className="location-list">{locations.map(location => <li key={`${location.classNo}-${location.groupNo}`} className={isStale(location, now) ? "muted" : ""}><strong>{location.classNo}반 {location.groupNo}모둠</strong><span>{locationLabel(location, now)}{isStale(location, now) ? " · 갱신 없음" : ""}</span></li>)}</ul></>;
}

export function TeacherLocationMap({ event }: { event: LearningEvent }) {
  const [allowed, setAllowed] = useState(false);
  const [locations, setLocations] = useState<SharedLocation[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [classNo, setClassNo] = useState(1);
  const [groupNo, setGroupNo] = useState(1);
  const [link, setLink] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const auth = locationAuth();
    if (!auth) return;
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, () => { setAllowed(false); setLocations([]); isLocationTeacher().then(value => { if (active) setAllowed(value); }); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const unsubscribe = watchLocations(event.id, setLocations, () => { setLocations([]); setNotice("위치를 불러오지 못했습니다. 교사 권한과 연결을 확인해 주세요."); });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [allowed, event.id]);
  if (event.isExample) return null;
  const invite = async () => {
    setBusy(true); setNotice(""); setLink("");
    try {
      const url = await createLocationInvite(event.id, classNo, groupNo); setLink(url);
      try { await navigator.clipboard.writeText(url); setNotice("모둠장용 위치 공유 링크를 복사했습니다. 이전 링크는 종료됩니다."); }
      catch { setNotice("아래 링크를 복사해 모둠장에게 공유하세요. 이전 링크는 종료됩니다."); }
    } catch { setNotice("링크를 만들지 못했습니다. 교사 권한과 연결을 확인해 주세요."); }
    finally { setBusy(false); }
  };
  return <section className="panel location-panel"><h3>모둠 위치</h3>{!allowed ? <p className="muted">교사 권한 확인 중</p> : <><LocationMap locations={locations} now={now} /><div className="location-invite"><select aria-label="위치 공유 반" value={classNo} onChange={e => { setClassNo(Number(e.target.value)); setGroupNo(1); setLink(""); }}>{numbers(event.classGroupCounts.length).map(n => <option key={n} value={n}>{n}반</option>)}</select><select aria-label="위치 공유 모둠" value={groupNo} onChange={e => { setGroupNo(Number(e.target.value)); setLink(""); }}>{numbers(event.classGroupCounts[classNo - 1]).map(n => <option key={n} value={n}>{n}모둠</option>)}</select><button className="secondary-button" type="button" disabled={busy} onClick={() => void invite()}>모둠장 링크 발급·복사</button></div>{link && <input className="location-link" aria-label="모둠장 위치 공유 링크" value={link} readOnly onFocus={e => e.target.select()} />}</>}{notice && <p role="status">{notice}</p>}</section>;
}
