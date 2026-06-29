// StreamStudio Main Renderer Process Controller

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // --- CUSTOM WINDOW CONTROLS AND MENUS (STEAM STYLE) ---
  if (window.electronAPI) {
    document.getElementById('win-minimize').addEventListener('click', () => {
      window.electronAPI.minimizeWindow();
    });
    
    document.getElementById('win-maximize').addEventListener('click', () => {
      window.electronAPI.maximizeWindow();
    });
    
    document.getElementById('win-close').addEventListener('click', () => {
      window.electronAPI.closeWindow();
    });
  }

  // Dropdown Menu Item Handlers
  document.getElementById('menu-item-settings').addEventListener('click', () => {
    const btn = document.getElementById('btn-open-settings') || document.querySelector('.bottom-dock .btn-icon:last-child');
    if (btn) btn.click();
  });

  const wizardBtn = document.getElementById('btn-run-wizard');
  if (wizardBtn) {
    document.getElementById('menu-item-wizard').addEventListener('click', () => {
      wizardBtn.click();
    });
  } else {
    // Hide or disable if wizard not loaded yet
    const wizEl = document.getElementById('menu-item-wizard');
    if (wizEl) wizEl.style.display = 'none';
  }

  document.getElementById('menu-item-exit').addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow();
    } else {
      window.close();
    }
  });

  document.getElementById('menu-item-studio').addEventListener('click', () => {
    const btn = document.getElementById('btn-toggle-studio');
    if (btn) btn.click();
  });

  document.getElementById('menu-item-add-audio').addEventListener('click', () => {
    const btn = document.getElementById('btn-add-audio-channel');
    if (btn) btn.click();
  });

  // About and Terms Modals
  const aboutModal = document.getElementById('about-modal');
  const termsModal = document.getElementById('terms-modal');

  document.getElementById('menu-item-about').addEventListener('click', () => {
    aboutModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-about-modal').addEventListener('click', () => {
    aboutModal.classList.add('hidden');
  });
  document.getElementById('btn-about-accept').addEventListener('click', () => {
    aboutModal.classList.add('hidden');
  });

  document.getElementById('menu-item-terms').addEventListener('click', () => {
    termsModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-terms-modal').addEventListener('click', () => {
    termsModal.classList.add('hidden');
  });
  document.getElementById('btn-terms-accept').addEventListener('click', () => {
    termsModal.classList.add('hidden');
  });

  // Instantiate Managers
  const settingsMgr = new SettingsManager();
  const chatSim = new ChatSimulator('chat-messages-container');
  
  // Set initial settings state in forms
  settingsMgr.populateForm();
  settingsMgr.bindUIEvents();
  
  // Initial config values
  const currentSettings = settingsMgr.get();
  const composer = new CanvasComposer('live-canvas', document.getElementById('preview-canvas'), currentSettings.resolutionBase);

  // Audio Context Graph & VU Meters variables
  let audioContext = null;
  let micStreamSource = null;
  let micGainNode = null;
  let micAnalyser = null;
  let micActiveStream = null;
  let isMicMuted = false;
  let micGainValue = 1.0;

  // Global Audio Tracks metadata container (consolidates all tracks and Web Audio nodes)
  let audioTracksData = {};
  let isDesktopMuted = false;
  let desktopGainValue = 1.0;
  
  // Initialize default Desktop Audio metadata
  audioTracksData['desktop'] = {
    id: 'desktop',
    name: 'Desktop Audio',
    isMuted: false,
    gainValue: 1.0,
    gateEnabled: false,
    compEnabled: false,
    eqEnabled: false
  };

  // Simulated VU level for Desktop
  let desktopSimLevel = 0.0;
  
  // Reusable custom prompt handler
  function showCustomPrompt(title, label, defaultValue, callback) {
    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-label').textContent = label;
    
    const input = document.getElementById('prompt-input');
    input.value = defaultValue || '';
    
    const modal = document.getElementById('prompt-modal');
    modal.classList.remove('hidden');
    
    setTimeout(() => input.focus(), 50);

    const cleanUp = () => {
      modal.classList.add('hidden');
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeyDown);
    };

    const onSubmit = () => {
      const val = input.value;
      cleanUp();
      callback(val);
    };

    const onCancel = () => {
      cleanUp();
      callback(null);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        onSubmit();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    const submitBtn = document.getElementById('btn-submit-prompt');
    const cancelBtn = document.getElementById('btn-cancel-prompt');
    const closeBtn = document.getElementById('btn-close-prompt-modal');

    submitBtn.addEventListener('click', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeyDown);
  }

  // Active custom audio channels list
  let activeAudioChannels = [];

  // Debounce helper to avoid flooding IPC with resize messages during active drag operations
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const debouncedResizeWebSource = debounce((sourceId, width, height) => {
    if (window.electronAPI && window.electronAPI.resizeWebSource) {
      window.electronAPI.resizeWebSource(sourceId, width, height);
    }
  }, 250); // 250ms delay is ideal to let Chromium settle

  // Handle receiving offscreen painted web frames using high-performance, non-leaking temporary Images
  if (window.electronAPI && window.electronAPI.onWebSourcePaint) {
    window.electronAPI.onWebSourcePaint(({ sourceId, buffer }) => {
      const blob = new Blob([buffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      
      const frameImg = new Image();
      frameImg.crossOrigin = 'anonymous'; // Set CORS to prevent canvas tainting for captureStream()
      
      frameImg.onload = () => {
        // Swap composer resource only when fully loaded to avoid Broken image states in drawImage
        composer.setSourceMedia(sourceId, frameImg);
        URL.revokeObjectURL(url); // Clean up memory safely now that it is resolved
      };
      
      frameImg.onerror = (err) => {
        console.error('Error loading offscreen frame image:', err);
        URL.revokeObjectURL(url); // Ensure memory is released even on load errors
      };
      
      frameImg.src = url;
    });
  }

  // Streaming state variables
  let isStreaming = false;
  let isRecording = false;
  let streamTimer = null;
  let streamSeconds = 0;
  let recorderStream = null;
  let streamMediaRecorder = null;
  let localMediaRecorder = null;
  let recordedChunks = [];
  let activeRecorderMime = 'video/webm;codecs=vp8,opus';
  let twitchWS = null;
  let streamAudioDestination = null;
  
  // Stats tracking
  let statsTimer = null;
  let simulatedDropped = 0;
  let simulatedCpu = 5;

  // Studio Mode State
  let isStudioMode = false;

  // Active video devices mapping
  let activeMediaDevices = {};

  // Setup initial state
  updatePlatformIndicators();

  // Initialize Default Scenes
  const lobbyScene = composer.addScene('1. Lobby (Pantalla + Cámara)');
  const gameScene = composer.addScene('2. Juego Completo');
  const chatScene = composer.addScene('3. Charla Directa');
  
  // Setup Lobby sources
  composer.addSource(lobbyScene.id, 'Fondo Gradiente', 'color', {
    color: '#0d0d12',
    color2: '#1a1a26',
    gradientType: 'linear'
  });
  composer.addSource(lobbyScene.id, 'Título del Directo', 'text', {
    textContent: '¡BIENVENIDOS AL STREAM!',
    fontSize: 54,
    fontColor: '#9146ff',
    y: 100
  });

  // Setup Chat sources
  composer.addSource(chatScene.id, 'Fondo Degradado', 'color', {
    color: '#120d1a',
    color2: '#09050e',
    gradientType: 'radial'
  });

  renderScenesList();
  renderSourcesList();

  // Populate device dropdown
  populateAudioDevices();

  // Initialize Chat Simulation
  const initialSettings = settingsMgr.get();
  if (initialSettings.twitchChannel) {
    // Uncheck chat simulator automatically if they have a real Twitch channel configured
    document.getElementById('chk-simulate-chat').checked = false;
  }

  if (document.getElementById('chk-simulate-chat').checked) {
    chatSim.start();
  }

  // Connect to live Twitch chat room
  connectTwitchChat();

  // --- AUDIO MIXER SYSTEM (WEB AUDIO API) ---
  async function initAudio() {
    if (audioContext) return;
    
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx({ sampleRate: currentSettings.sampleRate });
      console.log('AudioContext initialized at rate:', audioContext.sampleRate);
      
      // Initialize Web Audio mixed stream destination node
      streamAudioDestination = audioContext.createMediaStreamDestination();
      
      await setupMicSource();
      startAudioMetering();
    } catch (e) {
      console.error('Error starting Audio Mixer:', e);
      chatSim.addMessage('system', 'Error Audio', 'No se pudo iniciar el sistema de audio: ' + e.message);
    }
  }

  function setupAudioTrackChain(trackId, stream, deviceId, name) {
    if (!audioContext) return null;
    
    // Stop any existing tracks/nodes for this trackId
    if (audioTracksData[trackId] && audioTracksData[trackId].sourceNode) {
      try {
        audioTracksData[trackId].sourceNode.disconnect();
        audioTracksData[trackId].compressorNode.disconnect();
        audioTracksData[trackId].lowShelf.disconnect();
        audioTracksData[trackId].midPeaking.disconnect();
        audioTracksData[trackId].highShelf.disconnect();
        audioTracksData[trackId].gainNode.disconnect();
        if (audioTracksData[trackId].stream) {
          audioTracksData[trackId].stream.getTracks().forEach(t => t.stop());
        }
      } catch(e) {
        console.error('Error cleaning up previous audio track chain:', e);
      }
    }
    
    // Create new nodes
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const compressorNode = audioContext.createDynamicsCompressor();
    const lowShelf = audioContext.createBiquadFilter();
    const midPeaking = audioContext.createBiquadFilter();
    const highShelf = audioContext.createBiquadFilter();
    const gainNode = audioContext.createGain();
    const analyserNode = audioContext.createAnalyser();
    
    analyserNode.fftSize = 64;
    
    // Configure filter types
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 150; // Bass
    lowShelf.gain.value = 0;
    
    midPeaking.type = 'peaking';
    midPeaking.frequency.value = 1000; // Mids
    midPeaking.Q.value = 1.0;
    midPeaking.gain.value = 0;
    
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 6000; // Treble
    highShelf.gain.value = 0;
    
    // Default compressor settings
    compressorNode.threshold.value = 0; // Neutral
    compressorNode.ratio.value = 1; // Neutral
    
    // Connect Chain: Source -> Compressor -> EQ Low -> EQ Mid -> EQ High -> Gain -> Analyser
    sourceNode.connect(compressorNode);
    compressorNode.connect(lowShelf);
    lowShelf.connect(midPeaking);
    midPeaking.connect(highShelf);
    highShelf.connect(gainNode);
    gainNode.connect(analyserNode);
    
    // Route to the mixed stream destination
    if (streamAudioDestination) {
      gainNode.connect(streamAudioDestination);
    }
    
    // Create metadata object
    const trackObj = {
      id: trackId,
      name: name,
      deviceId: deviceId,
      stream: stream,
      
      // Nodes
      sourceNode: sourceNode,
      compressorNode: compressorNode,
      lowShelf: lowShelf,
      midPeaking: midPeaking,
      highShelf: highShelf,
      gainNode: gainNode,
      analyserNode: analyserNode,
      
      // Volume states
      gainValue: 1.0,
      isMuted: false,
      
      // Filter states
      gateEnabled: false,
      gateThreshold: -40,
      
      compEnabled: false,
      compThreshold: -24,
      compRatio: 4,
      
      eqEnabled: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0
    };
    
    audioTracksData[trackId] = trackObj;
    return trackObj;
  }

  async function setupMicSource() {
    const selectedDeviceId = document.getElementById('opt-device-mic').value;
    
    // Stop previous track if any
    if (micActiveStream) {
      micActiveStream.getTracks().forEach(t => t.stop());
    }
    
    // Apply studio-grade filters (Echo cancellation, noise suppression, high-pass filter, auto gain control)
    const constraints = {
      audio: {
        deviceId: selectedDeviceId === 'default' ? undefined : { exact: selectedDeviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
    
    try {
      micActiveStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Setup the chain using our new helper!
      const trackObj = setupAudioTrackChain('mic', micActiveStream, selectedDeviceId, 'Mic/Aux');
      
      // Assign the analyser to our global variables
      micAnalyser = trackObj.analyserNode;
      micGainNode = trackObj.gainNode;
      
      console.log('Microphone node connected with DSP filters and routed to mixer.');
    } catch (err) {
      console.error('Error capturing microphone stream:', err);
      chatSim.addMessage('system', 'Advertencia', 'No se detectó entrada de micrófono con filtros DSP. Se utilizará silencio.');
      micAnalyser = null;
    }
  }

  function applyFiltersToNodes(channelId) {
    const track = audioTracksData[channelId];
    if (!track || channelId === 'desktop') return;
    
    // 1. Equalizer Nodes
    if (track.eqEnabled) {
      track.lowShelf.gain.value = track.eqLow;
      track.midPeaking.gain.value = track.eqMid;
      track.highShelf.gain.value = track.eqHigh;
    } else {
      track.lowShelf.gain.value = 0;
      track.midPeaking.gain.value = 0;
      track.highShelf.gain.value = 0;
    }
    
    // 2. Compressor Node
    if (track.compEnabled) {
      track.compressorNode.threshold.value = track.compThreshold;
      track.compressorNode.ratio.value = track.compRatio;
      track.compressorNode.attack.value = 0.003; // Fast attack
      track.compressorNode.release.value = 0.25; // Release
    } else {
      track.compressorNode.threshold.value = 0;
      track.compressorNode.ratio.value = 1;
    }
  }

  function applyNoiseGates() {
    if (!audioContext) return;
    Object.values(audioTracksData).forEach(track => {
      if (track.id === 'desktop') return;
      if (!track.gateEnabled || track.isMuted) {
        if (!track.isMuted && track.gainNode) {
          track.gainNode.gain.value = track.gainValue;
        }
        return;
      }
      
      if (!track.analyserNode || !track.gainNode) return;
      
      const dataArray = new Uint8Array(track.analyserNode.frequencyBinCount);
      track.analyserNode.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const level = sum / dataArray.length / 255.0;
      let db = -100;
      if (level > 0.001) {
        db = 20 * Math.log10(level);
      }
      
      // If below gate threshold, mute smoothly to prevent pops
      if (db < track.gateThreshold) {
        track.gainNode.gain.setTargetAtTime(0.0, audioContext.currentTime, 0.015);
      } else {
        track.gainNode.gain.setTargetAtTime(track.gainValue, audioContext.currentTime, 0.015);
      }
    });
  }

  const drawMeter = (ctx, canvas, level, dbValText) => {
    if (!canvas || !ctx) return;
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    
    ctx.fillStyle = '#1e1e27';
    ctx.fillRect(0, 0, w, h);
    
    let db = -100;
    if (level > 0.001) {
      db = 20 * Math.log10(level);
    }
    dbValText.textContent = db <= -60 ? '-inf dB' : `${db.toFixed(1)} dB`;
    
    const fillW = Math.min(w, level * w);
    
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#10b981');
    grad.addColorStop(0.7, '#f59e0b');
    grad.addColorStop(0.9, '#ef4444');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, fillW, h);
    
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let x = w/10; x < w; x += w/10) {
      ctx.fillRect(x, 0, 1, h);
    }
  };

  function startAudioMetering() {
    const micCanvas = document.getElementById('meter-mic');
    const mCtx = micCanvas.getContext('2d');
    
    const deskCanvas = document.getElementById('meter-desktop');
    const dCtx = deskCanvas.getContext('2d');
    
    const dbMicText = document.getElementById('db-mic');
    const dbDeskText = document.getElementById('db-desktop');
 
    const meterLoop = () => {
      // Apply noise gates smooth silencing
      applyNoiseGates();

      // 1. Microphone metering
      let micLevel = 0.0;
      if (micAnalyser && !isMicMuted) {
        const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);
        micAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        micLevel = sum / dataArray.length / 255.0;
      }
      drawMeter(mCtx, micCanvas, micLevel * 2, dbMicText);
      
      // 2. Desktop simulated metering (controlled by fader and mute)
      if ((isStreaming || isRecording) && !isDesktopMuted) {
        desktopSimLevel = (0.02 + Math.random() * 0.12) * desktopGainValue;
        if (Math.random() > 0.95) desktopSimLevel = (0.5 + Math.random() * 0.4) * desktopGainValue;
      } else {
        desktopSimLevel = 0.0;
      }
      drawMeter(dCtx, deskCanvas, desktopSimLevel, dbDeskText);
      
      // 3. Dynamic audio channels metering (unified loop)
      Object.values(audioTracksData).forEach(chan => {
        if (chan.id === 'mic' || chan.id === 'desktop') return;
        
        let level = 0.0;
        if (chan.analyserNode && !chan.isMuted) {
          const dataArray = new Uint8Array(chan.analyserNode.frequencyBinCount);
          chan.analyserNode.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          level = sum / dataArray.length / 255.0;
        }
        
        const canvas = document.getElementById(`meter-${chan.id}`);
        const dbText = document.getElementById(`db-${chan.id}`);
        if (canvas && dbText) {
          const ctx = canvas.getContext('2d');
          drawMeter(ctx, canvas, level * 2, dbText);
        }
      });
      
      requestAnimationFrame(meterLoop);
    };
 
    requestAnimationFrame(meterLoop);
  }

  // --- DYNAMIC AUDIO CHANNEL ADDITION ---
  const audioPickerModal = document.getElementById('audio-picker-modal');
  
  document.getElementById('btn-add-audio-channel').addEventListener('click', async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = document.getElementById('select-new-audio-device');
      select.innerHTML = '';
      
      devices.forEach(device => {
        if (device.kind === 'audioinput') {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          opt.textContent = device.label || `Dispositivo ${select.children.length + 1}`;
          select.appendChild(opt);
        }
      });
      
      if (select.children.length === 0) {
        alert('No se detectaron dispositivos de audio adicionales.');
        return;
      }
      
      document.getElementById('input-new-audio-name').value = `Canal ${activeAudioChannels.length + 1}`;
      audioPickerModal.classList.remove('hidden');
    } catch (e) {
      console.error(e);
      alert('Error al enumerar dispositivos de audio: ' + e.message);
    }
  });

  const closeAudioModal = () => {
    audioPickerModal.classList.add('hidden');
  };

  document.getElementById('btn-close-audio-modal').addEventListener('click', closeAudioModal);
  document.getElementById('btn-cancel-audio').addEventListener('click', closeAudioModal);

  document.getElementById('btn-submit-audio').addEventListener('click', async () => {
    const devId = document.getElementById('select-new-audio-device').value;
    const name = document.getElementById('input-new-audio-name').value.trim() || 'Canal Audio';
    
    closeAudioModal();
    
    await initAudio();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: devId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      const channelId = 'chan_' + Math.random().toString(36).substr(2, 9);
      
      // Set up the unified processing chain
      const trackObj = setupAudioTrackChain(channelId, stream, devId, name);
      
      // Render mixer channel UI widget
      const channelContainer = document.createElement('div');
      channelContainer.className = 'mixer-channel';
      channelContainer.id = `channel-${channelId}`;
      channelContainer.innerHTML = `
        <div class="channel-info">
          <span class="channel-name">${escapeHtml(name)}</span>
          <span class="channel-db font-mono" id="db-${channelId}">-inf dB</span>
        </div>
        <div class="channel-fader-container">
          <button class="btn-icon btn-mute" id="mute-${channelId}" title="Silenciar"><i data-lucide="volume-2"></i></button>
          <input type="range" class="channel-slider" id="fader-${channelId}" min="0" max="1.5" step="0.01" value="1.0">
          <button class="btn-icon btn-settings-audio" data-channel-id="${channelId}" title="Propiedades y Filtros"><i data-lucide="settings"></i></button>
          <button class="btn-icon btn-delete-audio" data-channel-id="${channelId}" title="Eliminar Canal"><i data-lucide="trash-2" style="color: #ef4444;"></i></button>
        </div>
        <div class="channel-meter">
          <canvas class="vu-meter" id="meter-${channelId}"></canvas>
        </div>
      `;
      
      document.querySelector('.audio-mixer').appendChild(channelContainer);
      lucide.createIcons();
      
      // Fader listener
      document.getElementById(`fader-${channelId}`).addEventListener('input', (e) => {
        trackObj.gainValue = parseFloat(e.target.value);
        if (!trackObj.isMuted) {
          trackObj.gainNode.gain.value = trackObj.gainValue;
        }
      });
      
      // Mute listener
      document.getElementById(`mute-${channelId}`).addEventListener('click', () => {
        trackObj.isMuted = !trackObj.isMuted;
        const btn = document.getElementById(`mute-${channelId}`);
        if (trackObj.isMuted) {
          btn.classList.add('muted');
          btn.innerHTML = '<i data-lucide="volume-x"></i>';
          trackObj.gainNode.gain.value = 0;
        } else {
          btn.classList.remove('muted');
          btn.innerHTML = '<i data-lucide="volume-2"></i>';
          trackObj.gainNode.gain.value = trackObj.gainValue;
        }
        lucide.createIcons();
      });
      
      chatSim.addMessage('system', 'Audio Mixer', `Canal de audio "${name}" añadido correctamente.`);
      
    } catch (err) {
      console.error(err);
      alert('Error al acceder al dispositivo de audio: ' + err.message);
    }
  });

  async function populateAudioDevices() {
    try {
      // Trigger permission quickly
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = document.getElementById('opt-device-mic');
      select.innerHTML = '<option value="default">Predeterminado del Sistema</option>';
      
      devices.forEach(device => {
        if (device.kind === 'audioinput') {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          opt.textContent = device.label || `Micrófono ${select.length}`;
          select.appendChild(opt);
        }
      });
    } catch (e) {
      console.error('Error enumerating audio devices:', e);
    }
  }

  // --- SCENES & SOURCES UI RENDERERS ---

  function renderScenesList() {
    const list = document.getElementById('scenes-list');
    list.innerHTML = '';
    
    composer.scenes.forEach((scene, idx) => {
      const li = document.createElement('li');
      li.className = scene.id === composer.activeSceneId ? 'active' : '';
      
      // Make scenes draggable
      li.setAttribute('draggable', 'true');
      
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        li.classList.add('dragging');
      });
      
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });
      
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = idx;
        
        if (fromIdx !== toIdx && !isNaN(fromIdx)) {
          const draggedScene = composer.scenes[fromIdx];
          composer.scenes.splice(fromIdx, 1);
          composer.scenes.splice(toIdx, 0, draggedScene);
          renderScenesList();
        }
      });
      
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
      });
      
      const activeIndicator = scene.id === composer.activeSceneId ? '<i data-lucide="play-circle"></i>' : '<i data-lucide="circle"></i>';
      
      li.innerHTML = `
        <span class="item-name">${activeIndicator} ${escapeHtml(scene.name)}</span>
        <div class="item-actions">
          <button class="btn-icon btn-del-scene" data-id="${scene.id}"><i data-lucide="trash-2"></i></button>
        </div>
      `;
      
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-scene')) return;
        
        if (isStudioMode) {
          // In studio mode, select switches Preview scene, Program stays same until transitioned
          composer.performTransition(scene.id, parseInt(document.getElementById('input-transition-duration').value) || 300, document.getElementById('select-transition-type').value);
        } else {
          // Instant switch in standard mode
          composer.activeSceneId = scene.id;
        }
        
        composer.selectedSourceId = null;
        renderScenesList();
        renderSourcesList();
        hidePropertiesPanel();
      });
      
      list.appendChild(li);
    });
    
    lucide.createIcons({ attrs: { class: 'lucide-icon-custom' } });
  }

  function renderSourcesList() {
    const list = document.getElementById('sources-list');
    list.innerHTML = '';
    
    const activeScene = composer.getActiveScene();
    if (!activeScene) return;

    // Render back-to-front or top-to-bottom? Let's display top layer first (high z)
    const sortedSources = [...activeScene.sources].reverse();

    sortedSources.forEach((src, uiIdx) => {
      const li = document.createElement('li');
      li.className = src.id === composer.selectedSourceId ? 'active' : '';
      
      // Make sources draggable
      li.setAttribute('draggable', 'true');
      
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', uiIdx);
        li.classList.add('dragging');
      });
      
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });
      
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const fromUI = parseInt(e.dataTransfer.getData('text/plain'));
        const toUI = uiIdx;
        
        if (fromUI !== toUI && !isNaN(fromUI)) {
          // Convert from UI index to real array index (since list is reversed)
          const fromRealIdx = activeScene.sources.length - 1 - fromUI;
          const toRealIdx = activeScene.sources.length - 1 - toUI;
          
          const draggedSource = activeScene.sources[fromRealIdx];
          activeScene.sources.splice(fromRealIdx, 1);
          activeScene.sources.splice(toRealIdx, 0, draggedSource);
          
          // Reassign Z index to match array position
          activeScene.sources.forEach((s, idx) => s.z = idx);
          
          renderSourcesList();
        }
      });
      
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
      });
      
      let typeIcon = 'box';
      if (src.type === 'camera') typeIcon = 'video';
      else if (src.type === 'screen') typeIcon = 'monitor';
      else if (src.type === 'image') typeIcon = 'image';
      else if (src.type === 'text') typeIcon = 'type';
      else if (src.type === 'color') typeIcon = 'palette';

      li.innerHTML = `
        <span class="item-name"><i data-lucide="${typeIcon}"></i> ${escapeHtml(src.name)}</span>
        <div class="item-actions">
          <button class="btn-icon btn-visibility ${src.visible ? '' : 'hidden-source'}" data-id="${src.id}">
            <i data-lucide="${src.visible ? 'eye' : 'eye-off'}"></i>
          </button>
          <button class="btn-icon btn-lock ${src.locked ? 'locked-source' : ''}" data-id="${src.id}">
            <i data-lucide="${src.locked ? 'lock' : 'lock-open'}"></i>
          </button>
          <button class="btn-icon btn-del-source" data-id="${src.id}"><i data-lucide="trash-2"></i></button>
        </div>
      `;
      
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-visibility') || e.target.closest('.btn-lock') || e.target.closest('.btn-del-source')) return;
        composer.selectedSourceId = src.id;
        renderSourcesList();
        showPropertiesPanel(src);
      });
      
      list.appendChild(li);
    });

    lucide.createIcons();
  }

  // --- SOURCE ACTIONS ---

  // Handle source visible toggle
  document.getElementById('sources-list').addEventListener('click', (e) => {
    const activeScene = composer.getActiveScene();
    if (!activeScene) return;

    const visBtn = e.target.closest('.btn-visibility');
    if (visBtn) {
      const id = visBtn.getAttribute('data-id');
      const src = activeScene.sources.find(s => s.id === id);
      if (src) {
        src.visible = !src.visible;
        renderSourcesList();
      }
      return;
    }

    const lockBtn = e.target.closest('.btn-lock');
    if (lockBtn) {
      const id = lockBtn.getAttribute('data-id');
      const src = activeScene.sources.find(s => s.id === id);
      if (src) {
        src.locked = !src.locked;
        renderSourcesList();
      }
      return;
    }

    const delBtn = e.target.closest('.btn-del-source');
    if (delBtn) {
      const id = delBtn.getAttribute('data-id');
      const src = activeScene.sources.find(s => s.id === id);
      if (src && src.type === 'web' && window.electronAPI && window.electronAPI.destroyWebSource) {
        window.electronAPI.destroyWebSource(src.id);
      }
      composer.deleteSource(activeScene.id, id);
      renderSourcesList();
      hidePropertiesPanel();
    }
  });

  // Scene reordering buttons
  document.getElementById('btn-source-up').addEventListener('click', () => {
    const scene = composer.getActiveScene();
    if (scene && composer.selectedSourceId) {
      composer.moveSourceZ(scene.id, composer.selectedSourceId, 'up');
      renderSourcesList();
    }
  });

  document.getElementById('btn-source-down').addEventListener('click', () => {
    const scene = composer.getActiveScene();
    if (scene && composer.selectedSourceId) {
      composer.moveSourceZ(scene.id, composer.selectedSourceId, 'down');
      renderSourcesList();
    }
  });

  // Source selections from Canvas listener
  window.addEventListener('source-selected', (e) => {
    const src = e.detail.source;
    renderSourcesList();
    if (src) {
      showPropertiesPanel(src);
    } else {
      hidePropertiesPanel();
    }
  });

  window.addEventListener('source-properties-updated', (e) => {
    const src = e.detail.source;
    if (src) {
      if (composer.selectedSourceId === src.id) {
        updatePropertiesFormValues(src);
      }
    }
  });

  // Add scene button
  document.getElementById('btn-add-scene').addEventListener('click', () => {
    showCustomPrompt('Nueva Escena', 'Nombre de la Escena:', '', (name) => {
      if (name) {
        composer.addScene(name);
        renderScenesList();
      }
    });
  });

  // Delete scene action
  document.getElementById('scenes-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-del-scene');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (composer.scenes.length <= 1) {
        alert('Debes tener al menos una escena.');
        return;
      }
      if (confirm('¿Estás seguro de eliminar esta escena?')) {
        composer.removeScene(id);
        renderScenesList();
        renderSourcesList();
        hidePropertiesPanel();
      }
    }
  });

  // --- SOURCE PLACEMENT & CAPTURE ---

  // Dropdown Toggle
  const addSourceBtn = document.getElementById('btn-add-source-menu');
  const addSourceDropdown = document.getElementById('add-source-dropdown');
  
  addSourceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addSourceDropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    addSourceDropdown.classList.remove('show');
  });

  // Add sources click events
  addSourceDropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', async () => {
      const activeScene = composer.getActiveScene();
      if (!activeScene) return;

      const type = item.getAttribute('data-source-type');
      
      await initAudio(); // Lazy init Audio Mixer on first source capture

      if (type === 'camera') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          const video = document.createElement('video');
          video.srcObject = stream;
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true;
          
          const source = composer.addSource(activeScene.id, 'Cámara Web', 'camera');
          composer.setSourceMedia(source.id, video);
          
          video.onloadedmetadata = () => {
            source.width = video.videoWidth > 0 ? video.videoWidth : 640;
            source.height = video.videoHeight > 0 ? video.videoHeight : 480;
            renderSourcesList();
          };
        } catch (e) {
          console.error(e);
          alert('Error al acceder a la Cámara: ' + e.message);
        }
      } else if (type === 'screen') {
        if (window.electronAPI && window.electronAPI.getDesktopSources) {
          try {
            const sources = await window.electronAPI.getDesktopSources();
            const grid = document.getElementById('screen-sources-grid');
            grid.innerHTML = '';
            
            const modal = document.getElementById('screen-picker-modal');
            modal.classList.remove('hidden');

            const cleanUpScreenModal = () => {
              modal.classList.add('hidden');
              document.getElementById('btn-close-screen-modal').removeEventListener('click', onCancel);
              document.getElementById('btn-cancel-screen').removeEventListener('click', onCancel);
            };

            const onCancel = () => {
              cleanUpScreenModal();
            };

            document.getElementById('btn-close-screen-modal').addEventListener('click', onCancel);
            document.getElementById('btn-cancel-screen').addEventListener('click', onCancel);

            sources.forEach(source => {
              const card = document.createElement('div');
              card.className = 'screen-source-card';
              card.innerHTML = `
                <img class="screen-source-thumb" src="${source.thumbnail}">
                <div class="screen-source-name">${escapeHtml(source.name)}</div>
              `;
              
              card.addEventListener('click', async () => {
                cleanUpScreenModal();
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                      mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: source.id,
                        minWidth: 1280,
                        maxWidth: 1920,
                        minHeight: 720,
                        maxHeight: 1080
                      }
                    }
                  });
                  
                  const video = document.createElement('video');
                  video.srcObject = stream;
                  video.autoplay = true;
                  video.playsInline = true;
                  video.muted = true;

                  const compSource = composer.addSource(activeScene.id, 'Pantalla: ' + source.name.substring(0, 15), 'screen');
                  composer.setSourceMedia(compSource.id, video);

                  stream.getVideoTracks()[0].onended = () => {
                    composer.deleteSourceMedia(compSource.id);
                  };

                  video.onloadedmetadata = () => {
                    compSource.width = video.videoWidth;
                    compSource.height = video.videoHeight;
                    renderSourcesList();
                  };
                } catch (err) {
                  console.error(err);
                  alert('Error al capturar la pantalla seleccionada: ' + err.message);
                }
              });
              grid.appendChild(card);
            });
          } catch (err) {
            console.error('Error fetching screen sources:', err);
            alert('Error al obtener pantallas/ventanas: ' + err.message);
          }
        } else {
          alert('La captura de pantalla no es compatible en este entorno.');
        }
      } else if (type === 'image') {
        showCustomPrompt('Añadir Imagen', 'Ingresa URL de imagen (deja vacío para demo):', 'https://picsum.photos/800/600', (url) => {
          if (url !== null) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = url || 'https://picsum.photos/800/600';
            
            const source = composer.addSource(activeScene.id, 'Imagen ' + (url ? 'Cargada' : 'Demo'), 'image', { imgUrl: img.src });
            composer.setSourceMedia(source.id, img);
            
            img.onload = () => {
              source.width = img.width;
              source.height = img.height;
              renderSourcesList();
            };
          }
        });
      } else if (type === 'text') {
        showCustomPrompt('Añadir Texto', 'Contenido del Texto:', '¡Bienvenidos Streamers!', (textStr) => {
          if (textStr) {
            const source = composer.addSource(activeScene.id, 'Texto: ' + textStr.substring(0, 10), 'text', { textContent: textStr });
            renderSourcesList();
          }
        });
      } else if (type === 'color') {
        const source = composer.addSource(activeScene.id, 'Fondo de Color', 'color', { color: '#2b2b3a' });
        renderSourcesList();
      } else if (type === 'web') {
        showCustomPrompt('Añadir Web (Overlay)', 'URL de la Página Web / Alerta:', 'https://www.google.com', (url) => {
          if (url) {
            const source = composer.addSource(activeScene.id, 'Navegador', 'web', { 
              webUrl: url,
              renderWidth: 1920,
              renderHeight: 1080
            });
            // Tamaño de visualización inicial en el lienzo (escalado)
            source.width = 1280;
            source.height = 720;
            source.x = 0;
            source.y = 0;
            renderSourcesList();
            
            if (window.electronAPI && window.electronAPI.createWebSource) {
              const currentSettings = settingsMgr.get();
              // Crear el navegador offscreen a resolución completa 1920x1080 para evitar recortes
              window.electronAPI.createWebSource(source.id, url, 1920, 1080, currentSettings.fps);
            }
          }
        });
      } else if (type === 'video') {
        if (window.electronAPI && window.electronAPI.selectVideoFile) {
          window.electronAPI.selectVideoFile().then((filePath) => {
            if (filePath) {
              const video = document.createElement('video');
              video.crossOrigin = 'anonymous'; // Enable CORS to prevent canvas tainting for captureStream()
              video.src = 'stream-media://' + encodeURIComponent(filePath);
              video.autoplay = true;
              video.loop = true;
              video.muted = true;
              video.playsInline = true;
              
              const fileName = filePath.substring(filePath.lastIndexOf('\\') + 1);
              const source = composer.addSource(activeScene.id, 'Video: ' + fileName.substring(0, 10), 'video', { videoPath: filePath });
              composer.setSourceMedia(source.id, video);
              
              video.onloadedmetadata = () => {
                source.width = video.videoWidth > 0 ? video.videoWidth : 800;
                source.height = video.videoHeight > 0 ? video.videoHeight : 600;
                renderSourcesList();
              };
            }
          }).catch(err => {
            console.error('Error selecting video:', err);
            alert('Error al cargar video: ' + err.message);
          });
        } else {
          alert('La selección de video local no es compatible.');
        }
      }
      
      renderSourcesList();
    });
  });

  // --- PROPERTIES FORM EDITING ---

  const propPanel = document.getElementById('source-properties-panel');
  const propContainer = document.getElementById('properties-form-container');

  function showPropertiesPanel(source) {
    propPanel.style.display = 'block';
    propContainer.innerHTML = '';

    // Create common fields
    let html = `
      <div class="prop-row">
        <label>Posición X</label>
        <input type="number" id="prop-x" value="${source.x}">
      </div>
      <div class="prop-row">
        <label>Posición Y</label>
        <input type="number" id="prop-y" value="${source.y}">
      </div>
      <div class="prop-row">
        <label>Ancho (W)</label>
        <input type="number" id="prop-w" value="${source.width}" ${source.type === 'color' ? 'readonly' : ''}>
      </div>
      <div class="prop-row">
        <label>Alto (H)</label>
        <input type="number" id="prop-h" value="${source.height}" ${source.type === 'color' ? 'readonly' : ''}>
      </div>
      <div class="prop-row">
        <label>Opacidad</label>
        <input type="range" id="prop-opacity" min="0" max="1" step="0.05" value="${source.opacity}">
      </div>
    `;

    // Type specific fields
    if (source.type === 'color') {
      html += `
        <div class="prop-row">
          <label>Color 1</label>
          <input type="color" id="prop-color" value="${source.properties.color}">
        </div>
        <div class="prop-row">
          <label>Color 2 (Opc)</label>
          <input type="color" id="prop-color2" value="${source.properties.color2 || '#000000'}">
        </div>
        <div class="prop-row">
          <label>Gradiente</label>
          <select id="prop-grad-type">
            <option value="linear" ${source.properties.gradientType === 'linear' ? 'selected' : ''}>Lineal</option>
            <option value="radial" ${source.properties.gradientType === 'radial' ? 'selected' : ''}>Radial</option>
          </select>
        </div>
      `;
    } else if (source.type === 'text') {
      html += `
        <div class="prop-row">
          <label>Texto</label>
          <input type="text" id="prop-text-content" value="${escapeHtml(source.properties.textContent)}">
        </div>
        <div class="prop-row">
          <label>Color</label>
          <input type="color" id="prop-font-color" value="${source.properties.fontColor}">
        </div>
        <div class="prop-row">
          <label>Tamaño px</label>
          <input type="number" id="prop-font-size" value="${source.properties.fontSize}">
        </div>
        <div class="prop-row">
          <label>Familia</label>
          <select id="prop-font-family">
            <option value="Inter" ${source.properties.fontFamily === 'Inter' ? 'selected' : ''}>Inter</option>
            <option value="JetBrains Mono" ${source.properties.fontFamily === 'JetBrains Mono' ? 'selected' : ''}>JetBrains Mono</option>
            <option value="sans-serif" ${source.properties.fontFamily === 'sans-serif' ? 'selected' : ''}>Sans-serif</option>
            <option value="serif" ${source.properties.fontFamily === 'serif' ? 'selected' : ''}>Serif</option>
          </select>
        </div>
      `;
    } else if (source.type === 'web') {
      html += `
        <div class="prop-row">
          <label>Ancho Web (Render)</label>
          <input type="number" id="prop-render-w" value="${source.properties.renderWidth || 1920}">
        </div>
        <div class="prop-row">
          <label>Alto Web (Render)</label>
          <input type="number" id="prop-render-h" value="${source.properties.renderHeight || 1080}">
        </div>
        <div class="prop-row">
          <label>URL Web</label>
          <input type="text" id="prop-web-url" value="${escapeHtml(source.properties.webUrl || '')}">
        </div>
      `;
    }

    propContainer.innerHTML = html;

    // Bind inputs to properties
    const bindInput = (id, field, isNumeric = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        let val = el.value;
        if (isNumeric) val = parseFloat(val) || 0;
        source[field] = val;
      });
    };

    const bindPropInput = (id, propField, isNumeric = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        let val = el.value;
        if (isNumeric) val = parseFloat(val) || 0;
        source.properties[propField] = val;
      });
    };

    bindInput('prop-x', 'x', true);
    bindInput('prop-y', 'y', true);
    bindInput('prop-w', 'width', true);
    bindInput('prop-h', 'height', true);
    bindInput('prop-opacity', 'opacity', true);

    if (source.type === 'color') {
      bindPropInput('prop-color', 'color');
      
      const col2El = document.getElementById('prop-color2');
      const gradEl = document.getElementById('prop-grad-type');
      
      const checkGradient = () => {
        source.properties.color2 = col2El.value;
      };
      
      col2El.addEventListener('input', checkGradient);
      bindPropInput('prop-grad-type', 'gradientType');
    } else if (source.type === 'text') {
      bindPropInput('prop-text-content', 'textContent');
      bindPropInput('prop-font-color', 'fontColor');
      bindPropInput('prop-font-size', 'fontSize', true);
      bindPropInput('prop-font-family', 'fontFamily');
    } else if (source.type === 'web') {
      const renderWEl = document.getElementById('prop-render-w');
      const renderHEl = document.getElementById('prop-render-h');
      const webUrlEl = document.getElementById('prop-web-url');
      
      const updateWebSourceSettings = () => {
        const w = parseInt(renderWEl.value) || 1920;
        const h = parseInt(renderHEl.value) || 1080;
        source.properties.renderWidth = w;
        source.properties.renderHeight = h;
        
        if (window.electronAPI && window.electronAPI.resizeWebSource) {
          window.electronAPI.resizeWebSource(source.id, w, h);
        }
      };
      
      renderWEl.addEventListener('change', updateWebSourceSettings);
      renderHEl.addEventListener('change', updateWebSourceSettings);
      
      webUrlEl.addEventListener('change', () => {
        const url = webUrlEl.value.trim();
        if (url && url !== source.properties.webUrl) {
          source.properties.webUrl = url;
          if (window.electronAPI && window.electronAPI.destroyWebSource && window.electronAPI.createWebSource) {
            window.electronAPI.destroyWebSource(source.id);
            const currentSettings = settingsMgr.get();
            window.electronAPI.createWebSource(source.id, url, source.properties.renderWidth || 1920, source.properties.renderHeight || 1080, currentSettings.fps);
          }
        }
      });
    }
  }

  function updatePropertiesFormValues(source) {
    const x = document.getElementById('prop-x');
    const y = document.getElementById('prop-y');
    const w = document.getElementById('prop-w');
    const h = document.getElementById('prop-h');
    
    if (x) x.value = source.x;
    if (y) y.value = source.y;
    if (w) w.value = source.width;
    if (h) h.value = source.height;
  }

  function hidePropertiesPanel() {
    propPanel.style.display = 'none';
    propContainer.innerHTML = '';
  }

  document.getElementById('btn-close-properties').addEventListener('click', hidePropertiesPanel);

  // --- AUDIO MIXER CONTROLS ---

  document.getElementById('fader-mic').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    micGainValue = val; // Keep global in sync
    if (audioTracksData['mic']) {
      audioTracksData['mic'].gainValue = val;
      if (!audioTracksData['mic'].isMuted && !audioTracksData['mic'].gateEnabled) {
        audioTracksData['mic'].gainNode.gain.value = val;
      }
    }
  });

  document.getElementById('mute-mic').addEventListener('click', () => {
    if (!audioTracksData['mic']) return;
    const track = audioTracksData['mic'];
    track.isMuted = !track.isMuted;
    isMicMuted = track.isMuted; // Keep global in sync
    const btn = document.getElementById('mute-mic');
    
    if (track.isMuted) {
      btn.classList.add('muted');
      btn.innerHTML = '<i data-lucide="mic-off"></i>';
      track.gainNode.gain.value = 0;
    } else {
      btn.classList.remove('muted');
      btn.innerHTML = '<i data-lucide="mic"></i>';
      track.gainNode.gain.value = track.gainValue;
    }
    lucide.createIcons();
  });

  // Desktop fader and mute listeners
  document.getElementById('fader-desktop').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    desktopGainValue = val;
    if (audioTracksData['desktop']) {
      audioTracksData['desktop'].gainValue = val;
    }
  });

  document.getElementById('mute-desktop').addEventListener('click', () => {
    if (!audioTracksData['desktop']) return;
    const track = audioTracksData['desktop'];
    track.isMuted = !track.isMuted;
    isDesktopMuted = track.isMuted;
    const btn = document.getElementById('mute-desktop');
    
    if (track.isMuted) {
      btn.classList.add('muted');
      btn.innerHTML = '<i data-lucide="volume-x"></i>';
    } else {
      btn.classList.remove('muted');
      btn.innerHTML = '<i data-lucide="volume-2"></i>';
    }
    lucide.createIcons();
  });

  // Event Delegation for settings and deleting dynamic audio channels
  const audioMixerContainer = document.querySelector('.audio-mixer');
  
  audioMixerContainer.addEventListener('click', (e) => {
    // Check for delete button
    const deleteBtn = e.target.closest('.btn-delete-audio');
    if (deleteBtn) {
      const channelId = deleteBtn.getAttribute('data-channel-id');
      removeAudioChannel(channelId);
      return;
    }
    
    // Check for settings button
    const settingsBtn = e.target.closest('.btn-settings-audio');
    if (settingsBtn) {
      const channelId = settingsBtn.getAttribute('data-channel-id');
      openAudioProperties(channelId);
      return;
    }
  });

  function removeAudioChannel(channelId) {
    const track = audioTracksData[channelId];
    if (!track) return;
    
    console.log(`Removing Audio Channel: ${track.name} (${channelId})`);
    
    // 1. Disconnect Web Audio nodes
    try {
      track.sourceNode.disconnect();
      track.compressorNode.disconnect();
      track.lowShelf.disconnect();
      track.midPeaking.disconnect();
      track.highShelf.disconnect();
      track.gainNode.disconnect();
    } catch(err) {
      console.warn('Nodes already disconnected:', err);
    }
    
    // 2. Stop microphone device capture tracks (release hardware)
    if (track.stream) {
      track.stream.getTracks().forEach(t => t.stop());
    }
    
    // 3. Remove from DOM
    const el = document.getElementById(`channel-${channelId}`);
    if (el) el.remove();
    
    // 4. Delete from metadata object
    delete audioTracksData[channelId];
    
    chatSim.addMessage('system', 'Audio Mixer', `Canal de audio "${track.name}" removido.`);
  }

  // Properties and Filters Modal Handlers
  let activeEditingChannelId = null;

  async function openAudioProperties(channelId) {
    const track = audioTracksData[channelId];
    if (!track) return;
    
    activeEditingChannelId = channelId;
    
    // Update Title
    document.getElementById('audio-props-title').innerHTML = `<i data-lucide="sliders" style="color: #a855f7;"></i> Propiedades y Filtros: ${track.name}`;
    lucide.createIcons();
    
    // Populate Devices Dropdown (only for inputs, not desktop)
    const deviceGroup = document.getElementById('audio-device-group');
    const select = document.getElementById('audio-props-device-select');
    select.innerHTML = '';
    
    if (channelId === 'desktop') {
      deviceGroup.style.display = 'none';
    } else {
      deviceGroup.style.display = 'block';
      
      const optDefault = document.createElement('option');
      optDefault.value = 'default';
      optDefault.textContent = 'Predeterminado del Sistema';
      select.appendChild(optDefault);
      
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        devices.forEach(device => {
          if (device.kind === 'audioinput') {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.textContent = device.label || `Dispositivo`;
            if (track.deviceId === device.deviceId) {
              opt.selected = true;
            }
            select.appendChild(opt);
          }
        });
      } catch (err) {
        console.error('Error enumerating devices for properties:', err);
      }
    }
    
    // Populate current filter states
    document.getElementById('filter-gate-enable').checked = track.gateEnabled;
    document.getElementById('filter-gate-threshold').value = track.gateThreshold;
    document.getElementById('filter-gate-val').textContent = `${track.gateThreshold} dB`;
    
    document.getElementById('filter-comp-enable').checked = track.compEnabled;
    document.getElementById('filter-comp-threshold').value = track.compThreshold;
    document.getElementById('filter-comp-thresh-val').textContent = `${track.compThreshold} dB`;
    document.getElementById('filter-comp-ratio').value = track.compRatio;
    document.getElementById('filter-comp-ratio-val').textContent = `${track.compRatio}:1`;
    
    document.getElementById('filter-eq-enable').checked = track.eqEnabled;
    document.getElementById('filter-eq-low').value = track.eqLow;
    document.getElementById('filter-eq-low-val').textContent = `${track.eqLow} dB`;
    document.getElementById('filter-eq-mid').value = track.eqMid;
    document.getElementById('filter-eq-mid-val').textContent = `${track.eqMid} dB`;
    document.getElementById('filter-eq-high').value = track.eqHigh;
    document.getElementById('filter-eq-high-val').textContent = `${track.eqHigh} dB`;
    
    // Show Modal
    document.getElementById('audio-properties-modal').classList.remove('hidden');
  }

  // Bind close buttons
  document.getElementById('btn-close-audio-props').addEventListener('click', () => {
    document.getElementById('audio-properties-modal').classList.add('hidden');
  });

  // Slider visual updates
  document.getElementById('filter-gate-threshold').addEventListener('input', (e) => {
    document.getElementById('filter-gate-val').textContent = `${e.target.value} dB`;
  });
  document.getElementById('filter-comp-threshold').addEventListener('input', (e) => {
    document.getElementById('filter-comp-thresh-val').textContent = `${e.target.value} dB`;
  });
  document.getElementById('filter-comp-ratio').addEventListener('input', (e) => {
    document.getElementById('filter-comp-ratio-val').textContent = `${e.target.value}:1`;
  });
  document.getElementById('filter-eq-low').addEventListener('input', (e) => {
    document.getElementById('filter-eq-low-val').textContent = `${e.target.value} dB`;
  });
  document.getElementById('filter-eq-mid').addEventListener('input', (e) => {
    document.getElementById('filter-eq-mid-val').textContent = `${e.target.value} dB`;
  });
  document.getElementById('filter-eq-high').addEventListener('input', (e) => {
    document.getElementById('filter-eq-high-val').textContent = `${e.target.value} dB`;
  });

  // Save button action
  document.getElementById('btn-audio-props-save').addEventListener('click', async () => {
    const channelId = activeEditingChannelId;
    const track = audioTracksData[channelId];
    if (!track) return;
    
    // 1. Save input device changes (if changed device)
    if (channelId !== 'desktop') {
      const newDevId = document.getElementById('audio-props-device-select').value;
      if (newDevId !== track.deviceId) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: newDevId === 'default' ? undefined : { exact: newDevId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          
          // Rebuild graph with new stream
          setupAudioTrackChain(channelId, stream, newDevId, track.name);
          
          // Re-get new track references
          const updatedTrack = audioTracksData[channelId];
          Object.assign(updatedTrack, {
            gateEnabled: document.getElementById('filter-gate-enable').checked,
            gateThreshold: parseInt(document.getElementById('filter-gate-threshold').value),
            compEnabled: document.getElementById('filter-comp-enable').checked,
            compThreshold: parseInt(document.getElementById('filter-comp-threshold').value),
            compRatio: parseFloat(document.getElementById('filter-comp-ratio').value),
            eqEnabled: document.getElementById('filter-eq-enable').checked,
            eqLow: parseInt(document.getElementById('filter-eq-low').value),
            eqMid: parseInt(document.getElementById('filter-eq-mid').value),
            eqHigh: parseInt(document.getElementById('filter-eq-high').value)
          });
          
          applyFiltersToNodes(channelId);
          
        } catch (err) {
          alert('Error al cambiar de dispositivo de entrada: ' + err.message);
          return;
        }
      }
    }
    
    // 2. Save filter states
    track.gateEnabled = document.getElementById('filter-gate-enable').checked;
    track.gateThreshold = parseInt(document.getElementById('filter-gate-threshold').value);
    
    track.compEnabled = document.getElementById('filter-comp-enable').checked;
    track.compThreshold = parseInt(document.getElementById('filter-comp-threshold').value);
    track.compRatio = parseFloat(document.getElementById('filter-comp-ratio').value);
    
    track.eqEnabled = document.getElementById('filter-eq-enable').checked;
    track.eqLow = parseInt(document.getElementById('filter-eq-low').value);
    track.eqMid = parseInt(document.getElementById('filter-eq-mid').value);
    track.eqHigh = parseInt(document.getElementById('filter-eq-high').value);
    
    // Apply parameters directly to Web Audio nodes!
    applyFiltersToNodes(channelId);
    
    // Close Modal
    document.getElementById('audio-properties-modal').classList.add('hidden');
    
    chatSim.addMessage('system', 'Audio Mixer', `Filtros guardados para "${track.name}".`);
  });

  // --- STUDIO MODE TRANSITION SYSTEM ---

  const btnToggleStudio = document.getElementById('btn-toggle-studio');
  const singleContainer = document.getElementById('single-canvas-container');
  const studioContainer = document.getElementById('studio-canvas-container');
  const linkCanvas = document.getElementById('program-canvas-link');
  const linkCtx = linkCanvas.getContext('2d');

  btnToggleStudio.addEventListener('click', () => {
    isStudioMode = !isStudioMode;
    composer.studioMode = isStudioMode; // Sincronizar modo con el compositor
    
    if (isStudioMode) {
      btnToggleStudio.classList.add('active');
      singleContainer.classList.add('hidden');
      studioContainer.classList.remove('hidden');
      
      // Link canvases sizes
      linkCanvas.width = composer.width;
      linkCanvas.height = composer.height;
      
      // Start link canvas mirroring loop
      const mirror = () => {
        if (!isStudioMode) return;
        linkCtx.clearRect(0, 0, linkCanvas.width, linkCanvas.height);
        linkCtx.drawImage(composer.liveCanvas, 0, 0);
        requestAnimationFrame(mirror);
      };
      requestAnimationFrame(mirror);
      
    } else {
      btnToggleStudio.classList.remove('active');
      singleContainer.classList.remove('hidden');
      studioContainer.classList.add('hidden');
    }
    
    composer.selectedSourceId = null;
    renderSourcesList();
    hidePropertiesPanel();
  });

  document.getElementById('btn-studio-transition').addEventListener('click', () => {
    // In studio mode, trigger final cut or fade transition
    const duration = parseInt(document.getElementById('input-transition-duration').value) || 300;
    const effect = document.getElementById('select-transition-type').value;
    
    const activeScene = composer.getActiveScene();
    if (activeScene) {
      composer.performTransition(activeScene.id, duration, effect);
    }
  });

  // --- SETTINGS DIALOG ACTIONS ---

  const settingsModal = document.getElementById('settings-modal');
  
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    settingsMgr.populateForm();
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-settings-modal').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newSettings = settingsMgr.readForm();
    settingsMgr.save(newSettings);
    
    // Apply changes
    composer.setResolution(newSettings.resolutionBase);
    updatePlatformIndicators();
    
    // Refresh audio settings if context active
    if (audioContext) {
      setupMicSource();
    }

    // Reconnect to Twitch chat with new credentials if updated
    connectTwitchChat();

    settingsModal.classList.add('hidden');
  });

  function updatePlatformIndicators() {
    const settings = settingsMgr.get();
    
    const toggleInd = (id, active) => {
      const el = document.getElementById(id);
      if (active) el.classList.add('active');
      else el.classList.remove('active');
    };
    
    toggleInd('ind-twitch', settings.twitchEnabled && settings.twitchKey);
    toggleInd('ind-youtube', settings.youtubeEnabled && settings.youtubeKey);
    toggleInd('ind-kick', settings.kickEnabled && settings.kickKey);
  }

  // --- LIVE BROADCAST & RECORDING SYSTEM (FFMPEG & MEDIARECORDER) ---

  const btnStream = document.getElementById('btn-toggle-stream');
  const btnRecord = document.getElementById('btn-toggle-record');
  
  const indicator = document.getElementById('status-indicator');
  const valText = document.getElementById('status-val');
  const timeText = document.getElementById('stat-time');
  const fpsText = document.getElementById('stat-fps');
  const bitrateText = document.getElementById('stat-bitrate');
  const cpuText = document.getElementById('stat-cpu');
  const droppedText = document.getElementById('stat-dropped');

  // GO LIVE
  btnStream.addEventListener('click', async () => {
    if (isStreaming) {
      // STOP STREAMING
      console.log('Stopping live broadcast...');
      if (window.electronAPI && window.electronAPI.stopStream) {
        window.electronAPI.stopStream();
      }
    } else {
      // START STREAMING
      const settings = settingsMgr.get();
      
      // Validation keys
      if (!settings.twitchEnabled && !settings.youtubeEnabled && !settings.kickEnabled) {
        alert('Por favor, activa al menos una plataforma de transmisión en el menú de Configuración.');
        return;
      }
      
      await initAudio(); // Make sure audio mixer is live
      
      console.log('Initiating live broadcast...');
      btnStream.disabled = true;
      btnStream.textContent = 'Iniciando...';
      
      // Detect supported recorder codec
      activeRecorderMime = 'video/webm;codecs=vp8,opus';
      let inputCodec = 'vp8';
      
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')) {
          activeRecorderMime = 'video/webm;codecs=h264,opus';
          inputCodec = 'h264';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
          activeRecorderMime = 'video/webm;codecs=h264';
          inputCodec = 'h264';
        }
      }
      
      settings.inputCodec = inputCodec;
      settings.recorderMime = activeRecorderMime;
      
      if (window.electronAPI && window.electronAPI.startStream) {
        window.electronAPI.startStream(settings);
      }
    }
  });

  // Handle IPC streaming status response
  if (window.electronAPI && window.electronAPI.onStreamStatus) {
    window.electronAPI.onStreamStatus((status) => {
      btnStream.disabled = false;
      
      if (status.active) {
        // STREAM STARTED
        isStreaming = true;
        btnStream.innerHTML = '<i data-lucide="square"></i> Detener Emisión';
        btnStream.classList.remove('btn-danger');
        btnStream.classList.add('btn-primary');
        
        indicator.className = 'status-indicator live';
        valText.textContent = 'LIVE';
        valText.style.color = 'var(--color-danger)';
        
        // Start streaming logic (MediaRecorder $\rightarrow$ main.js $\rightarrow$ FFmpeg)
        startFFmpegStreamPipeline();
        
        // Start timers
        streamSeconds = 0;
        streamTimer = setInterval(() => {
          streamSeconds++;
          const hrs = String(Math.floor(streamSeconds / 3600)).padStart(2, '0');
          const mins = String(Math.floor((streamSeconds % 3600) / 60)).padStart(2, '0');
          const secs = String(streamSeconds % 60).padStart(2, '0');
          timeText.textContent = `${hrs}:${mins}:${secs}`;
        }, 1000);
        
        // Start simulated stats
        simulatedCpu = 12 + Math.floor(Math.random() * 8);
        statsTimer = setInterval(() => {
          simulatedCpu = 10 + Math.floor(Math.random() * 12);
          if (Math.random() > 0.98) {
            simulatedDropped += Math.floor(Math.random() * 4);
          }
          cpuText.textContent = `${simulatedCpu}%`;
          droppedText.textContent = `${simulatedDropped} (0.0%)`;
        }, 2000);
        
        chatSim.addMessage('system', 'Emisión', '¡Transmisión iniciada exitosamente en las plataformas seleccionadas!');
        
      } else {
        // STREAM STOPPED / FAILED
        isStreaming = false;
        btnStream.innerHTML = '<i data-lucide="play"></i> Iniciar Transmisión';
        btnStream.classList.add('btn-danger');
        btnStream.classList.remove('btn-primary');
        
        indicator.className = 'status-indicator offline';
        valText.textContent = 'OFFLINE';
        valText.style.color = '';
        
        stopFFmpegStreamPipeline();
        
        // Stop timers
        clearInterval(streamTimer);
        clearInterval(statsTimer);
        timeText.textContent = '00:00:00';
        fpsText.textContent = '0.0';
        bitrateText.textContent = '0 Kbps';
        cpuText.textContent = '0%';
        
        if (status.error) {
          alert('Error de Emisión: ' + status.error);
          chatSim.addMessage('system', 'Error Stream', status.error);
        } else {
          chatSim.addMessage('system', 'Emisión', 'Transmisión detenida correctamente.');
        }
      }
      lucide.createIcons();
    });
  }

  // Handle FFmpeg live stats
  if (window.electronAPI && window.electronAPI.onStreamStats) {
    window.electronAPI.onStreamStats((stats) => {
      if (isStreaming) {
        fpsText.textContent = stats.fps.toFixed(1);
        bitrateText.textContent = stats.bitrate;
      }
    });
  }

  // Pipestream chunks to main process
  function startFFmpegStreamPipeline() {
    const settings = settingsMgr.get();
    
    // Create recorder stream mixing canvas video and audio mixer destination
    const videoTrack = composer.getLiveCanvasStream(settings.fps).getVideoTracks()[0];
    
    const streamTracks = [videoTrack];
    
    // Use the single mixed audio track from the Web Audio destination node!
    // This node contains: Microphone (with volume control), custom audio channels, and TTS chatbot audio!
    let mixedAudioTrack = null;
    if (streamAudioDestination && streamAudioDestination.stream && streamAudioDestination.stream.getAudioTracks().length > 0) {
      mixedAudioTrack = streamAudioDestination.stream.getAudioTracks()[0];
    } else if (micActiveStream && micActiveStream.getAudioTracks().length > 0 && !isMicMuted) {
      mixedAudioTrack = micActiveStream.getAudioTracks()[0];
    }
    
    if (mixedAudioTrack) {
      streamTracks.push(mixedAudioTrack);
    }
    
    recorderStream = new MediaStream(streamTracks);
    
    try {
      // Use dynamic mimeType depending on hardware detection (supports H.264 or falls back to VP8)
      const options = {
        mimeType: activeRecorderMime,
        videoBitsPerSecond: settings.videoBitrate * 1000,
        audioBitsPerSecond: settings.audioBitrate * 1000
      };
      
      streamMediaRecorder = new MediaRecorder(recorderStream, options);
      
      streamMediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0 && isStreaming) {
          // Convert Blob to ArrayBuffer
          const buffer = await e.data.arrayBuffer();
          // Send to main process via IPC
          if (window.electronAPI && window.electronAPI.sendChunk) {
            window.electronAPI.sendChunk(buffer);
          }
        }
      };
      
      // Deliver chunks every 100ms for continuous streaming pipeline
      streamMediaRecorder.start(100);
      console.log('MediaRecorder streaming pipeline started!');
      
    } catch (err) {
      console.error('Error starting MediaRecorder pipeline:', err);
      alert('Error en tubería de streaming: ' + err.message);
      if (window.electronAPI && window.electronAPI.stopStream) {
        window.electronAPI.stopStream();
      }
    }
  }

  function stopFFmpegStreamPipeline() {
    if (streamMediaRecorder && streamMediaRecorder.state !== 'inactive') {
      streamMediaRecorder.stop();
    }
    streamMediaRecorder = null;
    recorderStream = null;
  }

  // LOCAL RECORDING
  btnRecord.addEventListener('click', async () => {
    if (isRecording) {
      // STOP RECORDING
      isRecording = false;
      btnRecord.innerHTML = '<i data-lucide="video"></i> Iniciar Grabación';
      btnRecord.classList.remove('btn-primary');
      btnRecord.classList.add('btn-outline');
      
      document.getElementById('rec-dot').classList.add('hidden');
      document.getElementById('rec-text').classList.add('hidden');
      
      if (localMediaRecorder) {
        localMediaRecorder.stop();
      }
      
      chatSim.addMessage('system', 'Grabación', 'Grabación local guardada exitosamente.');
      
    } else {
      // START RECORDING
      await initAudio();
      
      const settings = settingsMgr.get();
      
      recordedChunks = [];
      isRecording = true;
      
      btnRecord.innerHTML = '<i data-lucide="square"></i> Detener Grabación';
      btnRecord.classList.add('btn-primary');
      btnRecord.classList.remove('btn-outline');
      
      document.getElementById('rec-dot').classList.remove('hidden');
      document.getElementById('rec-text').classList.remove('hidden');
      
      // Combine canvas video track + mixed audio track
      const videoTrack = composer.getLiveCanvasStream(settings.fps).getVideoTracks()[0];
      const tracks = [videoTrack];
      
      let mixedAudioTrack = null;
      if (streamAudioDestination && streamAudioDestination.stream && streamAudioDestination.stream.getAudioTracks().length > 0) {
        mixedAudioTrack = streamAudioDestination.stream.getAudioTracks()[0];
      } else if (micActiveStream && micActiveStream.getAudioTracks().length > 0 && !isMicMuted) {
        mixedAudioTrack = micActiveStream.getAudioTracks()[0];
      }
      
      if (mixedAudioTrack) {
        tracks.push(mixedAudioTrack);
      }
      
      const recStream = new MediaStream(tracks);
      
      try {
        localMediaRecorder = new MediaRecorder(recStream, {
          mimeType: 'video/webm;codecs=vp9,opus'
        });
        
        localMediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };
        
        localMediaRecorder.onstop = () => {
          // Download the file locally
          const blob = new Blob(recordedChunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          document.body.appendChild(a);
          a.style = 'display: none';
          a.href = url;
          
          // Format timestamp
          const date = new Date();
          const stamp = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}-${String(date.getMinutes()).padStart(2,'0')}`;
          
          a.download = `StreamStudio_${stamp}.${settings.recordingFormat === 'mp4' ? 'mp4' : 'webm'}`;
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        };
        
        localMediaRecorder.start();
        chatSim.addMessage('system', 'Grabación', 'Grabación local iniciada.');
        
      } catch (err) {
        console.error('Error starting local recording:', err);
        alert('Error en grabación local: ' + err.message);
        isRecording = false;
        btnRecord.innerHTML = '<i data-lucide="video"></i> Iniciar Grabación';
        btnRecord.classList.remove('btn-primary');
        btnRecord.classList.add('btn-outline');
        document.getElementById('rec-dot').classList.add('hidden');
        document.getElementById('rec-text').classList.add('hidden');
      }
    }
    lucide.createIcons();
  });

  // --- MOCK CHAT ACTIONS ---

  const chkSimulate = document.getElementById('chk-simulate-chat');
  chkSimulate.addEventListener('change', () => {
    if (chkSimulate.checked) chatSim.start();
    else chatSim.stop();
  });

  document.getElementById('btn-trigger-alert').addEventListener('click', () => {
    chatSim.triggerAlert();
  });

  const sendBtn = document.getElementById('chat-send-btn');
  const chatInput = document.getElementById('chat-input-msg');
  const chatPlatform = document.getElementById('chat-platform-select');

  const sendMessage = () => {
    const msg = chatInput.value.trim();
    if (msg) {
      const settings = settingsMgr.get();
      if (chatPlatform.value === 'twitch' && settings.twitchChannel && settings.twitchOAuth) {
        sendTwitchChatMessage(msg);
      } else {
        chatSim.addMessage(chatPlatform.value, 'Tú (Prueba)', msg);
      }
      
      // Allow testing TTS locally via the input box
      handleIncomingTTSCommand('Tú (Prueba)', msg);
      
      chatInput.value = '';
    }
  };

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Platform filters
  document.querySelectorAll('.chat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const filter = btn.getAttribute('data-filter');
      const messages = document.getElementById('chat-messages-container').children;
      
      for (const msg of messages) {
        if (filter === 'all') {
          msg.classList.remove('hidden');
        } else {
          if (msg.classList.contains(filter)) {
            msg.classList.remove('hidden');
          } else {
            msg.classList.add('hidden');
          }
        }
      }
    });
  });

  // --- TWITCH LIVE CHAT & API INTEGRATION ---
  
  
  function connectTwitchChat() {
    if (twitchWS) {
      try { twitchWS.close(); } catch(e){}
      twitchWS = null;
    }
    
    const settings = settingsMgr.get();
    const channel = settings.twitchChannel ? settings.twitchChannel.trim().toLowerCase() : '';
    if (!channel) {
      console.log('No Twitch Channel Name configured for live chat.');
      return;
    }
    
    const token = settings.twitchOAuth ? settings.twitchOAuth.trim() : '';
    
    console.log(`Connecting to Twitch Chat for channel: ${channel}...`);
    chatSim.addMessage('system', 'Twitch Chat', `Conectando al chat de Twitch (#${channel})...`);
    
    try {
      twitchWS = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      
      twitchWS.onopen = () => {
        console.log('Twitch Chat WebSocket connected.');
        if (token) {
          const oauthPass = token.startsWith('oauth:') ? token : 'oauth:' + token;
          twitchWS.send(`PASS ${oauthPass}`);
          twitchWS.send(`NICK ${channel}`);
        } else {
          const randomNum = Math.floor(Math.random() * 1000000);
          twitchWS.send('PASS justinfan');
          twitchWS.send(`NICK justinfan${randomNum}`);
        }
        twitchWS.send(`JOIN #${channel}`);
      };
      
      twitchWS.onmessage = (event) => {
        const raw = event.data;
        if (raw.includes('PRIVMSG')) {
          const match = raw.match(/:([^!]+)![^@]+@[^\s]+\s+PRIVMSG\s+#[^\s]+\s+:(.*)/);
          if (match) {
            const username = match[1];
            const message = match[2].trim();
            chatSim.addMessage('twitch', username, message);
            
            // Check for TTS commands
            handleIncomingTTSCommand(username, message);
          }
        } else if (raw.includes('PING')) {
          twitchWS.send('PONG :tmi.twitch.tv');
        } else if (raw.includes('366')) {
          chatSim.addMessage('system', 'Twitch Chat', `¡Conectado exitosamente al chat en vivo de #${channel}!`);
        }
      };
      
      twitchWS.onclose = (event) => {
        console.log('Twitch Chat WebSocket closed.', event.reason);
        if (isStreaming) {
          setTimeout(connectTwitchChat, 5000); // Auto reconnect if live
        }
      };
      
      twitchWS.onerror = (err) => {
        console.error('Twitch Chat WebSocket error:', err);
      };
    } catch(e) {
      console.error('Error establishing Twitch Chat WS:', e);
    }
  }
  
  function sendTwitchChatMessage(messageText) {
    if (!twitchWS || twitchWS.readyState !== WebSocket.OPEN) {
      alert('El chat de Twitch no está conectado.');
      return;
    }
    const settings = settingsMgr.get();
    const channel = settings.twitchChannel ? settings.twitchChannel.trim().toLowerCase() : '';
    const token = settings.twitchOAuth ? settings.twitchOAuth.trim() : '';
    if (!token) {
      alert('Debes ingresar tu Token de OAuth en la configuración para poder enviar mensajes al chat desde la aplicación.');
      return;
    }
    twitchWS.send(`PRIVMSG #${channel} :${messageText}`);
    chatSim.addMessage('twitch', channel, messageText);
  }

  function handleIncomingTTSCommand(username, message) {
    const match = message.match(/^!(s|tts)\s+(.+)/i);
    if (!match) return;
    
    const ttsText = match[2].trim();
    if (!ttsText) return;
    
    console.log(`Triggering TTS Alert: [${username}] -> ${ttsText}`);
    
    // 1. Show visual alert on the live stream canvas
    composer.triggerTTSAlert(username, ttsText);
    
    // 2. Play TTS audio using Google Translate TTS API, routed digitally to the mixer!
    try {
      // Google Translate TTS is free, fast, and high quality
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(username + ' dice: ' + ttsText)}`;
      const audio = new Audio(ttsUrl);
      audio.crossOrigin = 'anonymous'; // Set CORS to allow routing through Web Audio API
      
      // Make sure we have an initialized AudioContext
      initAudio().then(() => {
        if (audioContext) {
          // Create the Web Audio source node for the HTML5 audio element
          const sourceNode = audioContext.createMediaElementSource(audio);
          
          // Connect to the speakers (so the streamer hears it)
          sourceNode.connect(audioContext.destination);
          
          // Connect to the stream mixer (so Twitch / the stream hears it digitally!)
          if (streamAudioDestination) {
            sourceNode.connect(streamAudioDestination);
          }
        }
        
        // Play the audio!
        audio.play().catch(e => {
          console.error('Error playing TTS audio via Web Audio:', e);
          
          // Fallback: If Web Audio routing fails (e.g. CORS), play it standard so they still hear it
          const fallbackAudio = new Audio(ttsUrl);
          fallbackAudio.play().catch(err => console.error('Fallback TTS play failed:', err));
        });
      });
      
    } catch (err) {
      console.error('Error in digital TTS routing:', err);
    }
  }

  async function updateTwitchStreamInfo(title, gameName) {
    const settings = settingsMgr.get();
    const token = settings.twitchOAuth ? settings.twitchOAuth.trim() : '';
    const channel = settings.twitchChannel ? settings.twitchChannel.trim().toLowerCase() : '';
    
    if (!token || !channel) {
      alert('Por favor, configura tu Nombre de Canal y Token de OAuth en la Configuración para poder actualizar el directo.');
      return;
    }
    
    const cleanToken = token.replace(/^oauth:/i, '');
    const clientId = 'gp762nuuoqcoxypju8c569th9wz7q5'; // Standard Client ID for TwitchApps
    
    try {
      chatSim.addMessage('system', 'Twitch API', 'Buscando ID de usuario en Twitch...');
      
      const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Client-Id': clientId
        }
      });
      
      if (!userRes.ok) {
        const errorData = await userRes.json();
        throw new Error(errorData.message || 'Error al obtener ID de usuario');
      }
      
      const userData = await userRes.json();
      if (!userData.data || userData.data.length === 0) {
        throw new Error('No se encontró el canal de Twitch especificado.');
      }
      
      const broadcasterId = userData.data[0].id;
      let gameId = '';
      
      if (gameName) {
        chatSim.addMessage('system', 'Twitch API', `Buscando ID de categoría para "${gameName}"...`);
        const gameRes = await fetch(`https://api.twitch.tv/helix/games?name=${encodeURIComponent(gameName)}`, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Client-Id': clientId
          }
        });
        
        if (gameRes.ok) {
          const gameData = await gameRes.json();
          if (gameData.data && gameData.data.length > 0) {
            gameId = gameData.data[0].id;
          } else {
            chatSim.addMessage('system', 'Advertencia', `No se encontró la categoría "${gameName}". Solo se actualizará el título.`);
          }
        }
      }
      
      chatSim.addMessage('system', 'Twitch API', 'Enviando actualización a Twitch...');
      const updateBody = { title: title };
      if (gameId) {
        updateBody.game_id = gameId;
      }
      
      const updateRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Client-Id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateBody)
      });
      
      if (!updateRes.ok) {
        const errorData = await updateRes.json();
        throw new Error(errorData.message || 'Error al actualizar el directo');
      }
      
      chatSim.addMessage('system', 'Twitch API', '¡Información del directo actualizada en Twitch con éxito!');
      alert('¡Información del directo actualizada en Twitch con éxito!');
      
    } catch(err) {
      console.error('Error updating Twitch stream info:', err);
      chatSim.addMessage('system', 'Error Twitch API', err.message);
      alert('Error de Twitch API: ' + err.message);
    }
  }

  async function fetchTwitchCurrentInfo() {
    const settings = settingsMgr.get();
    const token = settings.twitchOAuth ? settings.twitchOAuth.trim() : '';
    const channel = settings.twitchChannel ? settings.twitchChannel.trim().toLowerCase() : '';
    
    if (!token || !channel) return;
    
    const cleanToken = token.replace(/^oauth:/i, '');
    const clientId = 'gp762nuuoqcoxypju8c569th9wz7q5';
    
    try {
      const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Client-Id': clientId
        }
      });
      
      if (!userRes.ok) return;
      const userData = await userRes.json();
      if (!userData.data || userData.data.length === 0) return;
      const broadcasterId = userData.data[0].id;
      
      const channelRes = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Client-Id': clientId
        }
      });
      
      if (!channelRes.ok) return;
      const channelData = await channelRes.json();
      if (channelData.data && channelData.data.length > 0) {
        const info = channelData.data[0];
        document.getElementById('input-stream-title').value = info.title || '';
        document.getElementById('input-stream-game').value = info.game_name || '';
      }
    } catch(e) {
      console.error('Error fetching stream info:', e);
    }
  }

  // --- EDIT STREAM MODAL HANDLERS ---
  const editStreamModal = document.getElementById('edit-stream-modal');
  
  document.getElementById('btn-open-edit-stream').addEventListener('click', () => {
    const settings = settingsMgr.get();
    if (!settings.twitchChannel) {
      alert('Por favor, primero configura tu Nombre de Canal de Twitch en la Configuración.');
      document.getElementById('btn-open-settings').click();
      return;
    }
    fetchTwitchCurrentInfo();
    editStreamModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-edit-stream-modal').addEventListener('click', () => {
    editStreamModal.classList.add('hidden');
  });

  document.getElementById('btn-cancel-edit-stream').addEventListener('click', () => {
    editStreamModal.classList.add('hidden');
  });

  document.getElementById('btn-submit-edit-stream').addEventListener('click', async () => {
    const title = document.getElementById('input-stream-title').value.trim();
    const game = document.getElementById('input-stream-game').value.trim();
    
    if (!title) {
      alert('El título del directo no puede estar vacío.');
      return;
    }
    
    document.getElementById('btn-submit-edit-stream').disabled = true;
    document.getElementById('btn-submit-edit-stream').textContent = 'Actualizando...';
    
    await updateTwitchStreamInfo(title, game);
    
    document.getElementById('btn-submit-edit-stream').disabled = false;
    document.getElementById('btn-submit-edit-stream').textContent = 'Actualizar en Twitch';
    editStreamModal.classList.add('hidden');
  });

  // --- ATASJOS DE TECLADO (HOTKEYS) ---

  // Capture hotkeys in Settings Tab
  document.querySelectorAll('.hotkey-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      
      // Ignore alone modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      
      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      keys.push(e.key.toUpperCase());
      
      input.value = keys.join(' + ');
    });
  });

  // Global keydown listeners for hotkeys
  window.addEventListener('keydown', (e) => {
    // If inside a text input, don't trigger hotkeys
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const settings = settingsMgr.get();
    
    // Construct current press combo
    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');
    keys.push(e.key.toUpperCase());
    const combo = keys.join(' + ');
    
    // Check mapping
    const hkStart = document.getElementById('hk-start-stream').value;
    const hkStop = document.getElementById('hk-stop-stream').value;
    const hkScene1 = document.getElementById('hk-scene-1').value;
    const hkScene2 = document.getElementById('hk-scene-2').value;
    const hkMute = document.getElementById('hk-mute-mic').value;

    if (combo && combo === hkStart && !isStreaming) {
      btnStream.click();
    } else if (combo && combo === hkStop && isStreaming) {
      btnStream.click();
    } else if (combo && combo === hkMute) {
      document.getElementById('mute-mic').click();
    } else if (combo && combo === hkScene1 && composer.scenes.length > 0) {
      // Switch to first scene
      const listEl = document.getElementById('scenes-list').children[0];
      if (listEl) listEl.click();
    } else if (combo && combo === hkScene2 && composer.scenes.length > 1) {
      // Switch to second scene
      const listEl = document.getElementById('scenes-list').children[1];
      if (listEl) listEl.click();
    }
  });

  // Helper utility
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // --- AUTO-CONFIGURATION WIZARD LOGIC ---
  const wizardModal = document.getElementById('wizard-modal');
  const wizardSteps = document.querySelectorAll('.wizard-step');
  let currentWizardStep = 1;
  let hwInfo = null;

  function showWizardStep(stepNum) {
    wizardSteps.forEach(step => step.classList.add('hidden'));
    document.getElementById(`wizard-step-${stepNum}`).classList.remove('hidden');
    currentWizardStep = stepNum;
  }

  // Welcome step (Next)
  document.getElementById('btn-wizard-next-1').addEventListener('click', () => {
    showWizardStep(2);
  });

  // Target settings step (Back)
  document.getElementById('btn-wizard-back-2').addEventListener('click', () => {
    showWizardStep(1);
  });

  // Target settings step (Next -> Start Analysis)
  document.getElementById('btn-wizard-next-2').addEventListener('click', async () => {
    showWizardStep(3);
    runHardwareAnalysis();
  });

  // Close wizard modal button
  document.getElementById('btn-close-wizard').addEventListener('click', () => {
    wizardModal.classList.add('hidden');
  });

  // Detect GPU via WebGL (instant & reliable)
  function detectGPU() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Desconocida';
      }
    }
    return 'Grafica integrada genérica';
  }

  async function runHardwareAnalysis() {
    const logEl = document.getElementById('wizard-log-terminal');
    const progressEl = document.getElementById('wizard-progress-bar');
    const statusText = document.getElementById('wizard-status-text');
    
    logEl.innerHTML = '';
    
    const addLog = (text) => {
      const p = document.createElement('div');
      p.textContent = `> ${text}`;
      logEl.appendChild(p);
      logEl.scrollTop = logEl.scrollHeight;
    };

    // 10% Progress
    progressEl.style.width = '10%';
    statusText.textContent = 'Analizando procesador y memoria RAM...';
    addLog('Obteniendo información del Sistema Operativo...');
    
    // Call Electron IPC for system specs
    let systemSpecs = { platform: 'Windows', release: '10', arch: 'x64', cpu: 'Intel/AMD', cores: 4, ram: 8 };
    if (window.electronAPI && window.electronAPI.getHardwareInfo) {
      try {
        systemSpecs = await window.electronAPI.getHardwareInfo();
      } catch(e) {
        console.error('Error fetching hardware info:', e);
      }
    }

    // 30% Progress
    progressEl.style.width = '30%';
    addLog(`SO: ${systemSpecs.platform} ${systemSpecs.release} (${systemSpecs.arch})`);
    addLog(`CPU: ${systemSpecs.cpu}`);
    addLog(`Núcleos del Procesador: ${systemSpecs.cores} hilos`);
    addLog(`RAM Total: ${systemSpecs.ram} GB`);
    
    await new Promise(r => setTimeout(r, 600));

    // 50% Progress
    progressEl.style.width = '50%';
    statusText.textContent = 'Analizando aceleración de hardware por GPU...';
    addLog('Analizando tarjetas gráficas activas en WebGL...');
    const gpuString = detectGPU();
    addLog(`GPU: ${gpuString}`);
    
    // Determine GPU Vendor
    let gpuVendor = 'intel';
    if (gpuString.toLowerCase().includes('nvidia')) {
      gpuVendor = 'nvidia';
    } else if (gpuString.toLowerCase().includes('amd') || gpuString.toLowerCase().includes('radeon')) {
      gpuVendor = 'amd';
    }
    addLog(`Fabricante de GPU identificado: ${gpuVendor.toUpperCase()}`);

    await new Promise(r => setTimeout(r, 600));

    // 70% Progress
    progressEl.style.width = '70%';
    statusText.textContent = 'Evaluando conectividad de red y codificadores...';
    addLog('Comprobando codificadores H.264 disponibles...');
    if (gpuVendor === 'nvidia') {
      addLog('Codificador NVENC H.264 (NVIDIA) disponible.');
    } else if (gpuVendor === 'amd') {
      addLog('Codificador AMF H.264 (AMD) disponible.');
    } else {
      addLog('No se detectó GPU dedicada. Usando codificador x264 por Software.');
    }

    await new Promise(r => setTimeout(r, 600));

    // 90% Progress
    progressEl.style.width = '90%';
    statusText.textContent = 'Calculando perfiles de rendimiento óptimos...';
    addLog('Generando configuraciones ideales para transmisión...');
    
    // Formulate optimized parameters
    const goal = document.querySelector('input[name="wizard-goal"]:checked').value;
    const resolution = document.getElementById('wizard-resolution').value;
    const fpsOption = document.getElementById('wizard-fps').value;
    const uploadSpeed = document.getElementById('wizard-upload').value;

    let optimalEncoder = 'libx264';
    if (gpuVendor === 'nvidia') {
      optimalEncoder = 'h264_nvenc';
    } else if (gpuVendor === 'amd') {
      optimalEncoder = 'h264_amf';
    }

    let optimalResolution = resolution;
    let optimalFps = 30;

    // FPS logic
    if (fpsOption === '60-30') {
      if (systemSpecs.cores >= 6 || gpuVendor !== 'intel') {
        optimalFps = 60;
      } else {
        optimalFps = 30;
      }
    } else {
      optimalFps = 30;
    }

    // Bitrate logic based on goal, upload and resolution
    let optimalBitrate = 4000;
    if (goal === 'record') {
      optimalBitrate = optimalResolution === '1920x1080' ? 10000 : 7000;
    } else {
      if (uploadSpeed === 'high') {
        optimalBitrate = optimalResolution === '1920x1080' ? 6000 : 4500;
      } else if (uploadSpeed === 'medium') {
        optimalBitrate = optimalResolution === '1920x1080' ? 4000 : 3500;
        if (optimalResolution === '1920x1080' && optimalFps === 60) {
          optimalFps = 30;
        }
      } else {
        optimalResolution = '1280x720';
        optimalFps = 30;
        optimalBitrate = 2500;
      }
    }

    await new Promise(r => setTimeout(r, 600));

    // 100% Progress
    progressEl.style.width = '100%';
    
    hwInfo = {
      encoder: optimalEncoder,
      bitrate: optimalBitrate,
      resolution: optimalResolution,
      fps: optimalFps,
      hardwareText: `${systemSpecs.cpu} | ${systemSpecs.cores} Cores | ${systemSpecs.ram}GB RAM | ${gpuString.split(',')[0].replace('ANGLE (', '')}`
    };

    document.getElementById('res-encoder').textContent = optimalEncoder === 'h264_nvenc' ? 'Hardware NVIDIA (NVENC)' : (optimalEncoder === 'h264_amf' ? 'Hardware AMD (AMF)' : 'Software (x264)');
    document.getElementById('res-bitrate').textContent = `${optimalBitrate} Kbps`;
    document.getElementById('res-resolution').textContent = optimalResolution;
    document.getElementById('res-fps').textContent = `${optimalFps} FPS`;
    document.getElementById('wizard-detected-hw').textContent = hwInfo.hardwareText;

    showWizardStep(4);
  }

  // Apply wizard settings to forms and save
  document.getElementById('btn-wizard-apply').addEventListener('click', () => {
    if (hwInfo) {
      document.getElementById('opt-video-encoder').value = hwInfo.encoder;
      document.getElementById('input-video-bitrate').value = hwInfo.bitrate;
      document.getElementById('opt-resolution-base').value = hwInfo.resolution;
      document.getElementById('opt-resolution-output').value = hwInfo.resolution;
      document.getElementById('opt-video-fps').value = hwInfo.fps;
      
      // Save settings to LocalStorage using the standard settingsMgr functions
      const newSettings = settingsMgr.readForm();
      settingsMgr.save(newSettings);
      localStorage.setItem('streamstudio_wizard_completed', 'true');
      
      wizardModal.classList.add('hidden');
      chatSim.addMessage('system', 'Asistente', '¡Configuración del sistema optimizada y aplicada con éxito!');
      
      composer.setResolution(hwInfo.resolution);
      updatePlatformIndicators(); // Sync UI header platform state
    }
  });

  // Trigger wizard manually from settings sidebar
  document.getElementById('btn-run-wizard').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
    showWizardStep(1);
    wizardModal.classList.remove('hidden');
  });

  // Auto-run wizard on very first launch
  if (!localStorage.getItem('streamstudio_wizard_completed')) {
    setTimeout(() => {
      showWizardStep(1);
      wizardModal.classList.remove('hidden');
    }, 1000);
  }
});
