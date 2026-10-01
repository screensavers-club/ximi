import { useEffect, useCallback, useState } from "react";
import { useRoomContext, useLocalParticipant } from "@livekit/components-react";
import { MessageDataPayload } from "types";
import { Field, Formik } from "formik";
import { toast } from "react-hot-toast";
import { RoomEvent } from "livekit-client";
import { Transition, Dialog } from "@headlessui/react";
import * as Yup from "yup";
import { Button } from "./Button";
import { FaMessage } from "react-icons/fa6";
import classNames from "classnames";

const clsControlBtn = classNames(
  "flex",
  "items-center",
  "justify-center",
  "w-full",
  "p-2",
  "hover:bg-brand/50",
);

const ChatControl = () => {
  const [showChatModal, setShowChatModal] = useState(false);
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    const handleDataReceived = (payload: Uint8Array) => {
      const decoder = new TextDecoder();
      const data = decoder.decode(payload);

      try {
        const payload: MessageDataPayload | undefined = JSON.parse(data);

        if (payload && payload.from) {
          toast(
            <div>
              <h4 className="text-sm font-bold"> {payload.from}</h4>
              <p className="text-sm">{payload.message}</p>
            </div>,
            {
              position: "bottom-right",
              className: "bg-bg/80 border-brand border text-text rounded-none",
            },
          );
        }
      } catch (err) {
        toast.error("Error parsing incoming data message", {
          position: "bottom-right",
          className: "bg-negative/80 text-text rounded-none",
        });
      }
    };
    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  const sendMessage = useCallback(
    (text: string) => {
      const encoder = new TextEncoder();
      const data = encoder.encode(
        JSON.stringify({
          from: localParticipant.identity,
          message: text,
        } as MessageDataPayload),
      );
      return localParticipant.publishData(data, { reliable: true });
    },
    [localParticipant],
  );

  return (
    <>
      <Transition show={showChatModal}>
        <Dialog className="relative" onClose={() => setShowChatModal(false)}>
          <Transition.Child
            enter="transition duration-100 ease-out"
            enterFrom="opacity-0"
            enterTo="opacity-1"
            leave="transition duration-75 ease-out"
            leaveFrom="transform opacity-100"
            leaveTo="transform opacity-0"
          >
            <div className="fixed inset-0 z-10 bg-bg/30">&nbsp;</div>
          </Transition.Child>
          <Transition.Child
            as={"span"}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-300"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-90"
          >
            <Dialog.Panel className="z-20 w-full max-w-lg p-0 border rounded-md bg-bg border-brand text-text top-[50%] left-[50%] fixed transform translate-x-[-50%] translate-y-[-50%]">
              <Dialog.Title className="py-2 text-xl text-center">
                Send message
              </Dialog.Title>

              <Formik
                initialValues={{
                  message: "",
                }}
                validationSchema={Yup.object({
                  message: Yup.string().required(),
                })}
                validateOnMount={true}
                onSubmit={async ({ message }, { resetForm }) => {
                  await sendMessage(message);

                  toast(
                    <div>
                      <h4 className="text-sm font-bold">
                        {localParticipant.identity}
                      </h4>
                      <p className="text-sm">{message}</p>
                    </div>,
                    {
                      position: "bottom-right",
                      className:
                        "bg-bg/80 border-text border text-text rounded-none",
                    },
                  );
                  resetForm();
                }}
              >
                {({ isValid, submitForm }) => {
                  return (
                    <form
                      className="flex flex-col p-4 gap-4"
                      onSubmit={(e) => {
                        submitForm();
                        e.preventDefault();
                      }}
                    >
                      <Field
                        name="message"
                        className="text-2xl text-center border bg-bg border-grey [&:focus]:border-brand appearance-none outline-none rounded-sm w-full"
                        autoComplete="false"
                      />
                      <div className="flex gap-4">
                        <Button onClick={() => setShowChatModal(false)}>
                          Close
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!isValid}
                          onClick={() => {
                            submitForm();
                          }}
                        >
                          Send
                        </Button>
                      </div>
                    </form>
                  );
                }}
              </Formik>
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>
      <button
        type="button"
        className={clsControlBtn}
        onClick={() => {
          setShowChatModal(true);
        }}
      >
        <FaMessage />
      </button>
    </>
  );
};

export { ChatControl };
