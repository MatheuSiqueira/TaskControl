const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('config', {
  ler: () => ipcRenderer.invoke('config:ler'),
  testar: (endereco) => ipcRenderer.invoke('config:testar', endereco),
  salvar: (cfg) => ipcRenderer.invoke('config:salvar', cfg),
});
