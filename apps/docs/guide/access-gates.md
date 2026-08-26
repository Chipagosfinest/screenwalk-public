# Capture password-gated UI

By default, Screenwalk records what a public visitor can reach, including a login or password wall. A setup recipe can establish one additional access view in a fresh browser context without erasing the public map.

```bash
SCREENWALK_PREVIEW_PASSWORD="your-local-or-preview-password" \
  npx screenwalk /absolute/path/to/app \
  --url http://127.0.0.1:3000 \
  --setup /absolute/path/to/preview.setup.json
```

Studio then shows an access selector such as **Public / Preview access** alongside **Desktop / Mobile**.

## A bounded recipe

```json
{
  "schemaVersion": "screenbranch.setup.v0",
  "persona": "preview",
  "label": "Preview access",
  "startRoute": "/access",
  "actions": [
    {
      "type": "fill",
      "locator": {"kind": "label", "name": "Password"},
      "valueFromEnv": "SCREENWALK_PREVIEW_PASSWORD"
    },
    {
      "type": "click",
      "locator": {"kind": "role", "role": "button", "name": "Come in"}
    },
    {"type": "waitForRoute", "route": "/"}
  ]
}
```

The file stores an environment variable **name**, never a credential value. Cookies remain inside that capture context. Screenwalk does not write the password or reusable browser state to graphs, screenshots, logs, manifests, or the repository.

Use this path for local or preview password gates and controlled test accounts. CAPTCHA, MFA, OAuth consent, and arbitrary scripts require a human handoff and are not automated.

See the [setup recipe reference](/reference/setup-recipes) for the versioned contract.
