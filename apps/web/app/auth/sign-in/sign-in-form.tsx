"use client";

import { Button } from "@medlink/ui";
import { useFormStatus } from "react-dom";

import { requestMagicLink } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button aria-disabled={pending} className="mt-4 w-full" disabled={pending} type="submit">
    {pending ? "Sending secure link…" : "Email me a sign-in link"}
  </Button>;
}

export function SignInForm({ next }: { next: string }) {
  return <form action={requestMagicLink} className="mt-6">
    <input type="hidden" name="next" value={next} />
    <label className="block font-medium" htmlFor="email">Email address</label>
    <input
      autoComplete="email"
      autoFocus
      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
      id="email"
      name="email"
      required
      type="email"
    />
    <SubmitButton />
  </form>;
}
