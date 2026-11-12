export type LineLinkEventType = "linked" | "relinked" | "project_link_removed";

export function buildLineLinkNotificationMessage(input: {
  projectName: string;
  personName: string;
  lineDisplayName: string;
  eventType: Exclude<LineLinkEventType, "project_link_removed">;
}): string {
  const heading = input.eventType === "relinked" ? "LINEが再連携されました" : "LINE連携が完了しました";
  return [
    `SeisakuBoardで${heading}。`,
    "",
    `公演：${input.projectName}`,
    `関係者：${input.personName}`,
    `LINE表示名：${input.lineDisplayName}`,
  ].join("\n");
}

export function lineLinkEventLabel(type: LineLinkEventType): string {
  if (type === "relinked") return "再連携";
  if (type === "project_link_removed") return "誤連携を解除";
  return "初回連携";
}
