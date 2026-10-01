import { useRoomInfo } from "@livekit/components-react";
import { useContext, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { PresetIndex, SetPresetNameAction, XimiRoomState } from "types";
import { XimiServerContext } from "./ximiServerContext";
import { patchRoomState } from "ui/tailwind";

const renamePreset = async (
  serverUrl: string,
  roomName: string,
  n: PresetIndex,
  newName: string,
) => {
  const patch: SetPresetNameAction = {
    type: "set-preset-name",
    preset: n,
    name: newName,
    roomName: roomName,
  };
  return patchRoomState(serverUrl, patch);
};

const sanitizeNewName = (newName: string) => {
  return newName.replace(/[^a-zA-Z0-9]/g, "");
};

const PresetRenamer = () => {
  const meta = useRoomInfo();
  const [editing, setEditing] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  const { server } = useContext(XimiServerContext);

  // const setNewName = useCallback(async() =>, []);

  try {
    if (meta.metadata === undefined) {
      return <div>error</div>;
    }
    const roomState = JSON.parse(meta.metadata) as XimiRoomState;
    const activePresetName = roomState.presets[roomState.activePreset].name;
    return (
      <div className="relative top-[1px]">
        <input
          type="text"
          value={activePresetName}
          onClick={() => {
            if (newNameInputRef.current) {
              newNameInputRef.current.value = activePresetName;
              setEditing(true);
              setTimeout(() => {
                newNameInputRef.current?.focus();
              }, 100);
            }
          }}
          className={`w-48 h-8 p-1 text-left text-accent border bg-bg border-bg outline-none hover:border-brand hover:bg-brand/25 box-border ${
            editing ? "hidden" : "block"
          }`}
          readOnly={true}
        />

        <input
          type="text"
          id="new_preset_name"
          ref={newNameInputRef}
          placeholder={activePresetName}
          onBlur={async () => {
            setShowHint(false);
            const newName = sanitizeNewName(
              newNameInputRef.current?.value.toUpperCase() || "",
            );

            const saved = await renamePreset(
              server.serverUrl,
              meta.name,
              roomState.activePreset,
              newName || activePresetName,
            );

            if (saved && !!newName) {
              toast(`Saved name ${newName}`, {
                position: "bottom-right",
                className: "bg-brand/80 text-text rounded-none",
              });
            }

            setEditing(false);
          }}
          onKeyUp={async (e) => {
            if (e.key === "Enter") {
              const newName = sanitizeNewName(
                newNameInputRef.current?.value.toUpperCase() || "",
              );

              await renamePreset(
                server.serverUrl,
                meta.name,
                roomState.activePreset,
                newName || activePresetName,
              );
              setEditing(false);
            }
          }}
          onFocus={() => {
            setShowHint(true);
          }}
          className={`w-48 h-8 p-1 text-left  border bg-bg border-brand box-border ${
            !editing ? "hidden" : "block"
          }`}
        />
        <div
          className={`p-2 absolute bottom-[100%] left-[50%] translate-x-[-50%] translate-y-[-10px] bg-bg border border-brand w-24 text-sm transition pointer-events-none ${
            showHint ? "opacity-100" : "opacity-0"
          }`}
        >
          <b className="bg-bg border-brand border-l border-t block absolute w-[12px] h-[12px] bottom-[-6px] left-[50%] translate-x-[-50%] rotate-[-135deg]">
            &nbsp;
          </b>
          Press Enter to apply
        </div>
      </div>
    );
  } catch (err) {
    return <div>Error</div>;
  }
};

export { PresetRenamer };
