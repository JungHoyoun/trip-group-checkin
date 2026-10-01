import { initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { CourseInputPlace, GroupAction, GroupRecord, LearningEvent, EventInput } from "../types";
import { createClientActionId, applyGroupAction, reconcileGroupProgress, updateGroupCourse } from "./groupLogic";

import { eventStorageKey, validGroup, validateEventInput, validEventId } from "./eventLogic";

const LOCAL_EVENTS_KEY = "trip-checkin-v5-events";

export interface GroupStore {
  mode: "firebase" | "local";
  getGroup(id: string): Promise<GroupRecord | null>;
  listGroups(): Promise<GroupRecord[]>;
  saveGroup(group: GroupRecord): Promise<void>;
  clearAllGroups(): Promise<void>;
  updateCourse(
    id: string,
    courseInput: {
      places: CourseInputPlace[];
    },
  ): Promise<GroupRecord | null>;
  applyAction(action: GroupAction): Promise<GroupRecord | null>;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every((value) => typeof value === "string" && value.trim().length > 0);
}

function normalizeGroup(group: GroupRecord): GroupRecord {
  return reconcileGroupProgress({
    ...group,
    course: group.course.map((place) => ({
      ...place,
      placeId: place.placeId ?? "",
      scheduledTime: place.scheduledTime ?? null,
      requiredCheckpoint: place.requiredCheckpoint ?? null,
    })),
    history: (group.history ?? []).map((entry) => ({
      ...entry,
      placeId: entry.placeId ?? null,
    })),
    lastArrivalAt: group.lastArrivalAt ?? null,
    lastActionAt: group.lastActionAt ?? null,
    updatedAt: group.updatedAt ?? null,
  });
}

function readLocalGroups(key: string): Record<string, GroupRecord> {
  const raw = localStorage.getItem(key);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, GroupRecord>;
  } catch {
    return {};
  }
}

function writeLocalGroups(key: string, groups: Record<string, GroupRecord>) {
  localStorage.setItem(key, JSON.stringify(groups));
}

function createLocalStore(event: LearningEvent): GroupStore {
  const key = eventStorageKey(event.id, "groups");
  return {
    mode: "local",
    async getGroup(id) {
      return readLocalGroups(key)[id] ?? null;
    },
    async listGroups() {
      return Object.values(readLocalGroups(key));
    },
    async saveGroup(group) {
      const groups = readLocalGroups(key);
      groups[group.id] = normalizeGroup(group);
      writeLocalGroups(key, groups);
    },
    async clearAllGroups() {
      localStorage.removeItem(key);
    },
    async updateCourse(id, courseInput) {
      const groups = readLocalGroups(key);
      const current = groups[id];

      if (!current) {
        return null;
      }

      const next = normalizeGroup(updateGroupCourse(normalizeGroup(current), courseInput));
      groups[id] = next;
      writeLocalGroups(key, groups);
      return next;
    },
    async applyAction(action) {
      const groups = readLocalGroups(key);
      const current = groups[action.id];

      if (!current) {
        return null;
      }

      const next = normalizeGroup(applyGroupAction(current, action));
      groups[action.id] = next;
      writeLocalGroups(key, groups);
      return next;
    },
  };
}

function createFirebaseStore(db: Firestore, event: LearningEvent): GroupStore {
  const groups = collection(db, "events", event.id, "groups");
  return {
    mode: "firebase",
    async getGroup(id) {
      const snapshot = await getDoc(doc(groups, id));
      return snapshot.exists() ? normalizeGroup(snapshot.data() as GroupRecord) : null;
    },
    async listGroups() {
      const snapshot = await getDocs(groups);
      return snapshot.docs.map((item) => normalizeGroup(item.data() as GroupRecord));
    },
    async saveGroup(group) {
      await setDoc(doc(groups, group.id), normalizeGroup(group));
    },
    async clearAllGroups() {
      const snapshot = await getDocs(groups);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    },
    async updateCourse(id, courseInput) {
      const ref = doc(groups, id);

      return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref);

        if (!snapshot.exists()) {
          return null;
        }

        const current = normalizeGroup(snapshot.data() as GroupRecord);
        const next = normalizeGroup(updateGroupCourse(current, courseInput));
        transaction.set(ref, next);
        return next;
      });
    },
    async applyAction(action) {
      const ref = doc(groups, action.id);

      return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref);

        if (!snapshot.exists()) {
          return null;
        }

        const current = normalizeGroup(snapshot.data() as GroupRecord);
        const next = normalizeGroup(applyGroupAction(current, action));
        transaction.set(ref, next);
        return next;
      });
    },
  };
}

let cachedDb: Firestore | null = null;
function getDb() {
  if (!hasFirebaseConfig()) return null;
  if (!cachedDb) {
    cachedDb = getFirestore(initializeApp(firebaseConfig));
    const emulatorHost = import.meta.env.DEV ? import.meta.env.VITE_FIRESTORE_EMULATOR_HOST : null;
    if (emulatorHost && firebaseConfig.projectId.startsWith("demo-")) {
      const [host, port] = emulatorHost.split(":");
      connectFirestoreEmulator(cachedDb, host, Number(port));
    } else {
      enableIndexedDbPersistence(cachedDb).catch(() => {});
    }
  }
  return cachedDb;
}

export interface EventStore {
  mode: "firebase" | "local";
  listEvents(): Promise<LearningEvent[]>;
  getEvent(id: string): Promise<LearningEvent | null>;
  createEvent(input: EventInput): Promise<LearningEvent>;
  deleteEvent(id: string): Promise<void>;
  updateEvent(id: string, input: EventInput): Promise<LearningEvent>;
}

