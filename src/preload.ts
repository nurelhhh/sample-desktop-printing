import {contextBridge, ipcRenderer} from "electron";
import {cpus} from "os";

contextBridge.exposeInMainWorld("api", {
    threads: cpus().length,
    greet: (message: any) => ipcRenderer.send('greet', message)
});

contextBridge.exposeInMainWorld("authapi", {
    checkSend: (channel: string, data: any) => {
        // whitelist channels
        let validChannels = ["to-auth-check"];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    checkReceive: (channel: string, func: any) => {
        let validChannels = ["from-auth-check"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    refreshSend: (channel: string, data: any) => {
        // whitelist channels
        let validChannels = ["to-auth-refresh"];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    refreshReceive: (channel: string, func: any) => {
        let validChannels = ["from-auth-refresh"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});

contextBridge.exposeInMainWorld("printingapi", {
    framenumbersTotalReceive: (channel: string, func: any) => {
        let validChannels = ["from-framenumbers-total"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    filesPrintedReceive: (channel: string, func: any) => {
        let validChannels = ["from-files-printed"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    filesFailedPrintReceive: (channel: string, func: any) => {
        let validChannels = ["from-files-failed-print"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    printingProgressReceive: (channel: string, func: any) => {
        let validChannels = ["from-printing-progress"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
});