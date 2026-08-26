# Evidence and safety

Screenwalk is useful only when it is clear about what it knows.

## Evidence language

| Label | Meaning |
| --- | --- |
| Static | Found in source; not proof that a visitor can reach it. |
| Observed | Rendered or followed by the browser in this run. |
| Captured | A screenshot exists for this viewport and access view. |
| Unobserved | Known without current browser proof. |
| Unconnected | No entry path exists in current evidence. |

A source candidate verified in the browser gains another receipt; runtime evidence never overwrites its provenance.

## Identity evidence

A URL difference is not automatically a screen difference. Screenwalk groups concrete records under a route-template family, keeps known view-driving query/hash values as variants, and attaches viewport and access conditions as capture context. Generated IDs, tracking parameters, timestamps, cursors, and other volatile values do not create top-level screens.

Ambiguous parameters are not silently classified. Studio marks the grouping for review and the copied agent prompt preserves the reason. Use a project `screenwalk.identity.json` policy when a product-specific parameter should intentionally split or merge variants.

## Safe discovery

Automatic discovery is bounded by origin, depth, screen count, and action policy. It follows visible same-origin anchors but does not submit forms or click arbitrary buttons. Routes with names suggesting consequential actions are withheld.

The narrow exception is an explicit setup recipe used to establish an access session. Recipe actions are accessibility-targeted and secrets are resolved from the command environment.

## Local-first artifacts

Captures and graphs remain in the local checkout. Treat screenshots as potentially sensitive: they may contain private UI or test data even when Screenwalk correctly omits credentials.

Screenwalk reports console, page, request, and HTTP failures as observations active during capture. Their presence does not prove causality.

## No completeness claim

Unknown, static-only, declared, inferred, observed, and captured evidence remain distinct. A clean map means no issue was found within the current bounds—not that every possible product state was proven.
