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

async function searchPlaylist(query) {
  if (!query) return null;
  const res = await fetch(`/api/search-playlist?q=${encodeURIComponent(query)}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
    return null;
  }
  return data.playlists.items[0].id;
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

window.addEventListener('load', () => {
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const searchContainer = document.getElementById('search-container');

  // Check authentication by calling /api/top-tracks HEAD
  fetch('/api/top-tracks', { method: 'HEAD' }).then(res => {
    if (res.status === 401) {
      // Not logged in
      statusEl.textContent = 'Please log in with Spotify to use Mixtape.';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      searchContainer.style.display = 'none';
      loginBtn.addEventListener('click', () => {
        window.location = '/login';
      });
    } else {
      // Logged in
      statusEl.textContent = 'Enter a mood to generate a playlist.';
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
        statusEl.textContent = 'Building your playlist…';
        const mood = document.getElementById('mood-input').value.trim().toLowerCase();

        const artistIds = await getTopSeeds();
        const genres = await getGenresForArtists(artistIds);
        const combined = [mood, ...genres].join(' ');

        const playlistId = await searchPlaylist(combined);
        if (playlistId) {
          embedPlaylist(playlistId);
          statusEl.textContent = `Playlist for “${mood}” (${genres.join(', ')})`;
        } else {
          embedPlaylist(null);
          statusEl.textContent = 'No matching playlist found. Try another mood.';
        }
      });
    }
  });
});