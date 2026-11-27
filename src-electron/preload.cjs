const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("websshDesktop", {
    getServerPort: () => ipcRenderer.invoke("server-port:get"),
    setServerPort: (port) => ipcRenderer.invoke("server-port:set", port),
});
