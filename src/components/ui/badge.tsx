import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/7 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d9c9ba]",
        className,
      )}
      {...props}
    />
  );
}

