import {
  useRemoteParticipant,
  useRemoteParticipants,
  useRoomInfo,
} from "@livekit/components-react";
import { useContext, useState } from "react";
import { SetVideoLayoutAction, XimiParticipantState } from "types";
import classNames from "classnames";
import { FaBinoculars, FaUser } from "react-icons/fa6";
import { VideoFrame, patchRoomState } from "ui/tailwind";
import { Popover } from "@headlessui/react";
import { XimiServerContext } from "./ximiServerContext";

const clsSidebarBtn = (active: boolean) =>
  classNames(
    "px-2 py-1 cursor-pointer text-sm",
    active
      ? "bg-brand hover:bg-brand/75"
      : "bg-[transparent] hover:bg-brand/50",
  );

const vidLayoutBtnCls = (active: boolean) =>
  classNames(
    "flex flex-col items-center w-10 text-xs hover:bg-brand/25 p-1",
    "cursor-pointer",
    active
      ? "bg-brand hover:bg-brand/75"
      : "bg-[transparent] hover:bg-brand/50",
  );

const VideoLayout = () => {
  const participants = useRemoteParticipants();
  const filteredParticipants = participants
    .filter((p) => {
      try {
        if (p.metadata === undefined) {
          return false;
        }
        const pMeta = JSON.parse(p.metadata) as XimiParticipantState;
        return pMeta.role === "PERFORMER" || pMeta.role === "SCOUT";
      } catch (err) {
        console.warn(err);
        return false;
      }
    })
    .sort((a, b) => (a.identity < b.identity ? -1 : 1));
  const [selectedPerformer, setSelectedPerformer] = useState<string>();

  if (filteredParticipants.length < 1) {
    return (
      <div className="w-full h-[calc(100vh-100px)] flex justify-center items-center">
        Waiting for{" "}
        <span className="text-xs relative top-[.1em] mx-1 p-1 inline-block border leading-3 rounded-sm">
          PERFORMER
        </span>
      </div>
    );
  }

  return (
    <div className="w-full h-[calc(100vh-80px)] flex items-stretch">
      <div className="w-20 text-sm border-r md:w-40 md:text-base border-brand">
        {filteredParticipants
          .filter((p) => {
            try {
              const _pm = JSON.parse(p.metadata || "");
              return _pm?.role === "PERFORMER";
            } catch (err) {
              return false;
            }
          })
          .map((p) => (
            <div
              key={p.identity}
              className={clsSidebarBtn(selectedPerformer === p.identity)}
              onClick={() => {
                setSelectedPerformer(() => p.identity);
              }}
            >
              {p.identity}
            </div>
          ))}
      </div>
      <div className="flex items-center justify-center flex-grow">
        {selectedPerformer === undefined ? (
          <div>
            Select
            <span className="text-xs relative top-[-.05em] mx-1 p-1 inline-block border leading-3 rounded-sm">
              PERFORMER
            </span>{" "}
            on sidebar
          </div>
        ) : (
          <LayoutEditor identity={selectedPerformer} />
        )}
      </div>
    </div>
  );
};

