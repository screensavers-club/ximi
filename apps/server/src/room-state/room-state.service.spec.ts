import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { XimiParticipantState, XimiRoomState } from 'ximi-types';
import { RoomStateService } from './room-state.service';
import { RoomStateStore } from './room-state.store';
import { LivekitService } from '../livekit/service';

const tick = () => new Promise((r) => setTimeout(r, Math.random() * 5));

/** In-memory stand-in for LiveKit with async latency on every call */
const fakeLivekit = () => {
  const rooms = new Map<string, { name: string; metadata: string }>();
  const participants = new Map<
    string,
    { identity: string; metadata: string }
  >();

  const client = {
    async listRooms(names?: string[]) {
      await tick();
      return [...rooms.values()].filter(
        (r) => !names || names.includes(r.name),
      );
    },
    async createRoom({ name, metadata }) {
      await tick();
      rooms.set(name, { name, metadata });
      return rooms.get(name);
    },
    async updateRoomMetadata(name: string, metadata: string) {
      await tick();
      rooms.get(name).metadata = metadata;
    },
    async listParticipants() {
      await tick();
      return [...participants.values()];
    },
    async getParticipant(_room: string, identity: string) {
      await tick();
      return participants.get(identity);
    },
    async updateParticipant(_room: string, identity: string, metadata: string) {
      await tick();
      participants.get(identity).metadata = metadata;
    },
  };

  const livekit = {
    client,
    async getRoom(name: string) {
      const [room] = await client.listRooms([name]);
      return room;
    },
  } as unknown as LivekitService;

  const join = (identity: string, role: XimiParticipantState['role']) =>
    participants.set(identity, {
      identity,
      metadata: JSON.stringify({ role }),
    });

  return { livekit, rooms, participants, join };
};

