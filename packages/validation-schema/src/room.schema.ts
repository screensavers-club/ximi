import * as Yup from "yup";

const createRoomSchema = (hostname: string) =>
  Yup.object({
    roomName: Yup.string()
      .required()
      .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
      .max(10, "max 10 characters")
      .min(2, "min 2 characters")
      .test(
        "checkRoomUnique",
        "This room name already exists",
        async (value) => {
          console.log(hostname);
          try {
            const r = await fetch(`${hostname}/room/${value}/exists`);
            const result = await r.json();
            return !result as boolean;
          } catch (err) {
            console.warn(err);
            return false;
          }
        },
      ),
    passcode: Yup.string()

      .required()
      .matches(/^[0-9]*$/, "digits only")
      .max(5, "must be 5 digits")
      .min(5, "must be 5 digits"),
  })
    .required()
    .noUnknown();

const joinRoomSchemaForRoom = (hostname: string, roomname: string) =>
  Yup.object({
    passcode: Yup.string()
      .required()
      .matches(/^[0-9]*$/, "digits only")
      .min(5, "must be 5 digits")
      .max(5, "must be 5 digits")
      .test("checkPasscodeValid", "Passcode incorrect", async (value) => {
        try {
          const r = await fetch(`${hostname}/room/passcode/check`, {
            method: "POST",
            body: JSON.stringify({
              roomName: roomname,
              passcode: value,
            }),
            headers: {
              "content-type": "application/json",
            },
          });
          const result = await r.json();
          return result.ok as boolean;
        } catch (err) {
          console.warn(err);
          return false;
        }
      }),

    identity: Yup.string()
      .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
      .max(10, "max 10 characters")
      .min(2, "min 2 characters")
      .required()
      .test(
        "checkIdentityAvailable",
        "This identity is already taken",
        async (value) => {
          try {
            const r = await fetch(`${hostname}/room/identity/check`, {
              method: "POST",
              body: JSON.stringify({
                roomName: roomname,
                identity: value.toUpperCase(),
              }),
              headers: {
                "content-type": "application/json",
              },
            });
            const result = await r.json();
            return result.ok as boolean;
          } catch (err) {
            console.warn(err);
            return false;
          }
        },
      ),
  })
    .required()
    .noUnknown();

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

export { joinRoomSchemaForRoom, createRoomSchema, joinRoomSchema };
