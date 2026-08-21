import type { Trip } from "./queries";

export const TRANSPORT_MODE_VALUES = [
  "train",
  "flight",
  "drive",
  "other",
] as const;

export const TRANSPORT_MODE_LABELS = {
  train: "动车",
  flight: "飞机",
  drive: "驾车",
  other: "其他",
} as const satisfies Record<Trip["transportMode"], string>;
