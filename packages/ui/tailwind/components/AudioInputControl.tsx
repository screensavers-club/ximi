import { Popover } from "@headlessui/react";
import { useLocalParticipant } from "@livekit/components-react";
import classNames from "classnames";
import { useState } from "react";
import { publishAudioInput, unpublishAudio } from "../lib/media";
import { toastError } from "../lib/api";
import {
  FaVolumeOff,
  FaVolumeHigh,
  FaMicrophone,
  FaCircleDot,
  FaVolumeXmark,
  FaCaretDown,
} from "react-icons/fa6";

const clsControlBtn = (active: boolean) =>
  classNames(
    "flex",
    "items-center",
    "justify-center",
    "p-1",
    "w-8",
    "h-8",
    "hover:bg-brand/50",
    active ? "text-accent" : "text-text",
  );

const clsControlBtnMute = (muted: boolean) =>
  classNames(
    "flex",
    "items-center",
    "justify-center",
    "p-1",
    "w-8",
    "h-8",
    "rounded-sm",
    muted ? "hover:bg-negative/25" : "hover:bg-negative/50",
    muted ? "border border-negative" : "border-transparent",
    muted ? "bg-negative" : "bg-[transparent]",
    muted ? "hover:text-negative" : "hover:text-text",
  );

const clsToggle = (on: boolean) =>
  classNames(
    "flex w-6 h-6 items-center justify-center relative z-2",
    on ? "text-brand" : "text-text",
  );

const AudioInputControl = () => {
  const { localParticipant } = useLocalParticipant();
  const hasTrack = localParticipant.audioTrackPublications.size > 0;
  const [showHint, setShowHint] = useState(false);
  const [mode, setMode] = useState<"VOICE" | "LINE">("VOICE");
  const [muted, setMuted] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<MediaDeviceInfo>();
  const [deviceList, setDeviceList] = useState<MediaDeviceInfo[]>([]);

  return (
    <div className="flex items-center pr-2 border-r gap-1">
      <button
        className={clsControlBtn(hasTrack)}
        onClick={async () => {
          try {
            if (hasTrack) {
              await unpublishAudio(localParticipant);
              setMuted(false);
            } else {
              await publishAudioInput(localParticipant, {
                mode,
                deviceId: selectedDevice?.deviceId,
              });
            }
          } catch (err) {
            toastError(err, "Audio input");
          }
        }}
      >
        {hasTrack ? <FaVolumeHigh /> : <FaVolumeOff />}
      </button>

      {!hasTrack && (
        <Popover className="relative flex flex-col justify-center w-6 h-full">
          <Popover.Button
            onClick={async () => {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const audioInputDevices = devices.filter(
                (device) => device.kind === "audioinput",
              );
              setDeviceList(audioInputDevices);
            }}
          >
            <FaCaretDown />
          </Popover.Button>
          <Popover.Panel className="absolute z-10 bottom-[calc(100%+1rem)] w-40 text-sm left-[50%] translate-x-[-50%]">
            <div className="flex flex-col p-1 border rounded-sm gap-1 bg-bg border-text ">
              {deviceList.map((d) => (
                <Popover.Button
                  className={`w-full truncate hover:bg-brand pointer-cursor ${
                    selectedDevice?.deviceId === d.deviceId
                      ? "bg-brand"
                      : "bg-[transparent]"
                  }`}
                  onClick={() => {
                    setSelectedDevice(d);
                  }}
                  key={d.deviceId}
                >
                  {d.label || "Default device"}
                </Popover.Button>
              ))}
            </div>
          </Popover.Panel>
        </Popover>
      )}

      {hasTrack ? (
        <button
          className={clsControlBtnMute(muted)}
          onClick={async () => {
            const pubs = Array.from(
              localParticipant.audioTrackPublications.values(),
            );
            if (muted) {
              await Promise.all(pubs.map((pub) => pub.unmute()));
              setMuted(false);
            } else {
              await Promise.all(pubs.map((pub) => pub.mute()));
              setMuted(true);
            }
          }}
        >
          <FaVolumeXmark />
        </button>
      ) : (
        <div className="flex items-center h-6 p-0 border rounded-sm">
          <button
            className="relative flex items-center text-sm toggle hover:bg-brand/50 gap-0"
            onClick={() => {
              setMode((m) => (m === "VOICE" ? "LINE" : "VOICE"));
            }}
            onMouseEnter={() => setShowHint(true)}
            onMouseLeave={() => setShowHint(false)}
            type="button"
          >
            <div
              className={`p-2 absolute bottom-[calc(100%+3px)] left-[50%] translate-x-[-50%] translate-y-[-10px] bg-bg border border-brand w-32 text-sm transition pointer-events-none ${
                showHint ? "opacity-100" : "opacity-0"
              }`}
            >
              <b className="bg-bg border-brand border-l border-t block absolute w-[12px] h-[12px] bottom-[-6px] left-[50%] translate-x-[-50%] rotate-[-135deg]">
                &nbsp;
              </b>
              {mode === "VOICE" ? (
                <>
                  <strong>Voice Mode</strong>
                  <br />
                  Best for microphone input
                </>
              ) : (
                <>
                  <strong>Line Mode</strong>
                  <br />
                  Best for line input
                </>
              )}
            </div>
            <span
              className={`absolute h-full block bg-white z-1 w-6 transition left-0 translate-x-[${
                mode === "VOICE" ? "0" : "100%"
              }] top-0`}
            >
              &nbsp;
            </span>
            <div className={clsToggle(mode === "VOICE")}>
              <FaMicrophone />
            </div>
            <div className={clsToggle(mode === "LINE")}>
              <FaCircleDot />
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export { AudioInputControl };
