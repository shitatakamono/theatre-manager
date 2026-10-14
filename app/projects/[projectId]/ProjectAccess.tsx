"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import { canDeleteProject, canEditProject, canManageMembers, canViewProject, type ProjectRole } from "@/lib/auth";
import { getProject, getProjectMember } from "@/lib/firestore";

type ProjectAccessValue = {
  role?: ProjectRole;
  legacyAccess: boolean;
  canView: boolean;
  canEdit: boolean;
  canManageMembers: boolean;
  canDelete: boolean;
};

const ProjectAccessContext = createContext<ProjectAccessValue | null>(null);

export function ProjectAccessBoundary({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const { profile } = useAuth();
  const [access, setAccess] = useState<{
    projectId: string;
    role?: ProjectRole;
    legacyAccess: boolean;
  } | null>(null);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void getProject(projectId).then(async (project) => {
      if (!project) return { role: undefined, legacyAccess: false };
      if (!project.memberUids?.length) {
        return { role: "editor" as const, legacyAccess: true };
      }
      const member = await getProjectMember(projectId, profile.uid);
      return { role: member?.role, legacyAccess: false };
    }).then((result) => {
      if (active) setAccess({ projectId, ...result });
    }).catch(() => {
      if (active) setAccess({ projectId, role: undefined, legacyAccess: false });
    });
    return () => { active = false; };
  }, [profile, projectId]);

  const loading = access?.projectId !== projectId;
  const role = loading ? undefined : access.role;
  const legacyAccess = loading ? false : access.legacyAccess;

  const value = useMemo<ProjectAccessValue>(() => ({
    role,
    legacyAccess,
    canView: canViewProject(role),
    canEdit: canEditProject(role),
    canManageMembers: canManageMembers(role),
    canDelete: canDeleteProject(role),
  }), [legacyAccess, role]);

  if (loading) return <main className="grid min-h-[60vh] place-content-center p-6">権限を確認しています…</main>;
  if (!value.canView) return <main className="grid min-h-[60vh] place-content-center gap-3 p-6 text-center"><h1 className="text-xl font-bold">この公演を閲覧する権限がありません。</h1><Link className="underline" href="/">公演一覧へ戻る</Link></main>;
  return <ProjectAccessContext.Provider value={value}>{children}</ProjectAccessContext.Provider>;
}

export function useProjectAccess() {
  const value = useContext(ProjectAccessContext);
  if (!value) throw new Error("useProjectAccess must be used inside ProjectAccessBoundary");
  return value;
}

export function MembersLink({ projectId }: { projectId: string }) {
  const { canManageMembers } = useProjectAccess();
  return canManageMembers ? <Link href={`/projects/${projectId}/members`}>メンバー</Link> : null;
}
