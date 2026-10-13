export type PrintItemManagement = {
  enabled?: boolean;
  size?: string;
  sides?: "single" | "double" | "";
  quantity?: number;
  printer?: string;
  submissionPlannedDate?: string;
  submissionDate?: string;
  deliveryPlannedDate?: string;
  deliveryDate?: string;
  printCost?: number;
};

export type FlyerManagement = {
  specifications?: {
    designer?: string;
    surfaceDesign?: string;
    posterUsesFlyerFront?: boolean;
    color?: string;
    dataFormat?: string;
    hasQr?: boolean;
  };
  flyer?: PrintItemManagement;
  poster?: PrintItemManagement;
  information?: {
    informationFinalized?: boolean;
    sponsorInfoReady?: boolean;
    logoMaterialsReady?: boolean;
    proofread?: boolean;
  };
  distribution?: {
    distributionStartDate?: string;
    venue?: boolean;
    facilities?: boolean;
    inserts?: boolean;
    dm?: boolean;
    performers?: boolean;
    other?: string;
    note?: string;
  };
};

export type WebManagement = {
  channels?: {
    website?: boolean;
    x?: boolean;
    instagram?: boolean;
    facebook?: boolean;
    youtube?: boolean;
    other?: string;
  };
  page?: {
    teaserEnabled?: boolean;
    teaserUrl?: string;
    teaserPublishPlannedDate?: string;
    teaserPublishDate?: string;
    performancePageUrl?: string;
    publishPlannedDate?: string;
    publishDate?: string;
    published?: boolean;
    ticketLinkPublished?: boolean;
    accessPublished?: boolean;
    castPublished?: boolean;
    creditsPublished?: boolean;
  };
  announcements?: {
    announcementStartDate?: string;
    ticketSalesAnnouncement?: boolean;
    preShowReminder?: boolean;
  };
  assets?: {
    mainVisual?: boolean;
    flyerImage?: boolean;
    castPhotos?: boolean;
    map?: boolean;
    qr?: boolean;
    promoVideo?: boolean;
    sponsorLogos?: boolean;
  };
  consistency?: {
    performanceInfoCheckedAt?: string;
    note?: string;
  };
  postShow?: {
    postShowReport?: boolean;
    ticketLinkClosed?: boolean;
    performancePageUpdated?: boolean;
    note?: string;
  };
};

export type TicketManagement = {
  capacities?: {
    performanceId: string;
    availableSeats?: number;
  }[];
  methods?: {
    online?: boolean;
    phone?: boolean;
    email?: boolean;
    physical?: boolean;
    other?: string;
    onlineService?: string;
    salesUrl?: string;
  };
  sales?: {
    salesStartDate?: string;
    salesEndDate?: string;
    reservationDeadline?: string;
    onlineDeadline?: string;
    doorTicketAvailable?: boolean;
    seatingType?: "free" | "reserved" | "";
  };
  reservations?: {
    holdsAvailable?: boolean;
    invitationsAvailable?: boolean;
    stakeholderSeatsAvailable?: boolean;
    guestListUsed?: boolean;
    physicalTicketQuantity?: number;
    physicalTicketResponsible?: string;
  };
  handoff?: {
    receptionHandoffConfirmed?: boolean;
    note?: string;
  };
};

export type ReceptionScheduleItem = {
  id: string;
  time?: string;
  content: string;
  responsible?: string;
  note?: string;
};

export type ReceptionStaff = {
  id: string;
  name: string;
  role?: string;
  note?: string;
};

export type CustomChecklistItem = {
  id: string;
  label: string;
  checked?: boolean;
};

export type ReceptionChecklist = {
  receptionList?: boolean;
  guestList?: boolean;
  program?: boolean;
  questionnaire?: boolean;
  stationery?: boolean;
  firstAid?: boolean;
  otherSupplies?: boolean;
  cashFloat?: boolean;
  register?: boolean;
  cashlessReady?: boolean;
  customItems?: CustomChecklistItem[];
};

