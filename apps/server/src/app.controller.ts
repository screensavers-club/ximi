import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Patch,
  RawBodyRequest,
  Req,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { LivekitService } from './livekit/service';
import * as Yup from 'yup';
import { ApiBody } from '@nestjs/swagger';
import { yupToOpenAPISchema } from './util/yup-to-openapi-schema';
import { YupValidationPipe } from './util/yup.pipe';
import {
  createRoomBodySchema,
  joinRoomSchema,
  roomStateActionSchema,
} from 'validation-schema';
import { XIMIRole } from 'ximi-types';
import {
  RoomStateAction,
  RoomStateService,
} from './room-state/room-state.service';

type JoinRoomBody = Yup.InferType<ReturnType<typeof joinRoomSchema>>;

const startedAt = Date.now();

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private livekit: LivekitService,
    private roomState: RoomStateService,
  ) {}

  /** Liveness: the server process is up. Also reports LiveKit reachability. */
  @Get('health')
  async health() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      rooms: this.roomState.roomCount,
      livekit: await this.livekitStatus(),
    };
  }

  /** Readiness: 503 unless LiveKit is reachable */
  @Get('health/ready')
  async ready() {
    const livekit = await this.livekitStatus();
    if (livekit !== 'ok') {
      throw new ServiceUnavailableException(`LiveKit ${livekit}`);
    }
    return { status: 'ok', livekit };
  }

  @Get('livekit-url')
  async returnLivekitServerUrl(): Promise<{ livekitUrl: string }> {
    return { livekitUrl: process.env.LIVEKIT_HOST };
  }

  @Get('room/:roomName/exists')
  async getRoomExists(
    @Param() { roomName }: { roomName: string },
  ): Promise<boolean> {
    return (await this.livekit.getRoom(roomName.toUpperCase())) !== undefined;
  }

  @Get('rooms')
  async listRooms(): Promise<{ name: string; numParticipants: number }[]> {
    const rooms = await this.livekit.client.listRooms();
    // LiveKit v2 rooms carry bigint fields, which JSON can't serialise;
    // only send what clients use (and never the passcode in metadata)
    return rooms.map((room) => ({
      name: room.name,
      numParticipants: room.numParticipants,
    }));
  }

  @Post('room')
  @ApiBody(yupToOpenAPISchema(createRoomBodySchema()))
  async createRoom(
    @Body(new YupValidationPipe(createRoomBodySchema()))
    body: Yup.InferType<ReturnType<typeof createRoomBodySchema>>,
  ): Promise<{ name: string }> {
    const name = body.roomName.toUpperCase();
    await this.roomState.createRoom(name, body.passcode);
    return { name };
  }

  @Get('room/:roomName/identity/:identity/exists')
  async identityExistsInRoom(
    @Param() params: { roomName: string; identity: string },
  ): Promise<boolean> {
    const { roomName, identity } = params;
    const participantsInRoom = await this.livekit.client.listParticipants(
      roomName,
    );
    return participantsInRoom.some((p) => p.identity === identity);
  }

  @Post('room/token/control')
  @ApiBody(yupToOpenAPISchema(joinRoomSchema(), 'Generate a control token'))
  async generateControlToken(
    @Body(new YupValidationPipe(joinRoomSchema())) body: JoinRoomBody,
  ): Promise<{ token: string }> {
    return this.generateToken(body, 'CONTROL');
  }

  @Post('room/token/performer')
  @ApiBody(yupToOpenAPISchema(joinRoomSchema(), 'Generate a performer token'))
  async generatePerformerToken(
    @Body(new YupValidationPipe(joinRoomSchema())) body: JoinRoomBody,
  ): Promise<{ token: string }> {
    return this.generateToken(body, 'PERFORMER');
  }

  @Post('room/token/scout')
  @ApiBody(yupToOpenAPISchema(joinRoomSchema(), 'Generate a scout token'))
  async generateScoutToken(
    @Body(new YupValidationPipe(joinRoomSchema())) body: JoinRoomBody,
  ): Promise<{ token: string }> {
    return this.generateToken(body, 'SCOUT');
  }

  @Post('room/token/output')
  @ApiBody(yupToOpenAPISchema(joinRoomSchema(), 'Generate an output token'))
  async generateOutputToken(
    @Body(new YupValidationPipe(joinRoomSchema())) body: JoinRoomBody,
  ): Promise<{ token: string }> {
    return this.generateToken(body, 'OUTPUT');
  }

  @Post('room/identity/check')
  async checkIdentityAvailableForRoom(
    @Body() body: { identity: string; roomName: string },
  ): Promise<{ ok: boolean }> {
    const { roomName, identity } = body;
    const participants = await this.livekit.client.listParticipants(roomName);
    return { ok: !participants.some((p) => p.identity === identity) };
  }

  @Post('room/passcode/check')
  async checkPasscodeForRoom(
    @Body() body: { passcode: string; roomName: string },
  ): Promise<{ ok: boolean }> {
    if (typeof body?.roomName !== 'string') {
      throw new BadRequestException('roomName is required');
    }
    return {
      ok: await this.roomState.checkPasscode(body.roomName, body.passcode),
    };
  }

  @Patch('room/state')
  async updateRoomState(
    @Body(new YupValidationPipe(roomStateActionSchema()))
    body: RoomStateAction,
  ): Promise<{ ok: boolean }> {
    await this.roomState.apply(body);
    return { ok: true };
  }

  @Post('livekit/webhook')
  async handleWebhooks(@Req() req: RawBodyRequest<Request>) {
    const raw = req.body;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new BadRequestException(
        'Webhook body missing; expected Content-Type application/webhook+json',
      );
    }

    let event: Awaited<
      ReturnType<LivekitService['webhookReceiver']['receive']>
    >;
    try {
      event = await this.livekit.webhookReceiver.receive(
        raw.toString('utf8'),
        req.get('Authorization'),
      );
    } catch (err) {
      throw new UnauthorizedException(`Invalid webhook: ${err.message}`);
    }

    this.logger.debug(`webhook ${event.event} ${event.room?.name ?? ''}`);

    if (event.event === 'participant_joined') {
      const roomName = event.room.name;
      const identity = event.participant.identity;
      this.logger.log(`${identity} joined ${roomName}`);
      // Re-send the participant's state shortly after they join, in case it
      // changed between token issue and join. Runs after the webhook is
      // acknowledged so LiveKit isn't kept waiting.
      setTimeout(() => {
        this.roomState
          .resendParticipantState(roomName, identity)
          .catch((err) =>
            this.logger.warn(
              `Could not resend state to ${identity}@${roomName}: ${err.message}`,
            ),
          );
      }, 500);
    }

    if (event.event === 'participant_left') {
      this.logger.log(`${event.participant.identity} left ${event.room.name}`);
    }

    if (event.event === 'room_finished') {
      await this.roomState.forgetRoom(event.room.name);
    }

    return { ok: true };
  }

  private async generateToken(
    { identity, passcode, roomName }: JoinRoomBody,
    role: XIMIRole,
  ): Promise<{ token: string }> {
    if (!(await this.livekit.getRoom(roomName))) {
      throw new NotFoundException(`Room ${roomName} not found`);
    }
    if (!(await this.roomState.checkPasscode(roomName, passcode))) {
      throw new UnauthorizedException('Incorrect passcode');
    }

    const initialState = await this.roomState.initialParticipantState(
      roomName,
      identity,
      role,
    );
    return {
      token: await this.livekit.generateToken(
        roomName,
        identity,
        role,
        initialState,
      ),
    };
  }

  private async livekitStatus(): Promise<'ok' | 'unreachable'> {
    try {
      await this.livekit.client.listRooms();
      return 'ok';
    } catch {
      return 'unreachable';
    }
  }
}
