export type TaskCategoryMap = Record<string, string[]>;

export const BUILT_IN_TASK_CATEGORY_CHILDREN: Readonly<TaskCategoryMap> = {
  制作: ["WEB／SNS", "DM・折込"],
};

export function mergeBuiltInTaskCategories(categoryMap: TaskCategoryMap): TaskCategoryMap {
  const merged = Object.fromEntries(
    Object.entries(categoryMap).map(([parent, children]) => [parent, [...children]])
  );

  for (const [parent, children] of Object.entries(BUILT_IN_TASK_CATEGORY_CHILDREN)) {
    merged[parent] = [...new Set([...(merged[parent] ?? []), ...children])];
  }

  return merged;
}