export type ReceptionManagement = {
  basic?: {
    gatheringTime?: string;
    receptionStartTime?: string;
  };
  staff?: {
    leader?: string;
    members?: ReceptionStaff[];
  };
  operation?: {
    cash?: boolean;
    pos?: boolean;
    cashless?: boolean;
    other?: boolean;
    services?: string;
  };
  preparations?: ReceptionChecklist;
  merchandise?: {
    enabled?: boolean;
    productRegistration?: boolean;
    inventoryRegistration?: boolean;
    salesArea?: boolean;
    pricePop?: boolean;
    delivery?: boolean;
    customItems?: CustomChecklistItem[];
  };
  timetable?: ReceptionScheduleItem[];
  opening?: {
    openingCheckCompleted?: boolean;
    note?: string;
  };
  closingByPerformance?: ReceptionPerformanceClosing[];
  /** 旧形式との読み取り互換用。新UIでは保存しない。 */
  closing?: {
    salesChecked?: boolean;
    cashChecked?: boolean;
    registerClosed?: boolean;
    inventoryChecked?: boolean;
    customItems?: CustomChecklistItem[];
  };
};

export type ReceptionPerformanceClosing = {
  performanceId: string;
  salesChecked?: boolean;
  cashChecked?: boolean;
  registerClosed?: boolean;
  inventoryChecked?: boolean;
  customItems?: CustomChecklistItem[];
};

export type AccountingTaskPhase = "before" | "day" | "after";

export type AccountingTask = {
  id: string;
  label: string;
  phase: AccountingTaskPhase;
  dueDate?: string;
  completed?: boolean;
  completedAt?: string;
  responsible?: string;
  note?: string;
  source?: string;
  custom?: boolean;
};

export type AccountingManagement = {
  tasks?: AccountingTask[];
};

export type ProductionSectionDataMap = {
  flyer: FlyerManagement;
  web: WebManagement;
  tickets: TicketManagement;
  reception: ReceptionManagement;
  accounting: AccountingManagement;
};

export type ManagedProductionSection = keyof ProductionSectionDataMap;

export const PRODUCTION_BLOCKS = {
  flyer: ["specifications", "flyer", "poster", "information", "distribution"],
  web: ["channels", "page", "announcements", "assets", "consistency", "postShow"],
  tickets: ["methods", "sales", "reservations", "handoff"],
  reception: ["basic", "staff", "operation", "preparations", "merchandise", "timetable", "opening", "closingByPerformance"],
  accounting: ["tasks"],
} as const satisfies {
  [Section in ManagedProductionSection]: readonly (keyof ProductionSectionDataMap[Section])[];
};

export function isManagedProductionSection(
  value: unknown
): value is ManagedProductionSection {
  return typeof value === "string" && value in PRODUCTION_BLOCKS;
}

export function isProductionBlock<Section extends ManagedProductionSection>(
  section: Section,
  value: unknown
): value is keyof ProductionSectionDataMap[Section] & string {
  return (
    typeof value === "string" &&
    (PRODUCTION_BLOCKS[section] as readonly string[]).includes(value)
  );
}

type LegacyFlyerManagement = {
  specifications?: FlyerManagement["specifications"] & {
    sides?: string;
    flyerEnabled?: boolean;
    posterEnabled?: boolean;
    flyerSize?: string;
    posterSize?: string;
    quantity?: number;
  };
  progress?: {
    submissionPlannedDate?: string;
    submissionDate?: string;
  };
  print?: {
    printer?: string;
    deliveryPlannedDate?: string;
    deliveryDate?: string;
    printCost?: number;
  };
};