function readLocalEvents(): Record<string, LearningEvent> {
  try { return JSON.parse(localStorage.getItem(LOCAL_EVENTS_KEY) ?? "{}"); }
  catch { return {}; }
}

export function getEventStore(): EventStore {
  const db = getDb();
  return {
    mode: db ? "firebase" : "local",
    async listEvents() {
      const events = db ? (await getDocs(collection(db, "events"))).docs.map(item => ({ ...item.data(), id: item.id } as LearningEvent)) : Object.values(readLocalEvents());
      return events.filter(event => !event.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getEvent(id) {
      if (!validEventId(id)) return null;
      if (!db) { const event = readLocalEvents()[id]; return event && !event.deletedAt ? event : null; }
      const snapshot = await getDoc(doc(db, "events", id));
      return snapshot.exists() && !snapshot.data().deletedAt ? { ...snapshot.data(), id: snapshot.id } as LearningEvent : null;
    },
    async updateEvent(id, input) {
      if (!validEventId(id)) throw new Error("행사를 찾을 수 없습니다.");
      const settings = validateEventInput(input);
      const prepare = (current: LearningEvent) => {
        if (current.deletedAt) throw new Error("삭제된 행사입니다.");
        if (current.isExample) throw new Error("예시 체험학습은 보기 전용입니다.");
        if (settings.name !== current.name) throw new Error("행사 이름은 변경할 수 없습니다.");
        return { ...current, ...settings };
      };
      const excludedIds = (current: LearningEvent) => current.classGroupCounts.flatMap((count, index) =>
        Array.from({ length: count }, (_, group) => `${index + 1}-${group + 1}`)
          .filter((_, group) => !validGroup({ ...current, ...settings }, index + 1, group + 1)));
      const protectedRecord = (groupId: string) => {
        const [classNo, groupNo] = groupId.split("-");
        throw new Error(`${classNo}반 ${groupNo}모둠에 기록이 있어 줄일 수 없습니다. 해당 모둠을 포함해 주세요.`);
      };
      if (db) return runTransaction(db, async transaction => {
        const ref = doc(db, "events", id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error("행사를 찾을 수 없습니다.");
        const current = { ...snapshot.data(), id } as LearningEvent;
        const next = prepare(current);
        // Read removed slots in this transaction to protect concurrent student registrations.
        for (const groupId of excludedIds(current)) {
          const group = await transaction.get(doc(db, "events", id, "groups", groupId));
          if (group.exists()) protectedRecord(groupId);
        }
        transaction.update(ref, settings as Partial<LearningEvent>);
        return next;
      });
      const events = readLocalEvents();
      if (!events[id]) throw new Error("행사를 찾을 수 없습니다.");
      const next = prepare(events[id]);
      const groups = readLocalGroups(eventStorageKey(id, "groups"));
      for (const groupId of excludedIds(events[id])) if (groups[groupId]) protectedRecord(groupId);
      events[id] = next;
      localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events));
      return next;
    },
    async deleteEvent(id) {
      if (!validEventId(id)) throw new Error("행사를 찾을 수 없습니다.");
      const markDeleted = (event: LearningEvent) => {
        if (event.isExample) throw new Error("예시 체험학습은 삭제할 수 없습니다.");
        return { ...event, deletedAt: event.deletedAt ?? new Date().toISOString() };
      };
      if (db) {
        await runTransaction(db, async transaction => {
          const ref = doc(db, "events", id);
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists() || snapshot.data().deletedAt) return;
          const event = markDeleted({ ...snapshot.data(), id } as LearningEvent);
          transaction.update(ref, { deletedAt: event.deletedAt });
        });
      } else {
        const events = readLocalEvents();
        if (!events[id]) return;
        events[id] = markDeleted(events[id]);
        localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events));
      }
    },
    async createEvent(input) {
      const event: LearningEvent = { ...validateEventInput(input), id: createClientActionId(), createdAt: new Date().toISOString(), isExample: false };
      if (db) await setDoc(doc(db, "events", event.id), event);
      else localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify({ ...readLocalEvents(), [event.id]: event }));
      return event;
    },
  };
}

export function getGroupStore(event: LearningEvent): GroupStore {
  const db = getDb();
  const store = db ? createFirebaseStore(db, event) : createLocalStore(event);
  const checkId = (id: string) => {
    const [classNo, groupNo] = id.split("-").map(Number);
    if (id !== `${classNo}-${groupNo}` || !validGroup(!db ? readLocalEvents()[event.id] ?? event : event, classNo, groupNo)) throw new Error("행사에 없는 반 또는 모둠입니다.");
  };
  const checkActive = () => { if (event.deletedAt || (!db && readLocalEvents()[event.id]?.deletedAt)) throw new Error("삭제된 행사입니다."); };
  const checkWrite = () => { checkActive(); if (event.isExample) throw new Error("예시 체험학습은 보기 전용입니다."); };
  return {
    mode: store.mode,
    getGroup(id) { checkActive(); checkId(id); return store.getGroup(id); },
    listGroups() { checkActive(); return store.listGroups(); },
    saveGroup(group) { checkWrite(); checkId(group.id); if (group.id !== `${group.classNo}-${group.groupNo}`) throw new Error("모둠 정보가 일치하지 않습니다."); return store.saveGroup(group); },
    clearAllGroups() { checkWrite(); return store.clearAllGroups(); },
    updateCourse(id, input) { checkWrite(); checkId(id); return store.updateCourse(id, input); },
    applyAction(action) { checkWrite(); checkId(action.id); if (action.eventId !== event.id || action.id !== `${action.classNo}-${action.groupNo}`) throw new Error("행사 또는 모둠이 일치하지 않습니다."); return store.applyAction(action); },
  };
}
