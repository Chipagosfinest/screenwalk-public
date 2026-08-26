# Quickstart

Go from a running web app to an actual-UI product map. The happy path uses one Screenwalk command and should take less than five minutes after the repository is installed.

## 1. Install Screenwalk

Screenwalk is a public source beta, so run it from this repository:

```bash
git clone https://github.com/Chipagosfinest/screenwalk-public.git
cd screenwalk-public
pnpm install
```

The verified beta environment uses Node.js 22 and pnpm 11.18.0, with a Chromium-based browser available to Playwright or Chrome.

## 2. Start the app you want to map

Use its normal development command. For example:

```bash
cd /absolute/path/to/your-app
pnpm dev
```

Leave that process running and note the exact local URL. Screenwalk connects to an existing app; it never guesses or replaces your dev server.

## 3. Build the map

```bash
pnpm screenwalk /absolute/path/to/your-app \
  --url http://127.0.0.1:3000
```

You should see four named phases in the terminal—connect, scan, capture, and Studio—followed by an opened browser tab.

Expected shape:

```text
[1/4] Connecting to the running app…
[2/4] Scanning routes and source links…
[3/4] Capturing desktop UI and observing safe branches…
Map ready · … useful desktop screens · … observed transitions
[4/4] Opening the local Studio…
```

Counts vary by app. A successful run ends with **Map ready** and a Studio URL; a connection or capture failure prints an actionable error code instead.

### Monorepos and deployed environments

Inventory a repository before choosing a browser surface:

```bash
pnpm screenwalk inspect /absolute/path/to/repository --out /tmp/screenwalk-topology.json
```

The inventory distinguishes browser apps, APIs, workers, deployment configuration, public integration contracts, feature-flag providers, and documented environment URLs. Configuration, dependency, and bounded source-reference labels are discovery evidence—not proof that a service or flag is active. Screenwalk does not read flag values or generate a flag combination matrix.

When multiple browser surfaces exist, select one and name the environment explicitly:

```bash
pnpm screenwalk /absolute/path/to/repository \
  --url https://preview.example.com \
  --service apps-web \
  --environment staging \
  --deployment-id exact-platform-deployment-id
```

Every resulting run carries the selected service, environment, target URL, capture context, and—when the project is a git checkout—the actual SHA, branch, and dirty state read by Screenwalk. Production and staging should be captured from clean checkouts of the source revision that produced each deployment. A comparison receives a runtime label only when both graphs contain completed captures, clean graph-owned revisions, and matching graph-owned deployment URLs. CLI labels can validate that evidence but cannot create it. A difference between environments is something to review, not automatically a regression.

If the run cannot start, diagnose the same target without capturing it:

```bash
pnpm screenwalk doctor /absolute/path/to/your-app \
  --url http://127.0.0.1:3000
```

## 4. Make the first review

In Studio:

1. Read **N of M screens opened** — screens Screenwalk successfully opened, not just pages it found in code.
2. Click the starting screen. Don’t describe it; point at it. The inspector shows what led here and what opens next.
3. Choose **Play** to walk the path.
4. On one screen, write **What should change?** and an observable **Done when**, then choose **Copy change brief** for the next implementation round.
5. Open **Things to check** for anything Screenwalk could not confirm.

The canvas views answer different questions:

- **Map** — screens and the paths Screenwalk could prove.
- **Screens** — captured UI without route lines.
- **Desktop / Mobile** — separate evidence, not a CSS scale.

You have reached first value when you can answer one question you could not answer from a route list alone: *What rendered? What can a visitor reach? Which screen or path still needs proof?*

## Try Screenwalk without another project

The repository includes a plain HTML fixture:

```bash
# Terminal 1
pnpm --dir fixtures/html-app dev

# Terminal 2, from the Screenwalk repository
pnpm screenwalk fixtures/html-app --url http://127.0.0.1:3111
```

Next: [learn what Screenwalk observes and what it refuses to guess](/guide/how-it-works).

Using another stack? Open the [framework cookbook](/guide/frameworks).
