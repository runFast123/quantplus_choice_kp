"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";

const NEVER_ECHO = /pass|token|secret|api_key|key$/i;

/**
 * useActionState that keeps what the user typed when the server says no.
 * React 19 resets a form after every action; inputs that read their
 * defaultValue from `values` come back filled after an error, and clear after
 * success. Secret-looking fields are never echoed.
 */
export function useEchoAction(
  action: (prev: ActionState, form: FormData) => Promise<ActionState>,
  onResult?: (result: ActionState) => void,
) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, dispatch, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await action(prev, form);
    setValues(
      result?.error
        ? Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !NEVER_ECHO.test(k))) as Record<string, string>
        : {},
    );
    onResult?.(result);
    return result;
  }, undefined);
  return [state, dispatch, pending, values] as const;
}
