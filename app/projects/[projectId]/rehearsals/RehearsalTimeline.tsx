"use client";

import type { CSSProperties } from "react";
import { formatRehearsalTimelineBar, type RehearsalPrintModel } from "@/lib/rehearsal-print";
import styles from "./rehearsal-timeline.module.css";

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

export function RehearsalTimeline({ model, onSelect }: {
  model: RehearsalPrintModel;
  onSelect?: (rehearsalId: string) => void;
}) {
  return (
    <div className={styles.scrollArea}>
      <table className={styles.timeline} style={timelineStyle(model.slotCount)} aria-label="稽古時間軸">
        <colgroup><col className={styles.dateColumn} /><col className={styles.typeColumn} /><col /></colgroup>
        <thead><tr className={styles.axisHeader}>
          <th className={styles.dateHeading} scope="col">日付</th>
          <th className={styles.typeHeading} scope="col">カテゴリ</th>
          <th className={styles.hourHeading} scope="col"><div className={styles.hourAxis}>{model.hourTicks.map((tick) => <span key={tick.minutes} style={{ left: `${(tick.offsetSlots / model.slotCount) * 100}%` }}>{tick.label}</span>)}</div></th>
        </tr></thead>
        {model.days.map((day) => <tbody className={styles.dayGroup} key={day.date}>
          {day.categories.map((category, categoryIndex) => <tr className={styles.categoryRow} key={category.type}>
            {categoryIndex === 0 && <th className={styles.dateCell} rowSpan={day.categories.length} scope="rowgroup">{day.dateLabel}</th>}
            <th className={styles.typeCell} data-type={category.type} scope="row">{category.label}</th>
            <td className={styles.barCell}><div className={styles.barArea} style={timelineStyle(model.slotCount, category.laneCount)}>
              {category.bars.map((bar) => {
                const text = formatRehearsalTimelineBar(bar);
                const label = [text.primary, text.secondary, text.time].filter(Boolean).join(" ");
                const content = <><strong>{text.primary}</strong>{text.secondary && <span className={styles.barVenue}>{text.secondary}</span>}<span className={styles.barTime}>{text.time}</span></>;
                const style = {
                  left: `${(bar.leftSlot / model.slotCount) * 100}%`,
                  width: `${(bar.slotSpan / model.slotCount) * 100}%`,
                  top: `calc(${bar.lane} * (var(--bar-height) + var(--lane-gap)) + var(--row-padding))`,
                };
                return onSelect
                  ? <button aria-label={`${label}を編集`} className={styles.bar} data-type={category.type} key={bar.id} onClick={() => onSelect(bar.id)} style={style} title={label} type="button">{content}</button>
                  : <div className={styles.bar} data-type={category.type} key={bar.id} style={style} title={label}>{content}</div>;
              })}
            </div></td>
          </tr>)}
        </tbody>)}
      </table>
    </div>
  );
}
