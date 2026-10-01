import * as Yup from "yup";

const roomNameField = () =>
  Yup.string()
    .required()
    .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
    .max(10, "max 10 characters")
    .min(2, "min 2 characters");

const passcodeField = () =>
  Yup.string()
    .required()
    .matches(/^[0-9]*$/, "digits only")
    .max(5, "must be 5 digits")
    .min(5, "must be 5 digits");

/* Server side: shape only. Room uniqueness is checked against LiveKit directly. */
const createRoomBodySchema = () =>
  Yup.object({
    roomName: roomNameField(),
    passcode: passcodeField(),
  })
    .required()
    .noUnknown();

type RemoteResult = "ok" | "rejected" | "unreachable";

/**
 * Wraps a server-side validation check for use in a Yup test.
 *
 * Formik re-validates the whole form on every keystroke, so without this,
 * typing in one field re-runs every other field's network check.
 *  - cache: each value is checked once (results expire after `ttlMs`)
 *  - debounce: waits `debounceMs` after the last keystroke before asking
 *  - skips the request while the value is not well-formed yet; the field's
 *    own format rules report that
 *
 * Create one per form (memoize the schema), not one per render.
 */
const remoteCheck = (
  check: (value: string) => Promise<boolean>,
  {
    wellFormed,
    debounceMs = 300,
    ttlMs = 10_000,
  }: { wellFormed: RegExp; debounceMs?: number; ttlMs?: number },
) => {
  const cache = new Map<string, { at: number; result: Promise<RemoteResult> }>();
  // debounced checks not yet sent, shared by every validation run asking for that value
  const pending = new Map<string, Promise<RemoteResult>>();
  let latest: string | undefined;

  const run = (value: string | undefined): Promise<RemoteResult> => {
    latest = value;
    if (value === undefined || !wellFormed.test(value)) {
      return Promise.resolve("ok");
    }

    const hit = cache.get(value);
    if (hit && Date.now() - hit.at < ttlMs) {
      return hit.result;
    }
    const waiting = pending.get(value);
    if (waiting) {
      return waiting;
    }

    const debounced = (async (): Promise<RemoteResult> => {
      await new Promise((r) => setTimeout(r, debounceMs));
      if (latest !== value) {
        // Superseded by a newer keystroke. Formik applies whichever validation
        // run finishes last, so answer for the newest value rather than this one.
        return run(latest);
      }
      const result: Promise<RemoteResult> = check(value).then(
        (ok) => (ok ? "ok" : "rejected"),
        (err) => {
          console.warn(err);
          cache.delete(value);
          return "unreachable";
        },
      );
      cache.set(value, { at: Date.now(), result });
      return result;
    })();

    pending.set(value, debounced);
    debounced.finally(() => pending.delete(value));
    return debounced;
  };
  return run;
};

/** Yup test from a remoteCheck: fails with `message`, or says the server is unreachable */
const remoteTest =
  (checker: ReturnType<typeof remoteCheck>, message: string) =>
  async (value: string | undefined, ctx: Yup.TestContext) => {
    const result = await checker(value);
    if (result === "ok") {
      return true;
    }
    return ctx.createError({
      message:
        result === "unreachable"
          ? "Could not check with the server - try again"
          : message,
    });
  };

const postJson = async (url: string, body: unknown) => {
  const r = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  if (!r.ok) {
    throw new Error(`${url} -> ${r.status}`);
  }
  return r.json();
};

const ROOM_NAME = /^[0-9a-zA-Z]{2,10}$/;
const PASSCODE = /^[0-9]{5}$/;
const IDENTITY = /^[0-9a-zA-Z]{2,10}$/;

/* Client side: also asks the server whether the room name is free */
const createRoomSchema = (hostname: string) => {
  const roomIsFree = remoteCheck(
    async (name) => {
      const r = await fetch(`${hostname}/room/${name}/exists`);
      if (!r.ok) {
        throw new Error(`room exists check -> ${r.status}`);
      }
      return !(await r.json());
    },
    { wellFormed: ROOM_NAME },
  );

  return Yup.object({
    roomName: roomNameField().test(
      "checkRoomUnique",
      "This room name already exists",
      remoteTest(roomIsFree, "This room name already exists"),
    ),
    passcode: passcodeField(),
  })
    .required()
    .noUnknown();
};

const joinRoomSchemaForRoom = (hostname: string, roomname: string) => {
  const passcodeIsValid = remoteCheck(
    async (passcode) =>
      (await postJson(`${hostname}/room/passcode/check`, {
        roomName: roomname,
        passcode,
      })).ok === true,
    { wellFormed: PASSCODE },
  );
  const identityIsFree = remoteCheck(
    async (identity) =>
      (await postJson(`${hostname}/room/identity/check`, {
        roomName: roomname,
        identity: identity.toUpperCase(),
      })).ok === true,
    { wellFormed: IDENTITY },
  );

  return Yup.object({
    passcode: Yup.string()
      .required()
      .matches(/^[0-9]*$/, "digits only")
      .min(5, "must be 5 digits")
      .max(5, "must be 5 digits")
      .test(
        "checkPasscodeValid",
        "Passcode incorrect",
        remoteTest(passcodeIsValid, "Passcode incorrect"),
      ),

    identity: Yup.string()
      .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
      .max(10, "max 10 characters")
      .min(2, "min 2 characters")
      .required()
      .test(
        "checkIdentityAvailable",
        "This identity is already taken",
        remoteTest(identityIsFree, "This identity is already taken"),
      ),
  })
    .required()
    .noUnknown();
};

/* This one is for server side input validation only with no side effect */
const joinRoomSchema = () =>
  Yup.object({
    roomName: Yup.string()
      .required()
      .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
      .max(10, "max 10 characters")
      .min(2, "min 2 characters"),
    passcode: Yup.string()
      .matches(/^[0-9]*$/, "digits only")
      .min(5, "must be 5 digits")
      .max(5, "must be 5 digits")
      .required(),

    identity: Yup.string()
      .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
      .max(10, "max 10 characters")
      .min(2, "min 2 characters")
      .required(),
  })
    .required()
    .noUnknown();

export {
  joinRoomSchemaForRoom,
  createRoomSchema,
  createRoomBodySchema,
  joinRoomSchema,
};