const LayoutEditor: React.FC<{ identity: string }> = ({ identity }) => {
  const p = useRemoteParticipant(identity);
  const participants = useRemoteParticipants();
  const { name: roomName } = useRoomInfo();
  const { server } = useContext(XimiServerContext);

  const filteredParticipantsWithScouts = participants
    .filter((p) => {
      try {
        if (p.metadata === undefined) {
          return false;
        }
        const pMeta = JSON.parse(p.metadata) as XimiParticipantState;
        return pMeta.role === "PERFORMER" || pMeta.role === "SCOUT";
      } catch (err) {
        console.warn(err);
        return false;
      }
    })
    .sort((a, b) => (a.identity < b.identity ? -1 : 1));

  try {
    if (p === undefined) {
      return null;
    }
    if (p.metadata === undefined) {
      return null;
    }

    const pMeta = JSON.parse(p.metadata) as XimiParticipantState;
    const curLayout = pMeta.video.name;

    const numAutoCols = Math.ceil(
      Math.sqrt(filteredParticipantsWithScouts.length),
    );
    const numAutoRows = Math.ceil(
      filteredParticipantsWithScouts.length / numAutoCols,
    );

    return (
      <div className="flex flex-col w-full h-full">
        <div className="flex justify-center p-1 border-b gap-1 border-brand">
          {videoLayouts.map((layout) => (
            <button
              className={vidLayoutBtnCls(curLayout === layout.name)}
              onClick={async () => {
                const currentLayoutIdentities =
                  pMeta.video.layout === undefined
                    ? []
                    : [...pMeta.video.layout].map((l) => l.identity);
                const numSlots = layout.layout.length;
                const patch: SetVideoLayoutAction = {
                  type: "set-video-layout",
                  roomName: roomName,
                  forParticipant: p.identity,
                  layout: {
                    name: layout.name,
                    layout: new Array(numSlots).fill("").map((_, n) => ({
                      identity: currentLayoutIdentities?.[n] || "",
                      layout: layout.layout[n],
                    })),
                  },
                };

                await patchRoomState(server.serverUrl, patch);
              }}
            >
              <img src={layout.image} alt={layout.name} className="w-6" />
              <span>{layout.name}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-grow">
          {curLayout === "Auto" ? (
            <div
              className={`w-full h-[calc(100vh-130px)] grid gap-1 p-1`}
              style={{
                gridTemplateColumns: `repeat(${numAutoCols}, minmax(0,1fr))`,
                gridTemplateRows: `repeat(${numAutoRows}, minmax(0,1fr))`,
              }}
            >
              {filteredParticipantsWithScouts.map((p, n) => {
                try {
                  const pMeta = JSON.parse(
                    p.metadata || "",
                  ) as XimiParticipantState;
                  return (
                    <div
                      key={`slot_${n}_${p.identity}`}
                      className="relative border border-disabled"
                    >
                      <VideoFrame identity={p.identity} full={true} />
                      <label
                        className={classNames(
                          "absolute flex items-center py-1 px-2 leading-snug text-sm rounded-sm top-2 left-2 gap-2",
                          "text-text bg-bg/50",
                        )}
                      >
                        {pMeta.role === "PERFORMER" ? (
                          <FaUser size={10} />
                        ) : pMeta.role === "SCOUT" ? (
                          <FaBinoculars size={10} />
                        ) : (
                          ""
                        )}{" "}
                        {p.identity}
                      </label>
                    </div>
                  );
                } catch (err) {
                  return <div>Participant state error</div>;
                }
              })}
            </div>
          ) : (
            <div
              style={{
                gridTemplateColumns: "repeat(12, minmax(0,1fr))",
                gridTemplateRows: "repeat(12, minmax(0,1fr))",
              }}
              className={`w-full h-[calc(100vh-130px)] grid gap-1 p-1`}
            >
              {Array.isArray(pMeta.video.layout) &&
                pMeta.video.layout.map((slot, slotNum) => {
                  try {
                    const thisSlotParticipant =
                      filteredParticipantsWithScouts.find(
                        (p) => p.identity === slot.identity,
                      );
                    const slotMeta =
                      thisSlotParticipant === undefined
                        ? undefined
                        : (JSON.parse(
                            thisSlotParticipant.metadata || "",
                          ) as XimiParticipantState);
                    return (
                      <div
                        key={`slot_${slotNum}_${slot.identity}`}
                        className="relative border border-disabled"
                        style={{ gridArea: slot.layout }}
                      >
                        <VideoFrame identity={slot.identity} full={true} />
                        <Popover className="absolute text-sm top-1 left-1">
                          <Popover.Button className="border cursor-pointer ">
                            <label
                              className={classNames(
                                "flex items-center py-1 px-2 leading-snug text-sm rounded-sm top-2 left-2 gap-2",
                                "text-text bg-bg/50",
                              )}
                            >
                              {slotMeta === undefined ? (
                                ""
                              ) : slotMeta.role === "PERFORMER" ? (
                                <FaUser size={10} />
                              ) : slotMeta.role === "SCOUT" ? (
                                <FaBinoculars size={10} />
                              ) : (
                                ""
                              )}{" "}
                              {slot.identity || "Select"}
                            </label>
                          </Popover.Button>
                          <Popover.Panel className="flex flex-col w-24 border relative -top-[1px]">
                            {filteredParticipantsWithScouts.map((selectedP) => (
                              <Popover.Button
                                className="w-full p-1 text-left hover:bg-text/10"
                                onClick={async () => {
                                  const newLayout =
                                    pMeta.video.layout === undefined
                                      ? []
                                      : [...pMeta.video.layout];

                                  newLayout[slotNum].identity =
                                    selectedP.identity;

                                  const patch: SetVideoLayoutAction = {
                                    type: "set-video-layout",
                                    roomName: roomName,
                                    forParticipant: p.identity,
                                    layout: {
                                      ...pMeta.video,
                                      layout: newLayout,
                                    },
                                  };

                                  await patchRoomState(server.serverUrl, patch);
                                }}
                              >
                                {selectedP.identity}
                              </Popover.Button>
                            ))}
                          </Popover.Panel>
                        </Popover>
                      </div>
                    );
                  } catch (err) {
                    return <div></div>;
                  }
                })}
            </div>
          )}
        </div>
      </div>
    );
  } catch (err) {
    console.warn(err);
    return <div>Loading...</div>;
  }
};

const videoLayouts: {
  image: string;
  layout: string[];
  name: XimiParticipantState["video"]["name"];
}[] = [
  {
    image: "/video-layouts/layout-default.png",
    name: "Auto",
    layout: [],
  },

  {
    image: "/video-layouts/layout-a.png",
    name: "A",
    layout: ["1 / 1 / 13 / 13"],
  },
  {
    image: "/video-layouts/layout-b.png",
    name: "B",

    layout: ["1 / 4 / 7 / 10", "7 / 4 / 13 / 10"],
  },
  {
    image: "/video-layouts/layout-c.png",
    name: "C",
    layout: ["4 / 1 / 10 / 7", "4 / 7 / 10 / 13"],
  },
  {
    image: "/video-layouts/layout-d.png",
    name: "D",
    layout: ["1 / 4 / 7 / 10", "7 / 1 / 13 / 7", "7 / 7 / 13 / 13"],
  },
  {
    image: "/video-layouts/layout-e.png",
    name: "E",
    layout: ["1 / 1 / 7 / 7", "1 / 7 / 7 / 13", "7 / 4 / 13 / 10"],
  },

  {
    image: "/video-layouts/layout-f.png",
    name: "F",
    layout: ["1 / 1 / 13 / 7", "1 / 7 / 7 / 13", "7 / 7 / 13 / 13"],
  },

  {
    image: "/video-layouts/layout-g.png",
    name: "G",
    layout: ["1 / 4 / 7 / 10", "7 / 1 / 13 / 7", "7 / 7 / 13 / 13"],
  },
  {
    image: "/video-layouts/layout-h.png",
    name: "H",

    layout: ["5 / 1 / 9 / 5", "5 / 5 / 9 / 9", "5 / 9 / 9 / 13"],
  },
  {
    image: "/video-layouts/layout-i.png",
    name: "I",
    layout: ["1 / 1 / 13 / 5", "1 / 5 / 13 / 9", "1 / 9 / 13 / 13"],
  },
  {
    image: "/video-layouts/layout-j.png",
    name: "J",
    layout: [
      "1 / 1 / 7 / 7",
      "1 / 7 / 7 / 14",
      "7 / 1 / 13 / 7",
      "7 / 7 / 13 / 13",
    ],
  },
  {
    image: "/video-layouts/layout-k.png",
    name: "K",
    layout: [
      "1 / 1 / 13 / 4",
      "1 / 4 / 13 / 7",
      "1 / 7 / 13 / 10",
      "1 / 10 / 13 / 13",
    ],
  },
];

export { VideoLayout };
