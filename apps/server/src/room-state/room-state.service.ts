import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ParticipantInfo } from 'livekit-server-sdk';
import {
  MuteAudioAction,
  SetAudioDelayAction,
  SetPresetNameAction,
  SetScoutTextAction,
  SetVideoLayoutAction,
  SwitchActivePresetAction,
  UnmuteAudioAction,
  UploadPresetsAction,
  XIMIRole,
  XimiParticipantState,
  XimiRoomState,
} from 'ximi-types';
import { LivekitService } from '../livekit/service';
import { RoomStateStore } from './room-state.store';

export type RoomStateAction =
  | SwitchActivePresetAction
  | SetPresetNameAction
  | SetAudioDelayAction
  | MuteAudioAction
  | UnmuteAudioAction
  | SetScoutTextAction
  | SetVideoLayoutAction
  | UploadPresetsAction;

const PRESET_COUNT = 12;

const defaultParticipantState = (role: XIMIRole): XimiParticipantState => ({
  role,
  audio: { mute: [], delay: 0 },
  video: { name: 'Auto', layout: undefined },
  textPoster: '',
});

const parseParticipantMeta = (
  p: ParticipantInfo,
): Partial<XimiParticipantState> => {
  try {
    return JSON.parse(p.metadata || '{}');
  } catch {
    return {};
  }
};

/**
 * Owns XIMI room state. The server is the source of truth; LiveKit room and
 * participant metadata are only how the state is delivered to clients.
 *
 * Every change to a room runs through a per-room queue, so concurrent
 * requests apply one after another instead of overwriting each other.
 */
