import type { PerformanceSection } from "./performance.ts";
import type { ManagedProductionSection } from "./production-management.ts";
import type { VenueManagementSection } from "./venue-management.ts";
import { removeUndefinedValues } from "./firestore-values.ts";

export type ActivityActor = {
  uid: string;
  displayName?: string | null;
};

export type ActivityLog = {
  id: string;
  actorUid: string;
  actorName: string;
  action: "create" | "update" | "delete";
  section: string;
  sectionLabel: string;
  changedFields: string[];
  createdAt?: unknown;
};

export type ActivityField = {
  path: string;
  label: string;
};

export type ActivityDefinition = {
  section: string;
  sectionLabel: string;
  fields: readonly ActivityField[];
};

const field = (path: string, label: string): ActivityField => ({ path, label });

const performanceDefinitions: Record<PerformanceSection, ActivityDefinition> = {
  performanceInfo: {
    section: "performance.info",
    sectionLabel: "基本情報",
    fields: [
      field("performanceName", "公演名称"), field("title", "タイトル"),
      field("subtitle", "サブタイトル"), field("organizer", "主催"),
      field("coOrganizer", "共催"), field("support", "後援"),
      field("durationMinutes", "上演時間"), field("seatsPerPerformance", "1公演あたりの座席数"),
      field("hasIntermission", "休憩の有無"), field("intermissionMinutes", "休憩時間"),
      field("ageRestriction", "年齢制限"), field("notice", "注意事項"),
      field("synopsis", "あらすじ"),
    ],
  },
  venue: {
    section: "performance.venue",
    sectionLabel: "会場",
    fields: [field("name", "会場名"), field("hall", "ホール・劇場名"), field("address", "所在地"), field("url", "会場URL"), field("access", "交通アクセス")],
  },
  performances: { section: "performance.performances", sectionLabel: "公演回", fields: [field("", "公演回")] },
  tickets: {
    section: "performance.tickets",
    sectionLabel: "チケット",
    fields: [field("isPaid", "有料・無料"), field("advanceGeneral", "前売一般"), field("advanceStudent", "前売学生"), field("doorGeneral", "当日一般"), field("doorStudent", "当日学生"), field("note", "料金備考")],
  },
  cast: { section: "performance.cast", sectionLabel: "出演者", fields: [field("", "出演者")] },
  staff: { section: "performance.staff", sectionLabel: "スタッフ", fields: [field("", "スタッフ")] },
  contact: {
    section: "performance.contact",
    sectionLabel: "問い合わせ・公式情報",
    fields: [field("name", "問い合わせ先"), field("phone", "電話番号"), field("email", "メールアドレス"), field("website", "公式サイト"), field("x", "X"), field("instagram", "Instagram"), field("other", "その他")],
  },
  credits: { section: "performance.credits", sectionLabel: "掲載情報", fields: [field("", "掲載情報")] },
};

const venueDefinitions: Record<VenueManagementSection, ActivityDefinition> = {
  contract: {
    section: "production.venue",
    sectionLabel: "会場",
    fields: [field("useStartAt", "利用開始日時"), field("useEndAt", "利用終了日時"), field("venueContactName", "会場担当者"), field("venueContact", "会場連絡先"), field("reservationNumber", "予約番号"), field("reductionStatus", "減免申請"), field("note", "備考")],
  },
  registeredPerformance: {
    section: "production.venue",
    sectionLabel: "会場",
    fields: [field("finalized", "登録公演情報の確定"), field("finalizedAt", "確定日時"), field("note", "登録公演情報の備考")],
  },
  materials: {
    section: "production.venue",
    sectionLabel: "会場",
    fields: [field("flyerSubmitted", "チラシ提出"), field("posterSubmitted", "ポスター提出"), field("publicityRequested", "広報依頼"), field("note", "広報物の備考")],
  },
  meeting: {
    section: "production.venue",
    sectionLabel: "会場",
    fields: [
      field("adjustmentStatus", "打ち合わせ状況"), field("plannedDate", "打ち合わせ予定日"), field("completedDate", "打ち合わせ実施日"), field("troupeParticipants", "参加者"),
      field("loadIn", "搬入"), field("loadOut", "搬出"), field("merchandiseApplication", "物販申請"), field("parkingApplication", "駐車申請"),
      field("audio", "音響資料"), field("lighting", "照明資料"), field("video", "映像資料"), field("note", "打ち合わせ備考"),
    ],
  },
  documents: { section: "production.venue", sectionLabel: "会場", fields: [field("", "提出書類")] },
};

const productionLabels: Record<ManagedProductionSection, string> = {
  flyer: "チラシ・ポスター",
  web: "Web・SNS",
  tickets: "チケット",
  reception: "当日受付",
  accounting: "会計",
};

