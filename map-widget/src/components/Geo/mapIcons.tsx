import { memo, type SVGProps } from "react";

const Sign = ({ children, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...props}
  >
    {children}
  </svg>
);

export const LayersIcon = memo(function LayersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M7 1.75 1.75 4.5 7 7.25l5.25-2.75L7 1.75Z" />
      <path d="M1.75 7 7 9.75 12.25 7" />
      <path d="M1.75 9.5 7 12.25l5.25-2.75" />
    </Sign>
  );
});

export const PlayIcon = memo(function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M4.25 2.75v8.5L11 7 4.25 2.75Z" fill="currentColor" />
    </Sign>
  );
});

export const PauseIcon = memo(function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props} strokeWidth={1.8}>
      <path d="M4.75 3v8M9.25 3v8" />
    </Sign>
  );
});

export const FitIcon = memo(function FitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M1.75 4.5V1.75H4.5M9.5 1.75h2.75V4.5M12.25 9.5v2.75H9.5M4.5 12.25H1.75V9.5" />
      <circle cx="5.25" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.75" cy="5.75" r="0.9" fill="currentColor" stroke="none" />
    </Sign>
  );
});

export const DrawIcon = memo(function DrawIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M9.4 2.3 11.7 4.6 5 11.3l-2.9.6.6-2.9 6.7-6.7Z" />
      <path d="M8.2 3.5 10.5 5.8" />
    </Sign>
  );
});

export const DrawPointIcon = memo(function DrawPointIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <Sign {...props}>
      <circle cx="7" cy="7" r="2.4" />
      <circle cx="7" cy="7" r="0.5" fill="currentColor" />
    </Sign>
  );
});

export const DrawLineIcon = memo(function DrawLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M2.6 10.6 6 5.2l2.6 3 2.8-5" />
      <circle cx="2.6" cy="10.6" r="1" fill="currentColor" />
      <circle cx="11.4" cy="3.2" r="1" fill="currentColor" />
    </Sign>
  );
});

export const DrawAreaIcon = memo(function DrawAreaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M7 2.2 12 6l-1.9 5.6H3.9L2 6l5-3.8Z" />
    </Sign>
  );
});

export const DrawRectangleIcon = memo(function DrawRectangleIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <Sign {...props}>
      <rect x="2.2" y="3.4" width="9.6" height="7.2" rx="0.6" />
    </Sign>
  );
});

export const DrawCircleIcon = memo(function DrawCircleIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <Sign {...props}>
      <circle cx="7" cy="7" r="4.8" />
    </Sign>
  );
});

export const DrawSelectIcon = memo(function DrawSelectIcon(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <Sign {...props}>
      <path d="M3.2 2.4 11 6.3 7.7 7.6l-1.4 3.4L3.2 2.4Z" />
    </Sign>
  );
});

export const MeasureIcon = memo(function MeasureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Sign {...props}>
      <path d="M2 9.4 9.4 2 12 4.6 4.6 12 2 9.4Z" />
      <path d="M4.3 7.1 5.4 8.2M6.2 5.2 7.9 6.9M8.1 3.3 9.2 4.4" />
    </Sign>
  );
});
