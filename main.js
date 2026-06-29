const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Disable Web Security globally at Chromium level to prevent canvas tainting for captureStream()
app.commandLine.appendSwitch('disable-web-security');

let mainWindow;
let ffmpegProcess = null;
const offscreenWindows = {};

// Register secure local protocol for videos before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'stream-media', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    frame: false, // Make window frameless (no native OS title bar or borders!)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Desactivar ahorro de energía/throttling en segundo plano
      webSecurity: false,          // Disable CORS and same-origin checks to keep HTML5 Canvas clean for captureStream
      devTools: false              // Disables Developer Tools completely in production for maximum security!
    },
    title: 'StreamStudio - Professional Multi-Platform Broadcaster',
    backgroundColor: '#0f0f12',
    icon: path.join(__dirname, 'icon.ico') // Optional icon
  });

  // Register window control handlers
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');

  // Open target="_blank" links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Open regular link clicks in default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanupFFmpeg();
  });
}

function cleanupFFmpeg() {
  if (ffmpegProcess) {
    console.log('Terminating FFmpeg process...');
    try {
      ffmpegProcess.stdin.end();
      ffmpegProcess.kill('SIGINT');
    } catch (e) {
      console.error('Error terminating FFmpeg:', e);
    }
    ffmpegProcess = null;
  }
}

