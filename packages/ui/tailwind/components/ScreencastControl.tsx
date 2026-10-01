import { useLocalParticipant } from "@livekit/components-react";
import classNames from "classnames";
import { createLocalScreenTracks, Track } from "livekit-client";
import { FaTv } from "react-icons/fa6";
import { toastError } from "../lib/api";

const clsControlBtn = (active: boolean, disabled: boolean) =>
  classNames(
    "flex",
    "items-center",
    "justify-center",
    "p-1",
    "w-8",
    "h-8",
    active ? "text-accent" : "text-text",
    disabled
      ? "hover:bg-[transparent] opacity-50"
      : "hover:brand-50 opacity-100",
  );

const ScreencastControl = () => {
  const { localParticipant } = useLocalParticipant();

  const hasTrack =
    localParticipant.getTrackPublication(Track.Source.ScreenShare) !== undefined;
  const hasCameraTrack =
    localParticipant.getTrackPublication(Track.Source.Camera) !== undefined;

  return (
    <div className="flex items-center pr-1 border-r gap-1">
      <button
        className={clsControlBtn(hasTrack, hasCameraTrack)}
        disabled={hasCameraTrack}
        onClick={async () => {
          if (hasTrack) {
            const pub = localParticipant.getTrackPublication(
              Track.Source.ScreenShare,
            );
            if (pub?.track) {
              await localParticipant.unpublishTrack(pub.track);
            }
          } else {
            try {
              const newTracks = await createLocalScreenTracks({ audio: false });
              const trackToPublish = newTracks.find(
                (t) => t.kind === Track.Kind.Video,
              );
              if (trackToPublish !== undefined) {
                await localParticipant.publishTrack(trackToPublish);
              }
            } catch (err) {
              // closing the browser's share picker is not an error
              if ((err as Error)?.name !== "NotAllowedError") {
                toastError(err, "Screen share");
              }
            }
          }
        }}
      >
        <FaTv />
      </button>
    </div>
  );
};

export { ScreencastControl };
