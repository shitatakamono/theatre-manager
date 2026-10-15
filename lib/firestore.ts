// lib/firestore.ts
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  Timestamp,
  writeBatch,
  arrayUnion,
  arrayRemove,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  pickPerformanceData,
  type PerformanceSection,
  type PerformanceSectionMap,
  type ProjectPerformanceData,
} from "./performance";
import {
  VENUE_CONTRACT_FIELDS,
  type ProductionManagement,
  type VenueManagementSection,
  type VenueManagementSectionMap,
} from "./venue-management";
import type {
  ManagedProductionSection,
  ProductionSectionDataMap,
} from "./production-management";
import type { ProjectMember, ProjectRole, UserProfile } from "./auth";
import { removeUndefinedValues } from "./firestore-values";
import {
  getPerformanceActivityDefinition,
  getProductionActivityDefinition,
  getVenueActivityDefinition,
  type ActivityActor,
  type ActivityLog,
} from "./activity";
import {
  runProjectRevisionTransaction,
  type ProjectRevisions,
  type RevisionKey,
} from "./project-revisions";

/* ================================
   公演（projects）
================================ */

// Firestore参照
const projectsRef = collection(db, "projects");

// 公演型
export type Project = ProjectPerformanceData & {
  title: string;
  start_date?: string;
  end_date?: string;
  show_start_date?: string;
  show_end_date?: string;
  production?: ProductionManagement;
  createdAt?: Timestamp;
  performanceInfoUpdatedAt?: Timestamp;
  memberUids?: string[];
  revisions?: ProjectRevisions;
};

export type ProjectPerformanceRecord = {
  id: string;
  legacyTitle?: string;
  startDate?: string;
  endDate?: string;
  showStartDate?: string;
  showEndDate?: string;
  performanceInfoUpdatedAt?: string;
  data: ProjectPerformanceData;
  production?: ProductionManagement;
  memberUids?: string[];
  revisions?: ProjectRevisions;
};

export type Task = {
  id: string;
  title: string;
  stage: string;
  category_parent: string;
  category_child: string;
  done: boolean;
};

export type Category = {
  id: string;
  name: string;
  children?: string[];
};

export type ActivityWriteContext = {
  actor: ActivityActor;
  expectedRevision: number;
};

function venueContractForComparison(value: VenueManagementSectionMap["contract"] | undefined) {
  if (!value) return {};
  return Object.fromEntries(VENUE_CONTRACT_FIELDS.flatMap((field) => {
    const fieldValue = value[field];
    return fieldValue === undefined || fieldValue === "" ? [] : [[field, fieldValue]];
  }));
}

function requireActivityContext(activity?: ActivityWriteContext): ActivityWriteContext {
  if (!activity) {
    throw new Error("競合検知に必要なrevision情報がありません");
  }
  return activity;
}

// 公演追加
export async function addProject(data: Project, owner: UserProfile) {
  const ref = doc(projectsRef);
  const batch = writeBatch(db);
  const now = Timestamp.now();
  batch.set(ref, { ...data, memberUids: [owner.uid], createdAt: now });
  batch.set(doc(ref, "members", owner.uid), {
    ...owner,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  } satisfies ProjectMember);
  await batch.commit();
  return ref.id;
}

// 公演一覧取得
export async function getProjects(): Promise<(Project & { id: string })[]> {
  const snapshot = await getDocs(projectsRef);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Project),
  }));
}

export type AccessibleProject = Project & { id: string; role: ProjectRole; legacyAccess: boolean };

export async function getProjectsForUser(uid: string): Promise<AccessibleProject[]> {
  const legacyAccess = process.env.NEXT_PUBLIC_PROJECT_ACCESS_MODE === "legacy";
  const snapshot = await getDocs(
    legacyAccess ? projectsRef : query(projectsRef, where("memberUids", "array-contains", uid))
  );
  const projects = snapshot.docs.map((projectDoc) => ({
    id: projectDoc.id,
    ...(projectDoc.data() as Project),
  }));
  const result: AccessibleProject[] = [];
  for (const project of projects) {
    if (legacyAccess && !project.memberUids?.length) {
      result.push({ ...project, role: "editor", legacyAccess: true });
      continue;
    }
    if (!project.memberUids?.includes(uid)) continue;
    const member = await getProjectMember(project.id, uid);
    if (member) result.push({ ...project, role: member.role, legacyAccess: false });
  }
  return result;
}

