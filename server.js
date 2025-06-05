require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const path = require('path');
const Sentiment = require('sentiment');
const nlp = require('compromise');
const allGenres = require('./genres.json');

const app = express();
const sentiment = new Sentiment();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL;

let cachedCategories = [];
let categoriesFetchTime = 0;

let cachedSeedGenres = [];
let seedGenresFetchTime = 0;

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(express.json());

app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const scope = 'playlist-read-private user-top-read playlist-modify-private playlist-modify-public';
  const authURL = new URL('https://accounts.spotify.com/authorize');
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('client_id', CLIENT_ID);
  authURL.searchParams.set('scope', scope);
  authURL.searchParams.set('redirect_uri', `${APP_BASE_URL}/callback`);
  authURL.searchParams.set('state', state);
  res.redirect(authURL.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) return res.redirect('/');
  try {
    const tokenRes = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${APP_BASE_URL}/callback`,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const accessToken = tokenRes.data.access_token;
    res.cookie('spotify_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600 * 1000
    });
    res.redirect('/');
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.redirect('/');
  }
});

function getSpotifyToken(req) {
  return req.cookies.spotify_token || null;
}

async function loadSpotifyCategories(token) {
  const now = Date.now();
  if (now - categoriesFetchTime < CACHE_DURATION_MS && cachedCategories.length) {
    return cachedCategories;
  }
  try {
    const res = await axios.get('https://api.spotify.com/v1/browse/categories', {
      params: { country: 'US', limit: 50 },
      headers: { Authorization: `Bearer ${token}` }
    });
    cachedCategories = res.data.categories.items;
    categoriesFetchTime = now;
    return cachedCategories;
  } catch (err) {
    console.warn('Error loading categories:', err.response?.status);
    return [];
  }
}

async function loadSeedGenres(token) {
  const now = Date.now();
  if (now - seedGenresFetchTime < CACHE_DURATION_MS && cachedSeedGenres.length) {
    return cachedSeedGenres;
  }
  try {
    const res = await axios.get('https://api.spotify.com/v1/recommendations/available-genre-seeds', {
      headers: { Authorization: `Bearer ${token}` }
    });
    cachedSeedGenres = res.data.genres; 
    seedGenresFetchTime = now;
    return cachedSeedGenres;
  } catch (err) {
    console.warn('Error loading seed genres:', err.response?.status);
    return [];
  }
}

app.get('/api/top-tracks', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const spRes = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/top/tracks?limit=5',
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(spRes.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: err.message };
    res.status(status).json(data);
  }
});

app.get('/api/artists', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const ids = req.query.ids || '';
  if (!ids) return res.status(400).json({ error: 'Missing artist IDs' });
  try {
    const spRes = await axios({
      method: 'get',
      url: `https://api.spotify.com/v1/artists?ids=${encodeURIComponent(ids)}`,
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(spRes.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: err.message };
    res.status(status).json(data);
  }
});

app.get('/api/search-playlist', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const q = req.query.q || '';
  if (!q) return res.status(400).json({ error: 'Missing search query' });
  try {
    const spRes = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/search',
      params: { q, type: 'playlist', limit: 1 },
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(spRes.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: err.message };
    res.status(status).json(data);
  }
});

