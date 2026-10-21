export const batchUpdates = <T extends { id: string }>(updates: T[]) =>
  [...new Map(updates.map(update => [update.id, update])).values()];
