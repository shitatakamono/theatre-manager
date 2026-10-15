"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FeedbackLink({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  if (pathname === `/projects/${projectId}/feedback`) return null;

  return (
    <Link
      className="fixed bottom-4 right-4 z-40 inline-flex min-h-11 items-center rounded-full border border-emerald-800 bg-white px-4 text-sm font-bold text-emerald-900 shadow-lg hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
      href={{ pathname: `/projects/${projectId}/feedback`, query: { from: pathname } }}
    >
      フィードバック
    </Link>
  );
}
