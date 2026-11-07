import { contextBridge, ipcRenderer } from "electron";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--solus-${name}=`))?.slice(`--solus-${name}=`.length) ?? "";
const version = arg("version");
const platform = arg("platform");

/** The only things a page can ask of the Mac app. Each one is a fixed action. */
contextBridge.exposeInMainWorld("solusDesktop", {
  version,
  platform,
  testNotification: (): Promise<boolean> => ipcRenderer.invoke("solus:test-notification"),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke("solus:check-updates"),
});
