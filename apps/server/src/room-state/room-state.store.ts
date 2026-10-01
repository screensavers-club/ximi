import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { XimiRoomState } from 'ximi-types';

/**
 * Persists room state as one JSON file per room under DATA_DIR/rooms.
 * Writes go to a temp file first and are renamed into place, so a crash
 * mid-write never leaves a truncated state file behind.
 */
@Injectable()
export class RoomStateStore {
  private readonly logger = new Logger(RoomStateStore.name);
  private readonly roomsDir: string;
  private readonly archiveDir: string;

  constructor() {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.roomsDir = path.join(dataDir, 'rooms');
    this.archiveDir = path.join(dataDir, 'archive');
  }

  async loadAll(): Promise<Map<string, XimiRoomState>> {
    await mkdir(this.roomsDir, { recursive: true });
    await mkdir(this.archiveDir, { recursive: true });

    const states = new Map<string, XimiRoomState>();
    const files = (await readdir(this.roomsDir)).filter((f) =>
      f.endsWith('.json'),
    );

    for (const file of files) {
      try {
        const raw = await readFile(path.join(this.roomsDir, file), 'utf8');
        states.set(path.basename(file, '.json'), JSON.parse(raw));
      } catch (err) {
        this.logger.error(`Could not read room state ${file}: ${err}`);
      }
    }

    this.logger.log(`Loaded ${states.size} room(s) from ${this.roomsDir}`);
    return states;
  }

  async save(roomName: string, state: XimiRoomState): Promise<void> {
    const file = this.fileFor(roomName);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, file);
  }

  /** Moves a room's state out of the active set, keeping it for recovery */
  async archive(roomName: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await rename(
        this.fileFor(roomName),
        path.join(this.archiveDir, `${roomName}-${stamp}.json`),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private fileFor(roomName: string) {
    // room names are validated as alphanumeric, but never trust a path segment
    return path.join(
      this.roomsDir,
      `${roomName.replace(/[^A-Z0-9]/gi, '_')}.json`,
    );
  }
}
