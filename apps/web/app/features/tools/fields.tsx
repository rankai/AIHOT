import type { ReactNode } from "react";

export function ToolField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>{children}{hint && <span className="mt-1 block text-[12px] text-ink-4">{hint}</span>}</label>;
}
