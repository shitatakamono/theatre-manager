import type { Metadata } from "next";

import { LineAuthCompleteClient } from "./LineAuthCompleteClient";

export const metadata: Metadata = {
  title: "LINEログイン",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LineAuthCompletePage() {
  return <LineAuthCompleteClient />;
}
