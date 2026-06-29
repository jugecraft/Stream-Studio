// StreamStudio Live Canvas Composer and Scene Mixer

class CanvasComposer {
  constructor(liveCanvasId, previewCanvasId, baseResolution = '1920x1080') {
    this.liveCanvas = document.getElementById(liveCanvasId);
    this.previewCanvas = document.getElementById(previewCanvasId);
    
    this.liveCtx = this.liveCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;
    
    this.scenes = [];
    this.activeSceneId = null;
    this.selectedSourceId = null;
    
    // Drag and resize state
    this.isDragging = false;
    this.isResizing = false;
    this.resizeHandle = null; // 'tl', 'tr', 'bl', 'br'
    this.dragStart = { x: 0, y: 0 };
    this.sourceStart = { x: 0, y: 0, w: 0, h: 0 };
    
    // Transition state
    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.transitionDuration = 300; // ms
    this.transitionType = 'fade'; // 'cut' | 'fade'
    this.transitionStartTime = 0;
    
    // Offscreen canvas for transitions
    this.transitionCanvas = document.createElement('canvas');
    this.transitionCtx = this.transitionCanvas.getContext('2d');
    
    // Set initial resolution (now that transitionCanvas is initialized)
    this.setResolution(baseResolution);
    
    // Active streams/resources cache
    this.resources = {}; // Map of sourceId -> Image/Video HTML Elements
    
    // TTS Alert Overlay State
    this.ttsAlert = null;
    
    this.setupMouseEvents();
    this.startLoop();
  }

  setResolution(resolutionStr) {
    const [w, h] = resolutionStr.split('x').map(Number);
    this.width = w || 1920;
    this.height = h || 1080;
    
    this.liveCanvas.width = this.width;
    this.liveCanvas.height = this.height;
    
    if (this.previewCanvas) {
      this.previewCanvas.width = this.width;
      this.previewCanvas.height = this.height;
    }
    
    this.transitionCanvas.width = this.width;
    this.transitionCanvas.height = this.height;
  }

  getLiveCanvasStream(fps = 60) {
    return this.liveCanvas.captureStream(fps);
  }

  // Add a scene
  addScene(name) {
    const scene = {
      id: 'scene_' + Math.random().toString(36).substr(2, 9),
      name: name,
      sources: []
    };
    this.scenes.push(scene);
    if (!this.activeSceneId) {
      this.activeSceneId = scene.id;
    }
    return scene;
  }

  removeScene(sceneId) {
    const index = this.scenes.findIndex(s => s.id === sceneId);
    if (index !== -1) {
      // Clean up sources media
      this.scenes[index].sources.forEach(src => this.deleteSourceMedia(src.id));
      this.scenes.splice(index, 1);
      
      if (this.activeSceneId === sceneId) {
        this.activeSceneId = this.scenes.length > 0 ? this.scenes[0].id : null;
      }
    }
  }

  getActiveScene() {
    return this.scenes.find(s => s.id === this.activeSceneId);
  }

  getSceneById(sceneId) {
    return this.scenes.find(s => s.id === sceneId);
  }

  // Sources management
  addSource(sceneId, name, type, properties = {}) {
    const scene = this.getSceneById(sceneId);
    if (!scene) return null;

    // Default positioning in middle of canvas
    let w = 400;
    let h = 300;
    
    if (type === 'text') {
      w = 600;
      h = 100;
    } else if (type === 'color') {
      w = this.width;
      h = this.height;
    }

    const source = {
      id: 'source_' + Math.random().toString(36).substr(2, 9),
      name: name,
      type: type,
      visible: true,
      locked: false,
      x: type === 'color' ? 0 : (this.width - w) / 2,
      y: type === 'color' ? 0 : (this.height - h) / 2,
      width: w,
      height: h,
      opacity: 1.0,
      z: scene.sources.length, // bottom layer initially or top
      properties: {
        // Source specific properties
        color: '#1f1f2b',
        color2: '', // For gradient
        gradientType: 'linear',
        textContent: 'Texto de Prueba',
        fontSize: 48,
        fontFamily: 'Inter',
        fontColor: '#ffffff',
        fontWeight: 'bold',
        imgUrl: '',
        streamId: '', // For video capture reference
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
        ...properties
      }
    };

    scene.sources.push(source);
    // Sort by z-index
    this.sortSources(scene);
    
    this.selectedSourceId = source.id;
    return source;
  }

