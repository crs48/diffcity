import { expect, it, vi } from "vitest";
import { sharedReads } from "./sharedReads";

it("shares concurrent snapshot transfers but keeps fresh reads and mutations separate", async () => {
  let complete: (value: string) => void;
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
  );
  const rpc = sharedReads(read);
  const a = rpc("open_pull", { repository: "example/repo", number: 1 });
  const b = rpc("open_pull", { repository: "example/repo", number: 1 });
  expect(a).toBe(b);
  expect(read).toHaveBeenCalledTimes(1);
  complete!("snapshot");
  await expect(b).resolves.toBe("snapshot");
  rpc("open_pull", { repository: "example/repo", number: 1 });
  rpc("open_pull", { repository: "example/repo", number: 2 });
  rpc("save_note", { note: "same" });
  rpc("save_note", { note: "same" });
  expect(read).toHaveBeenCalledTimes(5);
});
