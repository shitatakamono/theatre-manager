"use client";

import type { CSSProperties } from "react";
import {
  buildRehearsalMobileTimelineModel,
  formatRehearsalTimelineBar,
  type RehearsalPrintModel,
} from "@/lib/rehearsal-print";
import styles from "./rehearsal-mobile-timeline.module.css";

type MobileTimelineStyle = CSSProperties & {
  "--slot-count": number;
  "--lane-count"?: number;
};

function timelineStyle(slotCount: number, laneCount?: number): MobileTimelineStyle {
  return {
    "--slot-count": slotCount,
    ...(laneCount === undefined ? {} : { "--lane-count": laneCount }),
  };
}

function barLabel(primary: string, secondary: string | null, time: string): string {
  return [primary, secondary, time].filter(Boolean).join(" ");
}

export function RehearsalMobileTimeline({ model, onSelect }: {
  model: RehearsalPrintModel;
  onSelect?: (rehearsalId: string) => void;
}) {
  const mobileModel = buildRehearsalMobileTimelineModel(model);

  return (
    <div className={styles.mobileTimeline} aria-label="スマートフォン用稽古時間軸">
      {mobileModel.days.map((day) => {
        const rehearsalCount = day.categories.reduce((count, category) => count + category.bars.length, 0);
        return <article className={styles.dayCard} key={day.date}>
          <header className={styles.dayHeader}>
            <h3>{day.dateLabel}</h3>
            <span>{rehearsalCount}件</span>
          </header>
          <div className={styles.axis} style={timelineStyle(day.slotCount)} aria-hidden="true">
            {day.hourTicks.map((tick) => <span key={tick.minutes} style={{ left: `${(tick.offsetSlots / day.slotCount) * 100}%` }}>{tick.label}</span>)}
          </div>
          <div className={styles.categories}>
            {day.categories.map((category) => <section className={styles.category} key={category.type}>
              <div className={styles.categoryHeader}>
                <h4 data-type={category.type}>{category.label}</h4>
                {category.bars.length === 0 && <span>予定なし</span>}
              </div>
              {category.bars.length > 0 && <>
                <div className={styles.track} style={timelineStyle(day.slotCount, category.laneCount)}>
                  {category.bars.map((bar) => {
                    const text = formatRehearsalTimelineBar(bar);
                    const label = barLabel(text.primary, text.secondary, text.time);
                    const position = {
                      left: `${(bar.leftSlot / day.slotCount) * 100}%`,
                      width: `${(bar.slotSpan / day.slotCount) * 100}%`,
                      top: `calc(${bar.lane} * (var(--bar-height) + var(--lane-gap)))`,
                    };
                    return onSelect
                      ? <button aria-label={`${label}を編集`} className={styles.bar} data-type={category.type} key={bar.id} onClick={() => onSelect(bar.id)} style={position} title={label} type="button"><span>{text.time}</span></button>
                      : <div aria-label={label} className={styles.bar} data-type={category.type} key={bar.id} role="img" style={position} title={label}><span>{text.time}</span></div>;
                  })}
                </div>
                <ul className={styles.details}>
                  {category.bars.map((bar) => {
                    const text = formatRehearsalTimelineBar(bar);
                    const venue = bar.venue.trim() || "会場未設定";
                    const detail = <><strong>{text.time}</strong><span>{venue}</span></>;
                    return <li key={bar.id} data-type={category.type}>
                      {onSelect
                        ? <button type="button" onClick={() => onSelect(bar.id)} aria-label={`${text.time} ${venue}を編集`}>{detail}</button>
                        : <div>{detail}</div>}
                    </li>;
                  })}
                </ul>
              </>}
            </section>)}
          </div>
        </article>;
      })}
    </div>
  );
}
