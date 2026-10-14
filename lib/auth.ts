export type ProjectRole = "owner" | "editor" | "viewer";

export type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
};

export type ProjectMember = UserProfile & {
  role: ProjectRole;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function canViewProject(role?: ProjectRole): boolean {
  return role === "owner" || role === "editor" || role === "viewer";
}

export function canEditProject(role?: ProjectRole): boolean {
  return role === "owner" || role === "editor";
}

export function canManageMembers(role?: ProjectRole): boolean {
  return role === "owner";
}

export function canDeleteProject(role?: ProjectRole): boolean {
  return role === "owner";
}
