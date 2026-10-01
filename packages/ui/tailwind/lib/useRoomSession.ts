import { DisconnectReason } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  errorMessage,
  JoinCredentials,
  requestToken,
  TokenRole,
} from "./api";

export type SessionStatus =
  | { phase: "idle" }
  | { phase: "connected" }
  | { phase: "rejoining"; attempt: number; lastError?: string }
  | { phase: "ended"; reason: string };

type Session = { credentials: JoinCredentials; token: string };

type Options = {
  /** Keep trying no matter what (unattended Output pages). Default false. */
  retryForever?: boolean;
  /** Remember credentials in this tab so a page reload rejoins automatically */
  persistInTab?: boolean;
};

const MAX_BACKOFF_MS = 10_000;
const backoff = (attempt: number) =>
  Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1));

/** Disconnects that a rejoin can't fix, and what to tell the user */
const finalDisconnects: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.CLIENT_INITIATED]: "You left the room",
  [DisconnectReason.DUPLICATE_IDENTITY]:
    "Someone else joined with your name, so you were disconnected",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the room",
  [DisconnectReason.ROOM_DELETED]: "The room was closed",
};

const storageKey = (role: TokenRole) => `ximi-session-${role}`;

const readStored = (role: TokenRole): JoinCredentials | undefined => {
  try {
    const raw = window.sessionStorage.getItem(storageKey(role));
    return raw ? (JSON.parse(raw) as JoinCredentials) : undefined;
  } catch {
    return undefined;
  }
};

const writeStored = (role: TokenRole, credentials?: JoinCredentials) => {
  try {
    if (credentials) {
      window.sessionStorage.setItem(
        storageKey(role),
        JSON.stringify(credentials),
      );
    } else {
      window.sessionStorage.removeItem(storageKey(role));
    }
  } catch {
    // storage unavailable (private mode etc.) - reload just won't auto-rejoin
  }
};

/**
 * Holds the credentials and LiveKit token for one room session, and rejoins
 * with a fresh token when the connection drops for good.
 *
 * LiveKit already retries short network blips by itself; this takes over once
 * it gives up (onDisconnected) or a connect attempt fails (onError).
 */
export function useRoomSession(role: TokenRole, options: Options = {}) {
  const { retryForever = false, persistInTab = false } = options;
  const [session, setSession] = useState<Session>();
  const [status, setStatus] = useState<SessionStatus>({ phase: "idle" });

  // bumps on every join/leave so an old retry loop knows to stop
  const generation = useRef(0);
  const sessionRef = useRef<Session>();
  sessionRef.current = session;

  /**
   * Fetches a token until it works. Superseded by any later join/leave.
   * `immediate` skips the wait before the first attempt.
   */
  const connectWithRetry = useCallback(
    async (
      credentials: JoinCredentials,
      { firstError, immediate = false }: { firstError?: string; immediate?: boolean } = {},
    ) => {
      const myGeneration = ++generation.current;
      let lastError = firstError;

      for (let attempt = 1; ; attempt++) {
        setStatus({ phase: "rejoining", attempt, lastError });
        const wait = immediate && attempt === 1 ? 0 : backoff(attempt);
        await new Promise((r) => setTimeout(r, wait));
        if (generation.current !== myGeneration) {
          return;
        }

        try {
          const token = await requestToken(role, credentials);
          if (generation.current !== myGeneration) {
            return;
          }
          setSession({ credentials, token });
          return;
        } catch (err) {
          lastError = errorMessage(err);
          const status = err instanceof ApiError ? err.status : 0;
          // wrong passcode / room gone: retrying won't help someone at a screen
          if (!retryForever && (status === 401 || status === 404)) {
            setStatus({ phase: "ended", reason: lastError });
            writeStored(role, undefined);
            return;
          }
        }
      }
    },
    [role, retryForever],
  );

  const rejoin = useCallback(
    (credentials: JoinCredentials, firstError?: string) =>
      connectWithRetry(credentials, { firstError }),
    [connectWithRetry],
  );

  /** First join from a form. Throws ApiError so the form can show it. */
  const join = useCallback(
    async (credentials: JoinCredentials) => {
      const myGeneration = ++generation.current;
      const token = await requestToken(role, credentials);
      if (generation.current !== myGeneration) {
        return;
      }
      setSession({ credentials, token });
      setStatus({ phase: "idle" });
      if (persistInTab) {
        writeStored(role, credentials);
      }
    },
    [role, persistInTab],
  );

  /** Join and keep retrying until it works (Output pages) */
  const joinWithRetry = useCallback(
    (credentials: JoinCredentials) =>
      connectWithRetry(credentials, { immediate: true }),
    [connectWithRetry],
  );

  const leave = useCallback(() => {
    generation.current++;
    writeStored(role, undefined);
    setSession(undefined);
    setStatus({ phase: "idle" });
  }, [role]);

  const onConnected = useCallback(() => {
    setStatus({ phase: "connected" });
  }, []);

  const onDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      const current = sessionRef.current;
      if (current === undefined) {
        return;
      }
      const finalReason =
        reason === undefined ? undefined : finalDisconnects[reason];

      if (
        finalReason !== undefined &&
        !(retryForever && reason === DisconnectReason.ROOM_DELETED)
      ) {
        generation.current++;
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          setStatus({ phase: "ended", reason: finalReason });
        }
        writeStored(role, undefined);
        return;
      }
      rejoin(current.credentials, "Connection lost");
    },
    [rejoin, retryForever, role],
  );

  /** connect() failed, e.g. LiveKit unreachable */
  const onError = useCallback(
    (err: Error) => {
      const current = sessionRef.current;
      if (current !== undefined) {
        rejoin(current.credentials, err.message);
      }
    },
    [rejoin],
  );

  // after a reload, pick the session back up
  useEffect(() => {
    if (!persistInTab) {
      return;
    }
    const stored = readStored(role);
    if (stored) {
      rejoin(stored, "Rejoining after reload");
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    session,
    status,
    join,
    joinWithRetry,
    leave,
    /** Spread onto <LiveKitRoom> */
    roomCallbacks: { onConnected, onDisconnected, onError },
  };
}
