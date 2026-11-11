"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice } from "./ui";

export type ActionResult = { error?: string; success?: string } | undefined;
export type FormAction = (prev: ActionResult, data: FormData) => Promise<ActionResult>;

function Submit({ label, variant }: { label: string; variant: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** A form wired to a server action, showing its error or success message and a pending state. */
export function ActionForm({
  action,
  submitLabel = "Save",
  variant = "primary",
  children,
  className = "space-y-4",
}: {
  action: FormAction;
  submitLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.success && <Notice tone="success">{state.success}</Notice>}
      <Submit label={submitLabel} variant={variant} />
    </form>
  );
}
