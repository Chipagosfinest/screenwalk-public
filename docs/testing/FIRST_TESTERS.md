# Screenwalk designer test

Screenwalk is a local review loop for real web products. The builder prepares a bounded capture; the designer reviews one actual path, writes two specific changes, and returns one clean brief for the next implementation round.

The target code, browser session, captures, and notes stay on the machine running Screenwalk. Only the text you deliberately copy leaves Studio.

## Before the session

The builder should start an app the designer knows and run Screenwalk before the call. Designers should not have to install Node or debug a dev server to evaluate the review experience.

```bash
git clone https://github.com/Chipagosfinest/screenwalk-public.git
cd screenwalk-public
pnpm install
pnpm screenwalk /absolute/path/to/your-app --url http://127.0.0.1:3000
```

Use a sanitized app or synthetic fixture if its UI cannot be shown to the tester. Never put credentials in a Screenwalk recipe.

## The 15-minute test

Do not explain the interface before the timer starts.

1. **Orient, 0–2 minutes.** Ask the designer to identify the product, viewport, environment/access context, selected path, and what Screenwalk actually opened.
2. **Walk, 2–5 minutes.** Choose one real path and **Play** it. Ask what action connects each screen and whether any `If …` condition is clear.
3. **Critique, 5–10 minutes.** Open two screens. For each, write one unique **What should change?** and an observable **Done when**. Choose **Copy change brief**.
4. **Change context, 10–13 minutes.** Switch desktop/mobile or use a separately captured signed-in, flag, A/B, staging, or production context. Ask what changed and what may still be missing.
5. **Return the brief, 13–15 minutes.** Paste the copied brief into a safe shared channel and answer the questions below.

The map uses three separate relationship cues: a line names the action between screens; `If …` names a condition; the environment/revision names where the UI was observed. An unconnected screen is not automatically dead.

## What success looks like

- the designer explains Screenwalk's job in under 60 seconds;
- the designer creates a useful brief without coaching;
- each requested change has an observable completion check;
- the designer distinguishes observed UI from an unproven path;
- the brief is more useful than a screenshot plus loose prose;
- the designer wants to inspect the result after implementation.

## What to send back

```text
What is Screenwalk for, in your words?
Where did you expect to click but could not?
What context was missing from the path or screen?
Was the copied brief better than a screenshot, Loom, or Figma comment? Why?
What proof would make you return after the implementation?
What was misleading?
The one thing that felt janky:
```

Submit the answers through the [public-beta feedback form](https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml) or send the text directly to the person who invited you. Do not include secrets, customer data, or unredacted sensitive captures.

## Invite copy

> I’m opening up Screenwalk, a local tool I made because AI-built apps get hard to review as whole products. It maps the screens and paths the app actually exposes, then turns screen-specific critique into a clean change brief a developer or coding agent can act on. Could I borrow 15 minutes? I’ll handle the setup; you’ll review one real path, leave two specific edits, and tell me what feels missing or misleading. No prep, and I care more about blunt feedback than a polished demo. The repo is public, but the app captures and notes stay local unless you choose to send me the copied brief.
