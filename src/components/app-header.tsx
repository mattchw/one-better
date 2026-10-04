/* Native links deliberately preserve unsaved-note/form beforeunload guards. */
import { AccountMenu } from "./account-menu";
type Section = "calendar" | "goals" | "focus" | "review" | "settings";
export function AppHeader({ section, accountName }: { section: Section; accountName?: string }) {
  return <header className="workspace-header app-header">
    <a className="brand" href="/calendar"><span className="brand-mark" aria-hidden="true"><i/><i/></span> One Better</a>
    <nav className="primary-nav" aria-label="Main navigation">
      {([['calendar','Calendar','/calendar'],['goals','Goals','/goals'],['focus','Focus','/focus'],['review','Review','/review']] as const).map(([key,label,url]) => <a key={key} href={url} aria-current={section===key?'page':undefined}>{label}</a>)}
    </nav>
    <div className="app-utilities">
      <a className="header-settings-link" href="/settings" aria-current={section==='settings'?'page':undefined}>Settings</a>
      <AccountMenu accountName={accountName}/>
    </div>
  </header>;
}