app.whenReady().then(() => {
  // Handle local video files loading securely
  protocol.handle('stream-media', (request) => {
    const filePath = decodeURIComponent(request.url.slice('stream-media://'.length));
    return net.fetch('file:///' + filePath);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanupFFmpeg();
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler for Streaming
ipcMain.on('start-stream', (event, { settings }) => {
  if (ffmpegProcess) {
    event.reply('stream-status', { active: false, error: 'La transmisión ya está iniciada.' });
    return;
  }

  console.log('Starting stream with settings:', JSON.stringify(settings, null, 2));

  // Build RTMP targets
  const targets = [];
  if (settings.twitchEnabled && settings.twitchKey) {
    targets.push(`[f=flv:onfail=ignore]${settings.twitchServer || 'rtmp://live.twitch.tv/app/'}${settings.twitchKey}?rtmp_buffer=0&tcp_nodelay=1`);
  }
  if (settings.youtubeEnabled && settings.youtubeKey) {
    targets.push(`[f=flv:onfail=ignore]${settings.youtubeServer || 'rtmp://a.rtmp.youtube.com/live2/'}${settings.youtubeKey}?rtmp_buffer=0&tcp_nodelay=1`);
  }
  if (settings.kickEnabled && settings.kickKey) {
    targets.push(`[f=flv:onfail=ignore]${settings.kickServer || 'rtmp://live.kick.com/app/'}${settings.kickKey}?rtmp_buffer=0&tcp_nodelay=1`);
  }

  if (targets.length === 0) {
    event.reply('stream-status', { active: false, error: 'Debes activar al menos una plataforma y proporcionar su clave de transmisión.' });
    return;
  }

  // Construct FFmpeg arguments
  // Input: WebM stream from standard input (stdin)
  const args = [
    '-y',
    '-loglevel', 'info',
    '-fflags', '+nobuffer+nocache',
    '-flags', '+low_delay',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'webm',
    '-i', 'pipe:0', // Read from stdin
  ];

  // Video Transcoding Options
  const encoder = settings.videoEncoder || 'libx264';
  const bitrate = settings.videoBitrate || 4500;
  const fps = settings.fps || 30;
  const gop = fps * (settings.keyframeInterval || 2);

  if (settings.inputCodec === 'h264') {
    console.log('Input stream from Electron is already H.264. Applying -c:v copy for zero-copy streaming.');
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', encoder);

    // Apply encoder specific configurations
    if (encoder === 'libx264') {
      args.push(
        '-preset', settings.encoderPreset || 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'high'
      );
    } else if (encoder === 'h264_nvenc') {
      args.push(
        '-preset', 'p2', // P1-P7 preset system in newer nvenc, or default
        '-tune', 'ull',  // Ultra Low Latency
        '-profile:v', 'high'
      );
    } else if (encoder === 'h264_amf') {
      args.push(
        '-usage', 'low_latency',
        '-profile', 'high'
      );
    }

    // Bitrate and FPS control
    args.push(
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-g', gop.toString(),
      '-r', fps.toString(),
      '-fps_mode', 'cfr', // Forzar tasa de cuadros constante
      '-bf', '0'          // Desactivar B-frames para evitar latencia
    );

    // Color Space adjustments
    if (settings.colorSpace === 'bt709') {
      args.push('-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709');
    }

    // Optimize thread usage for software decoding/encoding fallbacks
    args.push('-threads', '0');
  }

  // Audio Transcoding Options
  const audioBitrate = settings.audioBitrate || 128;
  const audioSampleRate = settings.sampleRate || 48000;
  const channels = settings.channels === 'mono' ? 1 : 2;

  args.push(
    '-c:a', 'aac',
    '-b:a', `${audioBitrate}k`,
    '-ar', audioSampleRate.toString(),
    '-ac', channels.toString(),
    '-af', 'aresample=async=1'
  );

  // Outputs: Multi-streaming or Single stream
  if (targets.length > 1) {
    // Multi-stream using TEE muxer
    args.push(
      '-f', 'tee',
      '-map', '0:v',
      '-map', '0:a',
      targets.join('|')
    );
  } else {
    // Single stream
    // Extract actual URL from targets (remove [f=flv:onfail=ignore] prefix)
    const rawUrl = targets[0].substring(targets[0].indexOf('rtmp://'));
    args.push(
      '-f', 'flv',
      rawUrl
    );
  }

  console.log('Spawning FFmpeg with args:', args.join(' '));

  try {
    ffmpegProcess = spawn('ffmpeg', args);

    ffmpegProcess.on('error', (err) => {
      console.error('Failed to start FFmpeg:', err);
      event.reply('stream-status', { active: false, error: `Error al iniciar FFmpeg: ${err.message}` });
      ffmpegProcess = null;
    });

    // Handle FFmpeg stderr (logs and stats)
    let statsBuffer = '';
    ffmpegProcess.stderr.on('data', (data) => {
      const log = data.toString();
      console.log('FFmpeg:', log);

      // Parse FFmpeg real-time stats
      // Standard output format includes frame=, fps=, q=, size=, time=, bitrate=, speed=
      statsBuffer += log;
      const lines = statsBuffer.split(/[\r\n]+/);
      statsBuffer = lines.pop(); // Keep last incomplete line

      for (const line of lines) {
        if (line.includes('frame=') && line.includes('fps=')) {
          // Parse values
          const frameMatch = line.match(/frame=\s*(\d+)/);
          const fpsMatch = line.match(/fps=\s*([\d.]+)/);
          const bitrateMatch = line.match(/bitrate=\s*([\d.kmb]+)/);
          const speedMatch = line.match(/speed=\s*([\d.x]+)/);
          
          const stats = {
            frames: frameMatch ? parseInt(frameMatch[1]) : 0,
            fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
            bitrate: bitrateMatch ? bitrateMatch[1] : 'N/A',
            speed: speedMatch ? speedMatch[1] : '1x',
            active: true
          };

          if (mainWindow) {
            mainWindow.webContents.send('stream-stats', stats);
          }
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      ffmpegProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('stream-status', { active: false, exitCode: code });
      }
    });

    event.reply('stream-status', { active: true });

  } catch (e) {
    console.error('Exception spawning FFmpeg:', e);
    event.reply('stream-status', { active: false, error: e.message });
    ffmpegProcess = null;
  }
});

ipcMain.on('stop-stream', (event) => {
  cleanupFFmpeg();
  event.reply('stream-status', { active: false });
});

// IPC Handler for writing stream chunks
ipcMain.on('stream-chunk', (event, arrayBuffer) => {
  if (ffmpegProcess && ffmpegProcess.stdin.writable) {
    try {
      const buffer = Buffer.from(arrayBuffer);
      ffmpegProcess.stdin.write(buffer);
    } catch (e) {
      console.error('Error writing chunk to FFmpeg stdin:', e);
      cleanupFFmpeg();
      if (mainWindow) {
        mainWindow.webContents.send('stream-status', { active: false, error: 'Error en la tubería de vídeo de FFmpeg.' });
      }
    }
  }
});

// Handle local recording path picker
ipcMain.handle('select-recording-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Handle fetching screen and window share sources
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 300, height: 200 }
    });
    return sources.map(src => ({
      id: src.id,
      name: src.name,
      thumbnail: src.thumbnail.toDataURL()
    }));
  } catch (e) {
    console.error('Error fetching desktop sources:', e);
    return [];
  }
});

