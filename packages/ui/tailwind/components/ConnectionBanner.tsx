import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { FaSpinner, FaTriangleExclamation } from "react-icons/fa6";
import type { SessionStatus } from "../lib/useRoomSession";

/**
 * Shows when the room connection is unhealthy. Must be rendered inside
 * <LiveKitRoom>. Renders nothing while connected.
 */
export const ConnectionBanner: React.FC<{
  status: SessionStatus;
  onLeave?: () => void;
}> = ({ status, onLeave }) => {
  const connectionState = useConnectionState();

  let tone: "warn" | "error";
  let text: string;

  if (status.phase === "ended") {
    tone = "error";
    text = status.reason;
  } else if (status.phase === "rejoining") {
    tone = "warn";
    text = `Connecting to room (attempt ${status.attempt})${
      status.lastError ? ` - ${status.lastError}` : ""
    }`;
  } else if (
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting
  ) {
    tone = "warn";
    text = "Connection unstable, reconnecting";
  } else {
    return null;
  }

  return (
    <div
      role="status"
      className={`fixed z-50 top-10 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-2 text-sm border rounded-sm text-text ${
        tone === "error"
          ? "bg-negative/90 border-negative"
          : "bg-bg/90 border-accent"
      }`}
    >
      {tone === "error" ? (
        <FaTriangleExclamation />
      ) : (
        <FaSpinner className="animate-spin" />
      )}
      <span>{text}</span>
      {onLeave && status.phase === "ended" && (
        <button
          type="button"
          className="px-2 py-0.5 border border-text rounded-sm hover:bg-text/20"
          onClick={onLeave}
        >
          Back to rooms
        </button>
      )}
    </div>
  );
};
