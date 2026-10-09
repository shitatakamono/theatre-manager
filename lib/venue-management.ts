export type VenueDocument = {
  id: string;
  name: string;
  deadline?: string;
  submitted?: boolean;
  note?: string;
};

export type VenueRegisteredPerformance = {
  checkedAt?: string;
  needsUpdate?: boolean;
  note?: string;
};

export type VenueMaterials = {
  flyerSubmitted?: boolean;
  posterSubmitted?: boolean;
  publicityRequested?: boolean;
  note?: string;
};

export type VenueMeeting = {
  plannedDate?: string;
  completedDate?: string;
  troupeParticipants?: string;
  loadInOut?: string;
  audienceCapacity?: string;
  receptionLocation?: string;
  doorTicket?: string;
  dressingRoom?: string;
  merchLocation?: string;
  foodDrink?: string;
  parking?: string;
  garbage?: string;
  restoration?: string;
  prohibitedItems?: string;
  technicalOverview?: string;
  timetableConfirmed?: boolean;
  note?: string;
};

export type VenueManagement = {
  useStartDate?: string;
  useEndDate?: string;
  useStartTime?: string;
  useEndTime?: string;
  applicationDate?: string;
  venueFee?: number;
  paymentDeadline?: string;
  paymentPaid?: boolean;
  venueContactName?: string;
  venueContact?: string;
  reservationNumber?: string;
  note?: string;
  registeredPerformance?: VenueRegisteredPerformance;
  materials?: VenueMaterials;
  meeting?: VenueMeeting;
  documents?: VenueDocument[];
};

export type ProductionManagement = {
  venue?: VenueManagement;
};

export const VENUE_CONTRACT_FIELDS = [
  "useStartDate",
  "useEndDate",
  "useStartTime",
  "useEndTime",
  "applicationDate",
  "venueFee",
  "paymentDeadline",
  "paymentPaid",
  "venueContactName",
  "venueContact",
  "reservationNumber",
  "note",
] as const satisfies readonly (keyof VenueManagement)[];

export type VenueContractField = (typeof VENUE_CONTRACT_FIELDS)[number];
export type VenueContract = Pick<VenueManagement, VenueContractField>;

export type VenueManagementSection =
  | "contract"
  | "registeredPerformance"
  | "materials"
  | "meeting"
  | "documents";

export type VenueManagementSectionMap = {
  contract: VenueContract;
  registeredPerformance: VenueRegisteredPerformance;
  materials: VenueMaterials;
  meeting: VenueMeeting;
  documents: VenueDocument[];
};

const venueManagementSections: VenueManagementSection[] = [
  "contract",
  "registeredPerformance",
  "materials",
  "meeting",
  "documents",
];

export function isVenueManagementSection(
  value: unknown
): value is VenueManagementSection {
  return (
    typeof value === "string" &&
    venueManagementSections.includes(value as VenueManagementSection)
  );
}

export function normalizeVenueManagement(
  data?: VenueManagement
): VenueManagement {
  return {
    ...data,
    paymentPaid: data?.paymentPaid ?? false,
    registeredPerformance: {
      ...data?.registeredPerformance,
      needsUpdate: data?.registeredPerformance?.needsUpdate ?? false,
    },
    materials: {
      ...data?.materials,
      flyerSubmitted: data?.materials?.flyerSubmitted ?? false,
      posterSubmitted: data?.materials?.posterSubmitted ?? false,
      publicityRequested: data?.materials?.publicityRequested ?? false,
    },
    meeting: {
      ...data?.meeting,
      timetableConfirmed: data?.meeting?.timetableConfirmed ?? false,
    },
    documents: Array.isArray(data?.documents) ? data.documents : [],
  };
}