// 公演1件取得
export async function getProject(projectId: string) {
  const ref = doc(db, "projects", projectId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...(snap.data() as Project),
  };
}

export async function getProjectPerformanceData(
  projectId: string
): Promise<ProjectPerformanceRecord | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  return {
    id: project.id,
    legacyTitle: project.title,
    startDate: project.start_date,
    endDate: project.end_date,
    showStartDate: project.show_start_date,
    showEndDate: project.show_end_date,
    performanceInfoUpdatedAt: project.performanceInfoUpdatedAt?.toDate().toISOString(),
    data: pickPerformanceData(project),
    production: project.production,
    memberUids: project.memberUids,
    revisions: project.revisions,
  };
}

export async function updateProjectPerformanceSection<
  Section extends PerformanceSection,
>(
  projectId: string,
  section: Section,
  value: PerformanceSectionMap[Section],
  activity?: ActivityWriteContext
) {
  const context = requireActivityContext(activity);
  const cleanValue = removeUndefinedValues(value);
  return runProjectRevisionTransaction({
    firestore: db,
    projectId,
    revisionKey: "performanceInfo",
    expectedRevision: context.expectedRevision,
    updates: {
      [section]: cleanValue,
      performanceInfoUpdatedAt: serverTimestamp(),
    },
    nextValue: cleanValue,
    readCurrentValue: (project) => project[section],
    actor: context.actor,
    activity: getPerformanceActivityDefinition(section),
  });
}

export async function updateProjectVenueSection<
  Section extends VenueManagementSection,
>(
  projectId: string,
  section: Section,
  value: VenueManagementSectionMap[Section],
  activity?: ActivityWriteContext
) {
  const context = requireActivityContext(activity);
  const cleanValue = removeUndefinedValues(value);
  const updates: Record<string, unknown> = {};
  let comparisonValue: unknown = cleanValue;

  if (section === "contract") {
    const contract = cleanValue as VenueManagementSectionMap["contract"];
    for (const field of VENUE_CONTRACT_FIELDS) {
      const fieldValue = contract[field];
      updates[`production.venue.${field}`] =
        fieldValue === undefined || fieldValue === "" ? deleteField() : fieldValue;
    }

    comparisonValue = venueContractForComparison(contract);
  } else {
    updates[`production.venue.${section}`] = cleanValue;
  }

  return runProjectRevisionTransaction({
    firestore: db,
    projectId,
    revisionKey: "venue",
    expectedRevision: context.expectedRevision,
    updates,
    nextValue: comparisonValue,
    readCurrentValue: (project) => {
      const venue = (project.production as Record<string, unknown> | undefined)?.venue as Record<string, unknown> | undefined;
      return section === "contract"
        ? venueContractForComparison(venue as VenueManagementSectionMap["contract"] | undefined)
        : venue?.[section];
    },
    actor: context.actor,
    activity: getVenueActivityDefinition(section),
  });
}

export async function updateProjectProductionBlock<
  Section extends ManagedProductionSection,
  Block extends keyof ProductionSectionDataMap[Section] & string,
>(
  projectId: string,
  section: Section,
  block: Block,
  value: ProductionSectionDataMap[Section][Block],
  activity?: ActivityWriteContext
) {
  const context = requireActivityContext(activity);
  const cleanValue = removeUndefinedValues(value);
  const revisionKey: RevisionKey = section === "tickets" ? "ticket" : section;
  return runProjectRevisionTransaction({
    firestore: db,
    projectId,
    revisionKey,
    expectedRevision: context.expectedRevision,
    updates: {
      [`production.${section}.${block}`]: cleanValue,
    },
    nextValue: cleanValue,
    readCurrentValue: (project) => {
      const production = project.production as Record<string, unknown> | undefined;
      const sectionData = production?.[section] as Record<string, unknown> | undefined;
      return sectionData?.[block];
    },
    actor: context.actor,
    activity: getProductionActivityDefinition(section, block),
  });
}

export async function getProjectActivityLogs(projectId: string): Promise<ActivityLog[]> {
  const snapshot = await getDocs(query(
    collection(db, "projects", projectId, "activityLogs"),
    orderBy("createdAt", "desc"),
    limit(100)
  ));
  return snapshot.docs.map((activity) => ({
    id: activity.id,
    ...(activity.data() as Omit<ActivityLog, "id">),
  }));
}

