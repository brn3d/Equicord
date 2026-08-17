/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher, React, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

// ─── State ────────────────────────────────────────────────────────────────────
let fakeDeafened = false;
let deafPayload: ArrayBuffer | null = null;
let undeafPayload: ArrayBuffer | null = null;
let capturing = false;

const originalSend = WebSocket.prototype.send;
const decoder = new TextDecoder();
const deafTrueRegex = /self_deaf.{0,4}true/;
const deafFalseRegex = /self_deaf.{0,4}false/;

function getGatewayWs(): WebSocket | null {
    for (const key of Object.getOwnPropertyNames(window)) {
        try {
            const val = (window as any)[key];
            if (val instanceof WebSocket && val.url.includes("gateway.discord.gg") && val.readyState === WebSocket.OPEN)
                return val;
        } catch { }
    }
    return null;
}

function updateLocalVoiceState(selfDeaf: boolean) {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState) return;

    FluxDispatcher.dispatch({
        type: "VOICE_STATE_UPDATES",
        voiceStates: [{
            ...voiceState,
            selfDeaf,
            selfMute: selfDeaf ? true : voiceState.selfMute,
        }],
    });
}

function patchedSend(this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (data instanceof ArrayBuffer) {
        const text = decoder.decode(data);

        if (deafTrueRegex.test(text)) {
            deafPayload = data;
            // If this was a silent capture, swallow it — don't actually send
            if (capturing) return;
        }
        if (deafFalseRegex.test(text)) {
            undeafPayload = data;
            // Swallow real undeafen while fake deafen is on
            if (fakeDeafened) return;
            // Swallow during silent capture
            if (capturing) return;
        }
    }
    return originalSend.call(this, data as any);
}

// Silently deafen+undeafen to capture both payloads without the user noticing
async function capturePayloads(): Promise<void> {
    return new Promise(resolve => {
        capturing = true;
        // Trigger deafen — patchedSend will capture but swallow the packet
        VoiceActions.toggleSelfDeaf();
        setTimeout(() => {
            // Trigger undeafen — patchedSend will capture but swallow
            VoiceActions.toggleSelfDeaf();
            setTimeout(() => {
                capturing = false;
                resolve();
            }, 100);
        }, 100);
    });
}

async function toggleFakeDeafen() {
    // Capture payloads on first use if we don't have them yet
    if (!deafPayload || !undeafPayload) {
        await capturePayloads();
    }

    const ws = getGatewayWs();
    fakeDeafened = !fakeDeafened;

    if (fakeDeafened) {
        if (deafPayload && ws) originalSend.call(ws, deafPayload);
        updateLocalVoiceState(true);
    } else {
        if (undeafPayload && ws) originalSend.call(ws, undeafPayload);
        updateLocalVoiceState(false);
    }
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

    async function toggle() {
        await toggleFakeDeafen();
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
    description: "Ghost button next to mute/deafen — tells Discord you're deafened without muting local audio. Visually shows as deafened.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: GhostIcon,
        render: FakeDeafenUserAreaButton,
    },

    start() {
        WebSocket.prototype.send = patchedSend;
    },

    stop() {
        WebSocket.prototype.send = originalSend;

        if (fakeDeafened) {
            const ws = getGatewayWs();
            if (ws && undeafPayload) originalSend.call(ws, undeafPayload);
            updateLocalVoiceState(false);
            fakeDeafened = false;
        }

        deafPayload = null;
        undeafPayload = null;
        capturing = false;
    },
});
