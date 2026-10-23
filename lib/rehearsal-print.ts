import {
  REHEARSAL_TYPE_LABELS,
  timestampToTokyoInput,
  type Rehearsal,
  type RehearsalType,
} from "./rehearsals.ts";

const SLOT_MINUTES = 15;
const DEFAULT_START_MINUTES = 12 * 60;
const DEFAULT_END_MINUTES = 19 * 60;

const PRINT_TYPE_ORDER = [
  "acting",
  "japanese_dance",
  "stage_combat",
  "meeting",
  "other",
] as const satisfies readonly RehearsalType[];

const BASIC_PRINT_TYPES = PRINT_TYPE_ORDER.slice(0, 3);

const TYPE_ORDER = new Map<RehearsalType, number>(
  PRINT_TYPE_ORDER.map((type, index) => [type, index])
);

export type RehearsalPrintBar = {
  id: string;
  startTime: string;
  endTime: string | null;
  endsOnAnotherDate: boolean;
  venue: string;
  content: string;
  leftSlot: number;
  slotSpan: number;
  lane: number;
};

export type RehearsalPrintCategory = {
  type: RehearsalType;
  label: string;
  laneCount: number;
  bars: RehearsalPrintBar[];
};

export type RehearsalPrintDay = {
  date: string;
  dateLabel: string;
  categories: RehearsalPrintCategory[];
};

export type RehearsalPrintModel = {
  rehearsalCount: number;
  axisStartMinutes: number;
  axisEndMinutes: number;
  slotMinutes: number;
  slotCount: number;
  hourTicks: Array<{ minutes: number; label: string; offsetSlots: number }>;
  days: RehearsalPrintDay[];
};

export type RehearsalTimelineBarText = {
  primary: string;
  secondary: string | null;
  time: string;
};

export function formatRehearsalTimelineBar(bar: RehearsalPrintBar): RehearsalTimelineBarText {
  const content = bar.content.trim();
  const venue = bar.venue.trim();
  return {
    primary: content || venue || "会場未設定",
    secondary: content && venue ? venue : null,
    time: `${bar.startTime}–${bar.endsOnAnotherDate ? `翌日 ${bar.endTime}` : bar.endTime ?? "終了未設定"}`,
  };
}

type PreparedRehearsal = {
  rehearsal: Rehearsal;
  date: string;
  startTime: string;
  endTime: string | null;
  endsOnAnotherDate: boolean;
  startMinutes: number;
  endMinutes: number | null;
  layoutStartMinutes: number;
  layoutEndMinutes: number;
};

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function floorToSlot(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function ceilToSlot(minutes: number): number {
  return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function dateInTokyo(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function prepareRehearsal(rehearsal: Rehearsal): PreparedRehearsal {
  const start = timestampToTokyoInput(rehearsal.startAt);
  const end = rehearsal.endAt ? timestampToTokyoInput(rehearsal.endAt) : null;
  const startMinutes = timeToMinutes(start.time);
  const endsOnAnotherDate = end !== null && end.date !== start.date;
  const endMinutes = end && !endsOnAnotherDate ? timeToMinutes(end.time) : null;
  const layoutStartMinutes = floorToSlot(startMinutes);
  const layoutEndMinutes = endMinutes === null
    ? layoutStartMinutes + SLOT_MINUTES
    : Math.max(layoutStartMinutes + SLOT_MINUTES, ceilToSlot(endMinutes));

  return {
    rehearsal,
    date: start.date,
    startTime: start.time,
    endTime: end?.time ?? null,
    endsOnAnotherDate,
    startMinutes,
    endMinutes,
    layoutStartMinutes,
    layoutEndMinutes,
  };
}

function assignLanes(items: PreparedRehearsal[], axisStartMinutes: number): RehearsalPrintBar[] {
  const laneEnds: number[] = [];
  return [...items]
    .sort((left, right) => left.layoutStartMinutes - right.layoutStartMinutes
      || left.layoutEndMinutes - right.layoutEndMinutes
      || left.rehearsal.id.localeCompare(right.rehearsal.id))
    .map((item) => {
      let lane = laneEnds.findIndex((endMinutes) => endMinutes <= item.layoutStartMinutes);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.layoutEndMinutes;
      return {
        id: item.rehearsal.id,
        startTime: item.startTime,
        endTime: item.endTime,
        endsOnAnotherDate: item.endsOnAnotherDate,
        venue: item.rehearsal.venue,
        content: item.rehearsal.content,
        leftSlot: (item.layoutStartMinutes - axisStartMinutes) / SLOT_MINUTES,
        slotSpan: (item.layoutEndMinutes - item.layoutStartMinutes) / SLOT_MINUTES,
        lane,
      };
    });
}

export function buildRehearsalPrintModel(rehearsals: Rehearsal[], now = new Date()): RehearsalPrintModel {
  const today = dateInTokyo(now);
  const prepared = rehearsals.map(prepareRehearsal).filter((item) => item.date >= today);
  const earliestStart = prepared.length > 0
    ? Math.min(...prepared.map((item) => item.layoutStartMinutes))
    : DEFAULT_START_MINUTES;
  const latestEnd = prepared.length > 0
    ? Math.max(...prepared.map((item) => item.layoutEndMinutes))
    : DEFAULT_END_MINUTES;
  const axisStartMinutes = Math.floor(Math.min(DEFAULT_START_MINUTES, earliestStart) / 60) * 60;
  const axisEndMinutes = Math.ceil(Math.max(DEFAULT_END_MINUTES, latestEnd) / 60) * 60;
  const slotCount = (axisEndMinutes - axisStartMinutes) / SLOT_MINUTES;

  const grouped = new Map<string, Map<RehearsalType, PreparedRehearsal[]>>();
  for (const item of prepared) {
    const day = grouped.get(item.date) ?? new Map<RehearsalType, PreparedRehearsal[]>();
    const category = day.get(item.rehearsal.type) ?? [];
    category.push(item);
    day.set(item.rehearsal.type, category);
    grouped.set(item.date, day);
  }

  const days = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, categories]) => ({
      date,
      dateLabel: formatDateLabel(date),
      categories: [...new Set<RehearsalType>([...BASIC_PRINT_TYPES, ...categories.keys()])]
        .sort((left, right) => (TYPE_ORDER.get(left) ?? 99) - (TYPE_ORDER.get(right) ?? 99))
        .map((type) => {
          const items = categories.get(type) ?? [];
          const bars = assignLanes(items, axisStartMinutes);
          return {
            type,
            label: REHEARSAL_TYPE_LABELS[type],
            laneCount: Math.max(1, ...bars.map((bar) => bar.lane + 1)),
            bars,
          };
        }),
    }));

  const hourTicks = [];
  for (let minutes = axisStartMinutes; minutes <= axisEndMinutes; minutes += 60) {
    hourTicks.push({
      minutes,
      label: formatMinutes(minutes),
      offsetSlots: (minutes - axisStartMinutes) / SLOT_MINUTES,
    });
  }

  return {
    rehearsalCount: prepared.length,
    axisStartMinutes,
    axisEndMinutes,
    slotMinutes: SLOT_MINUTES,
    slotCount,
    hourTicks,
    days,
  };
}
