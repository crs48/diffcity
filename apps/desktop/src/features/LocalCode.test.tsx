// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalCode, RepositoryContextButton } from "./LocalCode";
import { api, type RepositoryContext } from "../lib/api";
import "../i18n";
const initial = {
  settings: { roots: [], overrides: {} },
  index: { checkouts: [], warnings: [] },
};
const context: RepositoryContext = {
  repository: "owner/repo",
  path: null,
  head: null,
  branch: null,
  candidates: [],
  dirty: false,
  prHeadAvailable: false,
  detail: "PR context only",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  vi.spyOn(api, "localRepositories").mockResolvedValue(initial);
  vi.spyOn(api, "repositoryContext").mockResolvedValue(context);
  const onChange = vi.fn();
  render(
    <LocalCode
      repository="owner/repo"
      head="abc"
      onClose={vi.fn()}
      onChange={onChange}
    />,
  );
  return { user: userEvent.setup(), onChange };
}
it("saves a typed directory and displays matching checkouts", async () => {
  const save = vi
    .spyOn(api, "saveCodeRoots")
    .mockResolvedValue({
      settings: { roots: ["/Users/me/Code"], overrides: {} },
      index: {
        checkouts: [
          { repository: "owner/repo", path: "/Users/me/Code/different-name" },
        ],
        warnings: [],
      },
    });
  const { user, onChange } = setup();
  await screen.findByText(
    "No repositories found yet. Add a code directory or choose a checkout directly.",
  );
  await user.type(screen.getByLabelText("Code directory path"), "~/Code");
  await user.click(screen.getByRole("button", { name: "Add directory" }));
  await screen.findByText("/Users/me/Code/different-name");
  expect(save).toHaveBeenCalledWith(["~/Code"]);
  expect(onChange).toHaveBeenCalledOnce();
});
it("uses the native folder chooser for a manual binding and leaves cancellation alone", async () => {
  const choose = vi
    .spyOn(api, "chooseCodeFolder")
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("/repo");
  const bind = vi.spyOn(api, "bindLocalRepository").mockResolvedValue(initial);
  const { user } = setup();
  await screen.findByText("PR context only");
  await user.click(screen.getAllByRole("button", { name: "Browse…" })[1]);
  expect(bind).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole("button", { name: "Browse…" })[1]);
  await waitFor(() => expect(bind).toHaveBeenCalledWith("owner/repo", "/repo"));
  expect(choose).toHaveBeenCalledTimes(2);
});
it("preserves the entered path and explains mismatched remotes", async () => {
  vi.spyOn(api, "bindLocalRepository").mockRejectedValue(
    new Error("This folder has no GitHub remote for owner/repo"),
  );
  const { user, onChange } = setup();
  await screen.findByText("PR context only");
  await user.type(
    screen.getByLabelText("Repository folder path"),
    "/wrong/repo",
  );
  await user.click(screen.getByRole("button", { name: "Use folder" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "no GitHub remote",
  );
  expect(
    (screen.getByLabelText("Repository folder path") as HTMLInputElement).value,
  ).toBe("/wrong/repo");
  expect(onChange).not.toHaveBeenCalled();
});
it("keeps the selected PR context correct when an older lookup finishes later", async () => {
  let stale!: (c: RepositoryContext) => void;
  vi.spyOn(api, "repositoryContext").mockImplementation((repo) =>
    repo === "owner/first"
      ? new Promise((resolve) => {
          stale = resolve;
        })
      : Promise.resolve({ ...context, path: "/second" }),
  );
  const { rerender } = render(
    <RepositoryContextButton
      repository="owner/first"
      head="abc"
      version={0}
      onOpen={vi.fn()}
    />,
  );
  rerender(
    <RepositoryContextButton
      repository="owner/second"
      head="def"
      version={0}
      onOpen={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Local code connected" });
  stale(context);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Local code connected" }),
    ).toBeTruthy(),
  );
});