@Injectable()
export class RoomStateService implements OnModuleInit {
  private readonly logger = new Logger(RoomStateService.name);
  private states = new Map<string, XimiRoomState>();
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly livekit: LivekitService,
    private readonly store: RoomStateStore,
  ) {}

  async onModuleInit() {
    this.states = await this.store.loadAll();
    await this.archiveRoomsMissingFromLivekit();
  }

  get roomCount() {
    return this.states.size;
  }

  async createRoom(roomName: string, passcode: string): Promise<void> {
    return this.exclusive(roomName, async () => {
      if (await this.livekit.getRoom(roomName)) {
        throw new ConflictException(`Room ${roomName} already exists`);
      }

      const state: XimiRoomState = {
        passcode,
        activePreset: 0,
        presets: new Array(PRESET_COUNT).fill(0).map((_, n) => ({
          participants: {},
          name: `PRESET${n + 1}`,
        })),
      };

      await this.livekit.client.createRoom({
        name: roomName,
        metadata: JSON.stringify(state),
      });
      await this.store.save(roomName, state);
      this.states.set(roomName, state);
      this.logger.log(`Created room ${roomName}`);
    });
  }

  /** Returns the room's state, or throws NotFound if LiveKit has no such room */
  async getState(roomName: string): Promise<XimiRoomState> {
    const known = this.states.get(roomName);
    if (known) {
      return known;
    }

    // Rooms created before the server kept its own state (or whose state file
    // was lost) are adopted from the metadata LiveKit still holds.
    const room = await this.livekit.getRoom(roomName);
    if (!room) {
      throw new NotFoundException(`Room ${roomName} not found`);
    }

    try {
      const state = JSON.parse(room.metadata) as XimiRoomState;
      if (
        !Array.isArray(state?.presets) ||
        typeof state.passcode !== 'string'
      ) {
        throw new Error('metadata is not XIMI room state');
      }
      this.states.set(roomName, state);
      await this.store.save(roomName, state);
      this.logger.warn(`Adopted state for ${roomName} from LiveKit metadata`);
      return state;
    } catch (err) {
      throw new NotFoundException(
        `Room ${roomName} exists in LiveKit but has no XIMI state (${err.message})`,
      );
    }
  }

  async checkPasscode(roomName: string, passcode: string): Promise<boolean> {
    const state = await this.getState(roomName);
    return state.passcode === passcode;
  }

  /** The state a participant should join with: their saved state in the active preset */
  async initialParticipantState(
    roomName: string,
    identity: string,
    role: XIMIRole,
  ): Promise<XimiParticipantState> {
    const state = await this.getState(roomName);
    const saved =
      state.presets[state.activePreset].participants[identity]?.state;
    // the role always comes from how they are joining now
    return saved ? { ...saved, role } : defaultParticipantState(role);
  }

  /** Re-sends a participant's state, e.g. right after they join */
  async resendParticipantState(roomName: string, identity: string) {
    return this.exclusive(roomName, async () => {
      const state = await this.getState(roomName);
      const participant = await this.livekit.client.getParticipant(
        roomName,
        identity,
      );
      await this.livekit.client.updateParticipant(
        roomName,
        identity,
        JSON.stringify(this.participantState(state, participant)),
      );
    });
  }

  /** Called when LiveKit closes a room. State is archived, not deleted. */
  async forgetRoom(roomName: string) {
    return this.exclusive(roomName, async () => {
      if (!this.states.has(roomName)) {
        return;
      }
      this.states.delete(roomName);
      await this.store.archive(roomName);
      this.logger.log(`Room ${roomName} closed; state archived`);
    });
  }

  async apply(action: RoomStateAction): Promise<void> {
    const roomName = action.roomName;

    return this.exclusive(roomName, async () => {
      const current = await this.getState(roomName);
      // work on a copy so a failed action leaves state untouched
      const next = structuredClone(current);
      const participantsToPush = new Map<string, XimiParticipantState>();

      switch (action.type) {
        case 'mute-audio':
        case 'unmute-audio': {
          const p = await this.requireParticipant(
            roomName,
            action.forParticipant,
          );
          const pState = this.participantState(next, p);
          const mute = pState.audio.mute.filter((id) => id !== action.channel);
          if (action.type === 'mute-audio') {
            mute.push(action.channel);
          }
          pState.audio.mute = mute;
          this.setParticipantState(next, p.identity, pState);
          participantsToPush.set(p.identity, pState);
          break;
        }

        case 'set-audio-delay': {
          const p = await this.requireParticipant(
            roomName,
            action.forParticipant,
          );
          const pState = this.participantState(next, p);
          pState.audio.delay = action.delay;
          this.setParticipantState(next, p.identity, pState);
          participantsToPush.set(p.identity, pState);
          break;
        }

        case 'set-video-layout': {
          const p = await this.requireParticipant(
            roomName,
            action.forParticipant,
          );
          const pState = this.participantState(next, p);
          pState.video = action.layout;
          this.setParticipantState(next, p.identity, pState);
          participantsToPush.set(p.identity, pState);
          break;
        }

        case 'set-scout-text': {
          const inRoom = await this.livekit.client.listParticipants(roomName);
          const missing = action.forParticipant.filter(
            (id) => !inRoom.some((p) => p.identity === id),
          );
          if (missing.length > 0) {
            throw new NotFoundException(
              `Not in room ${roomName}: ${missing.join(', ')}`,
            );
          }

          for (const p of inRoom.filter((p) =>
            action.forParticipant.includes(p.identity),
          )) {
            const pState = this.participantState(next, p);
            pState.textPoster = action.textPoster;
            this.setParticipantState(next, p.identity, pState);
            participantsToPush.set(p.identity, pState);
          }
          break;
        }

        case 'set-preset-name': {
          next.presets[action.preset].name = action.name;
          break;
        }

        case 'set-active-preset': {
          next.activePreset = action.activePreset;
          await this.collectAllParticipants(roomName, next, participantsToPush);
          break;
        }

        case 'upload-presets': {
          // Only presets are loaded from the file. The room keeps its own
          // passcode, so loading a file from another room can't lock people out.
          next.presets = action.roomState.presets;
          next.activePreset = action.roomState.activePreset;
          await this.collectAllParticipants(roomName, next, participantsToPush);
          break;
        }
      }

      await this.commit(roomName, next, participantsToPush);
    });
  }

  /** Persist first (source of truth), then deliver to LiveKit */
  private async commit(
    roomName: string,
    state: XimiRoomState,
    participants: Map<string, XimiParticipantState>,
  ) {
    await this.store.save(roomName, state);
    this.states.set(roomName, state);

    await Promise.all(
      [...participants].map(([identity, pState]) =>
        this.livekit.client.updateParticipant(
          roomName,
          identity,
          JSON.stringify(pState),
        ),
      ),
    );
    await this.livekit.client.updateRoomMetadata(
      roomName,
      JSON.stringify(state),
    );
  }

  /** Queue every participant in the room for their state in the active preset */
  private async collectAllParticipants(
    roomName: string,
    state: XimiRoomState,
    into: Map<string, XimiParticipantState>,
  ) {
    const inRoom = await this.livekit.client.listParticipants(roomName);
    for (const p of inRoom) {
      into.set(p.identity, this.participantState(state, p));
    }
  }

  private participantState(
    state: XimiRoomState,
    p: ParticipantInfo,
  ): XimiParticipantState {
    const role = parseParticipantMeta(p).role ?? 'PERFORMER';
    const saved =
      state.presets[state.activePreset].participants[p.identity]?.state;
    return saved
      ? { ...structuredClone(saved), role }
      : defaultParticipantState(role);
  }

  private setParticipantState(
    state: XimiRoomState,
    identity: string,
    pState: XimiParticipantState,
  ) {
    state.presets[state.activePreset].participants[identity] = {
      identity,
      state: pState,
    };
  }

  private async requireParticipant(roomName: string, identity: string) {
    const inRoom = await this.livekit.client.listParticipants(roomName);
    const p = inRoom.find((p) => p.identity === identity);
    if (!p) {
      throw new NotFoundException(
        `Participant ${identity} is not in room ${roomName}`,
      );
    }
    return p;
  }

  private exclusive<T>(roomName: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(roomName) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const settled = run.catch(() => undefined);
    this.queues.set(roomName, settled);
    settled.then(() => {
      if (this.queues.get(roomName) === settled) {
        this.queues.delete(roomName);
      }
    });
    return run;
  }

  private async archiveRoomsMissingFromLivekit() {
    try {
      const live = new Set(
        (await this.livekit.client.listRooms()).map((r) => r.name),
      );
      for (const roomName of [...this.states.keys()]) {
        if (!live.has(roomName)) {
          await this.forgetRoom(roomName);
        }
      }
    } catch (err) {
      this.logger.warn(
        `LiveKit unreachable at startup, keeping all saved rooms: ${err.message}`,
      );
    }
  }
}
