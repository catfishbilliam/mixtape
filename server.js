require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const path = require('path');
const Sentiment = require('sentiment');
const nlp = require('compromise');

const app = express();
const sentiment = new Sentiment();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL;

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
  } catch {
    res.redirect('/');
  }
});

function getSpotifyToken(req) {
  return req.cookies.spotify_token || null;
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

  const sentimentResult = sentiment.analyze(freeText);
  const score = sentimentResult.score; 
  const doc = nlp(freeText).nouns().out('array');
  const seedGenres = doc.slice(0, 2).join(',') || 'pop,indie';

  const targetValence = score > 2 ? 0.8 : score < -2 ? 0.2 : 0.5;
  const targetEnergy = score > 2 ? 0.9 : score < -2 ? 0.3 : 0.5;

  try {
    const recParams = new URLSearchParams({
      seed_genres: seedGenres,
      limit: '20',
      target_valence: String(targetValence),
      target_energy: String(targetEnergy)
    });
    const recRes = await axios.get(
      `https://api.spotify.com/v1/recommendations?${recParams.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const trackUris = recRes.data.tracks.map(t => t.uri);

    const meRes = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = meRes.data.id;

    const createRes = await axios.post(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      { name: `Mixtape - ${freeText}`, description: `Your ${freeText} playlist`, public: false },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const newPlaylistId = createRes.data.id;

    await axios.post(
      `https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`,
      { uris: trackUris },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    res.json({ playlistId: newPlaylistId });
  } catch {
    res.status(500).json({ error: 'server_error' });
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