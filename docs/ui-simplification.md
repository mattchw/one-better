# UI simplification — Standalone reference

Requested 4 October 2026. Reference: the supplied `One Better - Standalone.html`, including its embedded Calendar, Goals / Focus / Review and Settings layouts. The reference informs presentation; its demonstration data and mock interactions are not application behavior.

## Changes

- Keep the four primary destinations: Calendar, Goals, Focus and Review. Settings is a direct link, with its active state visible on Settings pages.
- Move account name, sign-out and secondary destinations into the avatar disclosure. Native keyboard access is retained; Escape closes it and restores focus, and clicking outside closes it. Sign-out still uses the existing authenticated command and full navigation.
- Reduce the desktop header from 72 to 64 pixels. Mobile retains its readable two-row navigation.
- Combine Calendar scale controls, layer legend, weekend toggle and refresh into one toolbar. Remove the repeated instruction text and extra control row, giving more height to the timeline. On mobile the legend wraps onto a quiet second line.
- Remove the duplicate commitment count badge. Commitment cards show scheduled time against budget, an explicit remaining-time Schedule action, or Scheduled with an Add time action. Extra scheduling still uses the existing exact-time editor and deterministic preview.
- Make each Goal title the preview selector. Keep editing and archiving reachable, with the selected preview's Open goal workspace link as the route into full goal editing. This removes the separate Preview button and keeps browsing within the page.
- Reduce heading spacing on Goals and keep the existing warm paper, white surfaces, quiet borders and local Geist fonts.

## Behavior retained

Shared Month / Week / Day dates, original weekly identities and budgets, guarded scheduling, Focus entry, unsaved-state handling, explicit reflection saves and finalization, availability privacy and AI evidence/validation are unchanged. There are no schema, provider, prompt or domain-service changes, no live provider calls and no new dependencies. Nine coaching source hashes match the R6A frozen contract record.

## Verification

Browser tests run against disposable synthetic databases; production accounts and Google/ChatGPT connections are preserved. The separate R5G experiment is unchanged.

| Check | Observed result |
| --- | --- |
| Full browser run | 152 / 159 passed, 11.8 minutes; seven failures identified changed navigation locators and a Goal heading-name regression |
| Affected workflows rerun | 45 / 46 passed, 2.8 minutes; all prior failures resolved except the new outside-click test targeted a heading covered by the mobile dropdown |
| Final account/navigation run | 5 / 5 passed, 9.6 seconds, with an unobstructed outside-click target |
| Combined browser coverage | All 159 distinct cases have passing results; repeated tests are not counted as additional cases |
| Typecheck | PASS; final production build also validates TypeScript |
| ESLint | PASS, zero warnings |
| Production build | PASS; compilation 4.7 seconds, TypeScript 5.1 seconds |
| AI contract hashes | All nine match the R6A baseline |
| Local app | Port 3100 health and sign-in return 200 |

Changed test navigation now follows Goal title → selected preview → Open goal workspace, and direct Settings → Settings sections. Domain and persistence assertions remain intact. The Goal heading retains the exact Goal title as its accessible name while the title button explains its Preview action. Native account-menu disclosure is tested by its accessible label. The existing ChatGPT dynamic-filesystem tracing warning remains in the production build.

## Visual walkthrough

Production QA used `node --env-file=.env.test --import tsx scripts/ui-simplification-walkthrough.ts`. It creates a disposable database and synthetic account on **localhost:3104**, with separate cookies from the normal **127.0.0.1:3100** app. Real Google/OpenAI/Anthropic credentials are disabled for that process.

Desktop walkthrough verified the compact toolbar, account-menu opening and Escape/focus restoration, Goal editing and saved title persistence through the full workspace, preview selection without navigation, and the explicit Open goal workspace path. Two synthetic Goals were renamed through the normal UI to distinguish the fixture's repeated default titles. The database was removed after the walkthrough. No production user data was edited.

An in-app browser debugger interruption prevented completing the additional native mobile walkthrough. Automated responsive Calendar and account-menu checks passed on mobile; the mobile screenshots below come from that browser test run. Desktop manual screenshots and automated responsive screenshots are kept separate.

| Surface | Evidence |
| --- | --- |
| Desktop Calendar, production walkthrough | [Screenshot](ui-simplification-evidence/calendar.jpg) |
| Desktop Goals, production walkthrough | [Screenshot](ui-simplification-evidence/goals.jpg) |
| Account menu, production walkthrough | [Screenshot](ui-simplification-evidence/account-menu.jpg) |
| Desktop Month, automated fixture | [Screenshot](ui-simplification-evidence/desktop-month.png) |
| Mobile Month, automated fixture | [Screenshot](ui-simplification-evidence/mobile-month.png) |
| Mobile Day, automated fixture | [Screenshot](ui-simplification-evidence/mobile-day.png) |

Prior R6A screenshot evidence was preserved separately. See [verification metadata](ui-simplification-evidence/verification.json).

## Remaining design choices

The avatar adds one click to sign-out and the less frequent planning/account destinations. Core tabs and Settings remain immediately visible. The Calendar still owns internal scrolling for its full 24-hour timeline. Goal lifecycle controls remain visible to preserve easy editing and archiving; no new menu or hidden mutation flow is introduced.
