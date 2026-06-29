// StreamStudio Multi-Platform Chat & Alert Simulator

const USER_NAMES = [
  'ZackStreamer', 'Alex_Gaming', 'Lucia99', 'El_Pro_64', 'GamerGirl_x',
  'NexusPlayer', 'SoniaLive', 'AlphaCoder', 'DiegoPlay', 'Mia_Cat',
  'TwitchEnthusiast', 'YoutubeFan', 'KickKing', 'SpeedyGonzales', 'SilentKnight'
];

const CHAT_MESSAGES = [
  '¡Buen stream bro! 🚀',
  'Hola a todos en el chat, ¿cómo están?',
  '¡Ese clip va a ser genial! 😂',
  '¿De dónde eres streamer?',
  'El directo se ve súper fluido hoy, ¡buena optimización!',
  '¿Qué gráfica tienes para hacer streaming?',
  '¿Haces directo todos los días?',
  '¡Qué buena jugada! GG WP',
  'Kick > Twitch, la verdad jaja',
  'El chat de YouTube tiene un poco de lag',
  '¿Puedes poner música?',
  '¡Saludos desde Argentina! 🇦🇷',
  '¡Saludos desde México! 🇲🇽',
  '¡Increíble la calidad del video!',
  '¿Cuánto tiempo llevas transmitiendo?'
];

const ALERTS = [
  { text: '¡se ha suscrito con Prime!', type: 'subscription' },
  { text: '¡acaba de seguir el canal!', type: 'follow' },
  { text: '¡ha donado $5.00 dólares!', type: 'donation' },
  { text: '¡acaba de regalar 5 suscripciones!', type: 'gift' }
];

class ChatSimulator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.timer = null;
    this.active = false;
    this.platforms = ['twitch', 'youtube', 'kick'];
  }

  start() {
    if (this.active) return;
    this.active = true;
    
    // Welcome message
    this.addMessage('system', 'Sistema', 'Simulador de Chat consolidado iniciado. Los mensajes de Twitch, YouTube y Kick aparecerán aquí.');
    
    const scheduleNext = () => {
      if (!this.active) return;
      const delay = 1000 + Math.random() * 2500; // Random delay between 1s and 3.5s
      this.timer = setTimeout(() => {
        this.generateRandomMessage();
        scheduleNext();
      }, delay);
    };
    
    scheduleNext();
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  generateRandomMessage() {
    const platform = this.platforms[Math.floor(Math.random() * this.platforms.length)];
    const username = USER_NAMES[Math.floor(Math.random() * USER_NAMES.length)];
    const text = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
    this.addMessage(platform, username, text);
  }

  triggerAlert() {
    const platform = this.platforms[Math.floor(Math.random() * this.platforms.length)];
    const username = USER_NAMES[Math.floor(Math.random() * USER_NAMES.length)];
    const alert = ALERTS[Math.floor(Math.random() * ALERTS.length)];
    
    const alertText = `${username} ${alert.text}`;
    this.addMessage(platform, 'ALERTA', alertText, alert.type);
  }

  addMessage(platform, username, text, type = 'chat') {
    if (!this.container) return;

    const messageEl = document.createElement('div');
    messageEl.classList.add('chat-message', platform);
    
    if (type !== 'chat') {
      messageEl.classList.add('alert-msg');
    }

    // Platform badge
    let badgeHtml = '';
    if (platform !== 'system') {
      badgeHtml = `<span class="platform-badge ${platform}">${platform}</span>`;
    } else {
      badgeHtml = `<span class="platform-badge" style="background-color: var(--border-focus); color: var(--text-muted)">SYS</span>`;
    }

    messageEl.innerHTML = `
      <div class="chat-message-header">
        ${badgeHtml}
        <span class="chat-user">${username}</span>
      </div>
      <span class="chat-text">${text}</span>
    `;

    this.container.appendChild(messageEl);
    
    // Auto-scroll to bottom
    this.container.scrollTop = this.container.scrollHeight;

    // Limit messages in DOM to prevent performance slowdown
    while (this.container.children.length > 100) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for global availability
window.ChatSimulator = ChatSimulator;
