export type PerformanceInfo = {
  performanceName?: string;
  title?: string;
  subtitle?: string;
  organizer?: string;
  coOrganizer?: string;
  support?: string;
  durationMinutes?: number;
  seatsPerPerformance?: number;
  /** @deprecated 旧データの読み取り互換用。新規保存では使用しない。 */
  totalSeats?: number;
  hasIntermission: boolean;
  intermissionMinutes?: number;
  ageRestriction?: string;
  notice?: string;
  synopsis?: string;
};

export type VenueInfo = {
  name?: string;
  hall?: string;
  address?: string;
  url?: string;
  access?: string;
};

export type PerformanceShow = {
  id: string;
  date: string;
  openTime?: string;
  startTime?: string;
  endTimeOverride?: string;
  note?: string;
};

export type TicketInfo = {
  isPaid: boolean;
  advanceGeneral?: number;
  advanceStudent?: number;
  doorGeneral?: number;
  doorStudent?: number;
  note?: string;
};

export type CastMember = {
  id: string;
  personId?: string;
  order: number;
  name: string;
  affiliation?: string;
  role?: string;
  displayName?: string;
};

export type StaffMember = {
  id: string;
  personId?: string;
  name: string;
  creditName?: string;
};

export type StaffRole = {
  id: string;
  role: string;
  members: StaffMember[];
};

export type ContactInfo = {
  name?: string;
  phone?: string;
  email?: string;
  website?: string;
  x?: string;
  instagram?: string;
  other?: string;
};

export type CreditType =
  | "support"
  | "sponsor"
  | "cooperation"
  | "grant"
  | "other";

export type CreditInfo = {
  id: string;
  type: CreditType;
  name: string;
  displayName?: string;
  hasLogo: boolean;
  note?: string;
};

export type ProjectPerformanceData = {
  performanceInfo?: PerformanceInfo;
  venue?: VenueInfo;
  performances?: PerformanceShow[];
  tickets?: TicketInfo;
  cast?: CastMember[];
  staff?: StaffRole[];
  contact?: ContactInfo;
  credits?: CreditInfo[];
};

export type PerformanceSection = keyof ProjectPerformanceData;

export type PerformanceSectionMap = Required<ProjectPerformanceData>;

export const PERFORMANCE_SECTIONS: PerformanceSection[] = [
  "performanceInfo",
  "venue",
  "performances",
  "tickets",
  "cast",
  "staff",
  "contact",
  "credits",
];

export function isPerformanceSection(value: unknown): value is PerformanceSection {
  return (
    typeof value === "string" &&
    PERFORMANCE_SECTIONS.includes(value as PerformanceSection)
  );
}

export function calculateEndTime(
  startTime?: string,
  durationMinutes?: number
): string | undefined {
  if (!startTime || !durationMinutes || durationMinutes <= 0) return undefined;

  const [hours, minutes] = startTime.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined;

  const totalMinutes = (hours * 60 + minutes + durationMinutes) % (24 * 60);
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;

  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

export function formatPerformanceDate(date: string): string {
  if (!date) return "日付未設定";

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
}

export function resolveSeatsPerPerformance(
  performanceInfo: PerformanceInfo | undefined,
  performanceCount: number
): number | undefined {
  const seatsPerPerformance = performanceInfo?.seatsPerPerformance;
  if (
    seatsPerPerformance !== undefined &&
    Number.isFinite(seatsPerPerformance) &&
    seatsPerPerformance >= 0
  ) {
    return seatsPerPerformance;
  }

  const legacyTotalSeats = performanceInfo?.totalSeats;
  if (
    legacyTotalSeats === undefined ||
    !Number.isFinite(legacyTotalSeats) ||
    legacyTotalSeats < 0 ||
    performanceCount <= 0
  ) {
    return undefined;
  }

  const legacySeatsPerPerformance = legacyTotalSeats / performanceCount;
  return Number.isInteger(legacySeatsPerPerformance)
    ? legacySeatsPerPerformance
    : undefined;
}

export function calculateTotalSeats(
  performanceInfo: PerformanceInfo | undefined,
  performanceCount: number
): number | undefined {
  if (performanceCount <= 0) return undefined;

  const seatsPerPerformance = resolveSeatsPerPerformance(
    performanceInfo,
    performanceCount
  );
  return seatsPerPerformance === undefined
    ? undefined
    : seatsPerPerformance * performanceCount;
}

export function normalizePerformanceData(
  data: ProjectPerformanceData
): ProjectPerformanceData {
  const performances = Array.isArray(data.performances) ? data.performances : [];

  return {
    performanceInfo: {
      ...data.performanceInfo,
      seatsPerPerformance: resolveSeatsPerPerformance(
        data.performanceInfo,
        performances.length
      ),
      hasIntermission: data.performanceInfo?.hasIntermission ?? false,
    },
    venue: data.venue ?? {},
    performances,
    tickets: {
      ...data.tickets,
      isPaid: data.tickets?.isPaid ?? false,
    },
    cast: Array.isArray(data.cast) ? data.cast : [],
    staff: Array.isArray(data.staff) ? data.staff : [],
    contact: data.contact ?? {},
    credits: Array.isArray(data.credits) ? data.credits : [],
  };
}

export function pickPerformanceData(
  source: ProjectPerformanceData
): ProjectPerformanceData {
  const result: ProjectPerformanceData = {};

  for (const section of PERFORMANCE_SECTIONS) {
    if (source[section] !== undefined) {
      Object.assign(result, { [section]: source[section] });
    }
  }

  return result;
}
