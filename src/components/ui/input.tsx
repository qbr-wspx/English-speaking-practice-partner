import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-[#7f7066] focus:border-[#ff9c6f]/70 focus:ring-2 focus:ring-[#ff7549]/15",
        className,
      )}
      {...props}
    />
  );
}

