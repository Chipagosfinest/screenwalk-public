# Journey recipe reference

Journey recipes record one named path in one browser session. A terminal assertion can turn a route recording into a checked outcome, and each attempt writes an append-only local receipt whether it passes, fails, or errors.

The compatibility version remains `screenbranch.recipe.v0`.

## A checked journey

```json
{
  "schemaVersion": "screenbranch.recipe.v0",
  "journeys": [
    {
      "id": "checkout-v2",
      "title": "Complete the new checkout",
      "startRoute": "/cart",
      "steps": [
        {
          "targetRoute": "/checkout",
          "conditions": [
            {
              "kind": "access",
              "label": "signed in",
              "evidence": "declared"
            },
            {
              "kind": "feature-flag",
              "label": "new checkout enabled",
              "key": "checkout_v2",
              "value": true,
              "evidence": "declared"
            }
          ],
          "conditionLogic": "all",
          "trigger": { "role": "button", "name": "Checkout" }
        }
      ],
      "terminalAssertion": {
        "type": "visible-role",
        "role": "heading",
        "name": "Review your order"
      }
    }
  ]
}
```

Run it from the private checkout:

```bash
pnpm --filter @screenbranch/capture record /absolute/path/to/graph.json \
  --base-url http://127.0.0.1:3000 \
  --assets-dir /absolute/path/to/captures \
  --asset-prefix /captures \
  --out /absolute/path/to/graph.json \
  --recipe /absolute/path/to/journey.recipe.json \
  --receipts-dir /absolute/path/to/journey-runs
```

## Terminal assertions

The bounded assertion set is:

- `visible-text` with `text`;
- `visible-role` with an accessible `role` and exact `name`;
- `test-id` with `value`.

Reaching `targetRoute` proves navigation. A passing terminal assertion proves only that the named visible end condition held in that run. It does not prove accessibility, authorization, data integrity, or every alternate branch.

Recipes without a terminal assertion remain supported and are labeled `recorded-unverified`.

## Same-route modals and drawers

Routes are not the only meaningful product states. A recipe can explicitly target a modal, drawer, or popover that appears after a safe click without changing the URL:

```json
{
  "targetRoute": "/dashboard",
  "targetPresentation": {
    "kind": "drawer",
    "role": "dialog",
    "name": "Invite teammates"
  },
  "trigger": { "role": "button", "name": "Invite people" }
}
```

`role` and `name` are exact accessible locators. Screenwalk waits for that visible target, confirms the browser stayed on `targetRoute`, verifies that the rendered presentation matches `kind`, then records a separate captured screen state and observed transition.

Presentation detection stays explicit: modals use an open native `<dialog>` or `[role="dialog"][aria-modal="true"]`; drawers use `data-screenwalk-presentation="drawer"` or `data-screenwalk-drawer` with `data-state="open"`; popovers use the native open popover state.

This is deliberately recipe-driven. Screenwalk does not click arbitrary buttons or enumerate every DOM mutation. Use it for a meaningful review state whose trigger is safe and whose accessible outcome is known. Supported target roles are `dialog`, `region`, `complementary`, and `menu`.

## Conditional relationships

Conditions explain why one edge exists. They do not execute a feature-flag provider or reproduce its targeting rules.

Supported condition kinds are `access`, `choice`, `feature-flag`, `experiment`, `data-state`, `environment`, and `other`. Up to four conditions can be joined with `conditionLogic: "all"` or `"any"`.

Use `evidence` honestly:

- `declared` means the recipe author supplied the condition;
- `observed` means runtime evidence established the exact value;
- `inferred` means Screenwalk or a person concluded it from indirect evidence.

For feature flags, record the resolved flag key and value when they are available. Do not copy a provider's full targeting context into the recipe or receipt: user identifiers, email addresses, tenant secrets, and reusable credentials stay outside Screenwalk artifacts.

One passing `checkout_v2 = true` receipt says nothing about the `false` branch. Record that context separately before calling both branches covered.

## A/B and variant QA

Put each materially different variant in its own named journey with its own condition value and terminal assertion. A QA matrix is covered only when both receipts pass:

```json
{
  "schemaVersion": "screenbranch.recipe.v0",
  "journeys": [
    {
      "id": "onboarding-a",
      "title": "Variant A: guided setup",
      "startRoute": "/onboarding",
      "steps": [{
        "targetRoute": "/onboarding/profile",
        "conditions": [{ "kind": "experiment", "label": "guided setup", "key": "onboarding", "value": "A", "evidence": "declared" }],
        "trigger": { "role": "button", "name": "Personalize" }
      }],
      "terminalAssertion": { "type": "visible-role", "role": "heading", "name": "Tell us about yourself" }
    },
    {
      "id": "onboarding-b",
      "title": "Variant B: skip setup",
      "startRoute": "/onboarding",
      "steps": [{
        "targetRoute": "/dashboard",
        "conditions": [{ "kind": "experiment", "label": "skip setup", "key": "onboarding", "value": "B", "evidence": "declared" }],
        "trigger": { "role": "button", "name": "Skip for now" }
      }],
      "terminalAssertion": { "type": "visible-role", "role": "heading", "name": "Dashboard" }
    }
  ]
}
```

Screenwalk records the variant a recipe declares; it does not configure the experiment provider. The setup or test environment remains responsible for making that variant active. Deliberately broken A and B recipes should also fail independently in certification so one passing side cannot hide a stale assertion on the other.

## Run receipts

Every attempt writes a `screenwalk.journey-run.v0` JSON receipt containing:

- recipe hash, journey, persona, viewport, and browser version;
- pass, fail, or error status;
- whether a terminal outcome was asserted;
- visited node and edge IDs;
- terminal assertion and result;
- declared branch conditions;
- local graph and screenshot paths;
- a nullable trace path reserved for a later explicit trace integration.

Repeated runs use unique run IDs and append new receipt files, even when the recipe content is unchanged.

Screenwalk does not capture a Playwright trace implicitly. The current slice keeps receipts small and avoids silently persisting DOM, network, storage, or credential-bearing trace data.
