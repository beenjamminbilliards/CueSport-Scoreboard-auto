/*
 * CueSport Vision bridge
 *
 * Receives pocket-candidate events from a same-origin camera adapter through
 * BroadcastChannel. Candidates are queued for operator review; only an explicit
 * Confirm click routes the event through togglePot(), preserving scoreboard
 * scoring, undo, and overlay behavior.
 */
(function () {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    const instanceId = params.get("instance") || "";
    const channelName = "cuesport-vision-" + instanceId;
    const MIN_CONFIDENCE = 0.97;
    const MAX_EVENT_AGE_MS = 3000;
    const REVIEW_WINDOW_MS = 15000;
    const EVENT_RETENTION_MS = 30000;
    const BALL_COOLDOWN_MS = 1200;
    const MAX_PENDING = 12;

    let channel = null;
    let pending = [];
    let lastAcceptedAt = Object.create(null);
    const seenEvents = new Map();

    function status(message, isError) {
        const output = document.getElementById("cuesportVisionStatus");
        if (!output) return;
        output.textContent = message;
        output.dataset.state = isError ? "error" : "normal";
    }

    function validEvent(event) {
        if (!event || typeof event !== "object") return "Invalid event.";
        if (event.type !== "cuesport.vision.pocket-candidate" || event.version !== 1) return "Unsupported event.";
        if (!instanceId || event.instance !== instanceId) return "Wrong scoreboard instance.";
        if (typeof event.eventId !== "string" || event.eventId.length < 8 || event.eventId.length > 160) return "Invalid event ID.";
        if (!Number.isInteger(event.ballNumber) || event.ballNumber < 1 || event.ballNumber > 15) return "Invalid ball number.";
        if (typeof event.confidence !== "number" || !Number.isFinite(event.confidence) || event.confidence < MIN_CONFIDENCE || event.confidence > 1) return "Confidence below review threshold.";
        if (!Number.isFinite(event.timestamp) || Math.abs(Date.now() - event.timestamp) > MAX_EVENT_AGE_MS) return "Event is stale or timestamp is invalid.";
        return "";
    }

    function renderQueue() {
        const list = document.getElementById("cuesportVisionQueue");
        if (!list) return;
        list.replaceChildren();
        if (!pending.length) {
            const empty = document.createElement("div");
            empty.textContent = "No pocket candidates awaiting review.";
            list.appendChild(empty);
            return;
        }
        pending.forEach(function (event) {
            const item = document.createElement("div");
            item.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;";
            const label = document.createElement("span");
            label.textContent = "Ball " + event.ballNumber + " · " + Math.round(event.confidence * 100) + "% confidence";
            label.style.cssText = "flex:1;min-width:150px;";
            const confirm = document.createElement("button");
            confirm.type = "button";
            confirm.textContent = "Confirm pocket";
            confirm.addEventListener("click", function () { confirmCandidate(event.eventId); });
            const reject = document.createElement("button");
            reject.type = "button";
            reject.textContent = "Dismiss";
            reject.addEventListener("click", function () { dismissCandidate(event.eventId); });
            item.append(label, confirm, reject);
            list.appendChild(item);
        });
    }

    function dismissCandidate(eventId) {
        pending = pending.filter(function (event) { return event.eventId !== eventId; });
        renderQueue();
        status("Candidate dismissed. No score was changed.", false);
    }

    function confirmCandidate(eventId) {
        const index = pending.findIndex(function (event) { return event.eventId === eventId; });
        if (index < 0) return;
        const event = pending[index];
        if (Date.now() - event.receivedAt > REVIEW_WINDOW_MS) {
            dismissCandidate(eventId);
            status("Candidate expired. Wait for a fresh camera event.", true);
            return;
        }
        const ball = document.getElementById("ball " + event.ballNumber);
        if (!ball) {
            status("Ball " + event.ballNumber + " is not present in this game's tracker.", true);
            return;
        }
        if (ball.classList.contains("faded")) {
            dismissCandidate(eventId);
            status("Ball " + event.ballNumber + " is already marked pocketed.", false);
            return;
        }
        if (typeof window.togglePot !== "function") {
            status("Scoreboard scoring handler is unavailable.", true);
            return;
        }
        if (typeof window.isGameScoringLocked === "function" && window.isGameScoringLocked()) {
            status("Scoreboard scoring is locked. Candidate remains available for review.", true);
            return;
        }
        const now = Date.now();
        if (lastAcceptedAt[event.ballNumber] && now - lastAcceptedAt[event.ballNumber] < BALL_COOLDOWN_MS) {
            status("Please wait before confirming another event for this ball.", true);
            return;
        }
        lastAcceptedAt[event.ballNumber] = now;
        pending = pending.filter(function (candidate) { return candidate.eventId !== eventId; });
        renderQueue();
        try {
            Promise.resolve(window.togglePot(ball)).then(function () {
                status("Operator confirmed ball " + event.ballNumber + ". Scoreboard updated.", false);
            }).catch(function (error) {
                status("Scoreboard rejected ball " + event.ballNumber + ": " + (error && error.message ? error.message : "unknown error"), true);
            });
        } catch (error) {
            status("Could not score ball: " + (error && error.message ? error.message : "unknown error"), true);
        }
    }

    function handleMessage(message) {
        const event = message && message.data;
        const problem = validEvent(event);
        if (problem) {
            status(problem, true);
            return;
        }
        if (seenEvents.has(event.eventId)) return;
        seenEvents.set(event.eventId, Date.now());
        for (const [id, time] of seenEvents) {
            if (Date.now() - time > EVENT_RETENTION_MS) seenEvents.delete(id);
        }
        if (pending.some(function (candidate) { return candidate.ballNumber === event.ballNumber; })) {
            status("Candidate received for a ball already awaiting review; duplicate ball candidate ignored.", false);
            return;
        }
        if (pending.length >= MAX_PENDING) pending.shift();
        pending.push(Object.assign({}, event, { receivedAt: Date.now() }));
        renderQueue();
        status("Pocket candidate received. Review it below; no score has been changed.", false);
    }

    function mountControls() {
        if (document.getElementById("cuesportVisionControls")) return;
        const tracker = document.getElementById("ballTrackerDiv");
        if (!tracker || !tracker.parentNode) return;
        const panel = document.createElement("section");
        panel.id = "cuesportVisionControls";
        panel.style.cssText = "margin:10px 0;padding:10px;border:1px solid #777;border-radius:8px;";
        const heading = document.createElement("strong");
        heading.textContent = "CueSport Vision · Manual review";
        const output = document.createElement("div");
        output.id = "cuesportVisionStatus";
        output.setAttribute("role", "status");
        output.setAttribute("aria-live", "polite");
        output.style.cssText = "margin-top:6px;font-size:0.9em;";
        output.textContent = "Vision bridge ready. Camera events require manual confirmation.";
        const queue = document.createElement("div");
        queue.id = "cuesportVisionQueue";
        const note = document.createElement("small");
        note.textContent = "Confirming a candidate changes the score. Dismissing it does not.";
        note.style.cssText = "display:block;margin-top:8px;opacity:.75;";
        panel.append(heading, output, queue, note);
        tracker.parentNode.insertBefore(panel, tracker.nextSibling);
        renderQueue();
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
            status("Vision bridge ready on this scoreboard instance. Manual review is ON.", false);
        } catch (error) {
            status("Could not open the vision event channel.", true);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }

    window.CueSportVisionBridge = Object.freeze({
        getChannelName: function () { return channelName; },
        getPendingCount: function () { return pending.length; },
        dismissAll: function () { pending = []; renderQueue(); status("All candidates dismissed.", false); }
    });
})();
