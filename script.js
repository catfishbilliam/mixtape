const clientId = 'f9293119782449e88cb8da46afe19753';
const redirectUri = 'https://catfishbilliam.github.io/mixtape/';

function generateCodeVerifier() {
  const array = new Uint32Array(56);
  window.crypto.getRandomValues(array);
  return Array.from(array).map(n => ('00000000' + n.toString(16)).slice(-8)).join('');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function redirectToSpotify() {
  const verifier = generateCodeVerifier();
  sessionStorage.setItem('pkce_verifier', verifier);
  generateCodeChallenge(verifier).then(challenge => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'playlist-read-private user-top-read',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge
    });
    window.location = `https://accounts.spotify.com/authorize?${params}`;
  });
}

function parseQueryParams() {
  return new URLSearchParams(window.location.search);
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await res.json();
  return data.access_token;
}

async function getTopSeeds(token) {
  const res = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=5', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.items) return [];
  return data.items.map(item => item.artists[0].id);
}

async function getGenresForArtists(token, artistIds) {
  if (!artistIds.length) return [];
  const chunk = artistIds.slice(0, 50).join(',');
  const res = await fetch(`https://api.spotify.com/v1/artists?ids=${chunk}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.artists) return [];
  const genres = data.artists.reduce((acc, artist) => {
    if (artist.genres) acc.push(...artist.genres);
    return acc;
  }, []);
  return [...new Set(genres)].slice(0, 5);
}

async function searchPlaylist(token, query) {
  const params = new URLSearchParams({ q: query, type: 'playlist', limit: 1 });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
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

window.addEventListener('load', async () => {
  const params = parseQueryParams();
  const code = params.get('code');
  const statusEl = document.getElementById('status');
  const loginBtn = document.getElementById('login-btn');
  const searchContainer = document.getElementById('search-container');

  if (code) {
    const token = await exchangeCodeForToken(code);
    sessionStorage.setItem('spotify_token', token);
    window.history.replaceState({}, document.title, redirectUri);
  }

  const accessToken = sessionStorage.getItem('spotify_token');
  if (!accessToken) {
    statusEl.textContent = 'Please log in with Spotify to use Mixtape.';
    loginBtn.style.display = 'inline-block';
    loginBtn.addEventListener('click', redirectToSpotify);
    return;
  }

  statusEl.textContent = 'Enter a mood to generate a playlist.';
  searchContainer.style.display = 'block';

  document.getElementById('mood-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Building your playlist…';
    const mood = document.getElementById('mood-input').value.trim().toLowerCase();

    const artistIds = await getTopSeeds(accessToken);
    const genres = await getGenresForArtists(accessToken, artistIds);
    const combined = [mood, ...genres].join(' ');

    const playlistId = await searchPlaylist(accessToken, combined);
    if (playlistId) {
      embedPlaylist(playlistId);
      statusEl.textContent = `Playlist for “${mood}” (${genres.join(', ')})`;
    } else {
      embedPlaylist(null);
      statusEl.textContent = 'No matching playlist found. Try another mood.';
    }
  });
});