export function normalizeFlyer(data?: FlyerManagement): FlyerManagement {
  const legacy = data as (FlyerManagement & LegacyFlyerManagement) | undefined;
  const specifications = legacy?.specifications;
  const legacyPrint = legacy?.print;
  const legacyProgress = legacy?.progress;
  const sharedLegacy = {
    quantity: specifications?.quantity,
    printer: legacyPrint?.printer,
    submissionPlannedDate: legacyProgress?.submissionPlannedDate,
    submissionDate: legacyProgress?.submissionDate,
    deliveryPlannedDate: legacyPrint?.deliveryPlannedDate,
    deliveryDate: legacyPrint?.deliveryDate,
    printCost: legacyPrint?.printCost,
  };

  return {
    specifications: {
      ...specifications,
      posterUsesFlyerFront: specifications?.posterUsesFlyerFront ?? true,
    },
    flyer: {
      ...sharedLegacy,
      enabled: specifications?.flyerEnabled ?? legacy?.flyer?.enabled ?? false,
      size: specifications?.flyerSize ?? legacy?.flyer?.size,
      sides: legacy?.flyer?.sides ?? (specifications?.sides === "両面" ? "double" : specifications?.sides ? "single" : ""),
      ...legacy?.flyer,
    },
    poster: {
      ...sharedLegacy,
      enabled: specifications?.posterEnabled ?? legacy?.poster?.enabled ?? false,
      size: specifications?.posterSize ?? legacy?.poster?.size,
      sides: legacy?.poster?.sides ?? (specifications?.sides === "両面" ? "double" : specifications?.sides ? "single" : ""),
      ...legacy?.poster,
    },
    information: { ...legacy?.information },
    distribution: { ...legacy?.distribution },
  };
}

export function normalizeWeb(data?: WebManagement): WebManagement {
  return {
    channels: { ...data?.channels },
    page: { ...data?.page },
    announcements: { ...data?.announcements },
    assets: { ...data?.assets },
    consistency: { ...data?.consistency },
    postShow: { ...data?.postShow },
  };
}

export function normalizeTickets(data?: TicketManagement): TicketManagement {
  return {
    capacities: Array.isArray(data?.capacities) ? data.capacities : [],
    methods: { ...data?.methods },
    sales: { ...data?.sales },
    reservations: { ...data?.reservations },
    handoff: { ...data?.handoff },
  };
}

