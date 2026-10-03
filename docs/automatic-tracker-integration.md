# Automatic Ball Tracker Integration

## Status

This branch is the isolated integration workspace. The existing `main` branch is unchanged.

This document records the verified scoreboard integration points before automatic camera events are allowed to affect a live match.

## Verified scoreboard interfaces

- The control panel creates `BroadcastChannel("main_" + INSTANCE_ID)` and the browser source uses the matching instance convention.
- The ball tracker elements use IDs such as `ball 1`, `ball 2`, etc.
- Each ball element calls the existing `togglePot(element)` handler.
- `togglePot` is the authoritative scoring path. It updates `ballState`, broadcasts the tracker change, and applies game-specific scoring/undo/rack logic. The integration must call this path rather than writing local storage or overlay state directly.
- The browser source already receives the existing tracker messages; the integration should preserve that behavior.

## Proposed event contract

A camera adapter may report a *candidate* pocket event using this shape:

```json
{
  "type": "cuesport.vision.pocket-candidate",
  "version": 1,
  "eventId": "unique-event-id",
  "instance": "scoreboard-instance-id",
  "ballNumber": 3,
  "confidence": 0.97,
  "timestamp": 1791045124000
}
```

The receiver must validate the schema, instance, ball number, timestamp, confidence, and event ID. Events must be deduplicated. A candidate must never change the score on receipt. The current bridge places valid candidates in an operator review queue; only an explicit Confirm click calls the scoreboard scoring handler. Dismiss does not change the score. Candidates are deduplicated, checked against the scoreboard instance, and expire after a short review window. The 0.97 threshold is a conservative prototype gate, not a measured accuracy guarantee.

## Integration rules

1. Never write `ballState`, player scores, or overlay state directly from the vision process.\n2. Treat all vision output as untrusted suggestions; the operator remains the scoring authority.
2. Route only an operator-confirmed pocket candidate through the existing `togglePot(document.getElementById("ball " + ballNumber))` scoring handler, after checking that the ball is currently available and the game is not locked.
3. Do not toggle an already-faded ball. The action must be idempotent at the event layer.
4. Keep undo behavior owned by the scoreboard.
5. Do not assume the remote Floot dashboard can access scoreboard local storage or BroadcastChannel across origins. A same-origin bridge or authenticated relay is required.
6. Do not treat RGB segmentation as production-ready ball identity or pocket detection. Validate with recorded overhead-camera footage, occlusion cases, lighting changes, and operator review before enabling automatic scoring.

## Next implementation stages

- Add an operator-visible connection and arming control in the scoreboard.
- Add a same-origin receiver that validates candidate events and calls the existing scoring handler only when armed.
- Connect the camera service to that receiver through an authenticated, instance-scoped transport.
- Test all supported games and confirm that manual scoring, undo, OBS display, and multi-instance isolation remain unchanged.
