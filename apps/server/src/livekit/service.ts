import { Injectable } from '@nestjs/common';
import { XIMIRole, XimiParticipantState } from 'ximi-types';
import {
  RoomServiceClient,
  WebhookReceiver,
  AccessToken,
  Room,
} from 'livekit-server-sdk';

/** Seconds before a LiveKit API call is treated as failed */
const LIVEKIT_REQUEST_TIMEOUT = 5;

@Injectable()
export class LivekitService {
  client: RoomServiceClient;
  webhookReceiver: WebhookReceiver;

  constructor() {
    this.client = new RoomServiceClient(
      process.env.LIVEKIT_HOST,
      process.env.LIVEKIT_KEY,
      process.env.LIVEKIT_SECRET,
      { requestTimeout: LIVEKIT_REQUEST_TIMEOUT },
    );

    this.webhookReceiver = new WebhookReceiver(
      process.env.LIVEKIT_KEY,
      process.env.LIVEKIT_SECRET,
    );
  }

  async getRoom(roomName: string): Promise<Room | undefined> {
    const [room] = await this.client.listRooms([roomName]);
    return room;
  }

  async generateToken(
    roomName: string,
    participantIdentity: string,
    role: XIMIRole,
    initialState: XimiParticipantState,
  ): Promise<string> {
    const at = new AccessToken(
      process.env.LIVEKIT_KEY,
      process.env.LIVEKIT_SECRET,
      {
        identity: participantIdentity,
        metadata: JSON.stringify(initialState),
      },
    );
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: role !== 'OUTPUT',
    });
    return at.toJwt();
  }
}
