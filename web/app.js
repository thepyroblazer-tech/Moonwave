/* Moonwave: a music player for Audius with animated themes. */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = ms => { ms = Math.max(0, ms | 0); const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const native = () => window.MoonNative;
  const BLANK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1b2638"/><text x="5" y="6.6" font-size="4" text-anchor="middle" fill="#7f8ba0">♪</text></svg>');
  const img = u => esc(u || BLANK);
  const songs = n => n + (n === 1 ? ' song' : ' songs');
  // Some Audius covers fail to load (their CDN returns errors); show a placeholder instead of a broken image.
  document.addEventListener('error', e => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.getAttribute('src') !== BLANK) el.src = BLANK;
  }, true);

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('moonwave:' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('moonwave:' + k, JSON.stringify(v)); } catch (e) { toast('Could not save on this device.'); } },
  };

  const UI = { view: 'home', time: 'week', genre: 'All', seeking: false, sleepAt: 0 };

  /* ---------------- toast, sheet, haptics ---------------- */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; $('#sheetBackdrop').hidden = false; $('#sheet').scrollTop = 0; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; }
  $('#sheetBackdrop').onclick = closeSheet;
  function haptic() {
    if (native() && native().haptic) native().haptic();
    else if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not allowed */ } }
  }

  /* ---------------- library: favourites & playlists (saved on the phone) ---------------- */
  const Lib = {
    favs: () => store.get('favs', []),
    isFav: id => Lib.favs().some(t => t.id === id),
    toggleFav(t) {
      let f = Lib.favs();
      const on = !f.some(x => x.id === t.id);
      f = on ? [t].concat(f) : f.filter(x => x.id !== t.id);
      store.set('favs', f); haptic(); toast(on ? '♥ Added to Favourites' : 'Removed from Favourites');
      refreshFavMarks(); if (UI.view === 'library') renderLibrary();
      return on;
    },
    playlists: () => store.get('playlists', []),
    savePlaylists(p) { store.set('playlists', p); },
    newPlaylist(name) {
      const p = Lib.playlists(); const pl = { id: 'p' + Date.now().toString(36), name: name.trim() || 'My playlist', tracks: [] };
      p.unshift(pl); Lib.savePlaylists(p); return pl;
    },
    addTo(pid, t) {
      const p = Lib.playlists(), pl = p.find(x => x.id === pid); if (!pl) return;
      if (pl.tracks.some(x => x.id === t.id)) { toast('Already in ' + pl.name); return; }
      pl.tracks.push(t); Lib.savePlaylists(p); toast('Added to ' + pl.name);
    },
  };

  /* ---------------- track lists ---------------- */
  const HEART = '<svg viewBox="0 0 24 24" class="ic"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  const DOTS = '<svg viewBox="0 0 24 24" class="ic"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" class="ic"><path d="M3 6h12M3 12h12M3 18h7M18 13v8M14 17h8"/></svg>';

  /** Renders a song list into `root`. Tap plays the list from that song; swipe left adds to queue; ⋯ opens the menu. */
  function showTracks(root, list, opts = {}) {
    if (!list.length) { root.innerHTML = `<p class="empty">${esc(opts.empty || 'No songs here.')}</p>`; return; }
    const cur = Player.current();
    root.innerHTML = '<div class="rows">' + list.map((t, i) => `
      <div class="swipe-wrap"><div class="swipe-hint">${PLUS}<span>Add to queue</span></div>
        <div class="row${cur && cur.id === t.id ? ' playing' : ''}" data-i="${i}" data-id="${esc(t.id)}">
          ${opts.numbered ? `<span class="num">${i + 1}</span>` : ''}
          <img src="${img(t.artSmall)}" alt="" loading="lazy">
          <div class="rt"><div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.artist)} · ${fmt(t.duration)}</div></div>
          <button class="add fav-mark${Lib.isFav(t.id) ? ' on' : ''}" data-fav="${i}" title="Favourite">${HEART}</button>
          <button class="add" data-menu="${i}" title="More">${DOTS}</button>
        </div></div>`).join('') + '</div>';
    root.querySelectorAll('.row[data-i]').forEach(r => {
      r.onclick = e => {
        if (r.dataset.swiped) return;
        const i = +r.dataset.i, t = list[i];
        if (e.target.closest('[data-fav]')) { const on = Lib.toggleFav(t); e.target.closest('[data-fav]').classList.toggle('on', on); return; }
        if (e.target.closest('[data-menu]')) { trackMenu(t, opts.menu ? opts.menu(i) : {}); return; }
        Player.play(list, i);
        if (opts.closeOnPlay) closeSheet();
      };
      attachRowSwipe(r.parentElement, () => list[+r.dataset.i]);
    });
  }

  const QUEUE_PULL = 90;
  function attachRowSwipe(wrap, getTrack) {
    const row = wrap.querySelector('.row'); let sx = null, sy = 0, dx = 0, mode = null;
    row.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; dx = 0; mode = null; row.style.transition = 'none'; });
    row.addEventListener('pointermove', e => {
      if (sx == null) return;
      const mx = e.clientX - sx, my = e.clientY - sy;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.4) { mode = 'h'; try { row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        else if (Math.abs(my) > 10) mode = 'v';
      }
      if (mode !== 'h') return;
      dx = Math.min(0, mx); if (dx < -QUEUE_PULL) dx = -QUEUE_PULL + (dx + QUEUE_PULL) * .35;
      row.style.transform = `translateX(${dx}px)`;
      const armed = mx < -QUEUE_PULL;
      if (armed && !wrap.classList.contains('armed')) haptic();
      wrap.classList.toggle('armed', armed);
    });
    const end = () => {
      if (mode === 'h') {
        row.dataset.swiped = '1'; setTimeout(() => { delete row.dataset.swiped; }, 60);
        if (wrap.classList.contains('armed')) { const t = getTrack(); Player.addToQueue(t); toast('Added to queue: ' + t.title); wrap.classList.add('done'); }
        row.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.15)'; row.style.transform = '';
        setTimeout(() => wrap.classList.remove('armed', 'done'), 700);
      }
      sx = null; mode = null;
    };
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  }

  function refreshFavMarks() {
    $$('.row[data-id]').forEach(r => { const b = r.querySelector('.fav-mark'); if (b) b.classList.toggle('on', Lib.isFav(r.dataset.id)); });
    renderNow();
  }

  /* ---------------- menus ---------------- */
  function trackMenu(t, ctx = {}) {
    const fav = Lib.isFav(t.id);
    openSheet(`<div class="sheet-head small"><img src="${img(t.art)}" alt=""><div><div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.artist)}</div></div></div>
      <div class="rows menu">
        <button class="row" data-a="next"><div class="act-ic">⤵</div><div class="rt"><div class="t1">Play next</div></div></button>
        <button class="row" data-a="queue"><div class="act-ic">≡</div><div class="rt"><div class="t1">Add to queue</div></div></button>
        <button class="row" data-a="fav"><div class="act-ic">♥</div><div class="rt"><div class="t1">${fav ? 'Remove from Favourites' : 'Add to Favourites'}</div></div></button>
        <button class="row" data-a="pl"><div class="act-ic">＋</div><div class="rt"><div class="t1">Add to playlist</div></div></button>
        ${ctx.removeFromPlaylist ? '<button class="row" data-a="rm"><div class="act-ic">✕</div><div class="rt"><div class="t1">Remove from this playlist</div></div></button>' : ''}
        ${t.artistId ? '<button class="row" data-a="artist"><div class="act-ic">☺</div><div class="rt"><div class="t1">Go to artist</div><div class="t2">' + esc(t.artist) + '</div></div></button>' : ''}
        <button class="row" data-a="open"><div class="act-ic">↗</div><div class="rt"><div class="t1">Open on Audius</div></div></button>
      </div>`);
    $$('#sheetBody [data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'next') { Player.addToQueue(t, true); toast('Plays next: ' + t.title); closeSheet(); }
      else if (a === 'queue') { Player.addToQueue(t); toast('Added to queue: ' + t.title); closeSheet(); }
      else if (a === 'fav') { Lib.toggleFav(t); closeSheet(); }
      else if (a === 'pl') pickPlaylist(t);
      else if (a === 'rm') { ctx.removeFromPlaylist(); closeSheet(); }
      else if (a === 'artist') { closeSheet(); openArtist({ id: t.artistId, name: t.artist, handle: t.handle }); }
      else if (a === 'open') { closeSheet(); openLink(Audius.pageUrl(t)); }
    });
  }

  function pickPlaylist(t) {
    const pls = Lib.playlists();
    openSheet(`<div class="section-title">Add to playlist</div>
      <form id="newPl" class="inline-form"><input class="field" id="newPlName" placeholder="New playlist name" maxlength="60"><button class="btn primary">Create</button></form>
      <div class="rows">${pls.map(p => `<button class="row" data-p="${esc(p.id)}"><img src="${img(p.tracks[0] && p.tracks[0].artSmall)}" alt=""><div class="rt"><div class="t1">${esc(p.name)}</div><div class="t2">${songs(p.tracks.length)}</div></div></button>`).join('')}</div>`);
    $('#newPl').onsubmit = e => { e.preventDefault(); const pl = Lib.newPlaylist($('#newPlName').value); Lib.addTo(pl.id, t); closeSheet(); if (UI.view === 'library') renderLibrary(); };
    $$('#sheetBody [data-p]').forEach(b => b.onclick = () => { Lib.addTo(b.dataset.p, t); closeSheet(); if (UI.view === 'library') renderLibrary(); });
  }

  function openLink(url) {
    if (native()) native().openExternal(url); else window.open(url, '_blank', 'noopener');
  }

  async function openArtist(u) {
    openSheet(`<div class="sheet-head"><img class="round" src="${img(u.pic)}" alt=""><div><div class="t1">${esc(u.name)}${u.verified ? ' ✓' : ''}</div><div class="t2">@${esc(u.handle || '')}</div>
      <button class="btn primary" id="artistPlay" disabled>Play</button></div></div><div id="artistTracks" class="loading">Loading songs</div>`);
    try {
      const list = await Audius.userTracks(u.id);
      const box = $('#artistTracks'); if (!box) return;
      box.className = ''; showTracks(box, list, { empty: 'This artist has no playable songs.', closeOnPlay: true });
      const pb = $('#artistPlay'); if (pb && list.length) { pb.disabled = false; pb.onclick = () => { Player.play(list, 0); closeSheet(); }; }
    } catch (e) { const box = $('#artistTracks'); if (box) { box.className = 'empty'; box.textContent = e.message; } }
  }

  /* ---------------- navigation ---------------- */
  function go(view) {
    UI.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === view));
    renderMini();
    if (view === 'library') renderLibrary();
    if (view === 'themes') renderThemes();
    if (view === 'search' && !$('#searchInput').value) setTimeout(() => $('#searchInput').focus(), 250);
  }
  $$('.tabs button').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#mini').onclick = e => { if (!e.target.closest('button')) go('now'); };
  window.onNativeBack = () => {
    if (!$('#sheet').hidden) { closeSheet(); return true; }
    if (UI.view !== 'home') { go('home'); return true; }
    return false;
  };

  /* ---------------- home: trending ---------------- */
  const trendCache = new Map();
  $('#genreChips').innerHTML = Audius.GENRES.map(g => `<button class="chip${g === 'All' ? ' on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('');
  $$('#genreChips [data-genre]').forEach(b => b.onclick = () => { UI.genre = b.dataset.genre; $$('#genreChips .chip').forEach(c => c.classList.toggle('on', c === b)); loadHome(); });
  $$('#timeSeg button').forEach(b => b.onclick = () => { UI.time = b.dataset.time; $$('#timeSeg button').forEach(x => x.classList.toggle('on', x === b)); loadHome(); });

  async function loadHome() {
    const body = $('#homeBody'), key = UI.time + '|' + UI.genre;
    if (!trendCache.has(key)) body.innerHTML = '<div class="loading">Loading trending songs</div>';
    try {
      let list = trendCache.get(key);
      if (!list) {
        const opts = { time: UI.time }; if (UI.genre !== 'All') opts.genre = UI.genre;
        list = await Audius.trending(opts); trendCache.set(key, list);
      }
      if (key !== UI.time + '|' + UI.genre) return;
      body.innerHTML = list.length ? '<button class="btn ghost slim" id="playAllTrending">▶ Play all</button><div id="trendList"></div>' : '';
      if (list.length) { $('#playAllTrending').onclick = () => Player.play(list, 0); showTracks($('#trendList'), list, { numbered: true }); }
      else body.innerHTML = '<p class="empty">Nothing trending here right now.</p>';
    } catch (e) {
      body.innerHTML = `<p class="empty">${esc(e.message)}</p><button class="btn ghost" id="retryHome">Try again</button>`;
      $('#retryHome').onclick = loadHome;
    }
  }

  /* ---------------- search ---------------- */
  let searchTimer = 0, searchSeq = 0;
  $('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 400); });
  $('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); e.target.blur(); } });
  async function runSearch() {
    const q = $('#searchInput').value.trim(), body = $('#searchBody'), seq = ++searchSeq;
    if (!q) { body.innerHTML = '<p class="muted center pad-top">Find songs and artists on Audius.</p>'; return; }
    body.innerHTML = '<div class="loading">Searching</div>';
    try {
      const [users, list] = await Promise.all([Audius.searchUsers(q).catch(() => []), Audius.searchTracks(q)]);
      if (seq !== searchSeq) return;
      let html = '';
      if (users.length) html += '<div class="section-title">Artists</div><div class="artist-strip">' + users.slice(0, 8).map((u, i) => `<button class="artist-chip" data-u="${i}"><img src="${img(u.pic)}" alt="" loading="lazy"><span>${esc(u.name)}</span></button>`).join('') + '</div>';
      html += '<div class="section-title">Songs</div><div id="searchTracks"></div>';
      body.innerHTML = html;
      showTracks($('#searchTracks'), list, { empty: 'No songs found for “' + q + '”.' });
      body.querySelectorAll('[data-u]').forEach(b => b.onclick = () => openArtist(users[+b.dataset.u]));
    } catch (e) { if (seq === searchSeq) body.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  /* ---------------- library ---------------- */
  let libTab = 'favs';
  $$('#libSeg button').forEach(b => b.onclick = () => { libTab = b.dataset.lib; $$('#libSeg button').forEach(x => x.classList.toggle('on', x === b)); renderLibrary(); });
  function renderLibrary() {
    const body = $('#libBody');
    if (libTab === 'favs') {
      const f = Lib.favs();
      body.innerHTML = f.length ? '<div class="btn-row"><button class="btn primary slim" id="favPlay">▶ Play</button><button class="btn ghost slim" id="favShuffle">⤨ Shuffle</button></div><div id="favList"></div>' : '';
      if (!f.length) { body.innerHTML = '<p class="empty">Tap ♥ on any song to save it here.</p>'; return; }
      $('#favPlay').onclick = () => { Player.setShuffle(false); Player.play(f, 0); };
      $('#favShuffle').onclick = () => { const i = Math.floor(Math.random() * f.length); Player.play(f, i); Player.setShuffle(true); };
      showTracks($('#favList'), f);
    } else {
      const pls = Lib.playlists();
      body.innerHTML = '<form id="libNewPl" class="inline-form"><input class="field" id="libNewPlName" placeholder="New playlist name" maxlength="60"><button class="btn primary">Create</button></form>' +
        (pls.length ? '<div class="grid">' + pls.map(p => `<button class="tile" data-p="${esc(p.id)}"><div class="tile-art">${p.tracks.slice(0, 4).map(t => `<img src="${img(t.artSmall)}" alt="">`).join('') || '<span>♪</span>'}</div><div class="t1">${esc(p.name)}</div><div class="t2">${songs(p.tracks.length)}</div></button>`).join('') + '</div>'
          : '<p class="empty">No playlists yet. Make one above, or use ⋯ → Add to playlist on any song.</p>');
      $('#libNewPl').onsubmit = e => { e.preventDefault(); const n = $('#libNewPlName').value.trim(); if (!n) return; Lib.newPlaylist(n); toast('Playlist created'); renderLibrary(); };
      body.querySelectorAll('[data-p]').forEach(b => b.onclick = () => openPlaylist(b.dataset.p));
    }
  }

  function openPlaylist(pid) {
    const pl = Lib.playlists().find(p => p.id === pid); if (!pl) return;
    openSheet(`<div class="sheet-head"><img src="${img(pl.tracks[0] && pl.tracks[0].art)}" alt=""><div><div class="t1">${esc(pl.name)}</div><div class="t2">${songs(pl.tracks.length)}</div>
      <div class="btn-row"><button class="btn primary slim" id="plPlay"${pl.tracks.length ? '' : ' disabled'}>▶ Play</button><button class="btn ghost slim" id="plRename">Rename</button><button class="btn ghost slim" id="plDelete">Delete</button></div></div></div><div id="plTracks"></div>`);
    $('#plPlay').onclick = () => { Player.play(pl.tracks, 0); closeSheet(); };
    $('#plRename').onclick = () => {
      $('#sheetBody .sheet-head .t1').innerHTML = `<form id="renameForm" class="inline-form"><input class="field" id="renameInput" value="${esc(pl.name)}" maxlength="60"><button class="btn primary">Save</button></form>`;
      $('#renameInput').focus();
      $('#renameForm').onsubmit = e => { e.preventDefault(); const p = Lib.playlists(), x = p.find(q => q.id === pid); x.name = $('#renameInput').value.trim() || x.name; Lib.savePlaylists(p); renderLibrary(); openPlaylist(pid); };
    };
    $('#plDelete').onclick = () => {
      const b = $('#plDelete');
      if (b.dataset.sure) { Lib.savePlaylists(Lib.playlists().filter(p => p.id !== pid)); closeSheet(); renderLibrary(); toast('Playlist deleted'); return; }
      b.dataset.sure = '1'; b.textContent = 'Tap again to delete';
    };
    showTracks($('#plTracks'), pl.tracks, {
      empty: 'Empty. Use ⋯ → Add to playlist on any song.', closeOnPlay: true,
      menu: i => ({ removeFromPlaylist: () => { const p = Lib.playlists(), x = p.find(q => q.id === pid); x.tracks.splice(i, 1); Lib.savePlaylists(p); renderLibrary(); toast('Removed'); } }),
    });
  }

  /* ---------------- now playing ---------------- */
  function setPct(input) { input.style.setProperty('--pct', (input.value / input.max * 100) + '%'); }
  let lastArt = '';
  function renderNow() {
    const S = Player.state, t = Player.current();
    $('#title').textContent = t ? t.title : 'Nothing playing';
    $('#artist').textContent = t ? t.artist : 'Pick a song from Trending or Search';
    $('#artist').disabled = !(t && t.artistId);
    const art = t ? (t.artBig || t.art) : '';
    if (art !== lastArt) { lastArt = art; $('#cover').src = art || BLANK; Themes.setArtwork(t ? t.art : ''); }
    $('#cover').classList.toggle('spinning', !!(t && S.playing && !S.buffering));
    $('#playIcon').innerHTML = S.playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('#playBtn').classList.toggle('busy', !!(S.buffering && S.playing));
    $('#favBtn').style.visibility = t ? 'visible' : 'hidden';
    $('#favBtn').classList.toggle('on', !!(t && Lib.isFav(t.id)));
    $('#shuffleBtn').classList.toggle('on', S.shuffle);
    $('#repeatBtn').classList.toggle('on', S.repeat !== 'off');
    $('#repeatBtn').classList.toggle('one', S.repeat === 'one');
    $('#swipeTip').hidden = !t;
    const st = $('#status'); st.hidden = !S.error; st.textContent = S.error || '';
    renderProgress(); renderMini();
    $$('.row[data-id]').forEach(r => r.classList.toggle('playing', !!(t && r.dataset.id === t.id)));
  }
  function renderProgress() {
    if (UI.seeking) return;
    const dur = Player.state.duration, pos = Player.livePos();
    $('#seek').value = dur ? Math.round(pos / dur * 1000) : 0; setPct($('#seek'));
    $('#seek').disabled = !dur;
    $('#pos').textContent = fmt(pos); $('#dur').textContent = fmt(dur);
  }
  function renderMini() {
    const t = Player.current();
    $('#mini').hidden = UI.view === 'now' || !t;
    if (!t) return;
    const a = t.artSmall || BLANK; if ($('#miniCover').getAttribute('src') !== a) $('#miniCover').src = a;
    $('#miniTitle').textContent = t.title; $('#miniArtist').textContent = t.artist;
    $('#miniPlayPath').setAttribute('d', Player.state.playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
  }
  Player.onChange(renderNow);
  setInterval(() => { if (!document.hidden && Player.state.playing) renderProgress(); }, 500);

  $('#playBtn').onclick = () => { if (!Player.current()) { go('home'); toast('Pick a song to start'); return; } Player.toggle(); };
  $('#miniPlay').onclick = () => Player.toggle();
  $('#miniNext').onclick = () => Player.next();
  $('#nextBtn').onclick = () => Player.next();
  $('#prevBtn').onclick = () => Player.prev();
  $('#shuffleBtn').onclick = () => { const on = !Player.state.shuffle; Player.setShuffle(on); toast(on ? 'Shuffle on' : 'Shuffle off'); };
  $('#repeatBtn').onclick = () => {
    const order = ['off', 'all', 'one'], next = order[(order.indexOf(Player.state.repeat) + 1) % 3];
    Player.setRepeat(next); toast({ off: 'Repeat off', all: 'Repeat the queue', one: 'Repeat this song' }[next]);
  };
  $('#favBtn').onclick = () => { const t = Player.current(); if (t) Lib.toggleFav(t); };
  $('#artist').onclick = () => { const t = Player.current(); if (t && t.artistId) openArtist({ id: t.artistId, name: t.artist, handle: t.handle }); };

  const seek = $('#seek');
  seek.addEventListener('input', () => { UI.seeking = true; setPct(seek); $('#pos').textContent = fmt(seek.value / 1000 * Player.state.duration); });
  seek.addEventListener('change', () => { UI.seeking = false; Player.seek(seek.value / 1000 * Player.state.duration); });

  /* queue */
  $('#queueBtn').onclick = openQueue;
  function openQueue() {
    const S = Player.state;
    if (!S.queue.length) { toast('The queue is empty'); return; }
    openSheet('<div class="section-title">Queue</div><p class="muted small">Tap to jump to a song. ✕ removes it.</p><div class="rows">' + S.queue.map((t, i) => `
      <div class="row q${i === S.index ? ' playing' : ''}${i < S.index ? ' past' : ''}" data-q="${i}">
        <span class="num">${i === S.index ? '♪' : i + 1}</span><img src="${img(t.artSmall || t.art)}" alt="" loading="lazy">
        <div class="rt"><div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.artist)}</div></div>
        ${i === S.index ? '' : `<button class="add" data-rm="${i}" title="Remove">✕</button>`}
      </div>`).join('') + '</div>');
    $$('#sheetBody [data-q]').forEach(r => r.onclick = e => {
      const i = +r.dataset.q;
      if (e.target.closest('[data-rm]')) { Player.removeAt(i); setTimeout(openQueue, 150); return; }
      Player.skipTo(i); closeSheet();
    });
    const cur = $('#sheetBody .row.playing'); if (cur) cur.scrollIntoView({ block: 'center' });
  }

  /* swipe the cover */
  (function coverSwipe() {
    const sw = $('#coverSwipe'); let sx = null, dx = 0, busy = false;
    const reset = anim => { sw.style.transition = anim ? 'transform .45s cubic-bezier(.2,.9,.3,1.15), opacity .35s' : 'none'; sw.style.transform = ''; sw.style.opacity = ''; };
    sw.addEventListener('pointerdown', e => {
      if (busy || !Player.current()) return;
      sx = e.clientX; dx = 0; sw.style.transition = 'none';
      try { sw.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    sw.addEventListener('pointermove', e => {
      if (sx == null) return;
      dx = e.clientX - sx;
      sw.style.transform = `translateX(${dx}px) rotate(${dx / 16}deg)`;
      sw.style.opacity = String(1 - Math.min(.45, Math.abs(dx) / 700));
    });
    const end = async () => {
      if (sx == null) return; sx = null;
      const dir = dx < -70 ? 1 : dx > 70 ? -1 : 0;
      if (!dir) { reset(true); return; }
      busy = true; haptic();
      sw.style.transition = 'transform .22s ease-in, opacity .22s';
      sw.style.transform = `translateX(${dir > 0 ? -130 : 130}vw) rotate(${dir > 0 ? -25 : 25}deg)`; sw.style.opacity = '0';
      const old = (Player.current() || {}).id;
      if (dir > 0) Player.next(); else Player.prev();
      for (let i = 0; i < 12 && (Player.current() || {}).id === old; i++) await new Promise(r => setTimeout(r, 80));
      await new Promise(r => setTimeout(r, 120));
      sw.style.transition = 'none'; sw.style.transform = `translateX(${dir > 0 ? 130 : -130}vw) rotate(${dir > 0 ? 25 : -25}deg)`;
      void sw.offsetWidth;
      reset(true); busy = false;
    };
    sw.addEventListener('pointerup', end); sw.addEventListener('pointercancel', end);
  })();

  /* ---------------- sleep timer ---------------- */
  const useNativeSleep = () => native() && native().sleepSet;
  const Sleep = {
    endsAt() { return useNativeSleep() ? (+native().sleepGet() || 0) : (UI.sleepAt || 0); },
    set(at) { if (useNativeSleep()) native().sleepSet(String(Math.round(at))); else UI.sleepAt = at; renderSleep(); },
    cancel() { if (useNativeSleep()) native().sleepCancel(); UI.sleepAt = 0; renderSleep(); },
  };
  function renderSleep() {
    const left = Sleep.endsAt() - Date.now(), on = left > 0;
    $('#sleepBtn').classList.toggle('on', on);
    $('#sleepLabel').textContent = on ? 'Stops in ' + fmt(left) : 'Sleep timer';
  }
  setInterval(() => {
    if (UI.sleepAt && Date.now() >= UI.sleepAt && !useNativeSleep()) { UI.sleepAt = 0; Player.pause(); toast('Sleep timer: music paused. Good night ☾'); }
    if (!document.hidden) renderSleep();
  }, 1000);
  $('#sleepBtn').onclick = () => {
    const on = Sleep.endsAt() > Date.now();
    const mins = [5, 15, 30, 45, 60, 90];
    openSheet('<div class="section-title">Sleep timer</div><p class="muted small">Pauses the music when the time is up, even with the screen off.</p><div class="sleep-grid">' +
      mins.map(m => `<button class="chip big" data-min="${m}">${m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours')}</button>`).join('') +
      '<button class="chip big" data-min="song">End of this song</button></div>' +
      (on ? '<button class="btn ghost" id="sleepOff">Turn the timer off</button>' : ''));
    $$('#sheetBody [data-min]').forEach(b => b.onclick = () => {
      let at;
      if (b.dataset.min === 'song') {
        if (!Player.current() || !Player.state.duration) { toast('Nothing is playing.'); return; }
        at = Date.now() + (Player.state.duration - Player.livePos()) - 400;
      } else at = Date.now() + (+b.dataset.min) * 60000;
      Sleep.set(at); closeSheet(); toast('Music will pause in ' + fmt(at - Date.now()));
    });
    const off = $('#sleepOff'); if (off) off.onclick = () => { Sleep.cancel(); closeSheet(); toast('Sleep timer off'); };
  };

  /* ---------------- themes ---------------- */
  function renderThemes() {
    const cur = Themes.current;
    $('#themeList').innerHTML = Object.entries(Themes.THEMES).map(([id, th]) => `
      <button class="theme-card${cur.id === id ? ' on' : ''}" data-theme="${id}" style="background:${Themes.previewFor(id, id === 'starry' ? cur.scheme : null)}">
        <span class="tc-sub">${esc(th.sub)}</span><span>${esc(th.name)}</span></button>`).join('');
    $('#schemeList').innerHTML = Object.entries(Themes.STARRY).map(([name, s]) => `
      <button class="scheme${cur.id === 'starry' && cur.scheme === name ? ' on' : ''}" data-scheme="${esc(name)}"><i style="background:linear-gradient(180deg,${s.top},${s.bottom})"></i>${esc(name)}</button>`).join('');
    $$('#themeList [data-theme]').forEach(b => b.onclick = () => setTheme(b.dataset.theme, cur.scheme));
    $$('#schemeList [data-scheme]').forEach(b => b.onclick = () => setTheme('starry', b.dataset.scheme));
    $$('#motionSeg button').forEach(b => b.classList.toggle('on', b.dataset.motion === Themes.motion));
    $('#spinToggle').checked = store.get('spin', true) !== false;
  }
  function pushAccent() { if (native() && native().setAccent) native().setAccent(Themes.accentHex()); }
  function setTheme(id, scheme) { Themes.apply(id, scheme); store.set('theme', Themes.current); pushAccent(); renderThemes(); }
  $$('#motionSeg button').forEach(b => b.onclick = () => { Themes.setMotion(b.dataset.motion); store.set('motion', b.dataset.motion); renderThemes(); });
  $('#spinToggle').onchange = e => { store.set('spin', e.target.checked); document.body.classList.toggle('no-spin', !e.target.checked); };
  window.onThemeColors = () => { pushAccent(); if (UI.view === 'themes') renderThemes(); };

  /* ---------------- Android shell hooks ---------------- */
  window.onNativeInsets = (top, bottom) => {
    document.documentElement.style.setProperty('--sat', top + 'px');
    document.documentElement.style.setProperty('--sab', bottom + 'px');
  };
  window.onNativeResume = () => Player.refresh();
  window.onNativeOpenNow = () => go('now');

  /* ---------------- boot ---------------- */
  const saved = store.get('theme', { id: 'starry', scheme: 'Base' });
  Themes.start($('#sky')); Themes.apply(saved.id, saved.scheme);
  Themes.setMotion(store.get('motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'calm' : 'full'));
  document.body.classList.toggle('no-spin', store.get('spin', true) === false);
  pushAccent();
  Player.refresh();
  renderNow();
  loadHome();
  if (/[?&]now\b/.test(location.search)) go('now');
})();
