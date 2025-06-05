async function getTopSeeds() {
  const res = await fetch('/api/top-tracks');
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.items) return [];
  return data.items.map(item => item.artists[0].id);
}

async function getGenresForArtists(artistIds) {
  if (!artistIds.length) return [];
  const chunk = artistIds.slice(0, 50).join(',');
  const res = await fetch(`/api/artists?ids=${encodeURIComponent(chunk)}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.artists) return [];
  const genres = data.artists.reduce((acc, artist) => {
    if (artist.genres) acc.push(...artist.genres);
    return acc;
  }, []);
  return [...new Set(genres)].slice(0, 5);
}

async function createMoodPlaylist(moodText) {
  const res = await fetch('/api/create-mood-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood: moodText })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.playlistId;
}

function embedPlaylist(playlistId) {
  const container = document.getElementById('player');
  container.innerHTML = '';
  if (!playlistId) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://open.spotify.com/embed/playlist/${playlistId}`;
  iframe.allow = 'encrypted-media';
  iframe.width = '100%';
  iframe.height = '380';
  iframe.frameBorder = '0';
  container.appendChild(iframe);
}

function clearVisuals() {
  document.body.classList.remove('rainy', 'snowy', 'sunny', 'night', 'party');
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

function updateBackground(mood) {
  const mapToVisual = {
    happy: 'sunny',
    sad: 'rainy',
    energetic: 'party',
    chill: 'snowy',
    romantic: 'night',
    naughty: 'party',
    whimsical: 'sunny',
    melancholy: 'rainy',
    hopeful: 'sunny',
    lonely: 'night',
    angsty: 'rainy',
    dreamy: 'night',
    introspective: 'night',
    confident: 'sunny',
    rebellious: 'party',
    sonder: 'night'
  };
  const visClass = mapToVisual[mood] || 'sunny';
  setVisualEffects(visClass);
}

window.addEventListener('load', () => {
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const searchContainer = document.getElementById('search-container');
  const moodButtons = document.querySelectorAll('.mood-btn');

  fetch('/api/top-tracks', { method: 'HEAD' }).then(res => {
    if (res.status === 401) {
      statusEl.textContent = 'Please log in with Spotify to use Mixtape.';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      searchContainer.style.display = 'none';
      loginBtn.addEventListener('click', () => {
        window.location = '/login';
      });
    } else {
      statusEl.textContent = 'Pick a mood or enter your own!';
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
      searchContainer.style.display = 'block';

      logoutBtn.addEventListener('click', () => {
        fetch('/logout').then(() => {
          window.location.reload();
        });
      });

      document.getElementById('mood-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const mood = document.getElementById('mood-input').value.trim().toLowerCase();
        await handleMoodSelection(mood);
      });

      moodButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
          const mood = btn.dataset.mood;
          document.getElementById('mood-input').value = mood;
          await handleMoodSelection(mood);
        });
      });
    }
  });
});

async function handleMoodSelection(mood) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Building your playlist…';
  updateBackground(mood);
  const playlistId = await createMoodPlaylist(mood);
  if (playlistId) {
    embedPlaylist(playlistId);
    statusEl.textContent = `Your “${mood}” playlist is ready`;
  } else {
    embedPlaylist(null);
    statusEl.textContent = 'No matching playlist found. Try another mood.';
  }
}