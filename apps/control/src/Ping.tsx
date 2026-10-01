import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { RemoteParticipant, RoomEvent } from "livekit-client";
import { useEffect, useState } from "react";
import { MessageDataPayload, PingDataPayload, PongDataPayload } from "types";

const PING_INTERVAL_MS = 2000;
/** No pong for this long and the participant is shown as not responding */
const PING_TIMEOUT_MS = 5000;

const Pinger: React.FC<{ participant: RemoteParticipant }> = ({
  participant,
}) => {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [ping, setPing] = useState<number>();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // send time of every ping still waiting for its pong
    const pending = new Map<string, number>();
    let lastPongAt = Date.now();
    let seq = 0;

    const dataReceivedHandler = (
      payload: Uint8Array,
      from?: RemoteParticipant,
    ) => {
      if (from !== undefined && from.identity !== participant.identity) {
        return;
      }
      try {
        const dataParsed = JSON.parse(decoder.decode(payload)) as
          | PongDataPayload
          | PingDataPayload
          | MessageDataPayload;

        if (dataParsed.type === "pong" && pending.has(dataParsed.id)) {
          const sentAt = pending.get(dataParsed.id) as number;
          pending.delete(dataParsed.id);
          lastPongAt = Date.now();
          setPing(lastPongAt - sentAt);
          setTimedOut(false);
        }
      } catch (err) {
        console.warn(err);
      }
    };

    room.on(RoomEvent.DataReceived, dataReceivedHandler);

    const id = setInterval(() => {
      const now = Date.now();
      // forget pings that will never be answered
      pending.forEach((sentAt, pingId) => {
        if (now - sentAt > PING_TIMEOUT_MS) {
          pending.delete(pingId);
        }
      });
      setTimedOut(now - lastPongAt > PING_TIMEOUT_MS);

      const pingId = `${localParticipant.identity}-${now}-${seq++}`;
      const payload: PingDataPayload = {
        type: "ping",
        id: pingId,
        // pongs are addressed back by identity (LiveKit v2)
        sender: localParticipant.identity,
      };
      pending.set(pingId, now);
      localParticipant
        .publishData(encoder.encode(JSON.stringify(payload)), {
          reliable: true,
          destinationIdentities: [participant.identity],
        })
        .catch(() => undefined);
    }, PING_INTERVAL_MS);

    return () => {
      clearInterval(id);
      room.off(RoomEvent.DataReceived, dataReceivedHandler);
    };
  }, [localParticipant, participant, room]);

  if (timedOut) {
    return <span className="text-negative">no response</span>;
  }
  return <>{ping ?? "-"}</>;
};

export { Pinger };
