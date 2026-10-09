export type FlyerManagement = {
  specifications?: {
    flyerEnabled?: boolean;
    posterEnabled?: boolean;
    designer?: string;
    flyerSize?: string;
    posterSize?: string;
    sides?: string;
    color?: string;
    quantity?: number;
    dataFormat?: string;
    hasQr?: boolean;
  };
  information?: {
    informationFinalized?: boolean;
    sponsorInfoReady?: boolean;
    logoMaterialsReady?: boolean;
    proofread?: boolean;
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
    deliveryDestination?: string;
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

export type ReceptionManagement = {
  basic?: {
    gatheringTime?: string;
    receptionStartTime?: string;
  };
  staff?: {
    receptionLeader?: string;
    receptionStaffCount?: number;
    audienceGuide?: string;
    merchStaff?: string;
  };
  preparations?: {
    receptionList?: boolean;
    guestList?: boolean;
    cashFloat?: boolean;
    register?: boolean;
    program?: boolean;
    questionnaire?: boolean;
    stationery?: boolean;
    firstAid?: boolean;
    catering?: boolean;
  };
  timetable?: ReceptionScheduleItem[];
  opening?: {
    openingCheckCompleted?: boolean;
    note?: string;
  };
};

export type AccountingItem = {
  id: string;
  category?: string;
  name: string;
  amount?: number;
  deadline?: string;
  paid?: boolean;
  note?: string;
};

export type AccountingManagement = {
  budget?: {
    budgetTotal?: number;
    expectedIncome?: number;
    expectedExpense?: number;
  };
  expenses?: AccountingItem[];
  incomes?: AccountingItem[];
  sales?: {
    ticketSales?: number;
    merchandiseSales?: number;
  };
  closing?: {
    cashSettled?: boolean;
    staffPaymentsCompleted?: boolean;
    closingCompleted?: boolean;
    note?: string;
  };
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
  flyer: ["specifications", "information", "progress", "print", "distribution"],
  web: ["channels", "page", "announcements", "assets", "consistency", "postShow"],
  tickets: ["methods", "sales", "reservations", "handoff"],
  reception: ["basic", "staff", "preparations", "timetable", "opening"],
  accounting: ["budget", "expenses", "incomes", "sales", "closing"],
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

export function normalizeFlyer(data?: FlyerManagement): FlyerManagement {
  return {
    specifications: { ...data?.specifications }, information: { ...data?.information },
    progress: { ...data?.progress }, print: { ...data?.print },
    distribution: { ...data?.distribution },
  };
}

export function normalizeWeb(data?: WebManagement): WebManagement {
  return {
    channels: { ...data?.channels }, page: { ...data?.page },
    announcements: { ...data?.announcements }, assets: { ...data?.assets },
    consistency: { ...data?.consistency }, postShow: { ...data?.postShow },
  };
}

export function normalizeTickets(data?: TicketManagement): TicketManagement {
  return {
    methods: { ...data?.methods }, sales: { ...data?.sales },
    reservations: { ...data?.reservations }, handoff: { ...data?.handoff },
  };
}

export function normalizeReception(data?: ReceptionManagement): ReceptionManagement {
  return {
    basic: { ...data?.basic }, staff: { ...data?.staff },
    preparations: { ...data?.preparations },
    timetable: Array.isArray(data?.timetable) ? data.timetable : [],
    opening: { ...data?.opening },
  };
}

export function normalizeAccounting(data?: AccountingManagement): AccountingManagement {
  return {
    budget: { ...data?.budget },
    expenses: Array.isArray(data?.expenses) ? data.expenses : [],
    incomes: Array.isArray(data?.incomes) ? data.incomes : [],
    sales: { ...data?.sales }, closing: { ...data?.closing },
  };
}
