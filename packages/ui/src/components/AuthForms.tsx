"use client";

import { useState, type InputHTMLAttributes } from "react";
import { FormSubmitButton } from "./FormSubmitButton";
import { Input } from "./primitives";

export type AuthFormAction = (formData: FormData) => void | Promise<void>;

function PasswordInput({
  label,
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { readonly label: string; readonly id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ display: "grid", gap: ".35rem" }}>
      <Input label={label} id={id} type={visible ? "text" : "password"} {...props} />
      <button
        aria-controls={id}
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        className="ml-button"
        data-variant="secondary"
        onClick={() => setVisible((current) => !current)}
        style={{ justifySelf: "start", padding: ".35rem .65rem" }}
        type="button"
      >
        {visible ? "Hide" : "Show"} password
      </button>
    </div>
  );
}

const formStyle = { display: "grid", gap: "1rem", marginTop: "1.5rem" } as const;

export function PasswordSignInForm({
  action,
  magicLinkAction,
  forgotPasswordHref = "/auth/forgot-password",
  signUpHref,
  next = "/",
}: {
  readonly action: AuthFormAction;
  readonly magicLinkAction?: AuthFormAction;
  readonly forgotPasswordHref?: string;
  readonly signUpHref?: string;
  readonly next?: string;
}) {
  return (
    <>
      <form action={action} style={formStyle}>
        <input name="next" type="hidden" value={next} />
        <Input label="Email address" id="email" name="email" type="email" autoComplete="email" required />
        <PasswordInput
          label="Password"
          id="password"
          name="password"
          autoComplete="current-password"
          required
        />
        <FormSubmitButton pendingLabel="Signing in…">Sign in</FormSubmitButton>
      </form>
      <p><a href={forgotPasswordHref}>Forgot password?</a></p>
      {signUpHref && <p>New to MedLink? <a href={signUpHref}>Create your account</a>.</p>}
      {magicLinkAction && (
        <>
          <hr aria-hidden="true" style={{ border: 0, borderTop: "1px solid var(--ml-line, #d7e1de)", margin: "1.5rem 0" }} />
          <form action={magicLinkAction} style={formStyle}>
            <input name="next" type="hidden" value={next} />
            <Input label="Email address for sign-in link" id="magic-email" name="email" type="email" autoComplete="email" required />
            <FormSubmitButton pendingLabel="Sending sign-in link…" data-variant="secondary">
              Email me a sign-in link instead
            </FormSubmitButton>
          </form>
        </>
      )}
    </>
  );
}

export function PasswordSignUpForm({ action, minimumLength }: {
  readonly action: AuthFormAction;
  readonly minimumLength: number;
}) {
  return (
    <form action={action} style={formStyle}>
      <Input label="Email address" id="email" name="email" type="email" autoComplete="email" required />
      <PasswordInput
        label="Password"
        id="password"
        name="password"
        autoComplete="new-password"
        aria-describedby="password-requirements"
        minLength={minimumLength}
        required
      />
      <small id="password-requirements">Use at least {minimumLength} characters.</small>
      <PasswordInput
        label="Confirm password"
        id="confirm-password"
        name="confirmPassword"
        autoComplete="new-password"
        minLength={minimumLength}
        required
      />
      <FormSubmitButton pendingLabel="Creating account…">Create account</FormSubmitButton>
    </form>
  );
}

export function ForgotPasswordForm({ action }: { readonly action: AuthFormAction }) {
  return (
    <form action={action} style={formStyle}>
      <Input label="Email address" id="email" name="email" type="email" autoComplete="email" required />
      <FormSubmitButton pendingLabel="Sending…">Send reset link</FormSubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ action, minimumLength }: {
  readonly action: AuthFormAction;
  readonly minimumLength: number;
}) {
  return (
    <form action={action} style={formStyle}>
      <PasswordInput
        label="New password"
        id="password"
        name="password"
        autoComplete="new-password"
        aria-describedby="password-requirements"
        minLength={minimumLength}
        required
      />
      <small id="password-requirements">Use at least {minimumLength} characters.</small>
      <PasswordInput
        label="Confirm new password"
        id="confirm-password"
        name="confirmPassword"
        autoComplete="new-password"
        minLength={minimumLength}
        required
      />
      <FormSubmitButton pendingLabel="Updating…">Update password</FormSubmitButton>
    </form>
  );
}
