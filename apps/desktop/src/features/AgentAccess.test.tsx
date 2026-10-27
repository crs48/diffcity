// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AgentAccessSelector,
  AgentApproval,
  useAgentAccess,
} from "./AgentAccess";
import type { AgentPrompt } from "../lib/api";
import "../i18n";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const prompt: AgentPrompt = {
  id: "permission",
  title: "Allow update_issue?",
  description: "Update the issue title",
  details: '{"title":"Fix context"}',
  questions: [],
  url: null,
};

it("offers keyboard-accessible modes and persists the explicit choice", async () => {
  const { result } = renderHook(useAgentAccess);
  expect(result.current.access).toBe("ask");
  const change = vi.fn((access) => result.current.change(access));
  render(<AgentAccessSelector value="ask" onChange={change} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Agent access: Ask before actions" }),
  );
  await user.click(screen.getByRole("menuitemradio", { name: /Full access/ }));
  expect(change).toHaveBeenCalledWith("full");
  expect(localStorage.getItem("diffcity.agent-access")).toBe("full");
  const second = renderHook(useAgentAccess);
  expect(second.result.current.access).toBe("full");
  act(() => result.current.change("limited"));
  expect(localStorage.getItem("diffcity.agent-access")).toBe("limited");
});

it("shows the actual action, requires a click, and sends a scoped one-time decision", async () => {
  const respond = vi.fn().mockResolvedValue(undefined);
  render(<AgentApproval prompt={prompt} runId="run-1" onRespond={respond} />);
  expect(screen.getByText(prompt.details)).toBeTruthy();
  expect(respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(respond).toHaveBeenCalledExactlyOnceWith("run-1", "permission", {
      allow: true,
      answers: {},
    }),
  );
  expect(
    screen.getByRole("button", { name: "Sending…" }).hasAttribute("disabled"),
  ).toBe(true);
});

it("requires answers without preselecting consent and lets the user decline", async () => {
  const respond = vi.fn().mockRejectedValueOnce(new Error("Request expired"));
  render(
    <AgentApproval
      prompt={{
        ...prompt,
        questions: [
          {
            id: "choice",
            label: "Publish this update?",
            kind: "choice",
            required: true,
            multiple: false,
            options: [
              { label: "Yes", value: "true", description: "Publish now" },
              { label: "No", value: "false", description: "Keep local" },
            ],
          },
        ],
      }}
      runId="r"
      onRespond={respond}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "Send answer" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /No/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByRole("alert");
  expect(respond).toHaveBeenLastCalledWith("r", "permission", {
    allow: true,
    answers: { choice: ["false"] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(respond).toHaveBeenLastCalledWith("r", "permission", {
    allow: false,
    answers: { choice: ["false"] },
  });
});
