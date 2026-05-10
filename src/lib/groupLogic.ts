import type {
  CourseInputPlace,
  CoursePlace,
  DelayState,
  GroupAction,
  GroupRecord,
  GroupStatus,
  HistoryEntry,
  RequiredCheckpoint,
} from "../types";
import { FINAL_PLACE, FIRST_PLACE, REQUIRED_CHECKPOINTS } from "./constants";

const START_PLACE_ID = "fixed-start-1000";
const GATHERING_PLACE_ID = "fixed-asia-culture-center-1400";
const FINAL_PLACE_ID = "fixed-concert-hall-1830";

export function getGroupId(classNo: number, groupNo: number) {
  return `${classNo}-${groupNo}`;
}

export function createClientActionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPlaceId() {
  return `place-${createClientActionId()}`;
}

export function createEmptyCourseInputPlace(): CourseInputPlace {
  return {
    placeId: createPlaceId(),
    name: "",
  };
}

export function cleanMiddlePlaces(places: CourseInputPlace[]) {
  const requiredNames = new Set([FIRST_PLACE, FINAL_PLACE]);
  return places
    .map((place) => ({
      placeId: place.placeId || createPlaceId(),
      name: place.name.trim(),
    }))
    .filter((place) => place.name)
    .filter((place) => !requiredNames.has(place.name));
}

export function createCourse(beforeGatheringPlaces: CourseInputPlace[], afterGatheringPlaces: CourseInputPlace[]): CoursePlace[] {
  const places = [
    {
      placeId: START_PLACE_ID,
      name: FIRST_PLACE,
      scheduledTime: "10:00",
      requiredCheckpoint: null,
    },
    ...cleanMiddlePlaces(beforeGatheringPlaces).map((place) => ({
      placeId: place.placeId,
      name: place.name,
      scheduledTime: null,
      requiredCheckpoint: null,
    })),
    {
      placeId: GATHERING_PLACE_ID,
      name: FIRST_PLACE,
      scheduledTime: "14:00",
      requiredCheckpoint: "asia_culture_center" as RequiredCheckpoint,
    },
    ...cleanMiddlePlaces(afterGatheringPlaces).map((place) => ({
      placeId: place.placeId,
      name: place.name,
      scheduledTime: null,
      requiredCheckpoint: null,
    })),
    {
      placeId: FINAL_PLACE_ID,
      name: FINAL_PLACE,
      scheduledTime: "18:30",
      requiredCheckpoint: "concert_hall" as RequiredCheckpoint,
    },
  ];

  return places.map((place, index) => ({
    placeId: place.placeId,
    order: index + 1,
    name: place.name,
    scheduledTime: place.scheduledTime,
    requiredCheckpoint: place.requiredCheckpoint,
  }));
}

export function createInitialGroup(params: {
  classNo: number;
  groupNo: number;
  leaderName: string;
  beforeGatheringPlaces: CourseInputPlace[];
  afterGatheringPlaces: CourseInputPlace[];
}): GroupRecord {
  const now = new Date().toISOString();

  return {
    id: getGroupId(params.classNo, params.groupNo),
    classNo: params.classNo,
    groupNo: params.groupNo,
    leaderName: params.leaderName.trim(),
    course: createCourse(params.beforeGatheringPlaces, params.afterGatheringPlaces),
    status: "ready",
    currentIndex: 0,
    history: [],
    lastArrivalAt: null,
    lastActionAt: null,
    updatedAt: now,
  };
}

