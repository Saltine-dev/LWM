import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const defaultDevPort = process.env.DEV_SERVER_PORT || '5583';
const rendererDevServerURL = process.env.VITE_DEV_SERVER_URL || `http://localhost:${defaultDevPort}`;

function resolveIconPath() {
  const iconFile = process.platform === 'darwin' ? 'Logo.icns' : 'Logo.ico';

  if (isDev) {
    return path.join(process.cwd(), iconFile);
  }

  return path.join(process.resourcesPath, iconFile);
}

let mainWindow;

function resolvePreloadPath() {
  if (isDev) {
    return path.join(process.cwd(), 'src', 'preload.cjs');
  }

  return path.join(app.getAppPath(), 'dist', 'main', 'preload.cjs');
}

function resolveRendererHtml() {
  if (isDev) {
    return rendererDevServerURL;
  }

  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    backgroundColor: '#101820',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {
          trafficLightPosition: { x: 12, y: 18 },
        }
      : {}),
    icon: resolveIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const rendererTarget = resolveRendererHtml();

  if (isDev) {
    mainWindow.loadURL(rendererTarget);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(rendererTarget);
  }

  const sendWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('window:state', {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
      isMinimized: mainWindow.isMinimized(),
    });
  };

  mainWindow.once('ready-to-show', () => {
    sendWindowState();
    mainWindow?.show();
  });

  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.on('minimize', sendWindowState);
  mainWindow.on('restore', sendWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  if (isMac) {
    const dockIcon = resolveIconPath();
    if (dockIcon) {
      app.dock.setIcon(dockIcon);
    }
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

