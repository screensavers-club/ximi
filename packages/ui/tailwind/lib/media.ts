import {
  AudioPresets,
  createLocalAudioTrack,
  LocalParticipant,
  RoomOptions,
} from "livekit-client";

/**
 * Room options for every XIMI app.
 *  - dynacast: publishers stop encoding simulcast layers nobody is watching
 *  - adaptiveStream off: with it on, LiveKit caps every subscription at the
 *    on-screen element size, which would override manual quality choices.
 *    VideoFrame does size-based selection itself, only for tiles set to AUTO.
 *
 * Keep this a module-level constant: LiveKitRoom recreates the Room whenever
 * the options object changes.
 */
export const ximiRoomOptions: RoomOptions = {
  dynacast: true,
  adaptiveStream: false,
};

export type AudioInputMode = "VOICE" | "LINE";

/**
 * Publishes a microphone / line input.
 *
 * VOICE: speech processing on, mono, 48kbps, RED for packet-loss resilience.
 * LINE:  no processing, stereo, 128kbps (musicHighQualityStereo), following
 *        LiveKit's hi-fi guidance (dtx and red off).
 *
 * DTX is off in both: it drops packets during quiet passages, which cuts
 * sustained or soft sounds in performance audio.
 */
export const publishAudioInput = async (
  localParticipant: LocalParticipant,
  { mode, deviceId }: { mode: AudioInputMode; deviceId?: string },
) => {
  const line = mode === "LINE";
  const track = await createLocalAudioTrack({
    deviceId,
    autoGainControl: false,
    echoCancellation: !line,
    noiseSuppression: !line,
    sampleRate: 48000,
    channelCount: line ? 2 : 1,
  });

  return localParticipant.publishTrack(track, {
    audioPreset: line ? AudioPresets.musicHighQualityStereo : AudioPresets.music,
    forceStereo: line,
    dtx: false,
    red: !line,
  });
};

/** Unpublishes (and stops) every audio track this participant publishes */
export const unpublishAudio = async (localParticipant: LocalParticipant) => {
  await Promise.all(
    Array.from(localParticipant.audioTrackPublications.values()).map(
      (pub) => pub.track && localParticipant.unpublishTrack(pub.track),
    ),
  );
};
