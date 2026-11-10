import type { Metadata } from "next";
import { InviteClient } from "./InviteClient";

export const metadata: Metadata = {
  title: "公演への招待 | SeisakuBoard",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function InvitePage() {
  return <InviteClient />;
}
