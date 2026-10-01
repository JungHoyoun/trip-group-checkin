import { useEffect, useRef, useState } from "react";
import type { LearningEvent } from "../types";
import { LOCATION_INTERVAL_MS, validCoordinates } from "../lib/locationLogic";
import { publishLocation, stopLocation, studentLocationInvite } from "../lib/locationStore";

export function LocationSharing({ event, classNo, groupNo, activityActive, activityFinished }: { event: LearningEvent; classNo: number; groupNo: number; activityActive: boolean; activityFinished: boolean }) {
  const inviteId = new URLSearchParams(window.location.search).get("locationInvite");
  const storageKey = `trip-location:${event.id}:${classNo}-${groupNo}:${inviteId}`;
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const generation = useRef(0);
  const pendingWrite = useRef<Promise<void> | null>(null);
  const lastAttempt = useRef(0);
  const wasActive = useRef(false);
  useEffect(() => {
    if (!inviteId || event.isExample) return;
    let active = true;
    const previouslyActive = wasActive.current;
    wasActive.current = activityActive;
    if (!activityActive) {
      ++generation.current; setSharing(false);
      if (activityFinished || previouslyActive) {
        if (localStorage.getItem(storageKey) === "finished") {
          setNotice("관람 종료 · 위치 공유를 종료했습니다.");
          return;
        }
        const cleanupLocation = async () => {
          try {
            await pendingWrite.current?.catch(() => {});
            await studentLocationInvite(event.id, inviteId);
            if (!active) return;
            // A denied GPS permission may mean this device never published a point.
            if (localStorage.getItem(`${storageKey}:sent`)) await stopLocation(event.id, `${classNo}-${groupNo}`);
            localStorage.setItem(storageKey, activityFinished ? "finished" : "stopped");
            localStorage.removeItem(`${storageKey}:sent`);
            if (active) setNotice(activityFinished ? "관람 종료 · 위치 공유를 종료했습니다." : "위치 공유를 중지했습니다.");
          } catch { if (active) setNotice("위치 공유는 중지되었습니다. 마지막 위치 정리는 연결 후 다시 시도합니다."); }
        };
        void cleanupLocation();
        window.addEventListener("online", cleanupLocation);
        return () => { active = false; window.removeEventListener("online", cleanupLocation); };
      }
      return () => { active = false; };
    }
    if (localStorage.getItem(storageKey) === "paused") return;
    void (async () => {
      try {
        if (!navigator.geolocation) throw new Error("이 브라우저는 위치 공유를 지원하지 않습니다.");
        const invite = await studentLocationInvite(event.id, inviteId);
        if (!invite.active || invite.classNo !== classNo || invite.groupNo !== groupNo) throw new Error("링크에 지정된 반·모둠을 선택해 주세요.");
        if (!active) return;
        localStorage.removeItem(storageKey);
        lastAttempt.current = Number(localStorage.getItem(`${storageKey}:sent`)) || 0;
        setSharing(true); setNotice("관람 중 위치가 선생님에게 공유됩니다.");
      } catch (error) { if (active) setNotice(error instanceof Error ? error.message : "위치 공유를 시작하지 못했습니다."); }
    })();
    return () => { active = false; };
  }, [activityActive, activityFinished, inviteId, event.id, event.isExample, classNo, groupNo, storageKey]);
  useEffect(() => {
    if (!sharing || !inviteId || !activityActive) return;
    let active = true;
    const currentGeneration = ++generation.current;
    const send = () => {
      // Do not queue location history, or send a cached point as a new measurement.
      if (!active || document.visibilityState !== "visible" || !navigator.onLine || running.current) return;
      if (lastAttempt.current && Date.now() - lastAttempt.current < LOCATION_INTERVAL_MS) return;
      lastAttempt.current = Date.now(); running.current = true;
      navigator.geolocation.getCurrentPosition(async position => {
        try {
          if (!active || currentGeneration !== generation.current) return;
          const { latitude, longitude, accuracy } = position.coords;
          if (!validCoordinates(latitude, longitude, accuracy)) throw new Error("위치를 확인하지 못했습니다.");
          pendingWrite.current = publishLocation(event.id, { classNo, groupNo, latitude, longitude, accuracy, measuredAt: position.timestamp, inviteId });
          await pendingWrite.current;
          lastAttempt.current = Date.now();
          localStorage.setItem(`${storageKey}:sent`, String(lastAttempt.current));
          if (active) setNotice(`${new Date(position.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 위치 전송 · 약 3분 간격`);
        } catch { if (active) { setNotice("위치를 전송하지 못했습니다. 연결과 공유 링크를 확인해 주세요."); } }
        finally { running.current = false; pendingWrite.current = null; }
      }, error => {
        running.current = false;
        if (!active) return;
        setNotice(error.code === 1 ? "위치 권한을 허용해 주세요." : "위치를 확인하지 못했습니다. 다음 전송 때 다시 시도합니다.");
        if (error.code === 1) setSharing(false);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
    };
    send();
    const timer = window.setInterval(send, 10_000);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("online", send);
    return () => { active = false; ++generation.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", send); window.removeEventListener("online", send); };
  }, [sharing, inviteId, event.id, classNo, groupNo, activityActive, storageKey]);
  if (!inviteId || event.isExample) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      if (sharing) {
        localStorage.setItem(storageKey, "paused");
        ++generation.current;
        setSharing(false);
        await pendingWrite.current?.catch(() => {});
        await stopLocation(event.id, `${classNo}-${groupNo}`);
        localStorage.removeItem(`${storageKey}:sent`);
        setNotice("위치 공유를 종료했습니다.");
      } else {
        if (!navigator.geolocation) throw new Error("이 브라우저는 위치 공유를 지원하지 않습니다.");
        const invite = await studentLocationInvite(event.id, inviteId);
        if (!invite.active || invite.classNo !== classNo || invite.groupNo !== groupNo) throw new Error("링크에 지정된 반·모둠을 선택해 주세요.");
        localStorage.removeItem(storageKey);
        lastAttempt.current = Number(localStorage.getItem(`${storageKey}:sent`)) || 0; setSharing(true); setNotice("현재 위치를 확인하고 있습니다.");
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "위치 공유를 시작하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <section className="panel location-sharing"><div className="location-heading"><h3>{sharing ? "위치 공유 중" : activityFinished ? "위치 공유 종료" : "교사에게 위치 공유"}</h3>{activityActive && <button type="button" className="secondary-button" disabled={busy} onClick={() => void toggle()}>{sharing ? "공유 중지" : "공유 재시도"}</button>}</div><p className="muted">{activityActive ? "화면을 켜 둔 동안 약 3분 간격으로 공유합니다. 화면을 끄거나 다른 앱으로 이동하면 멈출 수 있어요." : activityFinished ? "관람이 끝나 위치를 전송하지 않습니다." : "첫 장소의 관람 시작부터 마지막 장소의 관람 종료까지 위치를 공유합니다."}</p>{notice && <p role="status">{notice}</p>}</section>;
}
