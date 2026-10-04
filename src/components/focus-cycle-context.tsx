import Link from 'next/link';
import type {CycleWorkspace} from '@/modules/focus-cycles/domain';
export function FocusCycleContext({workspace,compact=false,locked=false}:{workspace?:CycleWorkspace|null;compact?:boolean;locked?:boolean}){
 const c=workspace?.current;
 if(!c)return null;
 return <div className={`cycle-context ${compact?'cycle-context-compact':''}`} aria-label="Current Focus Cycle"><span className="eyebrow">Current focus</span>{locked?<span className="cycle-context-title" aria-disabled="true">{c.title}</span>:<Link href="/goals">{c.title}</Link>}<span className="small-note">{c.startDate} → {c.endDate}{!compact&&' · Current context; saved plans remain unchanged.'}</span></div>;
}
