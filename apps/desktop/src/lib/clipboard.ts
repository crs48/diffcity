import { isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Native WebViews use the OS clipboard; the browser preview uses its own API. */
export function copyText(text: string): Promise<void> {
  return isTauri() ? writeText(text) : navigator.clipboard.writeText(text);
}
