import { getAuth, signInWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { collection, deleteDoc, doc, getDocFromServer, onSnapshot, runTransaction, setDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getDb } from "./groupStore";
import type { SharedLocation } from "./locationLogic";
import { teacherPasswordFromCode } from "./teacherCode";

export function locationAuth() {
  const db = getDb();
  return db ? getAuth(db.app) : null;
}
export async function teacherLogin(code: string) {
  if (!/^[A-Za-z]+$/.test(code)) throw new Error("영문 알파벳만 입력해 주세요.");
  const auth = locationAuth();
  if (!auth) throw new Error("Firebase 설정이 필요합니다.");
  await signInWithEmailAndPassword(auth, "teacher@fieldtrip.local", await teacherPasswordFromCode(code));
}
export async function isLocationTeacher() {
  const db = getDb(), user = locationAuth()?.currentUser;
  if (!db || !user || user.isAnonymous) return false;
  try { const snapshot = await getDocFromServer(doc(db, "locationConfig", "access")); return snapshot.exists() && snapshot.data().teacherUids?.includes(user.uid) === true; }
  catch { return false; }
}
export async function claimLocationDevice(eventId: string, classNo: number, groupNo: number) {
  const db = getDb(), auth = locationAuth();
  if (!db || !auth) throw new Error("위치 공유 설정이 필요합니다.");
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser!.uid;
  const ref = doc(db, "events", eventId, "locationDevices", `${classNo}-${groupNo}`);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const binding = snapshot.exists() ? snapshot.data() : null;
    if (binding?.publisherUid && binding.publisherUid !== uid) throw new Error("다른 모둠장 기기가 등록되어 있습니다. 선생님에게 위치 공유 기기 초기화를 요청해 주세요.");
    const bindingId = binding?.bindingId ?? crypto.randomUUID().replace(/-/g, "");
    if (!binding?.publisherUid) transaction.set(ref, { publisherUid: uid, bindingId });
    return bindingId as string;
  });
}
export async function resetLocationDevice(eventId: string, classNo: number, groupNo: number) {
  const db = getDb();
  if (!db) throw new Error("Firebase 설정이 필요합니다.");
  const groupId = `${classNo}-${groupNo}`;
  const batch = writeBatch(db);
  batch.set(doc(db, "events", eventId, "locationDevices", groupId), { publisherUid: null, bindingId: crypto.randomUUID().replace(/-/g, "") });
  batch.delete(doc(db, "events", eventId, "locations", groupId));
  await batch.commit();
}
export async function publishLocation(eventId: string, location: Omit<SharedLocation, "publisherUid">) {
  const db = getDb(), user = locationAuth()?.currentUser;
  if (!db || !user) throw new Error("위치 공유 인증이 필요합니다.");
  await setDoc(doc(db, "events", eventId, "locations", `${location.classNo}-${location.groupNo}`), {
    ...location, publisherUid: user.uid, receivedAt: serverTimestamp(),
  });
}
export async function stopLocation(eventId: string, groupId: string) {
  const db = getDb();
  if (db) await deleteDoc(doc(db, "events", eventId, "locations", groupId));
}
export function watchLocations(eventId: string, next: (locations: SharedLocation[]) => void, error: () => void) {
  const db = getDb();
  if (!db) throw new Error("Firebase 설정이 필요합니다.");
  return onSnapshot(collection(db, "events", eventId, "locations"), snapshot => {
    next(snapshot.docs.map(item => item.data() as SharedLocation));
  }, error);
}
export function watchLocationDevice(eventId: string, groupId: string, next: (bindingId: string | null) => void) {
  const db = getDb();
  if (!db) return () => {};
  return onSnapshot(doc(db, "events", eventId, "locationDevices", groupId), snapshot => next(snapshot.exists() ? snapshot.data().bindingId : null), () => next(null));
}

export function watchLocation(eventId: string, groupId: string, next: (location: SharedLocation | null) => void, error: () => void) {
  const db = getDb();
  if (!db) throw new Error("Firebase 설정이 필요합니다.");
  return onSnapshot(doc(db, "events", eventId, "locations", groupId), snapshot => {
    next(snapshot.exists() ? snapshot.data() as SharedLocation : null);
  }, error);
}