export function getTotalAvailableSeats(
  data: TicketManagement | undefined,
  performanceIds: string[]
): number | undefined {
  if (performanceIds.length === 0) return undefined;
  const capacities = new Map((data?.capacities ?? []).map((item) => [item.performanceId, item.availableSeats]));
  const values = performanceIds.map((id) => capacities.get(id));
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

type LegacyReceptionStaff = {
  receptionLeader?: string;
  audienceGuide?: string;
  merchStaff?: string;
};

export function normalizeReception(data?: ReceptionManagement, performanceIds: string[] = []): ReceptionManagement {
  const rawStaff = data?.staff as ReceptionManagement["staff"] | ReceptionStaff[] | LegacyReceptionStaff | undefined;
  const legacyStaff = !Array.isArray(rawStaff) && rawStaff && !("leader" in rawStaff || "members" in rawStaff)
    ? rawStaff as LegacyReceptionStaff
    : undefined;
  const legacyMembers = Array.isArray(rawStaff)
    ? rawStaff
    : [
        legacyStaff?.receptionLeader
          ? { id: "legacy-reception-leader", name: legacyStaff.receptionLeader, role: "受付責任者" }
          : null,
        legacyStaff?.audienceGuide
          ? { id: "legacy-audience-guide", name: legacyStaff.audienceGuide, role: "客席案内" }
          : null,
        legacyStaff?.merchStaff
          ? { id: "legacy-merch-staff", name: legacyStaff.merchStaff, role: "物販" }
          : null,
      ].filter((item): item is Exclude<typeof item, null> => item !== null);

  const structuredStaff = !Array.isArray(rawStaff) && rawStaff && ("leader" in rawStaff || "members" in rawStaff)
    ? rawStaff as NonNullable<ReceptionManagement["staff"]>
    : undefined;
  const leaderFromArray = Array.isArray(rawStaff)
    ? rawStaff.find((member) => member.role === "受付責任者")?.name
    : undefined;

  const preparations = data?.preparations as (ReceptionChecklist & { catering?: boolean }) | undefined;
  const legacyClosing = data?.closing;
  const closingByPerformance = Array.isArray(data?.closingByPerformance)
    ? data.closingByPerformance
    : performanceIds.map((performanceId) => ({
        performanceId,
        salesChecked: legacyClosing?.salesChecked,
        cashChecked: legacyClosing?.cashChecked,
        registerClosed: legacyClosing?.registerClosed,
        inventoryChecked: legacyClosing?.inventoryChecked,
        customItems: Array.isArray(legacyClosing?.customItems) ? legacyClosing.customItems : [],
      }));

  return {
    basic: { ...data?.basic },
    staff: {
      leader: structuredStaff?.leader ?? legacyStaff?.receptionLeader ?? leaderFromArray,
      members: Array.isArray(structuredStaff?.members) ? structuredStaff.members : legacyMembers.filter((member) => member.role !== "受付責任者"),
    },
    operation: { ...data?.operation },
    preparations: { ...preparations, customItems: Array.isArray(preparations?.customItems) ? preparations.customItems : [] },
    merchandise: { ...data?.merchandise, customItems: Array.isArray(data?.merchandise?.customItems) ? data.merchandise.customItems : [] },
    timetable: Array.isArray(data?.timetable) ? data.timetable : [],
    opening: { ...data?.opening },
    closingByPerformance,
    closing: { ...data?.closing, customItems: Array.isArray(data?.closing?.customItems) ? data.closing.customItems : [] },
  };
}

type LegacyAccountingManagement = {
  tasks?: AccountingTask[];
  budget?: { expectedIncome?: number; expectedExpense?: number; budgetTotal?: number };
  attendance?: { availableSeats?: number; expectedAttendance?: number; expectedPaidAttendance?: number; expectedTicketIncome?: number };
  actuals?: { actualAttendance?: number; actualPaidAttendance?: number; actualTicketIncome?: number; actualIncome?: number; actualExpense?: number; note?: string };
  sales?: { ticketSales?: number };
};

export const STANDARD_ACCOUNTING_TASKS: readonly AccountingTask[] = [
  { id: "standard-participation-fee", label: "参加費徴収", phase: "before" },
  { id: "standard-venue-deposit", label: "会場頭金支払い", phase: "before" },
  { id: "standard-grant-application", label: "助成金申請", phase: "before" },
  { id: "standard-sponsor-payment", label: "協賛金入金確認", phase: "before" },
  { id: "standard-cash-float", label: "釣銭準備", phase: "before" },
  { id: "standard-day-staff-honorarium-prep", label: "当日スタッフ謝礼準備", phase: "before" },
  { id: "standard-day-staff-travel-prep", label: "当日スタッフ交通費準備", phase: "before" },
  { id: "standard-venue-equipment-payment", label: "会場付帯設備費等支払い", phase: "day" },
  { id: "standard-day-staff-travel-payment", label: "当日スタッフ交通費支払い", phase: "day" },
  { id: "standard-day-staff-honorarium-payment", label: "当日スタッフ謝礼支払い", phase: "day" },
  { id: "standard-kickback-calculation", label: "キックバック計算", phase: "after" },
  { id: "standard-kickback-refund", label: "キックバック返金", phase: "after" },
  { id: "standard-unpaid-check", label: "未払金確認", phase: "after" },
  { id: "standard-uncollected-check", label: "未収金確認", phase: "after" },
  { id: "standard-grant-payment", label: "助成金入金確認", phase: "after" },
  { id: "standard-financial-report", label: "決算／収支報告書作成", phase: "after" },
  { id: "standard-grant-report", label: "助成金実績報告", phase: "after" },
  { id: "standard-accounting-close", label: "会計締め", phase: "after" },
] as const;

export function normalizeAccounting(data?: AccountingManagement): AccountingManagement {
  const legacy = data as (AccountingManagement & LegacyAccountingManagement) | undefined;
  const savedTasks = Array.isArray(legacy?.tasks) ? legacy.tasks : [];
  const savedById = new Map(savedTasks.map((task) => [task.id, task]));
  const standardTasks = STANDARD_ACCOUNTING_TASKS.map((task) => ({
    ...task,
    ...savedById.get(task.id),
    id: task.id,
    label: task.label,
    phase: task.phase,
    custom: false,
  }));
  const customTasks = savedTasks.filter((task) => !STANDARD_ACCOUNTING_TASKS.some((standard) => standard.id === task.id));
  return {
    tasks: [...standardTasks, ...customTasks.map((task) => ({ ...task, custom: true }))],
  };
}
