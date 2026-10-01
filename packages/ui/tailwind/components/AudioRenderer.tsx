import {
  AudioTrack,
  useLocalParticipant,
  useParticipantInfo,
  useRemoteParticipants,
} from "@livekit/components-react";
import { useEffect, useState } from "react";
import {
  FaBinoculars,
  FaEarListen,
  FaUser,
  FaVolumeHigh,
  FaVolumeXmark,
} from "react-icons/fa6";
import { XimiParticipantState } from "types";
import classNames from "classnames";

const AudioRenderer: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();
  // useLocalParticipant doesn't re-render on metadata changes; this does
  const { metadata: localMetadata } = useParticipantInfo({
    participant: localParticipant,
  });
  const [showLayout, setShowLayout] = useState(true);

  const filteredParticipants = remoteParticipants
    .map((p) => {
      try {
        const pState: XimiParticipantState = JSON.parse(p.metadata || "");
        return { participant: p, role: pState.role };
      } catch (err) {
        return { participant: p };
      }
    })
    .filter((p) => {
      return p.role === "PERFORMER" || p.role === "SCOUT";
    })
    .sort((a, b) => {
      return a.participant.identity < b.participant.identity ? -1 : 1;
    });

  useEffect(() => {
    if (localMetadata === undefined) {
      console.warn("local participant does not have metadata");
      return;
    }
    try {
      const meta = JSON.parse(localMetadata) as XimiParticipantState;

      remoteParticipants.forEach((p) => {
        const muted = meta.audio.mute.indexOf(p.identity) > -1;
        // a disabled publication stops the server sending that audio at all
        p.audioTrackPublications.forEach((pub) => pub.setEnabled(!muted));
      });
    } catch (err) {
      console.warn(err);
    }
  }, [remoteParticipants, localMetadata]);

  return (
    <div
      className={classNames(
        "relative cursor-pointer",
        hidden === true && "hidden",
      )}
      onClick={() => {
        setShowLayout((show) => !show);
      }}
    >
      {showLayout ? (
        <div
          className={classNames(
            "flex flex-col gap-1",
            showLayout ? "block" : "hidden",
          )}
        >
          {filteredParticipants.map((p) => {
            const pub = Array.from(
              p.participant.audioTrackPublications.values(),
            )[0];
            const hasAudioTrack = pub !== undefined;

            const audioTrackMuted =
              pub === undefined ? undefined : !pub.isEnabled;

            return (
              <label
                key={p.participant.identity}
                className="flex items-center px-1 text-xs leading-snug cursor-pointer gap-2"
              >
                {hasAudioTrack ? (
                  audioTrackMuted ? (
                    <FaVolumeXmark className="text-negative" />
                  ) : (
                    <FaVolumeHigh className="text-text" />
                  )
                ) : (
                  <FaVolumeHigh className="text-bg" />
                )}
                {p.role === "PERFORMER" ? (
                  <FaUser size={10} />
                ) : p.role === "SCOUT" ? (
                  <FaBinoculars size={10} />
                ) : (
                  ""
                )}{" "}
                {p.participant.identity}
              </label>
            );
          })}
        </div>
      ) : (
        <FaEarListen />
      )}

      {remoteParticipants.map((p) => (
        <div
          key={`audio_renderer_p_${p.identity}`}
          className="absolute opacity-0"
        >
          {Array.from(p.audioTrackPublications.values()).map((pub) => (
            <AudioTrack
              key={pub.trackSid}
              trackRef={{ participant: p, publication: pub, source: pub.source }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export { AudioRenderer };
