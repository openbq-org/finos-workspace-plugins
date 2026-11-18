import { useEffect, useState } from "react";
import Icon from "~/components/Icon";
import { copyText } from "~/host";

const FEEDBACK_MS = 1_500;

export function CopyButton({
  text,
  className = "",
  "aria-label": label,
}: {
  text: string;
  inlineFeedback?: boolean;
  className?: string;
  "aria-label": string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() =>
        copyText(text).then(
          () => setCopied(true),
          () => {},
        )
      }
      className={`inline-flex items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover ${className}`}
    >
      <Icon id={copied ? "check" : "copy"} className="size-full" />
    </button>
  );
}
