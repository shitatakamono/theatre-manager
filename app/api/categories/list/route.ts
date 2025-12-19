import { NextResponse } from "next/server";
import { getCategories, toCategoryMap } from "@/lib/firestore";

export async function GET() {
  try {
    const categories = await getCategories();      // Firestore から取得
    const map = toCategoryMap(categories);         // {親: [子…]} の形に変換

    return NextResponse.json({ map });
  } catch (e) {
    console.error("カテゴリ取得エラー:", e);
    return NextResponse.json({ map: {} }, { status: 500 });
  }
}
