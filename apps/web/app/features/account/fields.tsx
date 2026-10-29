import type { InputHTMLAttributes } from "react";

export function AccountField({ label, hint, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; id: string }) {
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</label>
    <input {...props} id={id} className="h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60" />
    {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-4">{hint}</p>}
  </div>;
}

export function AccountNotice({ error, message }: { error?: boolean; message: string | null }) {
  if (!message) return null;
  return <p role={error ? "alert" : "status"} className={`rounded-control px-3 py-2.5 text-[13px] leading-relaxed ${error ? "bg-hot-soft text-hot" : "bg-accent-soft text-accent"}`}>{message}</p>;
}
