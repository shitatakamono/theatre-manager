"use client";

import { useState } from "react";

export function TaskFilters({ categoryMap, onFilter }) {
  console.log("🔥 TaskFilters categoryMap =", categoryMap);

  const [stage, setStage] = useState("");
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");

  const children = parent ? categoryMap[parent] || [] : [];

  function updateFilters(next) {
    const filters = {
      stage: next.stage ?? stage,
      parent: next.parent ?? parent,
      child: next.child ?? child,
    };
    onFilter(filters);
  }

  return (
    <div className="space-y-3 bg-white p-3 rounded border mb-4">

      {/* ▼ 時期フィルタ */}
      <select
        value={stage}
        onChange={(e) => {
          setStage(e.target.value);
          updateFilters({ stage: e.target.value });
        }}
        className="border p-2 rounded w-full"
      >
        <option value="">（すべて）</option>
        <option value="前期">前期</option>
        <option value="中期">中期</option>
        <option value="後期">後期</option>
        <option value="当日">当日</option>
      </select>

      {/* ▼ 親カテゴリ */}
      <select
        value={parent}
        onChange={(e) => {
          setParent(e.target.value);
          updateFilters({ parent: e.target.value, child: "" });
          setChild("");
        }}
        className="border p-2 rounded w-full"
      >
        <option value="">（すべて）</option>
        {Object.keys(categoryMap).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      {/* ▼ 子カテゴリ */}
      <select
        value={child}
        onChange={(e) => {
          setChild(e.target.value);
          updateFilters({ child: e.target.value });
        }}
        className="border p-2 rounded w-full"
      >
        <option value="">（すべて）</option>
        {children.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}
