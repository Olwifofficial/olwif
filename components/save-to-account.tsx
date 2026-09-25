"use client";

import {useEffect, useRef, useState} from "react";
import {Bookmark, Check} from "lucide-react";
import {Button} from "@/components/ui/button";

export default function SaveToAccount({reportId}: {reportId: string}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "signin" | "error">("idle");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function save() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/member", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "saveReport", reportId}), signal: controller.signal});
      if (response.status === 401) {setState("signin"); return;}
      const data = await response.json() as {error?: string};
      if (!response.ok) throw new Error(data.error || "This report could not be saved. Please try again.");
      setState("saved");
    } catch (error) {
      if (controller.signal.aborted) return;
      setState("error");
      setMessage(error instanceof Error ? error.message : "This report could not be saved. Please try again.");
    }
  }

  return <span className="save-to-account">
    <Button type="button" variant="outline" onClick={save} disabled={state === "saving" || state === "saved"}>
      {state === "saved" ? <Check size={16} aria-hidden="true"/> : <Bookmark size={16} aria-hidden="true"/>}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved to your account" : "Save report"}
    </Button>
    {state === "signin" && <span className="small" role="status"> <a className="inline-link" href={`/account?returnTo=${encodeURIComponent(`/report/${reportId}`)}`}>Connect your wallet to save this report</a>.</span>}
    {state === "saved" && <span className="sr-only" role="status">Report saved.</span>}
    {state === "error" && <span className="small" role="alert"> {message}</span>}
  </span>;
}
