/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByProps } from "@webpack";
import { FluxDispatcher, React, UserStore, VoiceStateStore } from "@webpack/common";

// ─── State ────────────────────────────────────────────────────────────────────
let fakeDeafened = false;
let originalSend: ((op: number, data: any, ...args: any[]) => void) | null = null;

// ─── Voice state helpers ──────────────────────────────────────────────────────
function refreshVoiceState(enabled: boolean) {
    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    const SelectedChannelStore = findByProps("getVoiceChannelId");
    const wsModule = findByProps("getSocket");
    const MediaEngineStore = findByProps("isDeaf", "isMute");

    if (!wsModule || !SelectedChannelStore) return;

    const socket = wsModule.getSocket();
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId ? ChannelStore?.getChannel(channelId) : null;

    if (!socket || !channelId) return;

    try {
        // op 4 = voice state update
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: (enabled || (MediaEngineStore?.isMute() ?? false)),
            self_deaf: enabled || (MediaEngineStore?.isDeaf() ?? false),
            self_video: false,
            flags: 0,
        });
    } catch (error) {
        console.error("[FakeDeafen] failed to update voice state:", error);
    }
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

function toggleFakeDeafen() {
    fakeDeafened = !fakeDeafened;
    refreshVoiceState(fakeDeafened);
    updateLocalVoiceState(fakeDeafened);
}

// ─── Icon ─────────────────────────────────────────────────────────────────────
function DeafenIcon({ active = false, className = "" }: { active?: boolean; className?: string; }) {
    const color = active ? "var(--status-danger)" : "currentColor";
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="4" rx="2" fill={color} />
            <rect x="11" y="3" width="10" height="8" rx="3" fill={color} />
            {active ? (
                <>
                    <line x1="7" y1="18" x2="13" y2="24" stroke={color} strokeWidth="2" />
                    <line x1="13" y1="18" x2="7" y2="24" stroke={color} strokeWidth="2" />
                    <line x1="19" y1="18" x2="25" y2="24" stroke={color} strokeWidth="2" />
                    <line x1="25" y1="18" x2="19" y2="24" stroke={color} strokeWidth="2" />
                    <path d="M14 23c1-1 3-1 4 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
                </>
            ) : (
                <>
                    <circle cx="10" cy="21" r="4" stroke={color} strokeWidth="2" fill="none" />
                    <circle cx="22" cy="21" r="4" stroke={color} strokeWidth="2" fill="none" />
                    <path d="M14 21c1 1 3 1 4 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
                </>
            )}
        </svg>
    );
}

// ─── Button ───────────────────────────────────────────────────────────────────
function FakeDeafenButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    function toggle() {
        toggleFakeDeafen();
        forceUpdate();
    }

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : fakeDeafened ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={<DeafenIcon active={fakeDeafened} className={iconForeground} />}
            role="switch"
            aria-checked={fakeDeafened}
            redGlow={fakeDeafened}
            plated={nameplate != null}
            onClick={toggle}
        />
    );
}

const FakeDeafenUserAreaButton: UserAreaButtonFactory = props => (
    <ErrorBoundary noop>
        <FakeDeafenButton {...props} />
    </ErrorBoundary>
);

// ─── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FakeDeafen",
    description: "Tells Discord you're deafened without actually muting your audio. Button appears next to mute/deafen.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: DeafenIcon,
        render: FakeDeafenUserAreaButton,
    },

    start() {
        const wsModule = findByProps("getSocket");
        if (!wsModule) {
            console.error("[FakeDeafen] ws module not found");
            return;
        }

        const socket = wsModule.getSocket();
        if (!socket) {
            console.error("[FakeDeafen] socket not found");
            return;
        }

        originalSend = socket.send;

        // Intercept outgoing voice state updates to enforce fake deafen
        socket.send = function (op: number, data: any, ...args: any[]) {
            if (op === 4 && fakeDeafened && data) {
                data.self_deaf = true;
                data.self_mute = true;
            }
            return originalSend!.apply(this, [op, data, ...args]);
        };
    },

    stop() {
        const wsModule = findByProps("getSocket");
        if (wsModule) {
            const socket = wsModule.getSocket();
            if (socket && originalSend) {
                socket.send = originalSend;
            }
        }

        // Restore real voice state if fake deafen was active
        if (fakeDeafened) {
            fakeDeafened = false;
            refreshVoiceState(false);
            updateLocalVoiceState(false);
        }

        originalSend = null;
    },
});
