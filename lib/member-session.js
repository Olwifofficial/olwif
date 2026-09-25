export const MEMBER_SESSION_EVENT = "olwif:member-session";

export function publishMemberSession(authenticated) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MEMBER_SESSION_EVENT, {detail: authenticated === true}));
}

// UI state only. Every private API request still authenticates on the server.
// No polling, wallet prompts, browser storage or background timers.
export function watchMemberSession(onChange, {target = window, fetchImpl = fetch} = {}) {
  let controller, disposed = false;
  const refresh = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const response = await fetchImpl("/api/auth/session", {credentials: "same-origin", cache: "no-store", signal: current.signal});
      const data = response.ok ? await response.json() : null;
      if (!disposed && !current.signal.aborted) onChange(data?.authenticated === true);
    } catch {
      if (!disposed && !current.signal.aborted) onChange(false);
    }
  };
  const changed = event => {
    if (typeof event.detail !== "boolean") return;
    controller?.abort();
    onChange(event.detail);
  };
  target.addEventListener(MEMBER_SESSION_EVENT, changed);
  target.addEventListener("focus", refresh);
  void refresh();
  return () => {
    disposed = true;
    controller?.abort();
    target.removeEventListener(MEMBER_SESSION_EVENT, changed);
    target.removeEventListener("focus", refresh);
  };
}
