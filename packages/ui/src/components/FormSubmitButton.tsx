"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./primitives";

export function FormSubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly pendingLabel: ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} aria-busy={pending} disabled={pending || props.disabled} type="submit">
      {pending ? pendingLabel : children}
    </Button>
  );
}
