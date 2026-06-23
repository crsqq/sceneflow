const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pyProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('frontend/index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function startPythonSidecar() {
  // Assuming uv is used and we want to run via 'uv run uvicorn app.main:app --reload'
  // In production, this would be a bundled executable.
  const pythonPath = process.env.PATH; // Simplified for now
  
  console.log('Starting FastAPI sidecar...');
  
  // We'll use 'uv run' which is available in the environment
  pyProcess = spawn('uv', ['run', '--project', 'app', 'uvicorn', 'app.main:app', '--port', '8000'], {
    shell: true,
    env: { ...process.env }
  });

  pyProcess.stdout.on('data', (data) => {
    console.log(`[FastAPI] ${data}`);
  });

  pyProcess.stderr.on('data', (data) => {
    console.error(`[FastAPI Error] ${data}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`FastAPI sidecar exited with code ${code}`);
  });
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select media folder to scan'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

app.whenReady().then(() => {
  startPythonSidecar();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pyProcess) {
    pyProcess.kill();
    pyProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
