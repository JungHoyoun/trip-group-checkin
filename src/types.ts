export type RequiredCheckpoint = "asia_culture_center" | "concert_hall";

export type GroupStatus = "ready" | "moving" | "watching";

export type HistoryType = "depart" | "arrive";

export type ActionType = HistoryType | "undo";

export interface CoursePlace {
  placeId: string;
  order: number;
  name: string;
  scheduledTime: string | null;
  requiredCheckpoint: RequiredCheckpoint | null;
}

export interface CourseInputPlace {
  placeId: string;
  name: string;
}

export interface HistoryEntry {
  type: HistoryType;
  placeId: string | null;
  placeName: string;
  placeIndex: number;
  at: string;
  clientActionId: string;
}

export interface GroupRecord {
  id: string;
  classNo: number;
  groupNo: number;
  leaderName: string;
  course: CoursePlace[];
  status: GroupStatus;
  currentIndex: number;
  history: HistoryEntry[];
  lastArrivalAt: string | null;
  lastActionAt: string | null;
  lastClientActionId?: string | null;
  updatedAt: string | null;
}

export interface GroupAction {
  eventId: string;
  id: string;
  classNo: number;
  groupNo: number;
  type: ActionType;
  clientActionId: string;
  clientAt: string;
}

export interface LearningEvent {
  id: string;
  name: string;
  classGroupCounts: number[];
  createdAt: string;
  isExample: boolean;
}

export interface EventInput {
  name: string;
  classGroupCounts: number[];
}
