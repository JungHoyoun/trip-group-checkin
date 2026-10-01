import { getAuth, signInWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocFromServer, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "./groupStore";
import type { SharedLocation } from "./locationLogic";
import { teacherPasswordFromCode } from "./teacherCode";

export function locationAuth() {
  const db = getDb();
  return db ? getAuth(db.app) : null;
}
export async function teacherLogin(code: string) {
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
export async function studentLocationInvite(eventId: string, inviteId: string) {
  const db = getDb(), auth = locationAuth();
  if (!db || !auth) throw new Error("위치 공유 설정이 필요합니다.");
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const snapshot = await getDoc(doc(db, "events", eventId, "locationInvites", inviteId));
  if (!snapshot.exists()) throw new Error("사용할 수 없는 위치 공유 링크입니다.");
  return snapshot.data() as { classNo: number; groupNo: number; active: boolean };
}
export async function createLocationInvite(eventId: string, classNo: number, groupNo: number) {
  const db = getDb();
  if (!db) throw new Error("Firebase 설정이 필요합니다.");
  // A teacher can revoke all links for a group without disclosing a capability to public group records.
  const groupId = `${classNo}-${groupNo}`;
  const previous = await getDoc(doc(db, "events", eventId, "locationInviteIndex", groupId));
  if (previous.exists()) await setDoc(doc(db, "events", eventId, "locationInvites", previous.data().inviteId), { active: false }, { merge: true });
  const inviteId = crypto.randomUUID().replace(/-/g, "");
  await setDoc(doc(db, "events", eventId, "locationInvites", inviteId), { classNo, groupNo, active: true });
  await setDoc(doc(db, "events", eventId, "locationInviteIndex", groupId), { inviteId });
  await deleteDoc(doc(db, "events", eventId, "locations", groupId));
  return `${window.location.origin}/?event=${encodeURIComponent(eventId)}&locationInvite=${inviteId}`;
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

export function watchLocation(eventId: string, groupId: string, next: (location: SharedLocation | null) => void, error: () => void) {
  const db = getDb();
  if (!db) throw new Error("Firebase 설정이 필요합니다.");
  return onSnapshot(doc(db, "events", eventId, "locations", groupId), snapshot => {
    next(snapshot.exists() ? snapshot.data() as SharedLocation : null);
  }, error);
}
