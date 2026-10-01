import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { APP_NAME } from "../lib/constants";
import { isLocationTeacher, locationAuth, teacherLogin } from "../lib/locationStore";

export function TeacherGate({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    localStorage.removeItem("trip-checkin-v4-admin-ok");
    const auth = locationAuth();
    if (!auth) { setLoading(false); setError("교사 로그인 설정이 필요합니다."); return; }
    let active = true, revision = 0;
    const unsubscribe = onAuthStateChanged(auth, () => {
      const current = ++revision;
      setAllowed(false); setLoading(true);
      isLocationTeacher().then(value => { if (active && revision === current) { setAllowed(value); setLoading(false); } });
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z]+$/.test(code)) { setError("영문 알파벳만 입력해 주세요."); return; }
    setBusy(true); setError("");
    try {
      await teacherLogin(code);
      const permitted = await isLocationTeacher();
      setAllowed(permitted); setCode("");
      if (!permitted) setError("교사 권한을 확인하지 못했습니다. 연결을 확인해 주세요.");
    } catch { setError("로그인하지 못했습니다. 교사용 코드와 연결을 확인해 주세요."); }
    finally { setBusy(false); }
  };
  if (loading) return <main className="page"><h1>{APP_NAME}</h1><p role="status">교사 권한 확인 중</p></main>;
  if (!allowed) return <main className="page"><h1>{APP_NAME}</h1><form className="panel" onSubmit={submit}><h2>교사 로그인</h2><label className="field"><span>교사용 코드</span><input type="password" value={code} onChange={e => {
    const value = e.target.value;
    if (/^[A-Za-z]*$/.test(value)) { setCode(value); setError(""); }
    else setError("영문 알파벳만 입력해 주세요.");
  }} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} lang="en" pattern="[A-Za-z]+" placeholder="영문 교사용 코드" required /></label>{error && <p role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy || !code}>{busy ? "확인 중" : "입장"}</button></form></main>;
  return <><div className="teacher-auth-bar"><button className="secondary-button" type="button" onClick={() => { const auth = locationAuth(); if (auth) void signOut(auth); }}>교사 로그아웃</button></div>{children}</>;
}
