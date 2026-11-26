/* Audius REST API client (https://api.audius.co/v1). Read-only calls need no key. */
(function () {
  'use strict';

  const BASE = 'https://api.audius.co/v1';
  const APP = 'Moonwave';

  async function get(path, params = {}) {
    const q = new URLSearchParams({ ...params, app_name: APP });
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(BASE + path + '?' + q);
        if (r.status === 429) { await new Promise(res => setTimeout(res, 800 * (attempt + 1))); continue; }
        if (!r.ok) throw new Error('Audius error ' + r.status);
        const j = await r.json();
        return j.data;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
      }
    }
    throw lastErr && /fetch|network/i.test(lastErr.message) ? new Error('No connection to Audius. Check your internet.') : lastErr;
  }

  /** True when the track can be streamed for free (not deleted, gated or unavailable). */
  function playable(t) {
    if (!t || t.is_delete || t.is_available === false || t.is_streamable === false) return false;
    if (t.access && t.access.stream === false) return false;
    if (t.is_stream_gated && !(t.access && t.access.stream)) return false;
    return true;
  }

  /** Small, storable track object used everywhere in the app (queue, favourites, playlists). */
  function slim(t) {
    const a = t.artwork || {};
    return {
      id: t.id, title: t.title || 'Untitled', artist: (t.user && t.user.name) || 'Unknown artist',
      handle: (t.user && t.user.handle) || '', artistId: (t.user && t.user.id) || '',
      duration: (t.duration || 0) * 1000,
      art: a['480x480'] || a['150x150'] || a['1000x1000'] || '',
      artSmall: a['150x150'] || a['480x480'] || '',
      artBig: a['1000x1000'] || a['480x480'] || '',
      permalink: t.permalink || '', genre: t.genre || '',
    };
  }
  const tracks = list => (list || []).filter(playable).map(slim);

  function slimUser(u) {
    const p = u.profile_picture || {};
    return { id: u.id, name: u.name || u.handle, handle: u.handle, verified: !!u.is_verified,
      pic: p['150x150'] || p['480x480'] || '', followers: u.follower_count || 0, trackCount: u.track_count || 0 };
  }

  window.Audius = {
    streamUrl: id => `${BASE}/tracks/${encodeURIComponent(id)}/stream?app_name=${APP}`,
    pageUrl: t => t.permalink ? 'https://audius.co' + t.permalink : 'https://audius.co',
    trending: (opts = {}) => get('/tracks/trending', { limit: 50, ...opts }).then(tracks),
    searchTracks: q => get('/tracks/search', { query: q, limit: 30 }).then(tracks),
    searchUsers: q => get('/users/search', { query: q, limit: 10 }).then(l => (l || []).map(slimUser)),
    userTracks: id => get('/users/' + encodeURIComponent(id) + '/tracks', { limit: 50, sort: 'plays' }).then(tracks),
    GENRES: ['All', 'Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Pop', 'House', 'Alternative', 'R&B/Soul', 'Rock', 'Ambient', 'Techno', 'Dubstep', 'Trap', 'Drum & Bass'],
  };
})();
