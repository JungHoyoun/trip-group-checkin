import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { LearningEvent } from "../types";
import { isStale, locationLabel, type SharedLocation } from "../lib/locationLogic";
import { createLocationInvite, isLocationTeacher, locationAuth, watchLocation } from "../lib/locationStore";

interface Coordinate { lat(): number; lng(): number }
interface MapInstance { setCenter(point: Coordinate): void; destroy(): void }
interface Marker { setMap(map: MapInstance | null): void }
interface MapsSdk {
  Map: new (element: HTMLElement, options: object) => MapInstance;
  LatLng: new (lat: number, lng: number) => Coordinate;
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

function LocationMap({ location, now }: { location: SharedLocation; now: number }) {
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
      map.current = new maps.Map(container.current, { center: new maps.LatLng(location.latitude, location.longitude), zoom: 16, zoomControl: true });
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
    markers.current = [new maps.Marker({
      map: instance, position: new maps.LatLng(location.latitude, location.longitude),
      title: `${location.classNo}반 ${location.groupNo}모둠 · ${locationLabel(location, now)}`,
      icon: { content: `<span class="location-pin${isStale(location, now) ? " stale" : ""}">${location.classNo}-${location.groupNo}</span>`, anchor: new maps.Point(25, 15) },
    })];
  }, [location, now, ready]);
  const center = () => {
    if (!sdk.current || !map.current) return;
    map.current.setCenter(new sdk.current.LatLng(location.latitude, location.longitude));
  };
  useEffect(() => { if (ready) center(); }, [ready, location.latitude, location.longitude]);
  return <><div className="location-heading"><p className="muted">{locationLabel(location, now)}{isStale(location, now) ? " · 갱신 없음" : ""}</p><button className="secondary-button" type="button" disabled={!ready} onClick={center}>위치로 이동</button></div>{error && <p role="alert">{error}</p>}<div ref={container} className="teacher-location-map" aria-label={`${location.classNo}반 ${location.groupNo}모둠 마지막 위치 지도`} /></>;
}

export function TeacherLocationMap({ event, classNo, groupNo }: { event: LearningEvent; classNo: number; groupNo: number }) {
  const [allowed, setAllowed] = useState(false);
  const [location, setLocation] = useState<SharedLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (event.isExample) return;
    const auth = locationAuth();
    if (!auth) return;
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, () => { setAllowed(false); setLocation(null); isLocationTeacher().then(value => { if (active) setAllowed(value); }); });
    return () => { active = false; unsubscribe(); };
  }, [event.isExample]);
  useEffect(() => {
    if (!allowed) return;
    setLoading(true); setLocation(null);
    const unsubscribe = watchLocation(event.id, `${classNo}-${groupNo}`, value => { setLocation(value); setLoading(false); }, () => { setLocation(null); setLoading(false); setNotice("위치를 불러오지 못했습니다. 교사 권한과 연결을 확인해 주세요."); });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [allowed, event.id, classNo, groupNo]);
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
  return <section className="panel nested-panel location-panel"><h3>마지막 위치</h3>{!allowed ? <p className="muted">교사 권한 확인 중</p> : <>{loading ? <p className="muted">위치 확인 중</p> : location ? <LocationMap location={location} now={now} /> : <p className="muted">아직 공유된 위치가 없습니다.</p>}<div className="location-invite"><button className="secondary-button" type="button" disabled={busy} onClick={() => void invite()}>이 모둠 위치 공유 링크</button></div>{link && <input className="location-link" aria-label="모둠장 위치 공유 링크" value={link} readOnly onFocus={e => e.target.select()} />}</>}{notice && <p role="status">{notice}</p>}</section>;
}
