# Automatic Ball Tracker Integration

## Status

This branch is the isolated integration workspace. The existing `main` branch is unchanged.

The scoreboard-side receiver is implemented as a review-first prototype. It accepts same-origin BroadcastChannel candidate events and never changes the score merely because a camera event arrived.

## Verified scoreboard interfaces

- The control panel creates `BroadcastChannel("main_" + INSTANCE_ID)` and the browser source uses the matching instance convention.
- Ball tracker elements use IDs such as `ball 1`, `ball 2`, etc.
- Each ball element calls the existing `togglePot(element)` handler.
- `togglePot` is the authoritative scoring path. It updates `ballState`, broadcasts the tracker change, and applies game-specific scoring/undo/rack logic.
- The browser source already receives the existing tracker messages; the integration must preserve that behavior.

## Candidate event contract

A camera adapter may report a candidate pocket event using this shape:

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

The receiver validates event type/version, scoreboard instance, ball number, timestamp, confidence, and event ID. Events are deduplicated. The current prototype requires confidence >= 0.97; this is a conservative software gate, not a measured accuracy guarantee.

## Current review behavior

- Valid candidates enter an operator-visible review queue.
- Each candidate has **Confirm pocket** and **Dismiss** actions.
- Receiving a candidate never changes the score. Only an explicit Confirm click calls the existing `togglePot()` scoring handler.
- Candidates expire 15 seconds after they enter the review queue.
- The bridge checks that the ball exists, is not already faded, and scoring is not locked.
- The bridge limits duplicate events and rapid repeat confirmations for the same ball.
- Dismissal never changes the score.

## Integration rules

1. Never write `ballState`, player scores, or overlay state directly from the vision process.
2. Treat all vision output as untrusted suggestions; the operator remains the scoring authority.
3. Route only an operator-confirmed candidate through `togglePot(document.getElementById("ball " + ballNumber))`.
4. Do not toggle an already-faded ball. Keep undo behavior owned by the scoreboard.
5. Do not assume the remote Floot dashboard can access scoreboard local storage or BroadcastChannel across origins. A same-origin bridge or authenticated relay is required.
6. Do not treat RGB segmentation as production-ready ball identity or pocket detection. Validate with recorded overhead-camera footage, occlusion cases, lighting changes, and operator review before enabling automatic scoring.

## Remaining implementation stages

- [x] Add a same-origin receiver that validates candidate events and queues them for operator review.
- [x] Add Confirm and Dismiss controls; no camera event scores automatically.
- [ ] Connect the Floot camera service to the receiver through an authenticated, instance-scoped transport.
- [ ] Replace rough RGB segmentation with calibrated ball detection, identity tracking, and pocket-transition detection.
- [ ] Test all supported games and confirm manual scoring, undo, OBS display, and multi-instance isolation remain unchanged.
