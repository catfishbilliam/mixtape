app.post('/api/create-mood-playlist', async (req, res) => {
  const token = getSpotifyToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const freeText = (req.body.mood || '').trim();
  if (!freeText) return res.status(400).json({ error: 'Missing mood text' });

  // NLP + sentiment for recommendation-based playlist
  const sentimentResult = sentiment.analyze(freeText);
  const score = sentimentResult.score;
  const nouns = nlp(freeText).nouns().out('array');

  // Load available seed genres (cached)
  const availableSeeds = await loadSeedGenres(token);

  // Extract seed genres from the user's mood text
  let extractedSeeds = nouns
    .map(w => w.toLowerCase().replace(/\s+/g, '-'))
    .filter(w => availableSeeds.includes(w))
    .slice(0, 2);

  let seedGenres = extractedSeeds.length > 0 ? extractedSeeds.join(',') : '';
  let seedArtists = '';
  let seedTracks = '';

  // If no seed genres, use top artists
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

  // If no seed genres or artists, fallback to seed tracks
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

  // Map sentiment to valence & energy
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

  let trackUris = [];
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

  // Fallback: find the most popular playlist by searching
  if (trackUris.length === 0) {
    try {
      const searchRes = await axios.get(
        'https://api.spotify.com/v1/search',
        {
          params: { q: freeText, type: 'playlist', limit: 10 },
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const playlists = searchRes.data.playlists;
      if (playlists && Array.isArray(playlists.items) && playlists.items.length > 0) {
        const playlistDetailsPromises = playlists.items.map(p =>
          axios.get(`https://api.spotify.com/v1/playlists/${p.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          }).then(res => res.data).catch(() => null)
        );
        const detailedPlaylists = await Promise.all(playlistDetailsPromises);
        const validDetails = detailedPlaylists.filter(p => p && p.followers && typeof p.followers.total === 'number');
        if (validDetails.length > 0) {
          validDetails.sort((a, b) => b.followers.total - a.followers.total);
          const topPlaylist = validDetails[0];
          return res.json({ playlistId: topPlaylist.id });
        }
        return res.json({ playlistId: playlists.items[0].id });
      }
      return res.status(404).json({ error: 'no_playlist_found' });
    } catch (err) {
      return res.status(500).json({ error: 'server_error' });
    }
  }

  // Create a private playlist and add tracks
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