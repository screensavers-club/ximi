import { toast } from "react-hot-toast";

/** An error response from the XIMI server, with its message made readable */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server could not be reached */
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const readMessage = (body: unknown, fallback: string) => {
  const message = (body as { message?: unknown })?.message;
  if (Array.isArray(message)) {
    return message.join("; ");
  }
  return typeof message === "string" && message !== "" ? message : fallback;
};

export async function ximiRequest<T>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      headers:
        init?.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the XIMI server");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readMessage(body, `Request failed (${response.status})`),
    );
  }
  return body as T;
}

export type TokenRole = "control" | "performer" | "scout" | "output";

export type JoinCredentials = {
  serverUrl: string;
  roomName: string;
  identity: string;
  passcode: string;
};

export const requestToken = async (
  role: TokenRole,
  { serverUrl, roomName, identity, passcode }: JoinCredentials,
) => {
  const { token } = await ximiRequest<{ token: string }>(
    `${serverUrl}/room/token/${role}`,
    { method: "POST", body: { roomName, identity, passcode } },
  );
  return token;
};

/**
 * Sends a room state action. Returns true if it was applied; on failure shows
 * the server's error message as a toast and returns false.
 */
export const patchRoomState = async (
  serverUrl: string,
  action: unknown,
): Promise<boolean> => {
  try {
    await ximiRequest<{ ok: boolean }>(`${serverUrl}/room/state`, {
      method: "PATCH",
      body: action,
    });
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
};

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "An unknown error occurred";

export const toastError = (err: unknown, prefix?: string) => {
  const message = errorMessage(err);
  toast.error(prefix ? `${prefix}: ${message}` : message, {
    position: "bottom-right",
    className: "bg-negative/80 text-text rounded-none",
  });
};
