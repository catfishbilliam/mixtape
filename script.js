const clientId = 'f9293119782449e88cb8da46afe19753';
const redirectUri = 'http://localhost:5500/';
const scopes = ['playlist-read-private'];

const lat = 39.4143;
const lon = -77.4105;

const playlists = {
  'spring_morning_clear': '37i9dQZF1DX0XUsuxWHRQd',
  'spring_morning_rain':  '37i9dQZF1DWYs83FtTMQFw',
  'summer_evening_clear': '37i9dQZF1DWTJ7xPn4vNaz',
  'summer_evening_rain':  '37i9dQZF1DX0Mb8xNY2KS2',
  'fall_night_clear':     '37i9dQZF1DXctWG2g5ZGb8',
  'fall_night_rain':      '37i9dQZF1DWTkIwO27gT3g',
  'winter_evening_snow':  '37i9dQZF1DXbITWG1ZJKYt',
  'winter_evening_clear': '37i9dQZF1DWUzFXarNiofw',
};

const fallbackPlaylist = '37i9dQZF1DX0XUsuxWHRQd';

function loginWithSpotify() {
  const authURL =
    'https://accounts.spotify.com/authorize' +
    '?response_type=token' +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location = authURL;
}

function getAccessTokenFromUrl() {
  const hash = window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash.substring(1));
  return params.get('access_token');
}

function getSeason(month) {
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'fall';
}

function getTimeOfDay(hour) {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function mapConditionToKey(condText) {
  const txt = condText.toLowerCase();
  if (txt.includes('rain')) return 'rain';
  if (txt.includes('snow')) return 'snow';
  if (txt.includes('fog') || txt.includes('mist') || txt.includes('haze'))
    return 'rain';
  return 'clear';
}

function getVisualClass(timeOfDay, weatherKey) {
  if (weatherKey === 'rain') return 'rainy';
  if (weatherKey === 'snow') return 'snowy';
  if (timeOfDay === 'night') return 'night';
  return 'sunny';
}

function clearVisuals() {
  document.body.classList.remove(
    'rainy',
    'snowy',
    'sunny',
    'night',
    'party'
  );
  document.querySelectorAll('.raindrop, .snowflake').forEach(el => el.remove());
}

function setVisualEffects(vis) {
  clearVisuals();
  document.body.classList.add(vis);

  if (vis === 'rainy') {
    for (let i = 0; i < 100; i++) {
      const drop = document.createElement('div');
      drop.className = 'raindrop';
      drop.style.left = Math.random() * 100 + 'vw';
      drop.style.animationDuration = 0.5 + Math.random() * 0.5 + 's';
      drop.style.animationDelay = Math.random() * 2 + 's';
      drop.style.height = 10 + Math.random() * 20 + 'px';
      drop.style.opacity = 0.2 + Math.random() * 0.5;
      document.body.appendChild(drop);
    }
  } else if (vis === 'snowy') {
    for (let i = 0; i < 50; i++) {
      const flake = document.createElement('div');
      flake.className = 'snowflake';
      const size = 5 + Math.random() * 10;
      flake.style.width = size + 'px';
      flake.style.height = size + 'px';
      flake.style.left = Math.random() * 100 + 'vw';
      flake.style.animationDuration = 2 + Math.random() * 2 + 's';
      flake.style.animationDelay = Math.random() * 3 + 's';
      flake.style.opacity = 0.5 + Math.random() * 0.5;
      document.body.appendChild(flake);
    }
  }
}

async function fetchGridpoint() {
  const url = `https://api.weather.gov/points/${lat},${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch gridpoint');
  const data = await res.json();
  return {
    gridId: data.properties.gridId,
    gridX: data.properties.gridX,
    gridY: data.properties.gridY,
  };
}

async function fetchLatestCondition(gridId, gridX, gridY) {
  const url = `https://api.weather.gov/gridpoints/${gridId}/${gridX},${gridY}/observations`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch observations');
  const data = await res.json();
  const latest = data.features[0].properties.textDescription;
  return latest || 'Clear';
}

async function getWeatherKey() {
  try {
    const { gridId, gridX, gridY } = await fetchGridpoint();
    const rawCond = await fetchLatestCondition(gridId, gridX, gridY);
    return mapConditionToKey(rawCond);
  } catch (err) {
    return 'clear';
  }
}

function embedPlaylist(playlistId) {
  const container = document.getElementById('player');
  container.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = `https://open.spotify.com/embed/playlist/${playlistId}`;
  iframe.allow = 'encrypted-media';
  container.appendChild(iframe);
}

window.addEventListener('load', async () => {
  const accessToken = getAccessTokenFromUrl();
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');

  if (!accessToken) {
    statusEl.textContent = 'Please log in with Spotify to start your mix.';
    loginBtn.style.display = 'inline-block';
    loginBtn.addEventListener('click', loginWithSpotify);
    setupOverrideButtons();
    return;
  }

  statusEl.textContent = 'Detecting weather, time & season…';

  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth();
  const season = getSeason(month);
  const timeOfDay = getTimeOfDay(hour);

  let weatherKey = await getWeatherKey();

  const moodKey = `${season}_${timeOfDay}_${weatherKey}`;
  let playlistId = playlists[moodKey] || fallbackPlaylist;

  statusEl.textContent = `Auto-DJ Mood: ${moodKey.replace(/_/g, ' ')}`;
  embedPlaylist(playlistId);

  const visualClass = getVisualClass(timeOfDay, weatherKey);
  setVisualEffects(visualClass);

  setupOverrideButtons();
});

function setupOverrideButtons() {
  document.querySelectorAll('#overrides button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-playlist');
      const vis = btn.getAttribute('data-visual');
      const label = btn.textContent;

      document.getElementById('status').textContent = 'Override → ' + label;

      embedPlaylist(pid);

      clearVisuals();
      document.body.classList.add(vis);
      if (vis === 'rainy') setVisualEffects('rainy');
      if (vis === 'snowy') setVisualEffects('snowy');
      if (vis === 'sunny') setVisualEffects('sunny');
      if (vis === 'night') setVisualEffects('night');
      if (vis === 'party') setVisualEffects('party');
    });
  });
}