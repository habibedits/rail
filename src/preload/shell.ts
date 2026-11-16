// Preload for Rail's own UI views. Only these get the `rail` bridge.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { installSwipe } from './swipe';
import { installWheelTrigger } from './wheel';

installSwipe((dir) => ipcRenderer.send('rail:swipe', dir));
installWheelTrigger((sig) => ipcRenderer.send('rail:wheel', sig));

contextBridge.exposeInMainWorld('rail', {
  send: (cmd: unknown) => ipcRenderer.send('rail:cmd', cmd),
  ff: (req: unknown) => ipcRenderer.invoke('ff', req),
  cal: (req: unknown) => ipcRenderer.invoke('cal', req),
  onCal: (cb: (snap: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on('rail:cal', listener);
    return () => ipcRenderer.removeListener('rail:cal', listener);
  },
  focus: (req: unknown) => ipcRenderer.invoke('focus', req),
  puzzle: (difficulty: string) => ipcRenderer.invoke('puzzle', difficulty),
  onFocus: (cb: (snap: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on('rail:focus', listener);
    return () => ipcRenderer.removeListener('rail:focus', listener);
  },
  agents: (req: unknown) => ipcRenderer.invoke('agents', req),
  onAgents: (cb: (snap: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on('rail:agents', listener);
    return () => ipcRenderer.removeListener('rail:agents', listener);
  },
  onAgentsOpen: (cb: (id: string) => void) => {
    const listener = (_e: IpcRendererEvent, id: string) => cb(id);
    ipcRenderer.on('rail:agents-open', listener);
    return () => ipcRenderer.removeListener('rail:agents-open', listener);
  },
  onWheel: (cb: (w: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, w: unknown) => cb(w);
    ipcRenderer.on('rail:wheel', listener);
    return () => ipcRenderer.removeListener('rail:wheel', listener);
  },
  onState: (cb: (state: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on('rail:state', listener);
    ipcRenderer.send('rail:cmd', { type: 'hello' });
    return () => ipcRenderer.removeListener('rail:state', listener);
  },
});
