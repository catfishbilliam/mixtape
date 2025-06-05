require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL; // e.g. https://my-heroku-app.herokuapp.com

// 1. Serve static front-end
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// 2. Step 1 of OAuth: redirect user to Spotify’s authorize endpoint
app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const scope = 'playlist-read-private user-top-read';
  const authURL = new URL('https://accounts.spotify.com/authorize');
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('client_id', CLIENT_ID);
  authURL.searchParams.set('scope', scope);
  authURL.searchParams.set('redirect_uri', `${APP_BASE_URL}/callback`);
  authURL.searchParams.set('state', state);

  // (Optionally store state in a cookie; omitted for brevity)
  res.redirect(authURL.toString());
});

// 3. Step 2 of OAuth: Spotify redirects back here with ?code=<code>
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) {
    return res.redirect('/');
  }

  // Exchange code for access token (and refresh token if needed)
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
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const accessToken = tokenRes.data.access_token;
    // Optionally store refresh_token: tokenRes.data.refresh_token

    // Set HTTP-only cookie so front-end can’t read it (server proxies calls)
    res.cookie('spotify_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600 * 1000 // 1 hour
    });

    // Redirect back to front-end’s main page
    res.redirect('/');
  } catch (err) {
    console.error('Token exchange error:', err.response ? err.response.data : err.message);
    res.redirect('/');
  }
});

// 4. Helper: get the stored token from the cookie
function getSpotifyToken(req) {
  return req.cookies.spotify_token || null;
}

// 5. API: GET /api/top-tracks → proxied /v1/me/top/tracks
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

// 6. API: GET /api/artists?ids=<comma-separated-ids>
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

// 7. API: GET /api/search-playlist?q=<query>
app.get('/api/search-playlist', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const q = req.query.q || '';
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  try {
    const spRes = await axios({
      method: 'get',
      url: `https://api.spotify.com/v1/search`,
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

// … all your other routes above …

// 8. Catch-all: serve index.html for any other route (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  });
  
  // 9. Logout endpoint: clear the Spotify token cookie
  app.get('/logout', (req, res) => {
    res.clearCookie('spotify_token');
    res.redirect('/');
  });
  
  // Only one listen() call at the very end:
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });