import React, { type ReactNode, type TableHTMLAttributes } from "react";
export function Table({ children, ...props }: TableHTMLAttributes<HTMLTableElement>) { return <div className="ml-table-wrap"><table className="ml-table" {...props}>{children}</table></div>; }
export function Form({ children, onSubmit, ...props }: React.FormHTMLAttributes<HTMLFormElement>) { return <form onSubmit={onSubmit} {...props}>{children}</form>; }
export function Chart({ label, children }: { label: string; children: ReactNode }) { return <figure className="ml-card" aria-label={label}>{children}<figcaption>{label}</figcaption></figure>; }
