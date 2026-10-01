import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as request from 'supertest';
import { raw } from 'express';
import { ServerError } from 'livekit-server-sdk';
import { AppModule } from './app.module';
import { LivekitService } from './livekit/service';
import { AllExceptionsFilter } from './util/http-exception.filter';

describe('HTTP API', () => {
  let app: INestApplication;
  let dataDir: string;
  let livekitDown = false;
  const rooms = new Map<
    string,
    {
      name: string;
      metadata: string;
      numParticipants: number;
      creationTime: bigint;
    }
  >();
  const participants = new Map<
    string,
    { identity: string; metadata: string }
  >();

  const guard = () => {
    if (livekitDown) {
      throw new TypeError('fetch failed');
    }
  };

  const fakeLivekit = {
    client: {
      async listRooms(names?: string[]) {
        guard();
        return [...rooms.values()].filter(
          (r) => !names || names.includes(r.name),
        );
      },
      async createRoom({ name, metadata }) {
        guard();
        rooms.set(name, {
          name,
          metadata,
          numParticipants: 0,
          creationTime: 1n,
        });
      },
      async updateRoomMetadata(name: string, metadata: string) {
        rooms.get(name).metadata = metadata;
      },
      async listParticipants() {
        guard();
        return [...participants.values()];
      },
      async getParticipant(_room: string, identity: string) {
        if (!participants.has(identity)) {
          throw new ServerError(
            'not_found',
            'participant does not exist',
            404,
            'not_found',
          );
        }
        return participants.get(identity);
      },
      async updateParticipant(_r: string, identity: string, metadata: string) {
        participants.get(identity).metadata = metadata;
      },
    },
    async getRoom(name: string) {
      const [room] = await fakeLivekit.client.listRooms([name]);
      return room;
    },
    async generateToken() {
      return 'token';
    },
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ximi-http-'));
    process.env.DATA_DIR = dataDir;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LivekitService)
      .useValue(fakeLivekit)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(raw({ type: 'application/webhook+json' }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    await request(app.getHttpServer())
      .post('/room')
      .send({ roomName: 'show', passcode: '12345' })
      .expect(201, { name: 'SHOW' });
    participants.set('ALICE', {
      identity: 'ALICE',
      metadata: '{"role":"PERFORMER"}',
    });
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    livekitDown = false;
  });

  const http = () => request(app.getHttpServer());

  it('lists rooms without bigint fields or metadata', async () => {
    const res = await http().get('/rooms').expect(200);
    expect(res.body).toEqual([{ name: 'SHOW', numParticipants: 0 }]);
  });

  it('409 when creating a duplicate room', async () => {
    const res = await http()
      .post('/room')
      .send({ roomName: 'SHOW', passcode: '12345' })
      .expect(409);
    expect(res.body.message).toBe('Room SHOW already exists');
  });

  it('400 lists every validation problem', async () => {
    const res = await http()
      .post('/room')
      .send({ roomName: 'x', passcode: 'abc' })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining(['min 2 characters', 'digits only']),
    );
  });

  it('token: 404 unknown room, 401 wrong passcode, 201 ok', async () => {
    const body = { roomName: 'NOPE', identity: 'ALICE', passcode: '12345' };
    expect(
      (await http().post('/room/token/performer').send(body).expect(404)).body
        .message,
    ).toBe('Room NOPE not found');
    expect(
      (
        await http()
          .post('/room/token/performer')
          .send({ ...body, roomName: 'SHOW', passcode: '00000' })
          .expect(401)
      ).body.message,
    ).toBe('Incorrect passcode');
    await http()
      .post('/room/token/performer')
      .send({ ...body, roomName: 'SHOW' })
      .expect(201, { token: 'token' });
  });

  it('PATCH validates actions', async () => {
    const res = await http()
      .patch('/room/state')
      .send({
        type: 'set-audio-delay',
        roomName: 'SHOW',
        forParticipant: 'ALICE',
        delay: 99999,
      })
      .expect(400);
    expect(res.body.message).toEqual(['max 5000ms']);

    const unknown = await http()
      .patch('/room/state')
      .send({ type: 'drop-tables', roomName: 'SHOW' })
      .expect(400);
    expect(unknown.body.message).toEqual(['unknown action type']);
  });

  it('PATCH strips unknown keys and applies the action', async () => {
    await http()
      .patch('/room/state')
      .send({
        type: 'set-audio-delay',
        roomName: 'SHOW',
        forParticipant: 'ALICE',
        delay: '120',
        extra: 1,
      })
      .expect(200, { ok: true });
    expect(JSON.parse(participants.get('ALICE').metadata).audio.delay).toBe(
      120,
    );
  });

  it('PATCH 404 names the missing participant', async () => {
    const res = await http()
      .patch('/room/state')
      .send({
        type: 'mute-audio',
        roomName: 'SHOW',
        forParticipant: 'ZED',
        channel: 'ALICE',
      })
      .expect(404);
    expect(res.body.message).toBe('Participant ZED is not in room SHOW');
  });

  it('502 when LiveKit is unreachable; health reports it', async () => {
    livekitDown = true;
    const res = await http().get('/rooms').expect(502);
    expect(res.body).toEqual({
      statusCode: 502,
      error: 'BAD_GATEWAY',
      message: 'LiveKit server unreachable',
    });

    expect((await http().get('/health').expect(200)).body.livekit).toBe(
      'unreachable',
    );
    await http().get('/health/ready').expect(503);
  });

  it('rejects unsigned webhooks', async () => {
    fakeLivekit['webhookReceiver'] = {
      receive: async () => {
        throw new Error('authorization header is empty');
      },
    };
    const res = await http()
      .post('/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .send('{}')
      .expect(401);
    expect(res.body.message).toBe(
      'Invalid webhook: authorization header is empty',
    );
  });
});
