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
      name: "StreamStudio v1.0.0 - Production Release",
      tag_name: "v1.0.0",
      published_at: "2026-06-29T03:58:11Z",
      body: `### 🌟 Características Destacadas
* **Lienzo Interactivo (60 FPS)**: Composición fluida con arrastre y redimensionado de cámaras/pantallas.
* **Mezclador de Audio DSP**: Faders, mutes, puerta de ruido, compresores y ecualizador de 3 bandas.
* **Seguridad Incorporada**: Chromium DevTools bloqueado en producción para evitar modificaciones no deseadas.
* **Aceleración por Hardware**: Soporte integrado para NVIDIA NVENC y AMD AMF en codificación de transmisiones.`,
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
});