const productionFields: Record<ManagedProductionSection, Record<string, readonly ActivityField[]>> = {
  flyer: {
    specifications: [field("designer", "デザイナー"), field("surfaceDesign", "表面デザイン"), field("posterUsesFlyerFront", "ポスターへの表面流用"), field("color", "色"), field("dataFormat", "データ形式"), field("hasQr", "QRコード")],
    flyer: [field("enabled", "チラシ使用"), field("size", "チラシサイズ"), field("sides", "チラシ印刷面"), field("quantity", "チラシ部数"), field("printer", "チラシ印刷会社"), field("submissionPlannedDate", "チラシ入稿予定日"), field("submissionDate", "チラシ入稿日"), field("deliveryPlannedDate", "チラシ納品予定日"), field("deliveryDate", "チラシ納品日"), field("printCost", "チラシ印刷費")],
    poster: [field("enabled", "ポスター使用"), field("size", "ポスターサイズ"), field("sides", "ポスター印刷面"), field("quantity", "ポスター部数"), field("printer", "ポスター印刷会社"), field("submissionPlannedDate", "ポスター入稿予定日"), field("submissionDate", "ポスター入稿日"), field("deliveryPlannedDate", "ポスター納品予定日"), field("deliveryDate", "ポスター納品日"), field("printCost", "ポスター印刷費")],
    information: [field("informationFinalized", "掲載情報確定"), field("sponsorInfoReady", "協賛情報"), field("logoMaterialsReady", "ロゴ素材"), field("proofread", "校正")],
    distribution: [field("distributionStartDate", "配布開始日"), field("venue", "会場配布"), field("facilities", "施設配布"), field("inserts", "折り込み"), field("dm", "DM"), field("performers", "出演者配布"), field("other", "その他の配布"), field("note", "配布備考")],
  },
  web: {
    channels: [field("website", "Webサイト"), field("x", "X"), field("instagram", "Instagram"), field("facebook", "Facebook"), field("youtube", "YouTube"), field("other", "その他の媒体")],
    page: [field("teaserEnabled", "ティザーサイト"), field("teaserUrl", "ティザーURL"), field("teaserPublishPlannedDate", "ティザー公開予定日"), field("teaserPublishDate", "ティザー公開日"), field("performancePageUrl", "本ページURL"), field("publishPlannedDate", "本ページ公開予定日"), field("publishDate", "本ページ公開日"), field("published", "公開状態"), field("ticketLinkPublished", "チケットリンク掲載"), field("accessPublished", "アクセス掲載"), field("castPublished", "出演者掲載"), field("creditsPublished", "クレジット掲載")],
    announcements: [field("announcementStartDate", "告知開始日"), field("ticketSalesAnnouncement", "チケット発売告知"), field("preShowReminder", "本番前リマインド")],
    assets: [field("mainVisual", "メインビジュアル"), field("flyerImage", "チラシ画像"), field("castPhotos", "出演者写真"), field("map", "地図"), field("qr", "QRコード"), field("promoVideo", "告知動画"), field("sponsorLogos", "協賛ロゴ")],
    consistency: [field("performanceInfoCheckedAt", "公演情報確認日"), field("note", "整合性確認備考")],
    postShow: [field("postShowReport", "終演報告"), field("ticketLinkClosed", "チケットリンク終了"), field("performancePageUpdated", "公演ページ更新"), field("note", "終演後備考")],
  },
  tickets: {
    methods: [field("online", "オンライン受付"), field("phone", "電話受付"), field("email", "メール受付"), field("physical", "窓口販売"), field("other", "その他の販売方法"), field("onlineService", "オンラインサービス"), field("salesUrl", "販売URL")],
    sales: [field("salesStartDate", "販売開始日"), field("salesEndDate", "販売終了日"), field("reservationDeadline", "予約締切"), field("onlineDeadline", "オンライン締切"), field("doorTicketAvailable", "当日券"), field("seatingType", "座席種別")],
    reservations: [field("holdsAvailable", "取り置き"), field("invitationsAvailable", "招待"), field("stakeholderSeatsAvailable", "関係者席"), field("guestListUsed", "ゲストリスト"), field("physicalTicketQuantity", "紙チケット枚数"), field("physicalTicketResponsible", "紙チケット担当者")],
    handoff: [field("receptionHandoffConfirmed", "受付引き継ぎ"), field("note", "引き継ぎ備考")],
  },
  reception: {
    basic: [field("gatheringTime", "集合時間"), field("receptionStartTime", "受付開始時間")],
    staff: [field("leader", "受付責任者"), field("members", "受付スタッフ")],
    operation: [field("cash", "現金受付"), field("pos", "POS"), field("cashless", "キャッシュレス"), field("other", "その他の受付方式"), field("services", "利用サービス")],
    preparations: [field("", "受付準備物")],
    merchandise: [field("", "物販準備")],
    timetable: [field("", "タイムテーブル")],
    opening: [field("openingCheckCompleted", "開場前確認"), field("note", "開場前備考")],
    closingByPerformance: [field("", "公演回別締め")],
  },
  accounting: { tasks: [field("", "会計TODO")] },
};

function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return valuesEqual(leftKeys, rightKeys) && leftKeys.every((key) => valuesEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

export function getChangedFields(before: unknown, after: unknown, fields: readonly ActivityField[]): string[] {
  const cleanBefore = removeUndefinedValues(before);
  const cleanAfter = removeUndefinedValues(after);
  return fields
    .filter(({ path }) => !valuesEqual(valueAtPath(cleanBefore, path), valueAtPath(cleanAfter, path)))
    .map(({ label }) => label);
}

export function getPerformanceActivityDefinition(section: PerformanceSection): ActivityDefinition {
  return performanceDefinitions[section];
}

export function getVenueActivityDefinition(section: VenueManagementSection): ActivityDefinition {
  return venueDefinitions[section];
}

export function getProductionActivityDefinition(section: ManagedProductionSection, block: string): ActivityDefinition {
  return {
    section: `production.${section}`,
    sectionLabel: productionLabels[section],
    fields: productionFields[section][block] ?? [field("", productionLabels[section])],
  };
}

export function getActivityActorName(actor: ActivityActor): string {
  return actor.displayName?.trim() || "名前未設定のユーザー";
}
