/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher, React, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

let fakeDeafened = false;
let originalToggleSelfDeaf: (() => void) | null = null;

function applyFakeDeafen(enabled: boolean) {
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
    const voiceState = currentUser && VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState) return;

    FluxDispatcher.dispatch({
        type: "VOICE_STATE_UPDATES",
        voiceStates: [{
            ...voiceState,
            selfDeaf: !voiceState.selfDeaf,
            selfMute: !voiceState.selfDeaf ? true : voiceState.selfMute,
        }],
    });
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
        applyFakeDeafen(!fakeDeafened);
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
    description: "Appear deafened to others in voice while still hearing audio. Toggle with the ghost button next to mute/deafen.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: GhostIcon,
        render: FakeDeafenUserAreaButton,
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
