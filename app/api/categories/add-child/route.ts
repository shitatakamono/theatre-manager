import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { parentId, name } = body;

    if (!parentId || !name) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const ref = doc(db, "categories", parentId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    const data = snapshot.data();
    const children: string[] = data.children || [];

    // 既存子カテゴリに追加
    children.push(name);

    await updateDoc(ref, { children });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
