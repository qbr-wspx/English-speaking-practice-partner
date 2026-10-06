/// <reference types="vite/client" />

interface BackendStatus {
  state: "stopped" | "starting" | "ready" | "error" | "needs-key" | string;
  message: string;
}

interface DesktopBridge {
  getConnection(): Promise<{ httpUrl: string; wsUrl: string; token: string; remote?: boolean }>;
  startBackend(): Promise<BackendStatus>;
  getBackendStatus(): Promise<BackendStatus>;
  redeemInvite(code: string): Promise<BackendStatus>;
}

interface Window {
  desktop?: DesktopBridge;
}
