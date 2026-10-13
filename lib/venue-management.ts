import type {
  AccountingManagement,
  FlyerManagement,
  ReceptionManagement,
  TicketManagement,
  WebManagement,
} from "./production-management";

export type VenueDocument = {
  id: string;
  name: string;
  deadline?: string;
  submitted?: boolean;
  note?: string;
};

export type VenueRegisteredPerformance = {
  finalized?: boolean;
  finalizedAt?: string;
  note?: string;
};

export type VenueMaterials = {
  flyerSubmitted?: boolean;
  posterSubmitted?: boolean;
  publicityRequested?: boolean;
  note?: string;
};

export type ApplicationStatus = "not-required" | "not-applied" | "applied" | "approved";
export type SubmissionStatus = "not-required" | "not-submitted" | "submitted";
export type AdjustmentStatus = "not-started" | "adjusting" | "confirmed";
export type ReductionStatus = "not-applicable" | "not-applied" | "applied" | "approved" | "rejected";

export type VenueLogistics = {
  dateTime?: string;
  vehicleType?: string;
  vehicleCount?: number;
  note?: string;
};

export type VenueTechnicalSubmission = {
  equipment?: string;
  equipmentApplication?: SubmissionStatus;
  setupPlan?: SubmissionStatus;
};

export type VenueMeeting = {
  adjustmentStatus?: AdjustmentStatus;
  plannedDate?: string;
  completedDate?: string;
  troupeParticipants?: string;
  loadIn?: VenueLogistics;
  loadOut?: VenueLogistics;
  merchandiseApplication?: ApplicationStatus;
  parkingApplication?: ApplicationStatus;
  audio?: VenueTechnicalSubmission;
  lighting?: VenueTechnicalSubmission;
  video?: VenueTechnicalSubmission;
  /** 旧形式との読み取り互換用 */
  audioApplication?: ApplicationStatus;
  lightingApplication?: ApplicationStatus;
  videoApplication?: ApplicationStatus;
  note?: string;
};

export type VenueManagement = {
  useStartAt?: string;
  useEndAt?: string;
  venueContactName?: string;
  venueContact?: string;
  reservationNumber?: string;
  reductionStatus?: ReductionStatus;
  note?: string;
  registeredPerformance?: VenueRegisteredPerformance;
  materials?: VenueMaterials;
  meeting?: VenueMeeting;
  documents?: VenueDocument[];
};

export type ProductionManagement = {
  venue?: VenueManagement;
  flyer?: FlyerManagement;
  web?: WebManagement;
  tickets?: TicketManagement;
  reception?: ReceptionManagement;
  accounting?: AccountingManagement;
};

export const VENUE_CONTRACT_FIELDS = [
  "useStartAt",
  "useEndAt",
  "venueContactName",
  "venueContact",
  "reservationNumber",
  "reductionStatus",
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
  const legacy = data as (VenueManagement & {
    useStartDate?: string;
    useEndDate?: string;
    useStartTime?: string;
    useEndTime?: string;
    registeredPerformance?: VenueRegisteredPerformance & {
      checkedAt?: string;
      needsUpdate?: boolean;
    };
    meeting?: VenueMeeting & {
      loadInOut?: string;
    };
  }) | undefined;

  const toSubmissionStatus = (value?: ApplicationStatus): SubmissionStatus =>
    value === "not-required"
      ? "not-required"
      : value === "applied" || value === "approved"
        ? "submitted"
        : "not-submitted";

  return {
    ...data,
    useStartAt:
      data?.useStartAt ??
      (legacy?.useStartDate
        ? `${legacy.useStartDate}T${legacy.useStartTime || "00:00"}`
        : undefined),
    useEndAt:
      data?.useEndAt ??
      (legacy?.useEndDate
        ? `${legacy.useEndDate}T${legacy.useEndTime || "00:00"}`
        : undefined),
    reductionStatus: data?.reductionStatus ?? "not-applicable",
    registeredPerformance: {
      ...data?.registeredPerformance,
      finalized: data?.registeredPerformance?.finalized ?? false,
    },
    materials: {
      ...data?.materials,
      flyerSubmitted: data?.materials?.flyerSubmitted ?? false,
      posterSubmitted: data?.materials?.posterSubmitted ?? false,
      publicityRequested: data?.materials?.publicityRequested ?? false,
    },
    meeting: {
      ...data?.meeting,
      adjustmentStatus: data?.meeting?.adjustmentStatus ?? "not-started",
      loadIn: data?.meeting?.loadIn ??
        (legacy?.meeting?.loadInOut ? { note: legacy.meeting.loadInOut } : {}),
      loadOut: data?.meeting?.loadOut ?? {},
      merchandiseApplication: data?.meeting?.merchandiseApplication ?? "not-required",
      parkingApplication: data?.meeting?.parkingApplication ?? "not-required",
      audio: {
        ...data?.meeting?.audio,
        equipmentApplication: data?.meeting?.audio?.equipmentApplication ?? toSubmissionStatus(data?.meeting?.audioApplication),
        setupPlan: data?.meeting?.audio?.setupPlan ?? "not-submitted",
      },
      lighting: {
        ...data?.meeting?.lighting,
        equipmentApplication: data?.meeting?.lighting?.equipmentApplication ?? toSubmissionStatus(data?.meeting?.lightingApplication),
        setupPlan: data?.meeting?.lighting?.setupPlan ?? "not-submitted",
      },
      video: {
        ...data?.meeting?.video,
        equipmentApplication: data?.meeting?.video?.equipmentApplication ?? toSubmissionStatus(data?.meeting?.videoApplication),
        setupPlan: data?.meeting?.video?.setupPlan ?? "not-submitted",
      },
    },
    documents: Array.isArray(data?.documents) ? data.documents : [],
  };
}
