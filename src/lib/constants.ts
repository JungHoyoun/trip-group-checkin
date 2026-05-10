import type { RequiredCheckpoint } from "../types";

export const APP_NAME = "수학여행 모둠 체크인";

export const FIRST_PLACE = "아시아 문화전당";
export const FINAL_PLACE = "공연장";

export const REQUIRED_CHECKPOINTS: Array<{
  checkpoint: RequiredCheckpoint;
  placeName: string;
  deadline: string;
  label: string;
}> = [
  {
    checkpoint: "asia_culture_center",
    placeName: FIRST_PLACE,
    deadline: "14:00",
    label: "14:00 아시아 문화전당",
  },
  {
    checkpoint: "concert_hall",
    placeName: FINAL_PLACE,
    deadline: "18:30",
    label: "18:30 공연장",
  },
];

export const STATUS_LABELS = {
  ready: "출발 전",
  moving: "이동중",
  watching: "관람중",
} as const;

export const CLASS_NUMBERS = [1, 2, 3, 4, 5] as const;
export const GROUP_NUMBERS = [1, 2, 3, 4] as const;
