import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { LearningEvent } from "../types";
import { isStale, locationLabel, type SharedLocation } from "../lib/locationLogic";
import { resetLocationDevice, isLocationTeacher, locationAuth, watchLocation } from "../lib/locationStore";

interface Coordinate { lat(): number; lng(): number }
interface MapInstance { setCenter(point: Coordinate): void; setSize(size: { width: number; height: number }): void; destroy(): void }
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

function LocationMap({ location, now }: { location: SharedLocation | null; now: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const sdk = useRef<MapsSdk | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const clearMarkers = () => {
    markers.current.forEach(marker => {
      // Authentication failure can cause the SDK to dispose markers itself.
      try { marker.setMap(null); } catch { /* Already disposed by the SDK. */ }
    });
    markers.current = [];
  };
  useEffect(() => {
    if (!location || map.current) return;
    let active = true;
    loadMapSdk().then(maps => {
      if (!active || !container.current) return;
      sdk.current = maps;
      const instance = new maps.Map(container.current, { center: new maps.LatLng(location.latitude, location.longitude), zoom: 16, zoomControl: true });
      map.current = instance;
      window.navermap_authFailure = () => { if (map.current === instance) { setReady(false); setError("지도 인증에 실패했습니다. 네이버 콘솔의 등록 주소를 확인해 주세요."); } };
      setReady(true);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [!!location, retry]);
  useEffect(() => {
    return () => {
      clearMarkers();
      // The SDK may already destroy an unauthenticated map before React unmounts it.
      try { map.current?.destroy(); } catch { /* Already disposed by the SDK. */ }
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const maps = sdk.current, instance = map.current;
    if (!ready || !maps || !instance) return;
    clearMarkers();
    if (!location) return;
    try { markers.current = [new maps.Marker({
      map: instance, position: new maps.LatLng(location.latitude, location.longitude),
      title: `${location.classNo}반 ${location.groupNo}모둠 · ${locationLabel(location, now)}`,
      icon: { content: `<span class="location-pin${isStale(location, now) ? " stale" : ""}">${location.classNo}-${location.groupNo}</span>`, anchor: new maps.Point(25, 15) },
    })]; } catch { setReady(false); setError("지도를 표시하지 못했습니다. 네이버 지도 인증과 연결을 확인해 주세요."); }
  }, [location, now, ready]);
  const center = () => {
    if (!location || !sdk.current || !map.current || !container.current) return;
    try {
      const { clientWidth: width, clientHeight: height } = container.current;
      if (width && height) map.current.setSize({ width, height });
      map.current.setCenter(new sdk.current.LatLng(location.latitude, location.longitude));
    }
    catch { setReady(false); setError("지도를 표시하지 못했습니다. 네이버 지도 인증과 연결을 확인해 주세요."); }
  };
  useEffect(() => { if (ready) center(); }, [ready, location]);
  useEffect(() => {
    if (!container.current || !ready || !location) return;
    const observer = new ResizeObserver(center);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready, location]);
  const retryMap = () => {
    clearMarkers();
    try { map.current?.destroy(); } catch { /* Already disposed. */ }
    map.current = null; setReady(false); setError(""); setRetry(value => value + 1);
  };
  return <div hidden={!location}>{location && <div className="location-heading"><p className="muted">{locationLabel(location, now)}{isStale(location, now) ? " · 갱신 없음" : ""}</p><button className="secondary-button" type="button" disabled={!ready} onClick={center}>위치로 이동</button></div>}{error && <p role="alert">{error} <button className="secondary-button" type="button" onClick={retryMap}>지도 다시 불러오기</button></p>}<div ref={container} className="teacher-location-map" aria-label={location ? `${location.classNo}반 ${location.groupNo}모둠 마지막 위치 지도` : "마지막 위치 지도"} /></div>;
}

export function TeacherLocationMap({ event, classNo, groupNo }: { event: LearningEvent; classNo: number; groupNo: number }) {
  const [allowed, setAllowed] = useState(false);
  const selection = `${event.id}:${classNo}-${groupNo}`;
  const [result, setResult] = useState<{ selection: string; location: SharedLocation | null } | null>(null);
  const location = result?.selection === selection ? result.location : null;
  const loading = result?.selection !== selection;
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (event.isExample) return;
    const auth = locationAuth();
    if (!auth) return;
    let active = true;
    let revision = 0;
    const unsubscribe = onAuthStateChanged(auth, () => {
      const current = ++revision;
      setAllowed(false); setResult(null);
      isLocationTeacher().then(value => { if (active && current === revision) setAllowed(value); }).catch(() => {
        if (active && current === revision) setNotice("교사 권한을 확인하지 못했습니다. 연결 후 다시 접속해 주세요.");
      });
    });
    return () => { active = false; unsubscribe(); };
  }, [event.isExample]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setNotice("");
    const unsubscribe = watchLocation(event.id, `${classNo}-${groupNo}`, value => {
      if (active) setResult({ selection, location: value });
    }, () => {
      if (active) { setResult({ selection, location: null }); setNotice("위치를 불러오지 못했습니다. 교사 권한과 연결을 확인해 주세요."); }
    });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); };
  }, [allowed, event.id, classNo, groupNo, selection]);
  if (event.isExample) return null;
  const resetDevice = async () => {
    if (!window.confirm(`${classNo}반 ${groupNo}모둠의 위치 공유 기기를 초기화할까요? 현재 공유가 중지되고, 다음에 접속한 모둠장 기기가 등록됩니다.`)) return;
    setBusy(true); setNotice("");
    try {
      await resetLocationDevice(event.id, classNo, groupNo);
      setNotice("기기를 초기화했습니다. 새 모둠장은 공통 학생 링크에서 반·모둠을 선택해 주세요.");
    } catch { setNotice("기기를 초기화하지 못했습니다. 교사 권한과 연결을 확인해 주세요."); }
    finally { setBusy(false); }
  };
  return <section className="panel nested-panel location-panel"><h3>마지막 위치</h3>{!allowed ? <p className="muted">교사 권한 확인 중</p> : <>{loading ? <p className="muted">위치 확인 중</p> : !location && <p className="muted">아직 공유된 위치가 없습니다.</p>}<LocationMap location={location} now={now} /><div className="location-invite"><button className="secondary-button" type="button" disabled={busy} onClick={() => void resetDevice()}>위치 공유 기기 초기화</button></div></>}{notice && <p role="status">{notice}</p>}</section>;
}
