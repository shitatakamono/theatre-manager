// lib/firestore.ts
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  updateDoc,
  Timestamp,
  doc,
} from "firebase/firestore";

//
// ▼ 公演データ（projects）
//
const projectsRef = collection(db, "projects");

// 公演追加
export async function addProject(data: {
  title: string;
  start_date?: string;
  end_date?: string;
  show_start_date?: string;
  show_end_date?: string;
}) {
  const docRef = await addDoc(projectsRef, {
    ...data,
    createdAt: Timestamp.now(),
  });

  return docRef.id;
}

// 公演一覧を取得
export async function getProjects() {
  const snapshot = await getDocs(projectsRef);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// 公演1件取得
export async function getProject(projectId: string) {
  const ref = doc(db, "projects", projectId);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

// 公演削除
export async function deleteProject(projectId: string) {
  const ref = doc(db, "projects", projectId);
  await deleteDoc(ref);
}

//
// ▼ タスク関連（projects/{projectId}/tasks）
//

// タスク一覧取得
export async function getTasks(projectId: string) {
  const tasksRef = collection(db, "projects", projectId, "tasks");
  const snapshot = await getDocs(tasksRef);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// タスク追加（カテゴリ対応版）
export async function addTask(
  projectId: string,
  data: {
    title: string;
    stage: string;
    category_parent: string;
    category_child?: string;
    due_date?: string;
  }
) {
  const tasksRef = collection(db, "projects", projectId, "tasks");

  const docRef = await addDoc(tasksRef, {
    title: data.title,
    stage: data.stage,
    category_parent: data.category_parent,
    category_child: data.category_child || "",
    due_date: data.due_date || "",
    today_flag: false, // ← 初期状態はピン留めされていない
    done: false,
    createdAt: Timestamp.now(),
  });

  return docRef.id;
}





// タスク完了／未完了
export async function toggleTask(
  projectId: string,
  taskId: string,
  done: boolean
) {
  const taskRef = doc(db, "projects", projectId, "tasks", taskId);
  await updateDoc(taskRef, { done });
}
// ▼ Today ピン留め切り替え
export async function toggleTodayPin(
  projectId: string,
  taskId: string,
  flag: boolean
) {
  const taskRef = doc(db, "projects", projectId, "tasks", taskId);
  await updateDoc(taskRef, { today_flag: flag });
}

// ▼ タスク進捗（done/total）を取得
export async function getTasksCount(projectId: string) {
  const snapshot = await getDocs(collection(db, "projects", projectId, "tasks"));
  const tasks = snapshot.docs.map((d) => d.data());
  const done = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  return { done, total };
}

