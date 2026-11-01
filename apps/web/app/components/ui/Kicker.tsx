import type { ReactNode } from "react";

/** A quiet editorial label, led by the brand's short signal bar. */
export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 text-[12px] font-medium text-accent ${className}`}>
      <span className="h-px w-6 bg-accent" aria-hidden="true" />
      {children}
    </div>
  );
}
