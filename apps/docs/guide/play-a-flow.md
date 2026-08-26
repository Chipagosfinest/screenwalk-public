# Play a flow

Use playback when the shape of the graph is less important than the experience of moving through it.

## Start from a screen

1. Open **From Home** or click a screen in **All screens**.
2. Choose **Trace selected path**.
3. Move with **Back**, **Next**, or a visible branch choice.
4. Use **Restart** to return to the first captured state.

The screen on the canvas, the path rail, and the evidence panel stay tied to the same selected step.

## What playback represents

Playback uses durable browser captures and observed transition receipts. It is a review composition, not a live clone of the application and not proof that every transient state was visited.

If a step lacks a capture, Screenwalk shows that gap instead of inventing a frame. If a branch was found only in source, it remains labeled separately from a browser-observed transition.

## Choose the right viewport and access view

**Desktop / Mobile** selects independently captured responsive states. When an access recipe exists, **Public / Preview access** selects independently captured browser contexts. Evidence never crosses from one context into the other.

## Share the path with an agent

Use **Select screens** for an arbitrary review set, or copy the active path from the findings workflow. The handoff includes route identity, source evidence, capture status, and reachability context so an agent does not treat a screenshot as the whole truth.
