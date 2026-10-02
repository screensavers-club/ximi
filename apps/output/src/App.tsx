import {
  LiveKitRoom,
  useStartAudio,
  useRoomContext,
  useRemoteParticipant,
} from "@livekit/components-react";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  ConnectionBanner,
  VideoFrame,
  pickVideoPublication,
  useRoomSession,
  ximiRoomOptions,
} from "ui/tailwind";
import qs from "qs";
import useSWR from "swr";
import ShortUniqueId from "short-unique-id";
import { FaPlay } from "react-icons/fa6";
import { XimiParticipantState } from "types";
import {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RoomConnectOptions,
  Track,
} from "livekit-client";

const uid = new ShortUniqueId({
  dictionary: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
});

/** OBS's browser source exposes window.obsstudio */
const inObs = typeof window !== "undefined" && "obsstudio" in window;

/**
 * Output only plays one participant, so it subscribes to their tracks by hand
 * (useTargetSubscriptions) instead of receiving every publisher in the room.
 * Module-level so LiveKitRoom doesn't see a new object each render.
 */
const outputConnectOptions: RoomConnectOptions = { autoSubscribe: false };

function App() {
  const { server, room, passcode, target, mode } = qs.parse(
    window.location.search,
    {
      ignoreQueryPrefix: true,
    },
  );
  const urlValid =
    typeof server === "string" &&
    typeof room === "string" &&
    typeof passcode === "string" &&
    typeof target === "string" &&
    typeof mode === "string";

  // SWR keeps retrying (with backoff) if the server isn't up yet
  const { data: livekitUrl } = useSWR(
    urlValid ? `livekitUrl-${server}` : null,
    async () => {
      const req = await fetch(`${server}/livekit-url`);
      const { livekitUrl } = await req.json();
      return livekitUrl as string;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    },
  );

  const rand = useMemo(() => uid.rnd(6), []);
  const [identity] = useState<string>(`OUT${rand}`);

  // Output pages run unattended (OBS), so they never give up rejoining
  const { session, status, joinWithRetry, roomCallbacks } = useRoomSession(
    "output",
    { retryForever: true },
  );

  useEffect(() => {
    if (!urlValid) {
      return;
    }
    joinWithRetry({
      serverUrl: server,
      roomName: room,
      passcode,
      identity,
    });
  }, [urlValid, server, room, passcode, identity, joinWithRetry]);

  if (!urlValid) {
    return <div>URL Invalid</div>;
  }

  return (
    <LiveKitRoom
      token={session?.token}
      serverUrl={livekitUrl}
      connect={session !== undefined && typeof livekitUrl === "string"}
      options={ximiRoomOptions}
      connectOptions={outputConnectOptions}
      {...roomCallbacks}
    >
      <OutputModule target={target} mode={mode} />
      {/* don't draw status over the broadcast picture */}
      {!inObs && <ConnectionBanner status={status} />}
    </LiveKitRoom>
  );
}

export default App;

const audioPublicationOf = (p: RemoteParticipant | undefined) =>
  p?.getTrackPublication(Track.Source.Microphone) ??
  Array.from(p?.audioTrackPublications.values() ?? [])[0];

/**
 * Subscribes to exactly the given publications of the target and
 * unsubscribes from the rest (e.g. a screen share while the camera is shown).
 *
 * Re-runs when the target publishes/unpublishes or rejoins (new participant
 * object), so the right tracks are picked up again on their own.
 */
const useTargetSubscriptions = (
  participant: RemoteParticipant | undefined,
  wanted: (RemoteTrackPublication | undefined)[],
) => {
  const wantedSids = wanted
    .flatMap((pub) => (pub ? [pub.trackSid] : []))
    .join(",");
  const publishedSids = Array.from(
    participant?.trackPublications.keys() ?? [],
  ).join(",");

  useEffect(() => {
    if (participant === undefined) {
      return;
    }
    const want = new Set(wantedSids.split(","));
    participant.trackPublications.forEach((pub) => {
      const desired = want.has(pub.trackSid);
      if (pub.isDesired !== desired) {
        pub.setSubscribed(desired);
      }
    });
  }, [participant, wantedSids, publishedSids]);
};

