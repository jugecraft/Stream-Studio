// StreamStudio Settings Manager

const DEFAULT_SETTINGS = {
  // Stream settings
  twitchEnabled: true,
  twitchServer: 'rtmp://live.twitch.tv/app/',
  twitchKey: '',
  twitchChannel: '',
  twitchOAuth: '',
  
  youtubeEnabled: false,
  youtubeServer: 'rtmp://a.rtmp.youtube.com/live2/',
  youtubeKey: '',
  
  kickEnabled: false,
  kickServer: 'rtmp://live.kick.com/app/',
  kickKey: '',

  // Output settings
  videoEncoder: 'libx264',
  videoBitrate: 4500,
  encoderPreset: 'veryfast',
  audioBitrate: 128,
  keyframeInterval: 2,
  recordingDir: '',
  recordingFormat: 'mp4',

  // Audio settings
  sampleRate: 48000,
  channels: 'stereo',
  micDevice: 'default',

  // Video settings
  resolutionBase: '1920x1080',
  resolutionOutput: '1920x1080',
  fps: 60,

  // Advanced settings
  procPriority: 'normal',
  colorSpace: 'bt709'
};

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem('stream_studio_settings');
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error loading settings from localStorage:', e);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  save(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('stream_studio_settings', JSON.stringify(this.settings));
      console.log('Settings saved successfully!');
    } catch (e) {
      console.error('Error saving settings to localStorage:', e);
    }
  }

  get() {
    return this.settings;
  }

  // Populate UI Form elements with settings values
  populateForm() {
    // Stream tab
    document.getElementById('opt-twitch-enable').checked = this.settings.twitchEnabled;
    document.getElementById('input-twitch-server').value = this.settings.twitchServer;
    document.getElementById('input-twitch-key').value = this.settings.twitchKey;
    document.getElementById('input-twitch-channel').value = this.settings.twitchChannel || '';
    document.getElementById('input-twitch-oauth').value = this.settings.twitchOAuth || '';

    document.getElementById('opt-youtube-enable').checked = this.settings.youtubeEnabled;
    document.getElementById('input-youtube-server').value = this.settings.youtubeServer;
    document.getElementById('input-youtube-key').value = this.settings.youtubeKey;

    document.getElementById('opt-kick-enable').checked = this.settings.kickEnabled;
    document.getElementById('input-kick-server').value = this.settings.kickServer;
    document.getElementById('input-kick-key').value = this.settings.kickKey;

    // Output tab
    document.getElementById('opt-video-encoder').value = this.settings.videoEncoder;
    document.getElementById('input-video-bitrate').value = this.settings.videoBitrate;
    document.getElementById('opt-encoder-preset').value = this.settings.encoderPreset;
    document.getElementById('opt-audio-bitrate').value = this.settings.audioBitrate;
    document.getElementById('input-keyframe-interval').value = this.settings.keyframeInterval;
    document.getElementById('input-record-dir').value = this.settings.recordingDir || 'Predeterminada del sistema';
    document.getElementById('opt-record-format').value = this.settings.recordingFormat;

    // Audio tab
    document.getElementById('opt-audio-samplerate').value = this.settings.sampleRate;
    document.getElementById('opt-audio-channels').value = this.settings.channels;
    document.getElementById('opt-device-mic').value = this.settings.micDevice;

    // Video tab
    document.getElementById('opt-resolution-base').value = this.settings.resolutionBase;
    document.getElementById('opt-resolution-output').value = this.settings.resolutionOutput;
    document.getElementById('opt-video-fps').value = this.settings.fps;

    // Advanced tab
    document.getElementById('opt-proc-priority').value = this.settings.procPriority;
    document.getElementById('opt-color-space').value = this.settings.colorSpace;
  }

  // Retrieve settings values from UI Form elements
  readForm() {
    return {
      twitchEnabled: document.getElementById('opt-twitch-enable').checked,
      twitchServer: document.getElementById('input-twitch-server').value,
      twitchKey: document.getElementById('input-twitch-key').value,
      twitchChannel: document.getElementById('input-twitch-channel').value,
      twitchOAuth: document.getElementById('input-twitch-oauth').value,

      youtubeEnabled: document.getElementById('opt-youtube-enable').checked,
      youtubeServer: document.getElementById('input-youtube-server').value,
      youtubeKey: document.getElementById('input-youtube-key').value,

      kickEnabled: document.getElementById('opt-kick-enable').checked,
      kickServer: document.getElementById('input-kick-server').value,
      kickKey: document.getElementById('input-kick-key').value,

      videoEncoder: document.getElementById('opt-video-encoder').value,
      videoBitrate: parseInt(document.getElementById('input-video-bitrate').value) || 4500,
      encoderPreset: document.getElementById('opt-encoder-preset').value,
      audioBitrate: parseInt(document.getElementById('opt-audio-bitrate').value) || 128,
      keyframeInterval: parseInt(document.getElementById('input-keyframe-interval').value) || 2,
      recordingDir: document.getElementById('input-record-dir').value === 'Predeterminada del sistema' ? '' : document.getElementById('input-record-dir').value,
      recordingFormat: document.getElementById('opt-record-format').value,

      sampleRate: parseInt(document.getElementById('opt-audio-samplerate').value) || 48000,
      channels: document.getElementById('opt-audio-channels').value,
      micDevice: document.getElementById('opt-device-mic').value,

      resolutionBase: document.getElementById('opt-resolution-base').value,
      resolutionOutput: document.getElementById('opt-resolution-output').value,
      fps: parseInt(document.getElementById('opt-video-fps').value) || 60,

      procPriority: document.getElementById('opt-proc-priority').value,
      colorSpace: document.getElementById('opt-color-space').value
    };
  }

  // Bind UI interactions (password toggles, tab controls, etc.)
  bindUIEvents() {
    // Password toggles
    document.querySelectorAll('.btn-toggle-password').forEach(button => {
      button.addEventListener('click', () => {
        const input = button.previousElementSibling;
        const icon = button.querySelector('i');
        
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) {
            icon.setAttribute('data-lucide', 'eye');
            lucide.createIcons();
          }
        } else {
          input.type = 'password';
          if (icon) {
            icon.setAttribute('data-lucide', 'eye-off');
            lucide.createIcons();
          }
        }
      });
    });

    // Tab buttons switching
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.add('hidden'));
        
        tab.classList.add('active');
        const target = tab.getAttribute('data-target');
        document.getElementById(target).classList.remove('hidden');
      });
    });

    // Recording directory picker
    const selectDirBtn = document.getElementById('btn-select-record-dir');
    if (selectDirBtn && window.electronAPI && window.electronAPI.selectRecordingDir) {
      selectDirBtn.addEventListener('click', async () => {
        const path = await window.electronAPI.selectRecordingDir();
        if (path) {
          document.getElementById('input-record-dir').value = path;
        }
      });
    }
  }
}

// Export for global availability
window.SettingsManager = SettingsManager;
