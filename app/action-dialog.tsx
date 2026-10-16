"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Choice = { value: string; label: string };
type Request = { kind: "confirm" | "prompt" | "alert" | "choice"; message: string; value: string; choices?: Choice[]; resolve: (value: string | boolean | null) => void };
type DialogApi = {
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, value?: string) => Promise<string | null>;
  alert: (message: string) => Promise<void>;
  choose: (message: string, choices: Choice[]) => Promise<string | null>;
};
const DialogContext = createContext<DialogApi | null>(null);

export function useActionDialog() {
  const api = useContext(DialogContext);
  if (!api) throw new Error("ActionDialogProvider is required");
  return api;
}

export function ActionDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const ask = useCallback((kind: Request["kind"], message: string, value = "", choices?: Choice[]) => {
    // Ignore repeated clicks while confirmation is open; never approve implicitly.
    if (pending.current) return Promise.resolve(null);
    return new Promise<string | boolean | null>((resolve) => {
      const next = { kind, message, value, choices, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);
  const finish = useCallback((value: string | boolean | null) => {
    const active = pending.current;
    pending.current = null;
    setRequest(null);
    active?.resolve(value);
  }, []);
  useEffect(() => () => { pending.current?.resolve(null); pending.current = null; }, []);
  useEffect(() => {
    if (!request) return;
    const previousFocus = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [request]);
  const api = useMemo<DialogApi>(() => ({
    confirm: async (message) => (await ask("confirm", message)) === true,
    prompt: async (message, value) => { const result = await ask("prompt", message, value); return typeof result === "string" ? result : null; },
    alert: async (message) => { await ask("alert", message); },
    choose: async (message, choices) => { const result = await ask("choice", message, "", choices); return typeof result === "string" ? result : null; },
  }), [ask]);
  return <DialogContext.Provider value={api}>{children}{request &&
    <dialog ref={ref} className="action-dialog" aria-labelledby="action-dialog-title" aria-describedby="action-dialog-message" onCancel={(event) => { event.preventDefault(); finish(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (request.kind !== "choice") finish(request.kind === "prompt" ? field.current?.value ?? "" : true); }}>
        <h2 id="action-dialog-title">{request.kind === "prompt" ? "내용 입력" : request.kind === "alert" ? "알림" : "작업 확인"}</h2>
        <p id="action-dialog-message">{request.message}</p>
        {request.kind === "prompt" && <textarea ref={field} aria-label="입력 내용" defaultValue={request.value} rows={4} autoFocus />}
        <div className="action-dialog-actions">
          {request.kind !== "alert" && <button type="button" autoFocus={request.kind === "confirm" || request.kind === "choice"} onClick={() => finish(null)}>취소</button>}
          {request.kind === "choice" ? request.choices?.map(choice => <button key={choice.value} type="button" onClick={() => finish(choice.value)}>{choice.label}</button>) : <button className="action-dialog-submit" type="submit" autoFocus={request.kind === "alert"}>확인</button>}
        </div>
      </form>
    </dialog>
  }</DialogContext.Provider>;
}
