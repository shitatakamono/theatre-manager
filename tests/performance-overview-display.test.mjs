import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const projectStylesUrl = new URL(
  "../app/projects/[projectId]/project-roadmap.module.css",
  import.meta.url
);
const performanceInfoUrl = new URL(
  "../app/projects/[projectId]/info/PerformanceInfoClient.tsx",
  import.meta.url
);
const performanceStylesUrl = new URL(
  "../app/projects/[projectId]/info/performance-info.module.css",
  import.meta.url
);

describe("performance overview display", () => {
  it("emphasizes the performance period and venue without changing the title", async () => {
    const styles = await readFile(projectStylesUrl, "utf8");

    assert.match(styles, /\.summary dd \{[^}]*font-size: clamp\(15px, 1\.5vw, 18px\)/s);
    assert.match(styles, /\.hero h1 \{[^}]*font-size: clamp\(25px, 3vw, 38px\)/s);
  });

  it("shows cast and each staff member as separate vertical rows", async () => {
    const [source, styles] = await Promise.all([
      readFile(performanceInfoUrl, "utf8"),
      readFile(performanceStylesUrl, "utf8"),
    ]);

    assert.match(styles, /\.peopleList \{ display: grid; gap: 0; \}/);
    assert.doesNotMatch(styles, /\.peopleList[^\n]*grid-template-columns/);
    assert.match(source, /className=\{styles\.staffMembers\}/);
    assert.match(source, /members\.map\(\(member\) => <li key=\{member\.id\}>\{member\.name\}<\/li>\)/);
    assert.doesNotMatch(source, /\.filter\(Boolean\)\.join\(" \/ "\)/);
  });
});