export function updateGroupCourse(
  group: GroupRecord,
  courseInput: {
    beforeGatheringPlaces: CourseInputPlace[];
    afterGatheringPlaces: CourseInputPlace[];
  },
): GroupRecord {
  const nextCourse = createCourse(courseInput.beforeGatheringPlaces, courseInput.afterGatheringPlaces);
  const nextHistory = group.history.map((entry) => {
    const matchedIndex = nextCourse.findIndex((place) => place.placeId === entry.placeId);
    const fallbackIndex = nextCourse.findIndex((place) => place.name === entry.placeName);
    const resolvedIndex = matchedIndex >= 0 ? matchedIndex : fallbackIndex;

    return {
      ...entry,
      placeIndex: resolvedIndex >= 0 ? resolvedIndex : Math.min(entry.placeIndex, nextCourse.length - 1),
    };
  });
  const progress = deriveProgress(nextCourse, nextHistory);

  return {
    ...group,
    course: nextCourse,
    history: nextHistory,
    status: progress.status,
    currentIndex: progress.currentIndex,
    lastArrivalAt: progress.lastArrivalAt,
    updatedAt: new Date().toISOString(),
  };
}

export function getEditablePlacesFromCourse(course: CoursePlace[]) {
  const gatheringIndex = course.findIndex((place) => place.requiredCheckpoint === "asia_culture_center");
  const finalIndex = course.findIndex((place) => place.requiredCheckpoint === "concert_hall");
  const beforeGatheringPlaces = course
    .slice(1, gatheringIndex === -1 ? 1 : gatheringIndex)
    .filter((place) => !place.requiredCheckpoint)
    .map((place) => ({ placeId: place.placeId, name: place.name }));
  const afterGatheringPlaces = course
    .slice(gatheringIndex === -1 ? 1 : gatheringIndex + 1, finalIndex === -1 ? course.length : finalIndex)
    .filter((place) => !place.requiredCheckpoint)
    .map((place) => ({ placeId: place.placeId, name: place.name }));

  return {
    beforeGatheringPlaces: beforeGatheringPlaces.length > 0 ? beforeGatheringPlaces : [createEmptyCourseInputPlace()],
    afterGatheringPlaces: afterGatheringPlaces.length > 0 ? afterGatheringPlaces : [createEmptyCourseInputPlace()],
  };
}

function deriveProgress(course: CoursePlace[], history: HistoryEntry[]) {
  if (history.length === 0) {
    return {
      status: "ready" as GroupStatus,
      currentIndex: 0,
      lastArrivalAt: null,
    };
  }

  const last = history[history.length - 1];
  const lastArrival = [...history].reverse().find((entry) => entry.type === "arrive");

  return {
    status: last.type === "depart" ? ("moving" as GroupStatus) : ("watching" as GroupStatus),
    currentIndex: Math.min(Math.max(last.placeIndex, 0), Math.max(course.length - 1, 0)),
    lastArrivalAt: lastArrival?.at ?? null,
  };
}

export function reconcileGroupProgress(group: GroupRecord): GroupRecord {
  const course = group.course.map((place, index) => ({
    ...place,
    placeId:
      place.placeId ||
      (index === 0
        ? START_PLACE_ID
        : place.requiredCheckpoint === "asia_culture_center"
          ? GATHERING_PLACE_ID
          : place.requiredCheckpoint === "concert_hall"
            ? FINAL_PLACE_ID
            : createPlaceId()),
  }));
  const startsAtAsiaCultureCenter = group.course[0]?.requiredCheckpoint === "asia_culture_center";
  const history = startsAtAsiaCultureCenter
    ? group.history.filter((entry) => entry.placeIndex !== 0)
    : [...group.history];
  const historyWithPlaceIds = history.map((entry) => ({
    ...entry,
    placeId: entry.placeId ?? course[entry.placeIndex]?.placeId ?? null,
  }));
  const progress = deriveProgress(course, historyWithPlaceIds);
  const lastAction = historyWithPlaceIds[historyWithPlaceIds.length - 1] ?? null;

  return {
    ...group,
    course,
    history: historyWithPlaceIds,
    status: progress.status,
    currentIndex: progress.currentIndex,
    lastArrivalAt: progress.lastArrivalAt,
    lastActionAt: lastAction?.at ?? null,
  };
}

