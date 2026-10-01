import * as Yup from "yup";

/* Server-side validation for room state and the PATCH /room/state actions. */

const PRESET_COUNT = 12;
/** Output applies delay with a DelayNode whose maxDelayTime is 5s */
const MAX_AUDIO_DELAY_MS = 5000;

const roles = ["PERFORMER", "SCOUT", "CONTROL", "OUTPUT"] as const;
const videoLayoutNames = [
  "Auto",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
] as const;

const identity = () => Yup.string().max(10);
const roomName = () =>
  Yup.string()
    .required()
    .matches(/^[0-9a-zA-Z]+$/, "digits and alphabets only")
    .max(10, "max 10 characters");
const presetIndex = () =>
  Yup.number()
    .required()
    .integer()
    .min(0)
    .max(PRESET_COUNT - 1);
const presetName = () => Yup.string().required().trim().min(1).max(32);

const videoLayoutSchema = Yup.object({
  name: Yup.string().required().oneOf(videoLayoutNames),
  layout: Yup.array()
    .of(
      Yup.object({
        identity: identity().defined(),
        layout: Yup.string().defined().max(32),
      }).noUnknown(),
    )
    .max(4)
    .optional(),
}).noUnknown();

const participantStateSchema = Yup.object({
  role: Yup.string().required().oneOf(roles),
  audio: Yup.object({
    mute: Yup.array().of(identity().required()).required(),
    delay: Yup.number().required().integer().min(0).max(MAX_AUDIO_DELAY_MS),
  }).noUnknown(),
  video: videoLayoutSchema.required(),
  textPoster: Yup.string().defined().max(1000),
}).noUnknown();

const presetSchema = Yup.object({
  name: presetName(),
  participants: Yup.lazy((participants: Record<string, unknown> = {}) =>
    Yup.object(
      Object.fromEntries(
        Object.keys(participants).map((key) => [
          key,
          Yup.object({
            identity: identity().required(),
            state: participantStateSchema.required(),
          }).noUnknown(),
        ]),
      ),
    ).required(),
  ),
}).noUnknown();

const roomStateSchema = Yup.object({
  passcode: Yup.string()
    .required()
    .matches(/^[0-9]{5}$/, "must be 5 digits"),
  activePreset: presetIndex(),
  presets: Yup.array()
    .of(presetSchema)
    .required()
    .length(PRESET_COUNT, `must have exactly ${PRESET_COUNT} presets`),
}).noUnknown();

const actionSchemas: Record<string, Yup.ObjectSchema<any>> = {
  "set-active-preset": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    activePreset: presetIndex(),
  }).noUnknown(),

  "set-preset-name": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    preset: presetIndex(),
    name: presetName(),
  }).noUnknown(),

  "mute-audio": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    channel: identity().required(),
    forParticipant: identity().required(),
  }).noUnknown(),

  "unmute-audio": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    channel: identity().required(),
    forParticipant: identity().required(),
  }).noUnknown(),

  "set-audio-delay": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    forParticipant: identity().required(),
    delay: Yup.number()
      .required()
      .integer()
      .min(0)
      .max(MAX_AUDIO_DELAY_MS, `max ${MAX_AUDIO_DELAY_MS}ms`),
  }).noUnknown(),

  "set-video-layout": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    forParticipant: identity().required(),
    layout: videoLayoutSchema.required(),
  }).noUnknown(),

  "set-scout-text": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    forParticipant: Yup.array().of(identity().required()).required().min(1),
    textPoster: Yup.string().defined().max(1000),
  }).noUnknown(),

  "upload-presets": Yup.object({
    type: Yup.string().required(),
    roomName: roomName(),
    roomState: roomStateSchema.required(),
  }).noUnknown(),
};

const roomStateActionSchema = () =>
  Yup.lazy((value: { type?: unknown } | undefined) => {
    const schema =
      typeof value?.type === "string" ? actionSchemas[value.type] : undefined;

    if (schema === undefined) {
      return Yup.object({
        type: Yup.string()
          .required()
          .oneOf(Object.keys(actionSchemas), "unknown action type"),
      });
    }
    return schema;
  });

export {
  roomStateSchema,
  roomStateActionSchema,
  participantStateSchema,
  MAX_AUDIO_DELAY_MS,
  PRESET_COUNT,
};
