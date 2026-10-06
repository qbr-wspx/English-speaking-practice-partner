import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  getConnection: () => ipcRenderer.invoke("backend:connection"),
  startBackend: (): Promise<BackendStatus> => ipcRenderer.invoke("backend:start"),
  getBackendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke("backend:status"),
  redeemInvite: (code: string): Promise<BackendStatus> => ipcRenderer.invoke("friends:redeem", code),
});

interface BackendStatus {
  state: string;
  message: string;
}
