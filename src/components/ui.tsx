import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-400",
  secondary: "bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-100 disabled:text-zinc-400",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300",
  ghost: "text-zinc-700 hover:bg-zinc-200 disabled:text-zinc-400",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-900",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-lg border border-zinc-200 bg-white p-4", className)}>
      {title && <h2 className="mb-3 text-sm font-semibold text-zinc-700">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "amber" | "green" | "red" | "blue" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    amber: "bg-amber-100 text-amber-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return <span className={clsx("inline-block rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}
