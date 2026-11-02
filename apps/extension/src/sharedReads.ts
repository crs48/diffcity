/** Coalesce simultaneous view loads; never cache mutations or stale completed reads. */
export function sharedReads<T>(
  read: (command: string, args: Record<string, unknown>) => Promise<T>,
) {
  const pending = new Map<string, Promise<T>>();
  return (command: string, args: Record<string, unknown>) => {
    if (!["bootstrap", "open_pull", "open_saved_review"].includes(command))
      return read(command, args);
    const key = JSON.stringify([command, args]);
    const existing = pending.get(key);
    if (existing) return existing;
    const result = read(command, args).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}
