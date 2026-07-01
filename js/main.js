// StreamStudio Landing Page Interactive Logic

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // --- INTERACTIVE AUDIO MIXER SIMULATOR ---
  const vuBar = document.getElementById('sim-vu-bar');
  const dbText = document.getElementById('sim-db-text');
  const volSlider = document.getElementById('sim-vol-slider');
  const muteBtn = document.getElementById('sim-mute-btn');
  const chkGate = document.getElementById('chk-sim-gate');
  const chkComp = document.getElementById('chk-sim-comp');
  const chkEq = document.getElementById('chk-sim-eq');

  let isMuted = false;
  let volume = 1.0;
  let targetWidth = 0;
  let currentWidth = 0;

  // Toggle Mute
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (isMuted) {
      muteBtn.classList.add('muted');
      muteBtn.innerHTML = '<i data-lucide="mic-off"></i>';
    } else {
      muteBtn.classList.remove('muted');
      muteBtn.innerHTML = '<i data-lucide="mic"></i>';
    }
    lucide.createIcons();
  });

  // Slider change
  volSlider.addEventListener('input', (e) => {
    volume = parseFloat(e.target.value);
  });

  // Simple VU Meter Animation Loop
  const simulateVU = () => {
    if (isMuted) {
      targetWidth = 0;
    } else {
      // Create random raw signal
      let signal = 0.2 + Math.random() * 0.5;
      
      // Apply Volume fader
      signal *= volume;

      // Apply Noise Gate (cuts low signals)
      if (chkGate.checked && signal < 0.35) {
        signal = 0;
      }

      // Apply Compressor (compresses high peaks and boosts low)
      if (chkComp.checked) {
        if (signal > 0.6) {
          signal = 0.6 + (signal - 0.6) * 0.3; // Compress high peak
        } else if (signal > 0.05) {
          signal = signal * 1.2; // Boost low gain
        }
      }

      // Apply EQ
      if (chkEq.checked) {
        signal = Math.min(1.0, signal * 1.1); // Add slight treble boost simulation
      }

      targetWidth = Math.min(100, signal * 100);
    }

    // Smooth transition
    currentWidth += (targetWidth - currentWidth) * 0.2;
    vuBar.style.width = `${currentWidth}%`;

    // Calculate DB text
    let dbValue = -100;
    const ratio = currentWidth / 100;
    if (ratio > 0.001) {
      dbValue = 20 * Math.log10(ratio);
    }
    
    if (dbValue <= -40 || isMuted || currentWidth < 1) {
      dbText.textContent = '-inf dB';
    } else {
      dbText.textContent = `${dbValue.toFixed(1)} dB`;
    }

    requestAnimationFrame(simulateVU);
  };

  simulateVU();

  // --- FETCH GITHUB RELEASES DYNAMICALLY ---
  const releasesList = document.getElementById('github-releases-list');

  const fallbackReleases = [
    {
      name: "StreamStudio v1.0.6 - Production Release",
      tag_name: "v1.0.6",
      published_at: "2026-07-01T17:00:00Z",
      body: `### 🌟 Características Destacadas
* **Audio de Escritorio Real**: Captura el sonido del sistema en directo sin simular ruido.
* **Guardado Local Seguro**: Grabación local directa a la ruta del disco configurada por el usuario.
* **Atajos de Teclado Persistentes**: Guarda la configuración de atajos entre reinicios del sistema.
* **Escalado de Video Activo**: Optimización de resolución de salida en FFmpeg.`,
      assets: [
        {
          name: "Descargar instalador (Windows)",
          browser_download_url: "https://github.com/jugecraft/Stream-Studio/releases",
          size: 103513126
        }
      ]
    }
  ];

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('es-ES', options);
  }

  function renderReleases(releases) {
    releasesList.innerHTML = '';
    
    if (releases.length === 0) {
      releasesList.innerHTML = '<div style="text-align: center; color: var(--text-muted);">No se encontraron lanzamientos.</div>';
      return;
    }

    releases.forEach((rel, index) => {
      const card = document.createElement('div');
      card.className = 'release-card';
      
      const isLatest = index === 0;
      const badge = isLatest ? '<span class="release-badge">Última Versión</span>' : '';
      
      // Simple Markdown parser for highlights
      let bodyHtml = rel.body || 'Sin descripción disponible.';
      bodyHtml = bodyHtml
        .replace(/### (.*)/g, '<h4>$1</h4>')
        .replace(/## (.*)/g, '<h3>$1</h3>')
        .replace(/\* (.*)/g, '<li>$1</li>')
        .replace(/^- (.*)/g, '<li>$1</li>')
        .replace(/\n\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

      // Ensure lists are wrapped in ul
      if (bodyHtml.includes('<li>')) {
        bodyHtml = bodyHtml.replace(/(<li>.*<\/li>)/gs, '<ul>$1<\/ul>');
      }

      let assetsHtml = '';
      if (rel.assets && rel.assets.length > 0) {
        rel.assets.forEach(asset => {
          assetsHtml += `
            <div style="margin-top: 10px;">
              <a href="${asset.browser_download_url}" class="asset-link">
                <span><i data-lucide="file-archive" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i> ${asset.name}</span>
                <span class="asset-size">${formatBytes(asset.size)}</span>
              </a>
            </div>
          `;
        });
      } else {
        // Fallback installer link if assets are empty (e.g. tag created but no binaries attached yet)
        assetsHtml = `
          <div style="margin-top: 10px;">
            <a href="https://github.com/jugecraft/Stream-Studio/releases" target="_blank" class="asset-link">
              <span><i data-lucide="link" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i> Ver Descargas en GitHub</span>
              <span class="asset-size">GitHub Releases</span>
            </a>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="release-header">
          <div>
            <h3>${rel.name || rel.tag_name}</h3>
            <div class="release-meta">Publicado el ${formatDate(rel.published_at)} | Tag: ${rel.tag_name}</div>
          </div>
          ${badge}
        </div>
        <div class="release-body">
          ${bodyHtml}
        </div>
        <div class="release-assets">
          <h5>Archivos Adjuntos</h5>
          ${assetsHtml}
        </div>
      `;

      releasesList.appendChild(card);
    });
    
    // Re-trigger icon loading
    lucide.createIcons();
  }

  // Fetch from Github Repo API
  fetch('https://api.github.com/repos/jugecraft/Stream-Studio/releases')
    .then(response => {
      if (!response.ok) {
        throw new Error('Github API rate limit or error');
      }
      return response.json();
    })
    .then(data => {
      if (data && data.length > 0) {
        renderReleases(data);
        
        // Dynamically update download links in hero and header CTA to point to the absolute latest binary
        const latestRelease = data[0];
        
        // Update version badges dynamically
        const badge = document.getElementById('hero-version-badge');
        if (badge) {
          badge.innerHTML = `<span class="badge-dot"></span> Nueva Versión Stable ${latestRelease.tag_name} Disponible`;
        }
        const mockupTitle = document.getElementById('mockup-version-title');
        if (mockupTitle) {
          mockupTitle.textContent = `StreamStudio ${latestRelease.tag_name} - Escena Activa: Juego Completo`;
        }

        const setupAsset = latestRelease.assets.find(a => a.name.endsWith('.exe'));
        if (setupAsset) {
          const ctaButtons = document.querySelectorAll('.nav-cta, .hero-actions .btn-primary');
          ctaButtons.forEach(btn => {
            btn.setAttribute('href', setupAsset.browser_download_url);
            btn.innerHTML = `<i data-lucide="download"></i> Descargar ${latestRelease.tag_name}`;
          });
          // Re-trigger icon rendering for updated markup
          lucide.createIcons();
        }
      } else {
        renderReleases(fallbackReleases);
      }
    })
    .catch(err => {
      console.warn('API error, loading fallback release info:', err);
      renderReleases(fallbackReleases);
    });

  // --- HERO INTERACTIVE 3D LOGO & PARTICLE SYSTEM ---
  const canvas = document.getElementById('hero-interactive-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    // Handle resize
    window.addEventListener('resize', () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    });

    // Particle class
    class Particle {
      constructor() {
        this.reset();
      }

      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.size = 1 + Math.random() * 2.5;
        this.speedX = (Math.random() - 0.5) * 0.4;
        this.speedY = (Math.random() - 0.5) * 0.4;
        // Purple, Pink, Violet glowing tones
        const hues = [260, 280, 290, 310, 330];
        this.hue = hues[Math.floor(Math.random() * hues.length)];
        this.alpha = 0.15 + Math.random() * 0.45;
        this.angle = Math.random() * Math.PI * 2;
        this.orbitRadius = 60 + Math.random() * 140;
        this.orbitSpeed = (Math.random() - 0.5) * 0.006;
      }

      update(logoX, logoY, mouseX, mouseY) {
        // Normal drift or orbit around logo
        if (logoX && logoY) {
          this.angle += this.orbitSpeed;
          const targetX = logoX + Math.cos(this.angle) * this.orbitRadius;
          const targetY = logoY + Math.sin(this.angle) * this.orbitRadius;
          this.x += (targetX - this.x) * 0.025;
          this.y += (targetY - this.y) * 0.025;
        } else {
          this.x += this.speedX;
          this.y += this.speedY;
        }

        // Mouse reaction (repelled by mouse)
        if (mouseX !== null && mouseY !== null) {
          const dx = this.x - mouseX;
          const dy = this.y - mouseY;
          const dist = Math.hypot(dx, dy);
          if (dist < 130) {
            const force = (130 - dist) / 130;
            this.x += (dx / dist) * force * 3.5;
            this.y += (dy / dist) * force * 3.5;
          }
        }

        // Boundary checks (re-wrap if drift too far)
        if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
          this.reset();
        }
      }

      draw() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.hue}, 95%, 70%, ${this.alpha})`;
        ctx.shadowBlur = this.size * 4;
        ctx.shadowColor = `hsla(${this.hue}, 95%, 70%, 0.85)`;
        ctx.fill();
        ctx.restore();
      }
    }

    // Initialize particles
    const particleCount = 80;
    const particles = Array.from({ length: particleCount }, () => new Particle());

    // Load logo image
    const logoImg = new Image();
    logoImg.src = 'logo.png';
    let logoLoaded = false;
    logoImg.onload = () => {
      logoLoaded = true;
    };

    // Interaction variables
    let mouse = { x: 0, y: 0, targetX: null, targetY: null };
    let logoRotation = { x: 0, y: 0 };
    let logoPosition = { x: width * 0.72, y: height * 0.45 };
    let bobbingAngle = 0;

    // Listen to mousemove on parent header
    const header = canvas.parentElement;
    header.addEventListener('mousemove', (e) => {
      const rect = header.getBoundingClientRect();
      mouse.targetX = e.clientX - rect.left;
      mouse.targetY = e.clientY - rect.top;
      
      // Calculate 3D tilt based on mouse offset from center
      const centerX = width / 2;
      const centerY = height / 2;
      logoRotation.y = ((e.clientX - rect.left) - centerX) / centerX * 0.35; // max 0.35 rad tilt
      logoRotation.x = -((e.clientY - rect.top) - centerY) / centerY * 0.35;
    });

    header.addEventListener('mouseleave', () => {
      mouse.targetX = null;
      mouse.targetY = null;
      logoRotation.x = 0;
      logoRotation.y = 0;
    });

    // Main animation loop
    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse tracking
      if (mouse.targetX !== null && mouse.targetY !== null) {
        mouse.x += (mouse.targetX - mouse.x) * 0.1;
        mouse.y += (mouse.targetY - mouse.y) * 0.1;
      } else {
        mouse.x += (0 - mouse.x) * 0.05;
        mouse.y += (0 - mouse.y) * 0.05;
      }

      // Logo placement in background (shifted to center-right, matching mockup background)
      const isMobile = width < 992;
      const logoX = isMobile ? width / 2 : width * 0.84;
      const logoY = isMobile ? height * 0.25 : height * 0.30;
      
      logoPosition.x += (logoX - logoPosition.x) * 0.05;
      logoPosition.y += (logoY - logoPosition.y) * 0.05;

      // Bobbing floating motion
      bobbingAngle += 0.015;
      const currentLogoY = logoPosition.y + Math.sin(bobbingAngle) * 12;

      // Draw particles behind logo
      particles.forEach(p => {
        p.update(logoPosition.x, currentLogoY, mouse.targetX !== null ? mouse.x : null, mouse.targetY !== null ? mouse.y : null);
        p.draw();
      });

      // Draw 3D-tilting Logo Image
      if (logoLoaded) {
        ctx.save();
        ctx.translate(logoPosition.x, currentLogoY);
        
        // 3D perspective effect via transform matrix
        ctx.transform(
          1, 
          logoRotation.y * 0.22, 
          logoRotation.x * 0.22, 
          1, 
          0, 
          0
        );

        // Logo Bobbing Tilt
        ctx.rotate(logoRotation.y * 0.3);

        // Draw shadow glow behind the logo
        ctx.beginPath();
        ctx.arc(0, 0, 95, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 115);
        glow.addColorStop(0, 'rgba(145, 70, 255, 0.35)');
        glow.addColorStop(0.5, 'rgba(239, 68, 68, 0.12)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fill();

        // 1. Draw glowing circular border
        ctx.beginPath();
        ctx.arc(0, 0, 68, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(145, 70, 255, 0.65)';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#9146ff';
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow

        // 2. Draw glassmorphism background inside circle
        ctx.fillStyle = 'rgba(15, 15, 21, 0.75)';
        ctx.fill();

        // 3. Clip and draw logo image inside the circle to hide square edges
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 66, 0, Math.PI * 2);
        ctx.clip();
        
        const logoSize = 132;
        // Draw multiple offset layers of logo for holograph/3D depth effect
        ctx.globalAlpha = 0.35;
        ctx.drawImage(logoImg, -logoSize/2 - logoRotation.y * 10, -logoSize/2 - logoRotation.x * 10, logoSize, logoSize);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(logoImg, -logoSize/2 - logoRotation.y * 5, -logoSize/2 - logoRotation.x * 5, logoSize, logoSize);
        ctx.globalAlpha = 1.0;
        ctx.drawImage(logoImg, -logoSize/2, -logoSize/2, logoSize, logoSize);
        ctx.restore();
        
        ctx.restore();
      }

      requestAnimationFrame(animate);
    };

    // Start loop
    animate();
  }
});
