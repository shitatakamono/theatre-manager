import type { PerformanceShow } from "./performance";
import {
  normalizeAccounting,
  normalizeFlyer,
  normalizeReception,
  normalizeTickets,
  normalizeWeb,
  type AccountingManagement,
  type AccountingTaskPhase,
  type FlyerManagement,
  type ReceptionManagement,
  type TicketManagement,
  type WebManagement,
} from "./production-management";
import {
  normalizeVenueManagement,
  type SubmissionStatus,
  type VenueManagement,
} from "./venue-management";

export type SectionProgress = {
  completed: number;
  total: number;
  percentage: number;
};

type ProgressItem = boolean;

const BASIC_PREPARATION_KEYS = [
  "receptionList",
  "guestList",
  "program",
  "questionnaire",
  "stationery",
  "firstAid",
  "otherSupplies",
] as const;

const MERCHANDISE_KEYS = [
  "productRegistration",
  "inventoryRegistration",
  "salesArea",
  "pricePop",
  "delivery",
] as const;

function progress(items: ProgressItem[]): SectionProgress {
  const total = items.length;
  const completed = items.filter(Boolean).length;
  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

function isSubmissionComplete(status?: SubmissionStatus): boolean {
  return status === "not-required" || status === "submitted";
}

export function getVenueProgress(data?: VenueManagement): SectionProgress {
  const venue = normalizeVenueManagement(data);
  const meeting = venue.meeting;
  const items: ProgressItem[] = [
    hasText(venue.useStartAt),
    hasText(venue.useEndAt),
    meeting?.adjustmentStatus === "confirmed",
    hasText(meeting?.completedDate),
    isSubmissionComplete(meeting?.audio?.equipmentApplication),
    isSubmissionComplete(meeting?.audio?.setupPlan),
    isSubmissionComplete(meeting?.lighting?.equipmentApplication),
    isSubmissionComplete(meeting?.lighting?.setupPlan),
    isSubmissionComplete(meeting?.video?.equipmentApplication),
    isSubmissionComplete(meeting?.video?.setupPlan),
    venue.registeredPerformance?.finalized === true,
  ];

  if ((venue.documents ?? []).length > 0) {
    items.push(venue.documents?.every((document) => document.submitted) === true);
  }
  if (data?.reductionStatus !== undefined) {
    items.push(
      data.reductionStatus === "not-applicable" ||
        data.reductionStatus === "approved" ||
        data.reductionStatus === "rejected"
    );
  }

  return progress(items);
}

export function getFlyerProgress(data?: FlyerManagement): SectionProgress {
  const flyer = normalizeFlyer(data);
  const flyerEnabled = flyer.flyer?.enabled === true;
  const posterEnabled = flyer.poster?.enabled === true;
  if (!flyerEnabled && !posterEnabled) return progress([]);

  const items: ProgressItem[] = [
    hasText(flyer.specifications?.designer),
    flyer.information?.informationFinalized === true,
    flyer.information?.sponsorInfoReady === true,
    flyer.information?.proofread === true,
  ];
  if (flyerEnabled) {
    items.push(
      hasText(flyer.flyer?.submissionDate),
      hasText(flyer.flyer?.deliveryDate)
    );
  }
  if (posterEnabled) {
    items.push(
      hasText(flyer.poster?.submissionDate),
      hasText(flyer.poster?.deliveryDate)
    );
  }
  return progress(items);
}

export function getWebProgress(
  data: WebManagement | undefined,
  today: Date,
  lastPerformanceDate: Date | null
): SectionProgress {
  const web = normalizeWeb(data);
  const channels = web.channels;
  const channelSelected = Boolean(
    channels?.website ||
      channels?.x ||
      channels?.instagram ||
      channels?.facebook ||
      channels?.youtube ||
      hasText(channels?.other)
  );
  const items: ProgressItem[] = [
    channelSelected,
    web.page?.published === true,
    web.page?.ticketLinkPublished === true,
    web.page?.accessPublished === true,
    web.page?.castPublished === true,
    web.page?.creditsPublished === true,
    hasText(web.announcements?.announcementStartDate),
  ];

  if (web.page?.teaserEnabled) {
    items.push(hasText(web.page.teaserPublishDate));
  }
  if (lastPerformanceDate && today.getTime() > lastPerformanceDate.getTime()) {
    items.push(web.postShow?.postShowReport === true);
  }
  return progress(items);
}

export function getTicketProgress(data?: TicketManagement): SectionProgress {
  const tickets = normalizeTickets(data);
  const methods = tickets.methods;
  const methodSelected = Boolean(
    methods?.online ||
      methods?.phone ||
      methods?.email ||
      methods?.physical ||
      hasText(methods?.other)
  );
  return progress([
    methodSelected,
    hasText(tickets.sales?.salesStartDate),
    hasText(tickets.sales?.salesEndDate) ||
      hasText(tickets.sales?.reservationDeadline),
    Boolean(tickets.sales?.seatingType),
    tickets.sales?.doorTicketAvailable !== undefined,
    tickets.handoff?.receptionHandoffConfirmed === true,
  ]);
}

function allChecked(values: (boolean | undefined)[]): boolean {
  return values.length > 0 && values.every((value) => value === true);
}

function parseShowDate(show: PerformanceShow): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(show.date)) return null;
  const date = new Date(`${show.date}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getReceptionProgress(
  data: ReceptionManagement | undefined,
  shows: PerformanceShow[],
  today: Date
): SectionProgress {
  const reception = normalizeReception(data, shows.map((show) => show.id));
  const operation = reception.operation;
  const preparationValues = BASIC_PREPARATION_KEYS.map(
    (key) => reception.preparations?.[key]
  );
  if (operation?.pos) preparationValues.push(reception.preparations?.register);
  if (operation?.cashless) {
    preparationValues.push(reception.preparations?.cashlessReady);
  }
  preparationValues.push(
    ...(reception.preparations?.customItems ?? []).map((item) => item.checked)
  );

  const items: ProgressItem[] = [
    hasText(reception.staff?.leader),
    (reception.staff?.members ?? []).some((member) => hasText(member.name)),
    Boolean(operation?.cash || operation?.pos || operation?.cashless || operation?.other),
    allChecked(preparationValues),
    (reception.timetable ?? []).some((item) => hasText(item.content)),
    reception.opening?.openingCheckCompleted === true,
  ];

  if (reception.merchandise?.enabled) {
    items.push(
      allChecked([
        ...MERCHANDISE_KEYS.map((key) => reception.merchandise?.[key]),
        ...(reception.merchandise.customItems ?? []).map((item) => item.checked),
      ])
    );
  }

  for (const show of shows) {
    const showDate = parseShowDate(show);
    if (!showDate || today.getTime() <= showDate.getTime()) continue;
    const closing = reception.closingByPerformance?.find(
      (item) => item.performanceId === show.id
    );
    const closingItems = [closing?.salesChecked];
    if (operation?.cash) closingItems.push(closing?.cashChecked);
    if (operation?.pos || operation?.cashless) {
      closingItems.push(closing?.registerClosed);
    }
    if (reception.merchandise?.enabled) {
      closingItems.push(closing?.inventoryChecked);
    }
    closingItems.push(...(closing?.customItems ?? []).map((item) => item.checked));
    items.push(allChecked(closingItems));
  }

  return progress(items);
}

function accountingPhases(
  today: Date,
  firstDate: Date | null,
  lastDate: Date | null
): AccountingTaskPhase[] {
  if (!firstDate || today.getTime() < firstDate.getTime()) return ["before"];
  if (!lastDate || today.getTime() <= lastDate.getTime()) {
    return ["before", "day"];
  }
  return ["before", "day", "after"];
}

export function getAccountingProgress(
  data: AccountingManagement | undefined,
  today: Date,
  firstDate: Date | null,
  lastDate: Date | null
): SectionProgress {
  const phases = new Set(accountingPhases(today, firstDate, lastDate));
  const tasks = (normalizeAccounting(data).tasks ?? []).filter((task) =>
    phases.has(task.phase)
  );
  return progress(tasks.map((task) => task.completed === true));
}
