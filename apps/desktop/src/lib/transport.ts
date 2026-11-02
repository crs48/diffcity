import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

export type ReviewTransport = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    name: string,
    receive: (event: { payload: T }) => void,
  ) => Promise<() => void>;
};
let browserTransport: ReviewTransport | undefined;
export function configureReviewTransport(transport: ReviewTransport) {
  browserTransport = transport;
}
export function usesBackendQueue() {
  return !!browserTransport;
}
export function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return browserTransport
    ? browserTransport.invoke<T>(command, args)
    : tauriInvoke<T>(command, args);
}
export function listen<T>(
  name: string,
  receive: (event: { payload: T }) => void,
): Promise<() => void> {
  return browserTransport
    ? browserTransport.listen<T>(name, receive)
    : tauriListen<T>(name, receive);
}
