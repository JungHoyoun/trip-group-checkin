import type {
  CourseInputPlace,
  CoursePlace,
  GroupAction,
  GroupRecord,
  GroupStatus,
  HistoryEntry,
} from "../types";

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

export function parseCoursePlaceInput(input: string): { name: string; scheduledTime: string | null } {
  const value = input.trim();
  const match = value.match(/^([+-]?\d+)\s*[:：]\s*(\d*)(.*)$/u);
  if (!match) {
    return { name: value, scheduledTime: null };
  }

  const [, hourText, minuteText, remainder] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!/^\d{1,2}$/u.test(hourText) || !/^\d{1,2}$/u.test(minuteText) || hour > 23 || minute > 59) {
    throw new Error("시간은 00:00~23:59 범위로 입력해 주세요. 예: 10:30 광장");
  }
  if (/^[:：]/u.test(remainder.trimStart())) {
    throw new Error("초 단위 없이 시:분으로 입력해 주세요. 예: 10:30 광장");
  }
  const name = remainder.replace(/^[\s\/|–—-]+/u, "").trim();
  if (!name) {
    throw new Error("시간 뒤에 장소 이름을 입력해 주세요. 예: 10:30 광장");
  }
  if (/^\d+\s*[:：]/u.test(name)) {
    throw new Error("시간은 한 개만 입력하고 그 뒤에 장소를 적어 주세요. 예: 10:30 광장");
  }
  return {
    name,
    scheduledTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function createCourse(places: CourseInputPlace[]): CoursePlace[] {
  return places
    .map((place, index) => {
      try {
        return { placeId: place.placeId || createPlaceId(), ...parseCoursePlaceInput(place.name) };
      } catch (error) {
        throw new Error(`${index + 1}번째 입력: ${error instanceof Error ? error.message : "입력을 확인해 주세요."}`);
      }
    })
    .filter((place) => place.name)
    .map((place, index) => ({
      ...place,
      order: index + 1,
      requiredCheckpoint: null,
    }));
}

export function createInitialGroup(params: {
  classNo: number;
  groupNo: number;
  leaderName: string;
  places: CourseInputPlace[];
}): GroupRecord {
  const now = new Date().toISOString();

  return {
    id: getGroupId(params.classNo, params.groupNo),
    classNo: params.classNo,
    groupNo: params.groupNo,
    leaderName: params.leaderName.trim(),
    course: createCourse(params.places),
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
    places: CourseInputPlace[];
  },
): GroupRecord {
  const nextCourse = createCourse(courseInput.places);
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
  return course.map((place) => ({
    placeId: place.placeId,
    name: place.scheduledTime ? `${place.scheduledTime} ${place.name}` : place.name,
  }));
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
  const course = group.course.map((place) => ({
    ...place,
    placeId: place.placeId || createPlaceId(),
    scheduledTime: place.scheduledTime ?? null,
    requiredCheckpoint: null,
  }));
  const history = [...group.history];
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
  if (group.lastClientActionId === action.clientActionId || group.history.some(entry => entry.clientActionId === action.clientActionId)) return group;
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
    lastClientActionId: action.clientActionId,
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