app.post('/api/create-mood-playlist', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const freeText = (req.body.mood || '').trim();
  if (!freeText) return res.status(400).json({ error: 'Missing mood text' });

  const nowDate = new Date();
  const hour = nowDate.getHours();
  const month = nowDate.getMonth();

  let timeOfDay;
  if (hour < 5 || hour >= 22) timeOfDay = 'night';
  else if (hour < 12) timeOfDay = 'morning';
  else if (hour < 17) timeOfDay = 'afternoon';
  else timeOfDay = 'evening';

  let season;
  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'fall';
  else season = 'winter';

  const searchTerms = [freeText, season, timeOfDay].join(' ').toLowerCase();

  let trackUris = [];

  // 1) Category-based search
  const categories = await loadSpotifyCategories(token);
  const matchedCategory = categories.find(cat =>
    searchTerms.includes(cat.name.toLowerCase())
  );
  if (matchedCategory) {
    try {
      const playlistsRes = await axios.get(
        `https://api.spotify.com/v1/browse/categories/${matchedCategory.id}/playlists`,
        {
          params: { country: 'US', limit: 1 },
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const items = playlistsRes.data.playlists.items;
      if (items.length > 0) {
        const playlistId = items[0].id;
        const tracksRes = await axios.get(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const fetchedTracks = tracksRes.data.items || [];
        trackUris = fetchedTracks.map(item => item.track.uri).slice(0, 20);
      }
    } catch (err) {
      console.warn('→ Category-based fetch failed:', err.response?.status);
      trackUris = [];
    }
  }

  // 2) Recommendation-based search using seed genres/artists/tracks
  if (trackUris.length === 0) {
    const sentimentResult = sentiment.analyze(freeText);
    const score = sentimentResult.score;
    const nouns = nlp(freeText).nouns().out('array');

    const availableSeeds = await loadSeedGenres(token);
    let extractedSeeds = nouns
      .map(w => w.toLowerCase().replace(/\s+/g, '-'))
      .filter(w => availableSeeds.includes(w))
      .slice(0, 2);

    let seedGenres = extractedSeeds.length > 0 ? extractedSeeds.join(',') : '';
    let seedArtists = '';
    let seedTracks = '';

    if (!seedGenres) {
      try {
        const topTracksRes = await axios.get(
          'https://api.spotify.com/v1/me/top/tracks?limit=5',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const artistIds = topTracksRes.data.items
          .map(t => t.artists[0].id)
          .slice(0, 2);
        seedArtists = artistIds.join(',');
      } catch (_) {
        seedArtists = '';
      }
    }

    if (!seedGenres && !seedArtists) {
      try {
        const topTracksRes = await axios.get(
          'https://api.spotify.com/v1/me/top/tracks?limit=5',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        seedTracks = topTracksRes.data.items
          .map(t => t.id)
          .slice(0, 3)
          .join(',');
      } catch (_) {
        seedTracks = '';
      }
    }

    let targetValence, targetEnergy;
    if (score >= 3) {
      targetValence = 0.9; targetEnergy = 0.9;
    } else if (score > 0) {
      targetValence = 0.7; targetEnergy = 0.6;
    } else if (score === 0) {
      targetValence = 0.5; targetEnergy = 0.4;
    } else if (score < 0 && score >= -2) {
      targetValence = 0.3; targetEnergy = 0.3;
    } else {
      targetValence = 0.1; targetEnergy = 0.2;
    }

    try {
      const recParams = new URLSearchParams({
        limit: '20',
        target_valence: String(targetValence),
        target_energy: String(targetEnergy),
        target_danceability: '0.6',
        min_popularity: '50'
      });
      if (seedGenres) recParams.set('seed_genres', seedGenres);
      else if (seedArtists) recParams.set('seed_artists', seedArtists);
      else if (seedTracks) recParams.set('seed_tracks', seedTracks);

      const recRes = await axios.get(
        `https://api.spotify.com/v1/recommendations?${recParams.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const recTracks = recRes.data.tracks || [];
      trackUris = recTracks.map(t => t.uri);
    } catch (_) {
      trackUris = [];
    }
  }

  // 3) Final fallback: search for a playlist by freeText
  if (trackUris.length === 0) {
    try {
      const spRes = await axios.get(
        'https://api.spotify.com/v1/search',
        {
          params: { q: freeText, type: 'playlist', limit: 1 },
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const playlists = spRes.data.playlists;
      if (playlists && Array.isArray(playlists.items) && playlists.items.length > 0) {
        return res.json({ playlistId: playlists.items[0].id });
      }
      return res.status(404).json({ error: 'no_playlist_found' });
    } catch (err) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // 4) Create a private playlist and add the found tracks
  try {
    const meRes = await axios.get(
      'https://api.spotify.com/v1/me',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const userId = meRes.data.id;
    const createRes = await axios.post(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        name: `Mixtape - ${freeText}`,
        description: `Your ${freeText} playlist`,
        public: false
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const newPlaylistId = createRes.data.id;
    await axios.post(
      `https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`,
      { uris: trackUris },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return res.json({ playlistId: newPlaylistId });
  } catch (err) {
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('spotify_token');
  res.redirect('/');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});