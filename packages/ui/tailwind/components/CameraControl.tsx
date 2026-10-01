import { Popover } from "@headlessui/react";
import { useLocalParticipant } from "@livekit/components-react";
import classNames from "classnames";
import { createLocalVideoTrack, Track, VideoPresets } from "livekit-client";
import { useState } from "react";
import { toastError } from "../lib/api";
import { FaCaretDown, FaH, FaL, FaVideo } from "react-icons/fa6";

const clsControlBtn = (active: boolean, disabled: boolean) =>
  classNames(
    "flex",
    "items-center",
    "justify-center",
    "p-1",
    "w-8",
    "h-8",
    "hover:bg-brand/50",
    active ? "text-accent" : "text-text",
    disabled
      ? "hover:bg-[transparent] opacity-50"
      : "hover:brand-50 opacity-100",
  );

const clsToggle = (on: boolean) =>
  classNames(
    "flex w-6 h-6 items-center justify-center relative z-2",
    on ? "text-brand" : "text-text",
  );

const CameraControl = () => {
  const { localParticipant } = useLocalParticipant();
  const hasTrack =
    localParticipant.getTrackPublication(Track.Source.Camera) !== undefined;

  const hasScreenshareTrack =
    localParticipant.getTrackPublication(Track.Source.ScreenShare) !== undefined;
  const [showHint, setShowHint] = useState(false);
  const [mode, setMode] = useState<"HIGH" | "LOW">("HIGH");

  const [selectedDevice, setSelectedDevice] = useState<MediaDeviceInfo>();
  const [deviceList, setDeviceList] = useState<MediaDeviceInfo[]>([]);

  return (
    <div className="flex items-center pr-2 border-r gap-1">
      <button
        className={clsControlBtn(hasTrack, hasScreenshareTrack)}
        onClick={async () => {
          if (hasTrack) {
            const pub = localParticipant.getTrackPublication(
              Track.Source.Camera,
            );
            if (pub?.track) {
              await localParticipant.unpublishTrack(pub.track);
            }
          } else {
            try {
              const newTrack = await createLocalVideoTrack({
                deviceId: selectedDevice?.deviceId,
                resolution: mode === "HIGH" ? undefined : VideoPresets.h360,
              });
              await localParticipant.publishTrack(newTrack, {
                simulcast: true,
              });
            } catch (err) {
              toastError(err, "Camera");
            }
          }
        }}
      >
        <FaVideo />
      </button>

      {!hasTrack && (
        <Popover className="relative flex flex-col justify-center w-6 h-full">
          <Popover.Button
            onClick={async () => {
              const devices = await navigator.mediaDevices.enumerateDevices();

              const audioInputDevices = devices.filter(
                (device) => device.kind === "videoinput",
              );
              setDeviceList(audioInputDevices);
            }}
          >
            <FaCaretDown />
          </Popover.Button>
          <Popover.Panel className="absolute z-10 bottom-[calc(100%+1rem)] w-40 text-sm">
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

      <div
        className={`flex items-center h-6 p-0 border rounded-sm ${
          hasTrack ? "opacity-50" : "opacity-100"
        }`}
      >
        <button
          className={`relative flex items-center text-sm toggle gap-0 ${
            hasTrack ? "hover:bg-[transparent]" : "hover:bg-brand/50"
          }`}
          disabled={hasTrack}
          onClick={() => {
            setMode((m) => (m === "HIGH" ? "LOW" : "HIGH"));
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
            {mode === "HIGH" ? <>720p</> : <>360p</>}
          </div>
          <span
            className={`absolute h-full block bg-white z-1 w-6 transition left-0 translate-x-[${
              mode === "HIGH" ? "0" : "100%"
            }] top-0 ${hasTrack ? "opacity-50" : "opacity-100"}`}
          >
            &nbsp;
          </span>
          <div className={clsToggle(mode === "HIGH")}>
            <FaH />
          </div>
          <div className={clsToggle(mode === "LOW")}>
            <FaL />
          </div>
        </button>
      </div>
    </div>
  );
};

export { CameraControl };
