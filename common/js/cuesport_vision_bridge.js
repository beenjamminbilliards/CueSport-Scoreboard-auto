/*
 * CueSport Vision bridge
 *
 * Receives pocket-candidate events from a same-origin camera adapter through
 * BroadcastChannel. It deliberately routes accepted events through togglePot()
 * so the scoreboard remains the owner of scoring, undo, and overlay updates.
 */
(function () {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    const instanceId = params.get("instance") || "";
    const channelName = "cuesport-vision-" + instanceId;
    const MIN_CONFIDENCE = 0.97;
    const MAX_EVENT_AGE_MS = 3000;
    const EVENT_RETENTION_MS = 30000;
    const BALL_COOLDOWN_MS = 1200;

    let armed = false;
    let channel = null;
    let lastAcceptedAt = Object.create(null);
    const seenEvents = new Map();

    function status(message, isError) {
        const output = document.getElementById("cuesportVisionStatus");
        if (!output) return;
        output.textContent = message;
        output.dataset.state = isError ? "error" : "normal";
    }

    function setArmed(next) {
        armed = !!next;
        const button = document.getElementById("cuesportVisionArm");
        if (button) {
            button.textContent = armed ? "Automatic scoring: ARMED" : "Automatic scoring: OFF";
            button.setAttribute("aria-pressed", armed ? "true" : "false");
        }
        status(armed ? "Armed — high-confidence camera events can score." : "Disarmed — camera events cannot change scores.", false);
    }

    function validEvent(event) {
        if (!event || typeof event !== "object") return "Invalid event.";
        if (event.type !== "cuesport.vision.pocket-candidate" || event.version !== 1) return "Unsupported event.";
        if (!instanceId || event.instance !== instanceId) return "Wrong scoreboard instance.";
        if (typeof event.eventId !== "string" || event.eventId.length < 8 || event.eventId.length > 160) return "Invalid event ID.";
        if (!Number.isInteger(event.ballNumber) || event.ballNumber < 1 || event.ballNumber > 15) return "Invalid ball number.";
        if (typeof event.confidence !== "number" || !Number.isFinite(event.confidence) || event.confidence < MIN_CONFIDENCE || event.confidence > 1) return "Confidence below threshold.";
        if (!Number.isFinite(event.timestamp) || Math.abs(Date.now() - event.timestamp) > MAX_EVENT_AGE_MS) return "Event is stale or timestamp is invalid.";
        return "";
    }

    function handleMessage(message) {
        const event = message && message.data;
        const problem = validEvent(event);
        if (problem) {
            if (armed) status(problem, true);
            return;
        }
        if (seenEvents.has(event.eventId)) return;
        seenEvents.set(event.eventId, Date.now());

        // Keep the deduplication cache bounded.
        for (const [id, time] of seenEvents) {
            if (Date.now() - time > EVENT_RETENTION_MS) seenEvents.delete(id);
        }

        if (!armed) {
            status("Camera candidate received. Automatic scoring is OFF.", false);
            return;
        }

        const ballId = "ball " + event.ballNumber;
        const ball = document.getElementById(ballId);
        if (!ball) {
            status("Ball " + event.ballNumber + " is not present in this game's tracker.", true);
            return;
        }
        if (ball.classList.contains("faded")) {
            status("Ignored: ball " + event.ballNumber + " is already marked pocketed.", false);
            return;
        }
        if (typeof window.togglePot !== "function") {
            status("Scoreboard scoring handler is unavailable.", true);
            return;
        }
        if (typeof window.isGameScoringLocked === "function" && window.isGameScoringLocked()) {
            status("Ignored: scoreboard scoring is locked.", true);
            return;
        }

        const now = Date.now();
        if (lastAcceptedAt[event.ballNumber] && now - lastAcceptedAt[event.ballNumber] < BALL_COOLDOWN_MS) return;
        lastAcceptedAt[event.ballNumber] = now;

        try {
            Promise.resolve(window.togglePot(ball)).then(function () {
                status("Scored camera-confirmed ball " + event.ballNumber + ".", false);
            }).catch(function (error) {
                status("Scoreboard rejected ball " + event.ballNumber + ": " + (error && error.message ? error.message : "unknown error"), true);
            });
        } catch (error) {
            status("Could not score ball: " + (error && error.message ? error.message : "unknown error"), true);
        }
    }

    function mountControls() {
        if (document.getElementById("cuesportVisionControls")) return;
        const tracker = document.getElementById("ballTrackerDiv");
        if (!tracker || !tracker.parentNode) return;

        const panel = document.createElement("section");
        panel.id = "cuesportVisionControls";
        panel.style.cssText = "margin:10px 0;padding:10px;border:1px solid #777;border-radius:8px;";
        const button = document.createElement("button");
        button.id = "cuesportVisionArm";
        button.type = "button";
        button.textContent = "Automatic scoring: OFF";
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", function () { setArmed(!armed); });

        const output = document.createElement("div");
        output.id = "cuesportVisionStatus";
        output.setAttribute("role", "status");
        output.setAttribute("aria-live", "polite");
        output.style.cssText = "margin-top:6px;font-size:0.9em;";
        output.textContent = "Vision bridge ready. Automatic scoring is OFF.";

        panel.appendChild(button);
        panel.appendChild(output);
        tracker.parentNode.insertBefore(panel, tracker.nextSibling);
    }

    function start() {
        mountControls();
        if (typeof BroadcastChannel === "undefined") {
            status("This browser does not support the camera bridge.", true);
            return;
        }
        try {
            channel = new BroadcastChannel(channelName);
            channel.addEventListener("message", handleMessage);
            status("Vision bridge ready on this scoreboard instance. Automatic scoring is OFF.", false);
        } catch (error) {
            status("Could not open the vision event channel.", true);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }

    // Small read-only hook for a same-origin adapter's diagnostics.
    window.CueSportVisionBridge = Object.freeze({
        getChannelName: function () { return channelName; },
        isArmed: function () { return armed; },
        disarm: function () { setArmed(false); }
    });
})();
