/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

// ─── State ────────────────────────────────────────────────────────────────────
let fakeDeafened = false;

// The captured binary payload that tells Discord's servers "self_deaf: true"
let deafPayload: ArrayBuffer | null = null;
// The captured binary payload that tells Discord's servers "self_deaf: false"
let undeafPayload: ArrayBuffer | null = null;

// Reference to the original WebSocket.send so we can restore it
const originalSend = WebSocket.prototype.send;

const decoder = new TextDecoder();

// Regex to detect self_deaf state in the binary websocket frame
const deafTrueRegex = /self_deaf.{0,4}true/;
const deafFalseRegex = /self_deaf.{0,4}false/;

function patchedSend(this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (data instanceof ArrayBuffer) {
        const text = decoder.decode(data);
        if (deafTrueRegex.test(text)) {
            deafPayload = data;
            // If fake deafen is active, swallow the real "undeafen" packet
            // so Discord servers stay thinking we're deafened.
            // But we still need to let the first deafen through to capture it.
        }
        if (deafFalseRegex.test(text)) {
            undeafPayload = data;
            // If fake deafen is active, swallow the "undeafen" packet —
            // we don't want Discord to know we turned off deafen.
            if (fakeDeafened) return;
        }
    }
    return originalSend.call(this, data as any);
}

function toggleFakeDeafen(ws: WebSocket | null) {
    fakeDeafened = !fakeDeafened;

    if (fakeDeafened && deafPayload && ws) {
        // Tell Discord's server we are deafened (without muting local audio)
        originalSend.call(ws, deafPayload);
    } else if (!fakeDeafened && undeafPayload && ws) {
        // Tell Discord's server we are undeafened
        originalSend.call(ws, undeafPayload);
    }
}

// Find the active Discord gateway WebSocket
function getGatewayWs(): WebSocket | null {
    // Discord's WS is accessible via the window's websocket connections;
    // we find it by looking for an open one connected to gateway.discord.gg
    for (const key of Object.getOwnPropertyNames(window)) {
        try {
            const val = (window as any)[key];
            if (val instanceof WebSocket && val.url.includes("gateway.discord.gg") && val.readyState === WebSocket.OPEN) {
                return val;
            }
        } catch { }
    }
    return null;
}

// ─── Ghost Icon ───────────────────────────────────────────────────────────────
function GhostIcon({ active = false, className = "" }: { active?: boolean; className?: string; }) {
    return (
        <svg
            className={className}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={active ? "var(--status-danger)" : "currentColor"}
        >
            <path d="M12 2a8 8 0 0 0-8 8v10l3-3 3 3 3-3 3 3 3-3V10a8 8 0 0 0-8-8Zm-2.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
    );
}

// ─── User Area Button ─────────────────────────────────────────────────────────
function FakeDeafenButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    function toggle() {
        const ws = getGatewayWs();
        toggleFakeDeafen(ws);
        forceUpdate();
    }

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : fakeDeafened ? "Fake Deafen: ON" : "Fake Deafen: OFF"}
            icon={<GhostIcon active={fakeDeafened} className={iconForeground} />}
            role="switch"
            aria-checked={fakeDeafened}
            redGlow={fakeDeafened}
            plated={nameplate != null}
            onClick={toggle}
        />
    );
}

const FakeDeafenUserAreaButton: UserAreaButtonFactory = props => <FakeDeafenButton {...props} />;

// ─── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FakeDeafen",
    description: "Ghost button next to mute/deafen — tells Discord you're deafened without muting local audio.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: GhostIcon,
        render: FakeDeafenUserAreaButton,
    },

    start() {
        // Patch WebSocket.send to intercept and capture deafen payloads
        WebSocket.prototype.send = patchedSend;
    },

    stop() {
        // Restore original send
        WebSocket.prototype.send = originalSend;

        // If we left the user fake-deafened, send the real undeafen packet
        if (fakeDeafened && undeafPayload) {
            const ws = getGatewayWs();
            if (ws) originalSend.call(ws, undeafPayload);
        }

        fakeDeafened = false;
        deafPayload = null;
        undeafPayload = null;
    },
});
