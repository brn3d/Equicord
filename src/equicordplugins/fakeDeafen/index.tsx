/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Appear deafened to others in voice while still hearing audio.",
        default: false,
    },
});

let originalToggleSelfDeaf: (() => void) | null = null;

function patchedToggleSelfDeaf() {
    if (!settings.store.enabled) {
        originalToggleSelfDeaf?.();
        return;
    }

    const currentUser = UserStore.getCurrentUser();
    const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!voiceState) return;

    const nowDeafened = !voiceState.selfDeaf;

    // Flip the local store only — no gateway update, no audio suppression.
    FluxDispatcher.dispatch({
        type: "VOICE_STATE_UPDATES",
        voiceStates: [{
            ...voiceState,
            selfDeaf: nowDeafened,
            // Deafen implies mute in Discord's UI, mirror that locally.
            selfMute: nowDeafened ? true : voiceState.selfMute,
        }],
    });
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Appear deafened to others in voice while still hearing audio. Enable in settings, then use the normal deafen button.",
    tags: ["Voice", "Privacy"],
    authors: [EquicordDevs.nobody],
    settings,

    start() {
        originalToggleSelfDeaf = VoiceActions.toggleSelfDeaf.bind(VoiceActions);
        VoiceActions.toggleSelfDeaf = patchedToggleSelfDeaf;
    },

    stop() {
        if (originalToggleSelfDeaf !== null) {
            VoiceActions.toggleSelfDeaf = originalToggleSelfDeaf;
            originalToggleSelfDeaf = null;
        }

        // Restore real state if we left the client fake-deafened.
        const currentUser = UserStore.getCurrentUser();
        const voiceState = currentUser && VoiceStateStore.getVoiceStateForUser(currentUser.id);
        if (voiceState?.selfDeaf) {
            FluxDispatcher.dispatch({
                type: "VOICE_STATE_UPDATES",
                voiceStates: [{ ...voiceState, selfDeaf: false, selfMute: false }],
            });
        }
    },
});
