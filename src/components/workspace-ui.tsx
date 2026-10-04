import type { ReactNode } from "react";
export function Panel({ children, className = "", label, tabIndex }: { children: ReactNode; className?: string; label?: string; tabIndex?:number }) { return <section className={`workspace-panel ${className}`} aria-label={label} tabIndex={tabIndex}>{children}</section>; }
export function Metric({ label, value, emphasis = false }: { label: string; value: ReactNode; emphasis?: boolean }) { return <div className={`canvas-metric ${emphasis?'metric-emphasis':''}`}><dt>{label}</dt><dd>{value}</dd></div>; }
export function EmptyState({ title, children }: { title: string; children: ReactNode }) { return <div className="canvas-empty"><span aria-hidden="true" className="empty-mark">↗</span><h2>{title}</h2>{children}</div>; }
