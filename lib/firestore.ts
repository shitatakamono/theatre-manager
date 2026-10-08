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
  Timestamp,
} from "firebase/firestore";
import {
  pickPerformanceData,
  type PerformanceSection,
  type PerformanceSectionMap,
  type ProjectPerformanceData,
} from "./performance";

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
  createdAt?: Timestamp;
};

export type ProjectPerformanceRecord = {
  id: string;
  legacyTitle?: string;
  startDate?: string;
  endDate?: string;
  showStartDate?: string;
  showEndDate?: string;
  data: ProjectPerformanceData;
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

// 公演追加
export async function addProject(data: Project) {
  const ref = await addDoc(projectsRef, {
    ...data,
    createdAt: Timestamp.now(),
  });
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
    data: pickPerformanceData(project),
  };
}

export async function updateProjectPerformanceSection<
  Section extends PerformanceSection,
>(
  projectId: string,
  section: Section,
  value: PerformanceSectionMap[Section]
) {
  const ref = doc(db, "projects", projectId);
  await updateDoc(ref, { [section]: value });
}

// 公演削除（必要なら）
export async function deleteProject(projectId: string) {
  const ref = doc(db, "projects", projectId);
  await deleteDoc(ref);
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



