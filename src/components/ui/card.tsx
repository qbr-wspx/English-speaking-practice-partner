import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/10 bg-[#241b18]/78 shadow-[0_24px_80px_rgba(0,0,0,.24)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