describe('RoomStateService', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ximi-state-'));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const setup = async () => {
    const lk = fakeLivekit();
    const service = new RoomStateService(lk.livekit, new RoomStateStore());
    await service.onModuleInit();
    await service.createRoom('R1', '12345');
    lk.join('ALICE', 'PERFORMER');
    lk.join('BOB', 'PERFORMER');
    lk.join('CAROL', 'SCOUT');
    return { ...lk, service };
  };

  const savedState = async (room = 'R1'): Promise<XimiRoomState> =>
    JSON.parse(
      await readFile(path.join(dataDir, 'rooms', `${room}.json`), 'utf8'),
    );

  it('keeps every change when actions arrive concurrently', async () => {
    const { service, participants } = await setup();

    await Promise.all([
      service.apply({
        type: 'mute-audio',
        roomName: 'R1',
        forParticipant: 'ALICE',
        channel: 'BOB',
      }),
      service.apply({
        type: 'mute-audio',
        roomName: 'R1',
        forParticipant: 'ALICE',
        channel: 'CAROL',
      }),
      service.apply({
        type: 'set-audio-delay',
        roomName: 'R1',
        forParticipant: 'ALICE',
        delay: 250,
      }),
      service.apply({
        type: 'set-preset-name',
        roomName: 'R1',
        preset: 3,
        name: 'ACT2',
      }),
    ]);

    const state = await service.getState('R1');
    const alice = state.presets[0].participants.ALICE.state;
    expect(alice.audio.mute.sort()).toEqual(['BOB', 'CAROL']);
    expect(alice.audio.delay).toBe(250);
    expect(state.presets[3].name).toBe('ACT2');

    // delivered to LiveKit and persisted identically
    expect(JSON.parse(participants.get('ALICE').metadata)).toEqual(alice);
    expect(await savedState()).toEqual(state);
  });

  it('does not duplicate a channel muted twice', async () => {
    const { service } = await setup();
    const mute = {
      type: 'mute-audio' as const,
      roomName: 'R1',
      forParticipant: 'ALICE',
      channel: 'BOB',
    };
    await service.apply(mute);
    await service.apply(mute);
    expect(
      (await service.getState('R1')).presets[0].participants.ALICE.state.audio
        .mute,
    ).toEqual(['BOB']);
  });

  it('switching presets pushes each participant their saved or default state', async () => {
    const { service, participants } = await setup();
    await service.apply({
      type: 'set-active-preset',
      roomName: 'R1',
      activePreset: 1,
    });
    await service.apply({
      type: 'set-audio-delay',
      roomName: 'R1',
      forParticipant: 'BOB',
      delay: 900,
    });
    await service.apply({
      type: 'set-active-preset',
      roomName: 'R1',
      activePreset: 0,
    });

    expect(JSON.parse(participants.get('BOB').metadata).audio.delay).toBe(0);
    expect(JSON.parse(participants.get('CAROL').metadata).role).toBe('SCOUT');

    await service.apply({
      type: 'set-active-preset',
      roomName: 'R1',
      activePreset: 1,
    });
    expect(JSON.parse(participants.get('BOB').metadata).audio.delay).toBe(900);
  });

  it('upload replaces presets but keeps the room passcode', async () => {
    const { service } = await setup();
    const uploaded = structuredClone(await service.getState('R1'));
    uploaded.passcode = '99999';
    uploaded.activePreset = 2;
    uploaded.presets[2].name = 'FROMFILE';

    await service.apply({
      type: 'upload-presets',
      roomName: 'R1',
      roomState: uploaded,
    });

    const state = await service.getState('R1');
    expect(state.passcode).toBe('12345');
    expect(state.activePreset).toBe(2);
    expect(state.presets[2].name).toBe('FROMFILE');
  });

  it('leaves state untouched when an action fails', async () => {
    const { service } = await setup();
    const before = structuredClone(await service.getState('R1'));
    await expect(
      service.apply({
        type: 'set-audio-delay',
        roomName: 'R1',
        forParticipant: 'NOBODY',
        delay: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.getState('R1')).toEqual(before);
  });

  it('survives a server restart', async () => {
    const { service, livekit } = await setup();
    await service.apply({
      type: 'set-preset-name',
      roomName: 'R1',
      preset: 0,
      name: 'OPENING',
    });

    const restarted = new RoomStateService(livekit, new RoomStateStore());
    await restarted.onModuleInit();
    expect((await restarted.getState('R1')).presets[0].name).toBe('OPENING');
  });

  it('archives state when the room closes, and on startup if LiveKit lost the room', async () => {
    const { service, livekit, rooms } = await setup();
    await service.createRoom('R2', '11111');

    await service.forgetRoom('R1');
    rooms.delete('R1');
    rooms.delete('R2'); // R2 disappears while the server is down

    const restarted = new RoomStateService(livekit, new RoomStateStore());
    await restarted.onModuleInit();

    expect(restarted.roomCount).toBe(0);
    expect(await readdir(path.join(dataDir, 'rooms'))).toEqual([]);
    expect((await readdir(path.join(dataDir, 'archive'))).length).toBe(2);
  });

  it('adopts rooms that only exist in LiveKit metadata', async () => {
    const { service, rooms } = await setup();
    const legacy = structuredClone(await service.getState('R1'));
    rooms.set('OLD', { name: 'OLD', metadata: JSON.stringify(legacy) });
    expect((await service.getState('OLD')).passcode).toBe('12345');
    expect(await savedState('OLD')).toEqual(legacy);
  });

  it('refuses to create a room that already exists', async () => {
    const { service } = await setup();
    await expect(service.createRoom('R1', '00000')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('uses the role a participant joins with, not the one saved in the preset', async () => {
    const { service } = await setup();
    await service.apply({
      type: 'set-audio-delay',
      roomName: 'R1',
      forParticipant: 'ALICE',
      delay: 40,
    });
    const s = await service.initialParticipantState('R1', 'ALICE', 'SCOUT');
    expect(s.role).toBe('SCOUT');
    expect(s.audio.delay).toBe(40);
  });
});
