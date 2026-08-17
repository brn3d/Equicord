/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { IconComponent } from "@utils/types";
import { FluxDispatcher, React, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

let fakeDeafened = false;
let originalToggleSelfDeaf: (() => void) | null = null;

function setFakeDeafen(enabled: boolean) {
    fakeDeafened = enabled;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState) return;

    FluxDispatcher.dispatch({
        type: "VOICE_STATE_UPDATES",
        voiceStates: [{
            ...voiceState,
            selfDeaf: enabled,
            selfMute: enabled ? true : voiceState.selfMute,
        }],
    });
}

function patchedToggleSelfDeaf() {
    if (!fakeDeafened) {
        originalToggleSelfDeaf?.();
        return;
    }

    const currentUser = UserStore.getCurrentUser();
    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState) return;

    const nowDeafened = !voiceState.selfDeaf;

    FluxDispatcher.dispatch({
        type: "VOICE_STATE_UPDATES",
        voiceStates: [{
            ...voiceState,
            selfDeaf: nowDeafened,
            selfMute: nowDeafened ? true : voiceState.selfMute,
        }],
    });
}

// ─── Ghost Icon ───────────────────────────────────────────────────────────────
const GhostIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        className={className}
        aria-hidden="true"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill="currentColor"
    >
        <path d="M12 2a8 8 0 0 0-8 8v10l3-3 3 3 3-3 3 3 3-3V10a8 8 0 0 0-8-8Zm-2.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
    </svg>
);

// ─── Chat Bar Button ──────────────────────────────────────────────────────────
const FakeDeafenButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [active, setActive] = React.useState(false);

    if (!isMainChat) return null;

    function toggle() {
        const next = !active;
        setActive(next);
        setFakeDeafen(next);
    }

    return (
        <ChatBarButton
            tooltip={active ? "Fake Deafen: ON — click to disable" : "Fake Deafen: OFF — click to enable"}
            onClick={toggle}
            buttonProps={{ style: { color: active ? "var(--status-danger, #ed4245)" : undefined } }}
        >
            <GhostIcon />
        </ChatBarButton>
    );
};

// ─── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FakeDeafen",
    description: "Appear deafened to others in voice while still hearing audio. Toggle with the ghost icon in the chat bar.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    dependencies: ["ChatInputButtonAPI"],

    chatBarButton: {
        icon: GhostIcon,
        render: FakeDeafenButton,
    },

    start() {
        originalToggleSelfDeaf = VoiceActions.toggleSelfDeaf.bind(VoiceActions);
        VoiceActions.toggleSelfDeaf = patchedToggleSelfDeaf;
    },

    stop() {
        if (originalToggleSelfDeaf !== null) {
            VoiceActions.toggleSelfDeaf = originalToggleSelfDeaf;
            originalToggleSelfDeaf = null;
        }

        if (fakeDeafened) {
            const currentUser = UserStore.getCurrentUser();
            const voiceState = currentUser && VoiceStateStore.getVoiceStateForUser(currentUser.id);
            if (voiceState?.selfDeaf) {
                FluxDispatcher.dispatch({
                    type: "VOICE_STATE_UPDATES",
                    voiceStates: [{ ...voiceState, selfDeaf: false, selfMute: false }],
                });
            }
            fakeDeafened = false;
        }
    },
});
