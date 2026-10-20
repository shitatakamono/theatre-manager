"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { buildRehearsalPrintModel } from "@/lib/rehearsal-print";
import { getAllProjectRehearsals, type Rehearsal } from "@/lib/rehearsals";
import styles from "./rehearsal-print.module.css";

type TimelineStyle = CSSProperties & {
  "--slot-count": number;
  "--lane-count"?: number;
};

function timelineStyle(slotCount: number, laneCount?: number): TimelineStyle {
  return {
    "--slot-count": slotCount,
    ...(laneCount === undefined ? {} : { "--lane-count": laneCount }),
  };
}

export function RehearsalPrintClient({ projectId }: { projectId: string }) {
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getAllProjectRehearsals(projectId)
      .then((items) => { if (active) setRehearsals(items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "稽古予定を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const model = useMemo(() => buildRehearsalPrintModel(rehearsals), [rehearsals]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>REHEARSAL SCHEDULE</p>
          <h1>稽古スケジュール</h1>
          <span>{model.days.length}日・{model.rehearsalCount}件</span>
        </div>
        <nav className={styles.screenActions} aria-label="印刷操作">
          <Link href={`/projects/${projectId}/rehearsals`}>稽古スケジュールへ戻る</Link>
          <button type="button" onClick={() => window.print()}>印刷する</button>
        </nav>
      </header>

      {loading ? <p className={styles.message}>読み込み中…</p> : error ? <p className={styles.error} role="alert">{error}</p> : model.rehearsalCount === 0 ? <p className={styles.message}>今日以降の稽古予定はありません。</p> : (
        <div className={styles.scrollArea}>
          <table className={styles.timeline} style={timelineStyle(model.slotCount)} aria-label="稽古時間軸">
            <colgroup>
              <col className={styles.dateColumn} />
              <col className={styles.typeColumn} />
              <col />
            </colgroup>
            <thead>
              <tr className={styles.axisHeader}>
                <th className={styles.dateHeading} scope="col">日付</th>
                <th className={styles.typeHeading} scope="col">カテゴリ</th>
                <th className={styles.hourHeading} scope="col">
                  <div className={styles.hourAxis}>
                    {model.hourTicks.map((tick) => (
                      <span
                        key={tick.minutes}
                        style={{ left: `${(tick.offsetSlots / model.slotCount) * 100}%` }}
                      >{tick.label}</span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            {model.days.map((day) => (
              <tbody className={styles.dayGroup} key={day.date}>
                {day.categories.map((category, categoryIndex) => (
                  <tr className={styles.categoryRow} key={category.type}>
                    {categoryIndex === 0 && <th className={styles.dateCell} rowSpan={day.categories.length} scope="rowgroup">{day.dateLabel}</th>}
                    <th className={styles.typeCell} scope="row">{category.label}</th>
                    <td className={styles.barCell}><div className={styles.barArea} style={timelineStyle(model.slotCount, category.laneCount)}>
                      {category.bars.map((bar) => (
                        <div
                          className={styles.bar}
                          key={bar.id}
                          style={{
                            left: `${(bar.leftSlot / model.slotCount) * 100}%`,
                            width: `${(bar.slotSpan / model.slotCount) * 100}%`,
                            top: `calc(${bar.lane} * (var(--bar-height) + var(--lane-gap)) + var(--row-padding))`,
                          }}
                          title={`${bar.startTime}–${bar.endsOnAnotherDate ? `翌日 ${bar.endTime}` : bar.endTime ?? "終了未設定"} ${bar.venue || "会場未設定"}`}
                        >
                          <strong>{bar.venue || "会場未設定"}</strong>
                          <span>{bar.startTime}–{bar.endsOnAnotherDate ? `翌日 ${bar.endTime}` : bar.endTime ?? "終了未設定"}</span>
                        </div>
                      ))}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </main>
  );
}
