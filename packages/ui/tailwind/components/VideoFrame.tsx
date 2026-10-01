import { useRemoteParticipant, VideoTrack } from "@livekit/components-react";
import classNames from "classnames";
import {
  Participant,
  RemoteTrackPublication,
  Track,
  TrackPublication,
  VideoQuality,
} from "livekit-client";
import { useEffect, useRef, useState } from "react";
import {
  FaRegSquare,
  FaTableCells,
  FaTableCellsLarge,
  FaWandMagicSparkles,
} from "react-icons/fa6";

type QualityMode = "AUTO" | VideoQuality;

const nextQuality: Record<QualityMode, QualityMode> = {
  AUTO: VideoQuality.LOW,
  [VideoQuality.LOW]: VideoQuality.MEDIUM,
  [VideoQuality.MEDIUM]: VideoQuality.HIGH,
  [VideoQuality.HIGH]: "AUTO",
};

const qualityLabel: Record<QualityMode, string> = {
  AUTO: "Auto quality (sized to this tile)",
  [VideoQuality.LOW]: "Low quality",
  [VideoQuality.MEDIUM]: "Medium quality",
  [VideoQuality.HIGH]: "High quality",
};

/** Camera if published, else screen share, else any video */
const pickVideoPublication = (
  p: Participant | undefined,
): TrackPublication | undefined =>
  p === undefined
    ? undefined
    : p.getTrackPublication(Track.Source.Camera) ??
      p.getTrackPublication(Track.Source.ScreenShare) ??
      Array.from(p.videoTrackPublications.values())[0];

/**
 * Requests the subscription quality for a tile.
 *  AUTO: asks for the tile's on-screen pixel size, so LiveKit picks the
 *        smallest simulcast layer that covers it (tracks resizes).
 *  LOW / MEDIUM / HIGH: asks for that layer regardless of tile size.
 */
const useSubscriptionQuality = (
  pub: TrackPublication | undefined,
  quality: QualityMode,
  container: React.RefObject<HTMLElement>,
) => {
  const subscribedTrack = pub?.track;

  useEffect(() => {
    // Only remote video has a subscription quality. Our own tile (the hook
    // below also resolves the local participant) is a local track.
    if (!(pub instanceof RemoteTrackPublication)) {
      return;
    }
    if (quality !== "AUTO") {
      pub.setVideoQuality(quality);
      return;
    }

    const el = container.current;
    if (el === null) {
      return;
    }
    const requestTileSize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 1 || height < 1) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      pub.setVideoDimensions({
        width: Math.ceil(width * dpr),
        height: Math.ceil(height * dpr),
      });
    };

    requestTileSize();
    const observer = new ResizeObserver(requestTileSize);
    observer.observe(el);
    return () => observer.disconnect();
    // re-apply when the track is (re)subscribed, e.g. after a reconnect
  }, [pub, subscribedTrack, quality, container]);
};

export const VideoFrame: React.FC<{
  identity: string;
  full: boolean;
  /** Preview tiles get the quality toggle; false = always HIGH (Output) */
  preview?: boolean;
}> = ({ identity, full, preview = true }) => {
  // despite the name, this also returns the local participant for our own identity
  const p = useRemoteParticipant(identity) as Participant | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoDisplayState, setVideoDisplayState] = useState<1 | 2 | 3 | 4>(
    full ? 2 : 1,
  );
  const [quality, setQuality] = useState<QualityMode>(
    preview ? "AUTO" : VideoQuality.HIGH,
  );

  const flip = videoDisplayState > 2;
  const fit = videoDisplayState % 2 === 1;

  const pub = pickVideoPublication(p);
  useSubscriptionQuality(pub, preview ? quality : VideoQuality.HIGH, containerRef);

  if (!p || pub === undefined) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative w-full h-full cursor-pointer">
      <VideoTrack
        trackRef={{ participant: p, publication: pub, source: pub.source }}
        onClick={() => {
          setVideoDisplayState((v) =>
            v === 4 ? 1 : ((v + 1) as 1 | 2 | 3 | 4),
          );
        }}
        className={classNames(
          "w-full h-full cursor-pointer",
          flip === true && "scale-x-[-1]",
          fit === true ? "object-contain" : "object-cover",
        )}
      />
      {preview && !p.isLocal && (
        <button
          className="absolute top-2 right-2"
          title={qualityLabel[quality]}
          onClick={() => setQuality((q) => nextQuality[q])}
        >
          {quality === "AUTO" ? (
            <FaWandMagicSparkles />
          ) : quality === VideoQuality.LOW ? (
            <FaRegSquare />
          ) : quality === VideoQuality.MEDIUM ? (
            <FaTableCellsLarge />
          ) : (
            <FaTableCells />
          )}
        </button>
      )}
    </div>
  );
};
