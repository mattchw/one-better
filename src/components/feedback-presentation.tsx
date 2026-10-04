import type { ReactNode } from "react";

export function FeedbackMetrics({ label, items, className = "" }: { label: string; items: { label: string; value: ReactNode }[]; className?: string }) {
  return <dl className={`feedback-metrics ${className}`} aria-label={label}>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function FeedbackDetails({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <details className={`feedback-details ${className}`}><summary><span>{title}</span><span aria-hidden="true">⌄</span></summary><div className="feedback-details-body">{children}</div></details>;
}

export function FinalizedLabel() {
  return <span className="feedback-finalized">✓ Finalized · read-only</span>;
}
