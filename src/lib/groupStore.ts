import { initializeApp } from "firebase/app";
import {
  collection,
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
import type { CourseInputPlace, GroupAction, GroupRecord } from "../types";
import { applyGroupAction, reconcileGroupProgress, updateGroupCourse } from "./groupLogic";

const GROUPS_COLLECTION = "groups";
const LOCAL_GROUPS_KEY = "trip-checkin-v4-local-groups";

export interface GroupStore {
  mode: "firebase" | "local";
  getGroup(id: string): Promise<GroupRecord | null>;
  listGroups(): Promise<GroupRecord[]>;
  saveGroup(group: GroupRecord): Promise<void>;
  clearAllGroups(): Promise<void>;
  updateCourse(
    id: string,
    courseInput: {
      beforeGatheringPlaces: CourseInputPlace[];
      afterGatheringPlaces: CourseInputPlace[];
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

function readLocalGroups(): Record<string, GroupRecord> {
  const raw = localStorage.getItem(LOCAL_GROUPS_KEY);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, GroupRecord>;
  } catch {
    return {};
  }
}

function writeLocalGroups(groups: Record<string, GroupRecord>) {
  localStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(groups));
}

function createLocalStore(): GroupStore {
  return {
    mode: "local",
    async getGroup(id) {
      return readLocalGroups()[id] ?? null;
    },
    async listGroups() {
      return Object.values(readLocalGroups());
    },
    async saveGroup(group) {
      const groups = readLocalGroups();
      groups[group.id] = normalizeGroup(group);
      writeLocalGroups(groups);
    },
    async clearAllGroups() {
      localStorage.removeItem(LOCAL_GROUPS_KEY);
    },
    async updateCourse(id, courseInput) {
      const groups = readLocalGroups();
      const current = groups[id];

      if (!current) {
        return null;
      }

      const next = normalizeGroup(updateGroupCourse(normalizeGroup(current), courseInput));
      groups[id] = next;
      writeLocalGroups(groups);
      return next;
    },
    async applyAction(action) {
      const groups = readLocalGroups();
      const current = groups[action.id];

      if (!current) {
        return null;
      }

      const next = normalizeGroup(applyGroupAction(current, action));
      groups[action.id] = next;
      writeLocalGroups(groups);
      return next;
    },
  };
}

function createFirebaseStore(db: Firestore): GroupStore {
  return {
    mode: "firebase",
    async getGroup(id) {
      const snapshot = await getDoc(doc(db, GROUPS_COLLECTION, id));
      return snapshot.exists() ? normalizeGroup(snapshot.data() as GroupRecord) : null;
    },
    async listGroups() {
      const snapshot = await getDocs(collection(db, GROUPS_COLLECTION));
      return snapshot.docs.map((item) => normalizeGroup(item.data() as GroupRecord));
    },
    async saveGroup(group) {
      await setDoc(doc(db, GROUPS_COLLECTION, group.id), normalizeGroup(group));
    },
    async clearAllGroups() {
      const snapshot = await getDocs(collection(db, GROUPS_COLLECTION));
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    },
    async updateCourse(id, courseInput) {
      const ref = doc(db, GROUPS_COLLECTION, id);

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
      const ref = doc(db, GROUPS_COLLECTION, action.id);

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

let cachedStore: GroupStore | null = null;

export function getGroupStore(): GroupStore {
  if (cachedStore) {
    return cachedStore;
  }

  if (!hasFirebaseConfig()) {
    cachedStore = createLocalStore();
    return cachedStore;
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  enableIndexedDbPersistence(db).catch(() => {
    // Persistence can fail in private windows or multiple tabs; normal reads/writes still work.
  });

  cachedStore = createFirebaseStore(db);
  return cachedStore;
}
