import { useEffect, useRef, useState } from "react";
import type { LearningEvent } from "../types";
import { LOCATION_INTERVAL_MS, validCoordinates } from "../lib/locationLogic";
import { publishLocation, stopLocation, studentLocationInvite } from "../lib/locationStore";

export function LocationSharing({ event, classNo, groupNo }: { event: LearningEvent; classNo: number; groupNo: number }) {
  const inviteId = new URLSearchParams(window.location.search).get("locationInvite");
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const generation = useRef(0);
  const pendingWrite = useRef<Promise<void> | null>(null);
  const lastAttempt = useRef(0);
  useEffect(() => {
    if (!sharing || !inviteId) return;
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
  }, [sharing, inviteId, event.id, classNo, groupNo]);
  if (!inviteId || event.isExample) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      if (sharing) {
        ++generation.current;
        setSharing(false);
        await pendingWrite.current?.catch(() => {});
        await stopLocation(event.id, `${classNo}-${groupNo}`);
        setNotice("위치 공유를 종료했습니다.");
      } else {
        if (!navigator.geolocation) throw new Error("이 브라우저는 위치 공유를 지원하지 않습니다.");
        const invite = await studentLocationInvite(event.id, inviteId);
        if (!invite.active || invite.classNo !== classNo || invite.groupNo !== groupNo) throw new Error("링크에 지정된 반·모둠을 선택해 주세요.");
        lastAttempt.current = 0; setSharing(true); setNotice("현재 위치를 확인하고 있습니다.");
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "위치 공유를 시작하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <section className="panel location-sharing"><div className="location-heading"><h3>{sharing ? "위치 공유 중" : "교사에게 위치 공유"}</h3><button type="button" className="secondary-button" disabled={busy} onClick={() => void toggle()}>{sharing ? "공유 종료" : "공유 시작"}</button></div><p className="muted">화면을 켜 둔 동안 약 3분 간격으로 공유합니다. 화면을 끄거나 다른 앱으로 이동하면 멈출 수 있어요.</p>{notice && <p role="status">{notice}</p>}</section>;
}