  deleteSource(sceneId, sourceId) {
    const scene = this.getSceneById(sceneId);
    if (!scene) return;
    
    const index = scene.sources.findIndex(s => s.id === sourceId);
    if (index !== -1) {
      scene.sources.splice(index, 1);
      this.deleteSourceMedia(sourceId);
      this.sortSources(scene);
      
      if (this.selectedSourceId === sourceId) {
        this.selectedSourceId = null;
      }
    }
  }

  deleteSourceMedia(sourceId) {
    if (this.resources[sourceId]) {
      const res = this.resources[sourceId];
      if (res instanceof HTMLVideoElement) {
        res.pause();
        if (res.srcObject) {
          res.srcObject.getTracks().forEach(track => track.stop());
        }
      }
      delete this.resources[sourceId];
    }
  }

  sortSources(scene) {
    scene.sources.sort((a, b) => a.z - b.z);
    // Re-assign Z to be clean indices
    scene.sources.forEach((s, idx) => s.z = idx);
  }

  moveSourceZ(sceneId, sourceId, direction) {
    const scene = this.getSceneById(sceneId);
    if (!scene) return;
    
    const idx = scene.sources.findIndex(s => s.id === sourceId);
    if (idx === -1) return;
    
    if (direction === 'up' && idx < scene.sources.length - 1) {
      // Swap z with next source
      const temp = scene.sources[idx].z;
      scene.sources[idx].z = scene.sources[idx + 1].z;
      scene.sources[idx + 1].z = temp;
    } else if (direction === 'down' && idx > 0) {
      // Swap z with previous source
      const temp = scene.sources[idx].z;
      scene.sources[idx].z = scene.sources[idx - 1].z;
      scene.sources[idx - 1].z = temp;
    }
    
    this.sortSources(scene);
  }

  // Set visual elements media bindings
  setSourceMedia(sourceId, htmlElement) {
    this.resources[sourceId] = htmlElement;
  }

  // Draw a specific source
  drawSource(ctx, source) {
    if (!source.visible || source.opacity === 0) return;
    
    ctx.save();
    ctx.globalAlpha = source.opacity;
    
    const rx = source.x;
    const ry = source.y;
    const rw = source.width;
    const rh = source.height;
    
    switch (source.type) {
      case 'color':
        if (source.properties.color2) {
          // Gradient
          let grad;
          if (source.properties.gradientType === 'radial') {
            grad = ctx.createRadialGradient(rx + rw/2, ry + rh/2, 10, rx + rw/2, ry + rh/2, Math.max(rw, rh)/2);
          } else {
            grad = ctx.createLinearGradient(rx, ry, rx + rw, ry + rh);
          }
          grad.addColorStop(0, source.properties.color);
          grad.addColorStop(1, source.properties.color2);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = source.properties.color;
        }
        ctx.fillRect(rx, ry, rw, rh);
        break;
        
      case 'text':
        ctx.fillStyle = source.properties.fontColor;
        ctx.font = `${source.properties.fontWeight} ${source.properties.fontSize}px ${source.properties.fontFamily}`;
        ctx.textBaseline = 'top';
        // Wrap text
        this.wrapText(ctx, source.properties.textContent, rx, ry, rw, source.properties.fontSize * 1.2);
        break;
        
      case 'image':
      case 'web':
        const img = this.resources[source.id];
        if (img && (img.complete || img.readyState >= 2)) {
          ctx.drawImage(img, rx, ry, rw, rh);
        } else {
          // Draw placeholder
          ctx.fillStyle = '#1e1e24';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#3e3e4a';
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = '#6e6e7a';
          ctx.font = '14px Inter';
          ctx.fillText(`Cargando ${source.type === 'web' ? 'Web Overlay' : 'Imagen'}: ${source.name}`, rx + 10, ry + 10);
        }
        break;
        
      case 'camera':
      case 'screen':
      case 'video':
        const video = this.resources[source.id];
        if (video && video.readyState >= video.HAVE_CURRENT_DATA) {
          ctx.drawImage(video, rx, ry, rw, rh);
        } else {
          // Draw device placeholder
          ctx.fillStyle = '#0f0f13';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#2a2a35';
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = '#8d8d9f';
          ctx.font = '16px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${source.name} (Cargando...)`, rx + rw/2, ry + rh/2);
        }
        break;
    }
    
    ctx.restore();
  }