// Handle offscreen Browser Sources for stream overlays
ipcMain.on('create-web-source', (event, { sourceId, url, width, height, fps }) => {
  if (offscreenWindows[sourceId]) {
    try {
      offscreenWindows[sourceId].close();
    } catch(e) {}
  }

  const w = Math.round(width || 1280);
  const h = Math.round(height || 720);
  const targetFps = Math.round(fps || 30);

  console.log(`Creating offscreen browser source for ID ${sourceId} with URL ${url} at resolution ${w}x${h} limited to ${targetFps} FPS`);

  const offscreenWin = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    transparent: true, // Permitir transparencia de fondos
    frame: false,      // Eliminar marcos de ventana
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  offscreenWin.loadURL(url);

  // Set the native frame rate of the offscreen window to optimize performance (saves massive CPU/GPU render work!)
  offscreenWin.webContents.setFrameRate(targetFps);

  // Inject overlay CSS to hide scrollbars, remove margins and force transparent backgrounds
  offscreenWin.webContents.on('dom-ready', () => {
    offscreenWin.webContents.insertCSS(`
      html, body {
        background-color: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      ::-webkit-scrollbar {
        display: none !important;
      }
    `).catch(err => console.error('Error injecting CSS on offscreen browser:', err));
  });

  let lastPaintTime = 0;

  // Limit IPC message frequency by only sending updates on paint and using raw binary Buffer for maximum performance
  offscreenWin.webContents.on('paint', (event, dirty, image) => {
    const now = Date.now();
    const minInterval = 1000 / targetFps;
    if (now - lastPaintTime < minInterval) {
      return; // Skip frames that exceed target FPS
    }
    lastPaintTime = now;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('web-source-paint', {
        sourceId,
        buffer: image.toPNG() // Native C++ fast PNG encoding to avoid base64 serialization CPU overhead
      });
    }
  });

  offscreenWindows[sourceId] = offscreenWin;
});

// Resize offscreen viewport dynamically to match canvas source size
ipcMain.on('resize-web-source', (event, { sourceId, width, height }) => {
  const w = Math.round(width);
  const h = Math.round(height);
  if (offscreenWindows[sourceId] && w > 0 && h > 0) {
    console.log(`Resizing offscreen browser viewport for ID ${sourceId} to ${w}x${h}`);
    try {
      offscreenWindows[sourceId].setSize(w, h);
    } catch(e) {
      console.error('Error resizing offscreen window:', e);
    }
  }
});

ipcMain.on('destroy-web-source', (event, { sourceId }) => {
  if (offscreenWindows[sourceId]) {
    console.log(`Destroying offscreen browser source for ID ${sourceId}`);
    try {
      offscreenWindows[sourceId].close();
    } catch(e) {}
    delete offscreenWindows[sourceId];
  }
});

// Handle local video file picker
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Get system hardware specs for auto-configuration wizard
ipcMain.handle('get-hardware-info', async () => {
  const os = require('os');
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0] ? os.cpus()[0].model : 'Desconocido',
    cores: os.cpus().length,
    ram: Math.round(os.totalmem() / (1024 * 1024 * 1024))
  };
});
