export const cacheKey = (repo: string, number: number, head: string) =>
  `${repo}#${number}@${head}`;
export const changedRevision = (before: string, after: string) => before !== after;
