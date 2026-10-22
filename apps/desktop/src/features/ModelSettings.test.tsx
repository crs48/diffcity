// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSettings } from "./ModelSettings";
import { defaultModelPreference } from "../lib/models";
import type { Model } from "../lib/api";
import "../i18n";

afterEach(cleanup);
const models: Model[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    isDefault: false,
    description: "Astra description",
    defaultReasoningEffort: "medium",
    reasoningEfforts: [
      { effort: "medium", description: "Balanced reasoning" },
      { effort: "xhigh", description: "Think deeply" },
    ],
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    isDefault: false,
    description: "Luna description",
    defaultReasoningEffort: "low",
    reasoningEfforts: [
      { effort: "low", description: "Quick reasoning" },
      { effort: "medium", description: "Balanced reasoning" },
    ],
  },
];
const connection = {
  connected: true,
  identity: "fixture",
  executable: "",
  detail: "",
};
const props = () => ({
  preference: defaultModelPreference,
  models,
  connection,
  onSave: vi.fn().mockResolvedValue(undefined),
  onRefresh: vi.fn().mockResolvedValue({ connection, models }),
  onClose: vi.fn(),
});

it("shows the requested default and saves the selected model with an advertised effort", async () => {
  const callbacks = props();
  const user = userEvent.setup();
  render(<ModelSettings {...callbacks} />);
  expect(
    (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
      .value,
  ).toBe("gpt-6-astra");
  expect(
    (screen.getByRole("combobox", { name: "Reasoning" }) as HTMLSelectElement)
      .value,
  ).toBe("xhigh");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Model" }),
    "gpt-6-luna",
  );
  expect(
    (screen.getByRole("combobox", { name: "Reasoning" }) as HTMLSelectElement)
      .value,
  ).toBe("low");
  expect(screen.queryByRole("option", { name: "Extra high" })).toBeNull();
  expect(
    screen.getByText("Reasoning adjusted to match this model."),
  ).toBeTruthy();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Reasoning" }),
    "medium",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Model" }),
    "gpt-6-astra",
  );
  expect(
    (screen.getByRole("combobox", { name: "Reasoning" }) as HTMLSelectElement)
      .value,
  ).toBe("medium");
  await user.click(screen.getByRole("button", { name: "Save default" }));
  expect(callbacks.onSave).toHaveBeenCalledWith({
    ...defaultModelPreference,
    reasoningEffort: "medium",
  });
  expect(callbacks.onClose).toHaveBeenCalledOnce();
});

it("retains the dialog and selection on a failed save and permits retry", async () => {
  const callbacks = props();
  callbacks.onSave.mockRejectedValueOnce(new Error("Codex is offline"));
  const user = userEvent.setup();
  render(<ModelSettings {...callbacks} />);
  await user.click(screen.getByRole("button", { name: "Save default" }));
  expect(screen.getByRole("alert").textContent).toContain("Codex is offline");
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save default" }));
  expect(callbacks.onClose).toHaveBeenCalledOnce();
});

it("keeps unavailable saved choices visible without substituting a model", async () => {
  const callbacks = props();
  render(
    <ModelSettings
      {...callbacks}
      preference={{ ...defaultModelPreference, model: "retired" }}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Save default" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole("option", { name: "retired · Unavailable" }),
  ).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Refresh models" }));
  await waitFor(() => expect(callbacks.onRefresh).toHaveBeenCalledOnce());
  expect(callbacks.onSave).not.toHaveBeenCalled();
});

it("keeps disconnected controls disabled and reports refresh failures", async () => {
  const callbacks = props();
  callbacks.onRefresh.mockRejectedValue(new Error("Sign in to Codex"));
  render(
    <ModelSettings
      {...callbacks}
      models={[]}
      connection={{ ...connection, connected: false }}
    />,
  );
  expect(
    (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Save default" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Refresh models" }));
  expect(screen.getByRole("alert").textContent).toContain("Sign in to Codex");
});

it("allows the catalog default reasoning and closes with Escape", async () => {
  const callbacks = props();
  const user = userEvent.setup();
  render(<ModelSettings {...callbacks} />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Reasoning" }),
    "",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Model" }),
    "gpt-6-luna",
  );
  expect(
    (screen.getByRole("combobox", { name: "Reasoning" }) as HTMLSelectElement)
      .value,
  ).toBe("");
  await user.click(screen.getByRole("button", { name: "Save default" }));
  expect(callbacks.onSave).toHaveBeenCalledWith({
    ...defaultModelPreference,
    model: "gpt-6-luna",
    reasoningEffort: null,
  });
  callbacks.onClose.mockClear();
  await user.keyboard("{Escape}");
  expect(callbacks.onClose).toHaveBeenCalled();
});

it("creates a guide with Claude without saving a different default", async () => {
  const callbacks = props();
  const claude: Model = {
    ...models[0],
    id: "claude-fable-5",
    name: "Claude Fable 5",
    reasoningEfforts: [{ effort: "high", description: "Deep review" }],
    defaultReasoningEffort: "high",
  };
  callbacks.onRefresh.mockResolvedValue({ connection, models: [claude] });
  const user = userEvent.setup();
  render(<ModelSettings {...callbacks} purpose="guide" />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Provider" }),
    "claude",
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Generate guide",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(callbacks.onRefresh).toHaveBeenCalledWith("claude");
  expect(
    (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
      .value,
  ).toBe("claude-fable-5");
  await user.click(screen.getByRole("button", { name: "Generate guide" }));
  expect(callbacks.onSave).toHaveBeenCalledWith({
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "high",
  });
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(defaultModelPreference.model).toBe("gpt-6-astra");
});

it("shows a disconnected Claude account and lets the user return to Codex", async () => {
  const callbacks = props();
  callbacks.onRefresh
    .mockRejectedValueOnce(new Error("Run claude auth login"))
    .mockResolvedValue({ connection, models });
  const user = userEvent.setup();
  render(<ModelSettings {...callbacks} />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Provider" }),
    "claude",
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "claude auth login",
    ),
  );
  expect(
    (screen.getByRole("button", { name: "Save default" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Provider" }),
    "codex",
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Save default",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});
