// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";
import { useState } from "react";
import App from "../App";
import { AppDialog } from "./AppDialog";
import { Diff } from "../features/Diff";
import type { Bootstrap, ReviewWorkspace, Settings } from "../lib/api";
import fixture from "../../../../tests/fixtures/review-workspace.json";

const workspace = fixture as ReviewWorkspace;
let settings: Settings;
beforeEach(() => {
  localStorage.clear();
  settings = {
    repositories: [],
    ghPath: null,
    codexPath: null,
    model: null,
    theme: "system",
    locale: "en",
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  mockWindows("main");
  Object.assign(window, {
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
  });
  mockIPC(
    (command, args) => {
      const payload = args as Record<string, unknown>;
      if (command === "bootstrap")
        return {
          settings,
          github: {
            connected: false,
            identity: "",
            executable: "",
            detail: "Offline fixture",
          },
          codex: {
            connected: false,
            identity: "",
            executable: "",
            detail: "Offline fixture",
          },
          models: [],
          pulls: [],
          schemaVersion: 3,
          dataDirectory: "test-data",
        } satisfies Bootstrap;
      if (command === "sample_review") return structuredClone(workspace);
      if (command === "save_settings") {
        settings = payload!.settings as Settings;
        return settings;
      }
      if (command === "save_progress") return payload!.progress;
      if (command === "refresh_inbox") return [];
      throw new Error(`Unexpected command in accessibility test: ${command}`);
    },
    { shouldMockEvents: true },
  );
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  clearMocks();
  vi.unstubAllGlobals();
});

function DialogExample({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <button>Outside</button>
      {open && (
        <AppDialog
          label="Test dialog"
          onClose={() => setOpen(false)}
          busy={busy}
        >
          <header>
            <h2>Test dialog</h2>
          </header>
          <label>
            Name
            <input />
          </label>
          <button onClick={() => setOpen(false)}>Done</button>
        </AppDialog>
      )}
    </>
  );
}

describe("keyboard and assistive navigation", () => {
  it("contains dialog focus, dismisses with Escape, and returns to its trigger", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    for (let n = 0; n < 6; n++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps a busy publication dialog open on Escape", async () => {
    const user = userEvent.setup();
    render(<DialogExample busy />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Test dialog" })).toBeTruthy();
  });

  it("switches review tabs and guide steps with the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Explore a sample" }),
    );
    const guide = await screen.findByRole("tab", { name: "Guide" });
    await user.click(guide);
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toBeTruthy();
    await user.keyboard("{Home}");
    expect(guide.getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Review outline/ }));
    const menu = screen.getByRole("menu", { name: /Review outline/ });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    await user.keyboard("{Home}{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Keep invitations inside their team",
        }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("changes and persists appearance without reconnecting accounts", async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole("button", {
      name: "Appearance: system",
    });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    expect(settings.theme).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Appearance: dark" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Light" }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
  });

  it("exposes all lines in assistive reading mode and preserves keyboard line anchoring", async () => {
    const hunk = {
      ...workspace.snapshot.files[0].hunks[0],
      lines: Array.from({ length: 80 }, (_, i) => ({
        kind: "addition" as const,
        old: null,
        new: i + 1,
        text: `added line ${i + 1}`,
      })),
    };
    const onSelect = vi.fn();
    render(
      <Diff
        hunk={hunk}
        selection={null}
        onSelect={onSelect}
        notes={[]}
        comments={[]}
        split={false}
        readingMode
      />,
    );
    expect(screen.getByText("added line 80")).toBeTruthy();
    const lastLine = screen.getByRole("button", {
      name: `Select ${hunk.path} line 80`,
    });
    lastLine.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ side: "RIGHT", startLine: 80, line: 80 }),
    );
  });
});