export function applyGroupAction(group: GroupRecord, action: GroupAction): GroupRecord {
  if (group.lastActionAt) {
    const lastActionTime = Date.parse(group.lastActionAt);
    const nextActionTime = Date.parse(action.clientAt);

    if (Number.isFinite(lastActionTime) && Number.isFinite(nextActionTime) && nextActionTime < lastActionTime) {
      return group;
    }
  }

  let history = [...group.history];

  if (action.type === "undo") {
    history = history.slice(0, -1);
  }

  if (action.type === "depart") {
    const targetIndex = group.status === "ready" ? 1 : group.status === "watching" ? group.currentIndex + 1 : null;

    if (targetIndex === null || targetIndex >= group.course.length) {
      return group;
    }

    const place = group.course[targetIndex];
    history.push({
      type: "depart",
      placeId: place.placeId,
      placeName: place.name,
      placeIndex: targetIndex,
      at: action.clientAt,
      clientActionId: action.clientActionId,
    });
  }

  if (action.type === "arrive") {
    if (group.status !== "moving") {
      return group;
    }

    const place = group.course[group.currentIndex];
    history.push({
      type: "arrive",
      placeId: place.placeId,
      placeName: place.name,
      placeIndex: group.currentIndex,
      at: action.clientAt,
      clientActionId: action.clientActionId,
    });
  }

  const progress = deriveProgress(group.course, history);

  return {
    ...group,
    history,
    status: progress.status,
    currentIndex: progress.currentIndex,
    lastArrivalAt: progress.lastArrivalAt,
    lastActionAt: action.clientAt,
    updatedAt: new Date().toISOString(),
  };
}

export function getNextAction(group: GroupRecord): {
  type: "depart" | "arrive" | null;
  label: string;
  placeName: string | null;
  disabled: boolean;
} {
  if (group.status === "ready") {
    const firstDestination = group.course[1] ?? group.course[0];

    return {
      type: "depart",
      label: "출발하기",
      placeName: firstDestination?.name ?? null,
      disabled: group.course.length < 2,
    };
  }

  if (group.status === "moving") {
    return {
      type: "arrive",
      label: "도착하기",
      placeName: group.course[group.currentIndex]?.name ?? null,
      disabled: false,
    };
  }

  const nextPlace = group.course[group.currentIndex + 1];

  if (!nextPlace) {
    return {
      type: null,
      label: "모든 코스 완료",
      placeName: null,
      disabled: true,
    };
  }

  return {
    type: "depart",
    label: "출발하기",
    placeName: nextPlace.name,
    disabled: false,
  };
}

export function getCurrentPlaceName(group: GroupRecord) {
  return group.course[group.currentIndex]?.name ?? "-";
}

export function getNextPlaceName(group: GroupRecord) {
  if (group.status === "ready") {
    return group.course[group.currentIndex + 1]?.name ?? null;
  }

  if (group.status === "moving") {
    return group.course[group.currentIndex]?.name ?? null;
  }

  return group.course[group.currentIndex + 1]?.name ?? null;
}

function getKoreaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
  };
}

export function koreaTodayAt(time: string, baseDate = new Date()) {
  const { year, month, day } = getKoreaDateParts(baseDate);
  return new Date(`${year}-${month}-${day}T${time}:00+09:00`);
}

function hasArrivedCheckpoint(group: GroupRecord, checkpoint: RequiredCheckpoint) {
  const checkpointIndex = group.course.findIndex((place) => place.requiredCheckpoint === checkpoint);

  if (checkpointIndex === 0) {
    return true;
  }

  return group.history.some((entry) => {
    const coursePlace = group.course[entry.placeIndex];
    return entry.type === "arrive" && coursePlace?.requiredCheckpoint === checkpoint;
  });
}

export function getDelayState(group: GroupRecord | null, now = new Date()): DelayState {
  if (!group) {
    return { isDelayed: false, labels: [] };
  }

  const delayedLabels = REQUIRED_CHECKPOINTS.filter((checkpoint) => {
    const deadline = koreaTodayAt(checkpoint.deadline, now);
    return now.getTime() > deadline.getTime() && !hasArrivedCheckpoint(group, checkpoint.checkpoint);
  }).map((checkpoint) => checkpoint.label);

  return {
    isDelayed: delayedLabels.length > 0,
    labels: delayedLabels,
  };
}

export function formatTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
