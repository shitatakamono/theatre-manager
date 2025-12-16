// lib/firestore.ts
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  Timestamp,
} from "firebase/firestore";

// ---------------
// 公演追加
// ---------------
export async function addProject(data: {
  title: string;
  start_date?: string;
  end_date?: string;
  show_start_date?: string;
  show_end_date?: string;
}) {
  const ref = await addDoc(collection(db, "projects"), {
    ...data,
    createdAt: Timestamp.now(),
  });

  return ref.id;
}

// ---------------
// 公演一覧を取得
// ---------------
export async function getProjects() {
  const snapshot = await getDocs(collection(db, "projects"));
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// ---------------
// 公演1件を取得
// ---------------
export async function getProject(projectId: string) {
  const ref = doc(db, "projects", projectId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...snap.data(),
  };
}
// ----------------------
// タスク一覧取得
// ----------------------
export async function getTasks(projectId: string) {
  const ref = collection(db, "projects", projectId, "tasks");
  const snap = await getDocs(ref);

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// ----------------------
// タスク追加（タイトルのみ）
// ----------------------
export async function addTask(projectId: string, title: string) {
  const ref = collection(db, "projects", projectId, "tasks");
  const newTask = await addDoc(ref, {
    title,
    done: false,
    createdAt: Timestamp.now(),
  });

  return newTask.id;
}

// ----------------------
// タスク完了・未完了の切り替え
// ----------------------
export async function toggleTask(projectId: string, taskId: string, done: boolean) {
  const ref = doc(db, "projects", projectId, "tasks", taskId);
  await updateDoc(ref, { done });
}
