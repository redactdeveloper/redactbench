export type IconName =
  | "book"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "code"
  | "cube"
  | "download"
  | "file"
  | "home"
  | "list"
  | "menu"
  | "plus"
  | "shield"
  | "sort"
  | "warning"
  | "x";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
    viewBox: "0 0 24 24",
    width: size
  };

  switch (name) {
    case "home":
      return <svg {...common} aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>;
    case "list":
      return <svg {...common} aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case "code":
      return <svg {...common} aria-hidden="true"><path d="m8 5-5 7 5 7M16 5l5 7-5 7M14 3l-4 18"/></svg>;
    case "cube":
      return <svg {...common} aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z"/><path d="M12 12v10"/></svg>;
    case "book":
      return <svg {...common} aria-hidden="true"><path d="M4 4h5a3 3 0 0 1 3 3v13a4 4 0 0 0-4-4H4V4ZM20 4h-5a3 3 0 0 0-3 3v13a4 4 0 0 1 4-4h4V4Z"/></svg>;
    case "menu":
      return <svg {...common} aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    case "plus":
      return <svg {...common} aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;
    case "chevron-down":
      return <svg {...common} aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>;
    case "chevron-right":
      return <svg {...common} aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>;
    case "sort":
      return <svg {...common} aria-hidden="true"><path d="m8 7 4-4 4 4M16 17l-4 4-4-4M12 3v18"/></svg>;
    case "download":
      return <svg {...common} aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>;
    case "check":
      return <svg {...common} aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
    case "warning":
      return <svg {...common} aria-hidden="true"><path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg>;
    case "file":
      return <svg {...common} aria-hidden="true"><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></svg>;
    case "shield":
      return <svg {...common} aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>;
    case "clock":
      return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>;
    case "x":
      return <svg {...common} aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>;
  }
}
