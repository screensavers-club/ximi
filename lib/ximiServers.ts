export type XimiServer = {
  name: string;
  id: "env" | "localhost" | "ximi-livekit" | "livekit-cloud" | "ximi-offline";
  serverUrl: string;
};

const servers: XimiServer[] = [
  /** First option is default */

  {
    name: "XIMI Hosted Livekit",
    id: "ximi-livekit",
    serverUrl: "https://next.server.ximi.network",
  },

  {
    name: "Livekit Cloud",
    id: "livekit-cloud",
    serverUrl: "https://lk-node-server.ximi.network",
  },
];

if (import.meta.env.VITE_HAS_OFFLINE) {
  servers.splice(0, 0, {
    name: "XIMI Offline",
    id: "ximi-offline",
    serverUrl: "https://server.ximi.offline",
  });
}

/** VITE_XIMI_SERVER_URL (app .env) overrides the localhost default */
const envServerUrl: string | undefined = import.meta.env.VITE_XIMI_SERVER_URL;

if (envServerUrl) {
  servers.splice(0, 0, {
    name: envServerUrl.replace(/^https?:\/\//, ""),
    id: "env",
    serverUrl: envServerUrl.replace(/\/+$/, ""),
  });
} else if (import.meta.env.DEV) {
  servers.splice(0, 0, {
    name: "localhost",
    id: "localhost",
    serverUrl: "https://localhost:4000",
  });
}

export { servers };