const delayOf = (p: RemoteParticipant | undefined) => {
  try {
    const state = JSON.parse(p?.metadata || "") as XimiParticipantState;
    return typeof state.audio?.delay === "number" ? state.audio.delay : 0;
  } catch {
    return 0;
  }
};

/**
 * Plays the target's audio through a DelayNode.
 *
 * One AudioContext + DelayNode live for the whole page. The track source is
 * rebuilt whenever the target's audio track changes (they republish, switch
 * input, reconnect, or leave and rejoin), so audio comes back on its own.
 */
const useDelayedAudio = (
  track: RemoteTrack | undefined,
  delayMs: number,
  enabled: boolean,
  canPlayAudio: boolean,
) => {
  const graph = useRef<{ ctx: AudioContext; delay: DelayNode }>();
  const audioEl = useRef<HTMLAudioElement>(null);

  const getGraph = () => {
    if (graph.current === undefined) {
      const ctx = new AudioContext();
      const delay = new DelayNode(ctx, { maxDelayTime: 5, delayTime: 0 });
      delay.connect(ctx.destination);
      graph.current = { ctx, delay };
    }
    return graph.current;
  };

  // apply the delay whenever it changes - including the initial value on load
  useEffect(() => {
    const { ctx, delay } = getGraph();
    delay.delayTime.setValueAtTime(delayMs / 1000, ctx.currentTime);
    console.log(`delay set to ${delayMs}`);
  }, [delayMs]);

  useEffect(() => {
    const el = audioEl.current;
    if (!enabled || !canPlayAudio || track === undefined || el === null) {
      return;
    }
    const { ctx, delay } = getGraph();

    // Chrome only feeds a remote WebRTC stream into Web Audio if a media
    // element is also playing it; keep that element muted.
    track.attach(el);
    el.muted = true;

    const source = ctx.createMediaStreamSource(
      new MediaStream([track.mediaStreamTrack]),
    );
    source.connect(delay);

    if (ctx.state !== "running") {
      ctx.resume();
    }

    return () => {
      source.disconnect();
      track.detach(el);
    };
  }, [track, enabled, canPlayAudio]);

  useEffect(
    () => () => {
      graph.current?.ctx.close();
      graph.current = undefined;
    },
    [],
  );

  return audioEl;
};

const OutputModule = ({ target, mode }: { target: string; mode: string }) => {
  const participant = useRemoteParticipant(target);
  const room = useRoomContext();
  const { canPlayAudio, mergedProps } = useStartAudio({
    room,
    props: { style: { display: "flex" } },
  });

  const videoOn = mode === "1" || mode === "2";
  const audioOn = mode === "0" || mode === "2";

  const audioPub = audioPublicationOf(participant);
  useTargetSubscriptions(participant, [
    videoOn
      ? (pickVideoPublication(participant) as RemoteTrackPublication)
      : undefined,
    audioOn ? audioPub : undefined,
  ]);

  const audioRef = useDelayedAudio(
    audioPub?.track as RemoteTrack | undefined,
    delayOf(participant),
    audioOn,
    canPlayAudio,
  );

  return (
    <div className="object-cover w-full h-[100vh] overflow-hidden">
      {audioOn && (
        <>
          <audio ref={audioRef} />

          {!canPlayAudio && (
            <button {...mergedProps}>
              <div className="fixed z-10 flex items-center justify-center w-8 h-8 p-0 bottom-2 right-2 text-text bg-bg/10">
                <FaPlay size={16} />
              </div>
            </button>
          )}
        </>
      )}

      {participant === undefined ? (
        <div>Waiting for {target}</div>
      ) : (
        videoOn && <VideoFrame identity={target} full={true} preview={false} />
      )}
    </div>
  );
};