export async function renameProject(projectId: string, title: string) {
  const ref = doc(db, "projects", projectId);
  await updateDoc(ref, { title });
}

export async function deleteProjectWithTasks(projectId: string) {
  const projectRef = doc(db, "projects", projectId);
  const tasksSnapshot = await getDocs(
    collection(db, "projects", projectId, "tasks")
  );

  if (tasksSnapshot.size < 500) {
    const batch = writeBatch(db);
    tasksSnapshot.docs.forEach((task) => batch.delete(task.ref));
    batch.delete(projectRef);
    await batch.commit();
    return;
  }

  const taskDocs = tasksSnapshot.docs;
  for (let index = 0; index < taskDocs.length; index += 450) {
    const batch = writeBatch(db);
    taskDocs.slice(index, index + 450).forEach((task) => batch.delete(task.ref));
    await batch.commit();
  }
  await deleteDoc(projectRef);
}

export async function getProjectMember(projectId: string, uid: string): Promise<ProjectMember | null> {
  const snapshot = await getDoc(doc(db, "projects", projectId, "members", uid));
  return snapshot.exists() ? snapshot.data() as ProjectMember : null;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const snapshot = await getDocs(collection(db, "projects", projectId, "members"));
  return snapshot.docs.map((member) => member.data() as ProjectMember);
}

export async function updateProjectMemberRole(projectId: string, member: ProjectMember, role: ProjectRole) {
  const batch = writeBatch(db);
  batch.set(doc(db, "projects", projectId, "members", member.uid), {
    ...member,
    role,
    updatedAt: Timestamp.now(),
  });
  batch.update(doc(db, "projects", projectId), { memberUids: arrayUnion(member.uid) });
  await batch.commit();
}

export async function removeProjectMember(projectId: string, uid: string) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "projects", projectId, "members", uid));
  batch.update(doc(db, "projects", projectId), { memberUids: arrayRemove(uid) });
  await batch.commit();
}

/* ================================
   タスク（projects/{id}/tasks）
================================ */

// タスク取得
export async function getTasks(projectId: string): Promise<Task[]> {
  const ref = collection(db, "projects", projectId, "tasks");
  const snap = await getDocs(ref);

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Task, "id">),
  }));
}

// タスク追加
export async function addTask(
  projectId: string,
  data: {
    title: string;
    stage?: string;
    category_parent?: string;
    category_child?: string;
  }
) {
  const tasksRef = collection(db, "projects", projectId, "tasks");

  const docRef = await addDoc(tasksRef, {
    title: data.title,
    stage: data.stage ?? "",
    category_parent: data.category_parent ?? "",
    category_child: data.category_child ?? "",
    done: false,
    createdAt: Timestamp.now(),
  });

  return docRef.id;
}

// タスク完了/未完了切替
export async function toggleTask(
  projectId: string,
  taskId: string,
  done: boolean
) {
  const ref = doc(db, "projects", projectId, "tasks", taskId);
  await updateDoc(ref, { done });
}

/* ================================
   カテゴリ（categories）
================================ */

// カテゴリ取得
export async function getCategories(): Promise<Category[]> {
  const ref = collection(db, "categories");
  const snap = await getDocs(ref);

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Category, "id">),
  }));
}

export async function addParentCategory(name: string) {
  await addDoc(collection(db, "categories"), {
    name: name.trim(),
    children: [],
  });
}

export async function addChildCategory(parentId: string, name: string) {
  await updateDoc(doc(db, "categories", parentId), {
    children: arrayUnion(name.trim()),
  });
}

// Firestore のカテゴリを { 親名: 子リスト } に変換する
export function toCategoryMap(categories: Category[]) {
  const map: Record<string, string[]> = {};

  categories.forEach((cat) => {
    const parent = cat.name;
    let children = cat.children || [];

    // Firestore の children が ["[\"広報\",\"受付\",\"会計\"]"] のような文字列配列のケース
    if (children.length === 1 && typeof children[0] === "string") {
      try {
        const parsed = JSON.parse(children[0]);
        if (Array.isArray(parsed)) {
          children = parsed;
        }
      } catch {
        // JSON.parse に失敗した場合は ","で区切る
        children = children[0].split(",").map((s: string) => s.replace(/[\[\]"]/g, "").trim());
      }
    }

    map[parent] = children;
  });

  return map;
}



