# Setup recipe reference

Setup recipes establish a bounded browser access state before capture. The current schema version is `screenbranch.setup.v0`; that compatibility identifier remains stable even though the product name is Screenwalk.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | Yes | Must be `screenbranch.setup.v0`. |
| `persona` | Yes | Stable machine identifier for the access view. |
| `label` | Yes | Human-readable Studio label. |
| `startRoute` | Yes | Same-origin route where setup begins. |
| `actions` | Yes | Ordered bounded actions. |

## Actions

### Fill

Resolves a secret from the command environment and fills an accessibility-targeted field.

```json
{
  "type": "fill",
  "locator": {"kind": "label", "name": "Password"},
  "valueFromEnv": "SCREENWALK_PREVIEW_PASSWORD"
}
```

### Click

Activates an accessibility-targeted element.

```json
{
  "type": "click",
  "locator": {"kind": "role", "role": "button", "name": "Come in"}
}
```

### Wait for route

Waits for the expected same-origin route before capture continues.

```json
{"type": "waitForRoute", "route": "/"}
```

## Credential boundary

Never put a password, cookie, token, or reusable browser state in a setup file. `valueFromEnv` names the environment variable Screenwalk resolves at runtime. Missing variables fail with `SB_SETUP_ENV_MISSING` before the protected capture proceeds.
