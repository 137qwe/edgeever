import type { ComponentProps } from "react";
import { CheckCircle2, LoaderCircle, CircleAlert } from "lucide-react";
import { Button as SharedButton } from "../../../web/src/components/ui/button";
export { Input } from "../../../web/src/components/ui/input";

export function Button({ variant = "solid", className = "", ...props }: ComponentProps<typeof SharedButton>) {
  return <SharedButton variant={variant} className={`${variant === "solid" ? "bg-primary text-primary-foreground hover:bg-neutral-800 border-primary" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"} ${className}`} {...props} />;
}

export type Feedback = { message: string; kind?: "normal" | "success" | "error" };
export function Status({ message, kind = "normal", busy = false, id = "status" }: Feedback & { busy?: boolean; id?: string }) {
  const Icon = busy ? LoaderCircle : kind === "success" ? CheckCircle2 : kind === "error" ? CircleAlert : null;
  return <p id={id} role="status" aria-atomic="true" data-kind={kind} className={`flex items-start gap-2 text-xs leading-5 ${message ? "mt-3" : ""} ${kind === "error" ? "text-red-700" : "text-neutral-600"}`}>
    {message && Icon && <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />}{message}
  </p>;
}
