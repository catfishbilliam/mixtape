async function getTopSeeds(token) {
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
  if (!data.playlists || !data.playlists.items.length) return null;
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
  const searchContainer = document.getElementById('search-container');

  // 1) Check for a cookie named "spotify_token"
  fetch('/api/top-tracks', { method: 'HEAD' }).then(res => {
    if (res.status === 401) {
      // Not authenticated
      statusEl.textContent = 'Please log in with Spotify to use Mixtape.';
      loginBtn.style.display = 'inline-block';
      loginBtn.addEventListener('click', () => {
        window.location = '/login';
      });
    } else {
      // Authenticated
      statusEl.textContent = 'Enter a mood to generate a playlist.';
      searchContainer.style.display = 'block';

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