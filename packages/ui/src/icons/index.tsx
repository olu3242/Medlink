import React, { type SVGProps } from "react";
export type IconName = "menu" | "search" | "bell" | "chevron" | "check" | "close";
const paths: Record<IconName, string> = { menu: "M4 7h16M4 12h16M4 17h16", search: "m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4", chevron: "m9 18 6-6-6-6", check: "m5 12 4 4L19 6", close: "M6 6l12 12M18 6 6 18" };
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>; }