  // Draw selection handles on the preview canvas
  drawHandles(ctx, source) {
    if (source.locked) return;
    
    const rx = source.x;
    const ry = source.y;
    const rw = source.width;
    const rh = source.height;
    
    // Outlined border
    ctx.strokeStyle = '#9146ff'; // Twitch purple color accent
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]); // Reset
    
    // Corners square handles (8x8)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#9146ff';
    ctx.lineWidth = 2;
    
    const hs = 8; // handle size
    const handles = [
      { x: rx, y: ry }, // tl
      { x: rx + rw, y: ry }, // tr
      { x: rx, y: ry + rh }, // bl
      { x: rx + rw, y: ry + rh } // br
    ];
    
    handles.forEach(h => {
      ctx.fillRect(h.x - hs/2, h.y - hs/2, hs, hs);
      ctx.strokeRect(h.x - hs/2, h.y - hs/2, hs, hs);
    });
  }

  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    
    for (let n = 0; n < words.length; n++) {
      let testLine = line + words[n] + ' ';
      let metrics = ctx.measureText(testLine);
      let testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  // Draw full scene to a canvas
  drawScene(ctx, scene, drawUI = false) {
    if (!scene) {
      // Draw idle black/pattern screen
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#101015';
      ctx.font = '24px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STREAMSTUDIO - CONFIGURA TUS ESCENAS', this.width/2, this.height/2);
      return;
    }

    // Draw all sources in order
    scene.sources.forEach(src => {
      this.drawSource(ctx, src);
    });

    // Draw selection handles for editing on preview screen
    if (drawUI && this.selectedSourceId) {
      const selSource = scene.sources.find(s => s.id === this.selectedSourceId);
      if (selSource && selSource.visible) {
        this.drawHandles(ctx, selSource);
      }
    }
  }

  // Perform transition from current live scene to target preview scene
  performTransition(targetSceneId, duration = 300, type = 'fade') {
    if (this.isTransitioning) return;
    
    const currentScene = this.getActiveScene();
    const nextScene = this.getSceneById(targetSceneId);
    
    if (!nextScene) return;
    if (!currentScene || type === 'cut') {
      // Instant switch
      this.activeSceneId = targetSceneId;
      return;
    }

    // Begin fade transition
    this.isTransitioning = true;
    this.transitionType = type;
    this.transitionDuration = duration;
    this.transitionStartTime = performance.now();
    
    // Draw current scene to offscreen canvas to freeze it
    this.transitionCtx.clearRect(0, 0, this.width, this.height);
    this.drawScene(this.transitionCtx, currentScene);
    
    // Instantly switch active ID so new sources render in main loop,
    // but the loop will overlay the fading transition canvas.
    this.activeSceneId = targetSceneId;
  }

  // Mouse handler logic for dragging & resizing
  setupMouseEvents() {
    this.studioMode = false; // Synchronized from renderer.js
    let activeCanvas = null;

    const getCanvasMousePos = (e) => {
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const handleMouseDown = (e) => {
      const isLive = e.currentTarget === this.liveCanvas;
      
      // Ignore live canvas interactions in studio mode
      if (this.studioMode && isLive) return;
      // Ignore preview canvas interactions in standard mode
      if (!this.studioMode && !isLive) return;
      
      const scene = this.getActiveScene();
      if (!scene || this.isTransitioning) return;
      
      activeCanvas = e.currentTarget;
      const mouse = getCanvasMousePos(e);
      
      // Check handles first if a source is selected
      if (this.selectedSourceId) {
        const source = scene.sources.find(s => s.id === this.selectedSourceId);
        if (source && !source.locked && source.visible) {
          const rx = source.x;
          const ry = source.y;
          const rw = source.width;
          const rh = source.height;
          const hs = 10; // Hit handle margin
          
          const handles = {
            tl: { x: rx, y: ry },
            tr: { x: rx + rw, y: ry },
            bl: { x: rx, y: ry + rh },
            br: { x: rx + rw, y: ry + rh }
          };
          
          for (const [key, pos] of Object.entries(handles)) {
            if (Math.abs(mouse.x - pos.x) < hs && Math.abs(mouse.y - pos.y) < hs) {
              this.isResizing = true;
              this.resizeHandle = key;
              this.dragStart = { ...mouse };
              this.sourceStart = { x: source.x, y: source.y, w: source.width, h: source.height };
              e.preventDefault();
              return;
            }
          }
        }
      }

      // Check hit on sources, back-to-front (topmost first)
      const clickedSource = [...scene.sources]
        .reverse()
        .find(src => {
          if (!src.visible) return false;
          return mouse.x >= src.x && mouse.x <= src.x + src.width &&
                 mouse.y >= src.y && mouse.y <= src.y + src.height;
        });

      if (clickedSource) {
        this.selectedSourceId = clickedSource.id;
        
        // Dispatch event for UI updates
        const evt = new CustomEvent('source-selected', { detail: { source: clickedSource } });
        window.dispatchEvent(evt);

        if (!clickedSource.locked) {
          this.isDragging = true;
          this.dragStart = { ...mouse };
          this.sourceStart = { x: clickedSource.x, y: clickedSource.y, w: clickedSource.width, h: clickedSource.height };
        }
        e.preventDefault();
      } else {
        // Clicked empty space: de-select
        this.selectedSourceId = null;
        window.dispatchEvent(new CustomEvent('source-selected', { detail: { source: null } }));
      }
    };

    const handleMouseMove = (e) => {
      if (!activeCanvas) return;
      const scene = this.getActiveScene();
      if (!scene || (!this.isDragging && !this.isResizing)) return;
      
      const rect = activeCanvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const mouse = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
      
      const source = scene.sources.find(s => s.id === this.selectedSourceId);
      if (!source) return;

      const dx = mouse.x - this.dragStart.x;
      const dy = mouse.y - this.dragStart.y;

      if (this.isDragging) {
        source.x = Math.round(this.sourceStart.x + dx);
        source.y = Math.round(this.sourceStart.y + dy);
      } else if (this.isResizing) {
        const start = this.sourceStart;
        
        switch (this.resizeHandle) {
          case 'br':
            source.width = Math.max(10, Math.round(start.w + dx));
            source.height = Math.max(10, Math.round(start.h + dy));
            break;
          case 'bl':
            const newW_bl = Math.round(start.w - dx);
            if (newW_bl > 10) {
              source.x = Math.round(start.x + dx);
              source.width = newW_bl;
            }
            source.height = Math.max(10, Math.round(start.h + dy));
            break;
          case 'tr':
            source.width = Math.max(10, Math.round(start.w + dx));
            const newH_tr = Math.round(start.h - dy);
            if (newH_tr > 10) {
              source.y = Math.round(start.y + dy);
              source.height = newH_tr;
            }
            break;
          case 'tl':
            const newW_tl = Math.round(start.w - dx);
            const newH_tl = Math.round(start.h - dy);
            if (newW_tl > 10) {
              source.x = Math.round(start.x + dx);
              source.width = newW_tl;
            }
            if (newH_tl > 10) {
              source.y = Math.round(start.y + dy);
              source.height = newH_tl;
            }
            break;
        }
      }
      
      // Dispatch drag/resize updates to sync UI input boxes
      const evt = new CustomEvent('source-properties-updated', { detail: { source } });
      window.dispatchEvent(evt);
    };

    const handleMouseUp = () => {
      this.isDragging = false;
      this.isResizing = false;
      this.resizeHandle = null;
      activeCanvas = null;
    };

    if (this.previewCanvas) {
      this.previewCanvas.addEventListener('mousedown', handleMouseDown);
    }
    if (this.liveCanvas) {
      this.liveCanvas.addEventListener('mousedown', handleMouseDown);
    }
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Animation Loop: 60 FPS (Steady background rendering)
  startLoop() {
    const render = () => {
      const scene = this.getActiveScene();
      
      // Render Preview Canvas (always showing current layout edit handles)
      if (this.previewCtx && this.previewCanvas) {
        this.previewCtx.clearRect(0, 0, this.width, this.height);
        this.drawScene(this.previewCtx, scene, true);
        this.drawTTSAlert(this.previewCtx);
      }
      
      // Render Live Program Canvas
      if (this.liveCtx && this.liveCanvas) {
        this.liveCtx.clearRect(0, 0, this.width, this.height);
        
        if (this.isTransitioning) {
          const now = performance.now();
          const elapsed = now - this.transitionStartTime;
          this.transitionProgress = Math.min(1.0, elapsed / this.transitionDuration);
          
          if (this.transitionType === 'fade') {
            // Draw new scene as base
            this.drawScene(this.liveCtx, scene, false);
            // Draw frozen old scene overlayed with alpha
            this.liveCtx.save();
            this.liveCtx.globalAlpha = 1.0 - this.transitionProgress;
            this.liveCtx.drawImage(this.transitionCanvas, 0, 0);
            this.liveCtx.restore();
          }
          
          if (this.transitionProgress >= 1.0) {
            this.isTransitioning = false;
          }
        } else {
          // In standard mode (not studio), draw handles directly on program canvas
          const drawUI = !this.studioMode;
          this.drawScene(this.liveCtx, scene, drawUI);
        }
        
        // Draw the TTS alert overlay on top of the live canvas
        this.drawTTSAlert(this.liveCtx);
      }
    };

    // Run render loop at a steady 60 FPS using setInterval
    // (combined with disabling background throttling in Electron, this runs smoothly when minimized)
    this.loopTimer = setInterval(render, 1000 / 60);
  }

  triggerTTSAlert(username, message, duration = 6000) {
    this.ttsAlert = {
      username,
      message,
      startTime: performance.now(),
      duration
    };
  }

  drawTTSAlert(ctx) {
    if (!this.ttsAlert) return;
    
    const now = performance.now();
    const elapsed = now - this.ttsAlert.startTime;
    
    if (elapsed > this.ttsAlert.duration) {
      this.ttsAlert = null;
      return;
    }
    
    // Animation transitions (500ms fade in/out)
    let opacity = 1.0;
    let yOffset = 0;
    
    if (elapsed < 500) {
      opacity = elapsed / 500;
      yOffset = (1.0 - opacity) * -40; // Slide down
    } else if (elapsed > this.ttsAlert.duration - 500) {
      opacity = (this.ttsAlert.duration - elapsed) / 500;
      yOffset = (1.0 - opacity) * -40; // Slide up
    }
    
    const boxW = 800;
    const boxH = 140;
    const x = (this.width - boxW) / 2;
    const y = 80 + yOffset;
    
    ctx.save();
    ctx.globalAlpha = opacity;
    
    // Draw outer glow / shadow
    ctx.shadowColor = 'rgba(145, 70, 255, 0.6)';
    ctx.shadowBlur = 20;
    
    // Draw box background (sleek Twitch dark theme)
    ctx.fillStyle = 'rgba(15, 12, 22, 0.9)';
    
    // Draw rounded rect helper
    this.drawRoundedRect(ctx, x, y, boxW, boxH, 15, true, false);
    
    // Draw Twitch purple border
    ctx.shadowBlur = 0; // Disable shadow for border
    ctx.strokeStyle = '#9146ff';
    ctx.lineWidth = 3;
    this.drawRoundedRect(ctx, x, y, boxW, boxH, 15, false, true);
    
    // Draw visual accent line on the left
    ctx.fillStyle = '#9146ff';
    ctx.fillRect(x + 12, y + 15, 6, boxH - 30);
    
    // Draw Text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Username (Line 1)
    ctx.font = 'bold 22px "Inter", sans-serif';
    ctx.fillStyle = '#a855f7'; // Bright purple
    ctx.fillText('💬  ' + this.ttsAlert.username.toUpperCase() + ' dice:', x + 30, y + 22);
    
    // Message content (Line 2 + Auto wrap)
    ctx.font = '20px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    
    // Custom wrap text helper (using the pre-existing wrapText method)
    this.wrapText(ctx, this.ttsAlert.message, x + 30, y + 58, boxW - 60, 26);
    
    ctx.restore();
  }

  // Helper to draw rounded rectangles
  drawRoundedRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
}

// Export for global availability
window.CanvasComposer = CanvasComposer;
