import {
  useLocalParticipant,
  useParticipantInfo,
  useRoomContext,
} from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { useEffect } from "react";
import { MessageDataPayload, PingDataPayload, PongDataPayload } from "types";
import {
  AudioInputControl,
  AudioRenderer,
  VideoRenderer,
  CameraControl,
  ChatControl,
  ScreencastControl,
} from "ui/tailwind";

const Stage = () => {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  // re-renders when this participant's state (metadata) changes
  const { metadata } = useParticipantInfo({ participant: localParticipant });

  // pong response
  useEffect(() => {
    const handleDataReceived = (payload: Uint8Array) => {
      const decoder = new TextDecoder();
      const data = decoder.decode(payload);

      try {
        const payload:
          | MessageDataPayload
          | PingDataPayload
          | PongDataPayload
          | undefined = JSON.parse(data) as
          | MessageDataPayload
          | PingDataPayload
          | PongDataPayload;

        if (payload === undefined) {
          throw new Error("invalid payload");
        }

        if (payload.type === "ping") {
          const pongPayload: PongDataPayload = {
            id: payload.id,
            type: "pong",
          };

          const encoder = new TextEncoder();
          const pongData = encoder.encode(JSON.stringify(pongPayload));

          localParticipant.publishData(pongData, {
            reliable: true,
            destinationIdentities: [payload.sender],
          });
        }
      } catch (err) {
        console.warn(err);
      }
    };
    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, localParticipant]);

  try {
    if (metadata === undefined) {
      console.warn("local participant does not have metadata");
      return <>loading</>;
    }

    return (
      <div className="relative w-full h-[calc(100%-33px)]" id="stage">
        <div className="fixed flex p-1 text-lg rounded-sm controls right-4 bottom-4 gap-1 bg-bg">
          <AudioRenderer />
        </div>
        <VideoRenderer thisPerformerIdentity={localParticipant.identity} />
        <div className="fixed flex p-1 text-lg border rounded-sm controls left-4 bottom-4 border-text gap-1 bg-bg">
          <CameraControl />
          <ScreencastControl />
          <AudioInputControl />
          <ChatControl />
        </div>
      </div>
    );
  } catch (err) {
    return <>Error</>;
  }
};

export { Stage };
