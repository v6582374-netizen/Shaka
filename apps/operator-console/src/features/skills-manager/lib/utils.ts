import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists used by the vendored Skills Manager surface. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
