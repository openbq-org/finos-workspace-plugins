const PATHS: Record<string, string> = {
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-left": "m15 6-6 6 6 6",
  "chevron-down": "m6 9 6 6 6-6",
  "x-close": "M6 6l12 12M18 6 6 18",
  "trash-02":
    "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  "minus-icon": "M5 12h14",
  "radix-icons-reset": "M4 12a8 8 0 1 0 3-6.2M4 4v4h4",
  "table-02": "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  "eye-opened-icon":
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-closed-icon":
    "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.4 7.7A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4-.9",
  copy: "M9 9h11v11H9zM5 15V4h11",
  check: "m5 12 5 5 9-10",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
};

export default function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[id]} />
    </svg>
  );
}
