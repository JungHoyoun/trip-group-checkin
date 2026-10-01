import type { EventInput, LearningEvent } from "../types";

export function numbers(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function validateEventInput(input: EventInput): EventInput {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("행사 이름을 1~80자로 입력해 주세요.");
  if (!Array.isArray(input.classGroupCounts) || input.classGroupCounts.length < 1 || input.classGroupCounts.length > 30 ||
      input.classGroupCounts.some(count => !Number.isInteger(count) || count < 1 || count > 30)) {
    throw new Error("반 수와 모둠 수는 1~30의 정수로 입력해 주세요.");
  }
  if (input.defaultGroupCount !== undefined && (!Number.isInteger(input.defaultGroupCount) || input.defaultGroupCount < 1 || input.defaultGroupCount > 30)) throw new Error("기본 모둠 수는 1~30의 정수로 입력해 주세요.");
  return { name, classGroupCounts: [...input.classGroupCounts], ...(input.defaultGroupCount === undefined ? {} : { defaultGroupCount: input.defaultGroupCount }) };
}

export function validGroup(event: LearningEvent, classNo: number, groupNo: number) {
  return Number.isInteger(classNo) && Number.isInteger(groupNo) && classNo >= 1 &&
    classNo <= event.classGroupCounts.length && groupNo >= 1 && groupNo <= event.classGroupCounts[classNo - 1];
}

export function eventStorageKey(eventId: string, suffix: string) {
  return `trip-checkin-v5-${eventId}-${suffix}`;
}

export function validEventId(id: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}
