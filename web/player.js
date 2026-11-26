/* Playback. On the phone the Android app plays the audio (so it keeps going with the screen off and
   shows lock-screen controls); in a PC browser an <audio> element plays it instead. Both expose the same API. */
(function () {
  'use strict';

  const native = () => window.MoonNative;
  const listeners = new Set();
  const S = { queue: [], index: -1, playing: false, buffering: false, position: 0, posAt: Date.now(), duration: 0, shuffle: false, repeat: 'off', error: '' };
  const emit = () => listeners.forEach(fn => { try { fn(S); } catch (e) { console.warn(e); } });
  const forNative = t => ({ id: t.id, title: t.title, artist: t.artist, art: t.art, artBig: t.artBig, duration: t.duration, handle: t.handle, artistId: t.artistId, permalink: t.permalink });

  /* ---------------- phone: native ExoPlayer ---------------- */
  function NativeEngine() {
    const n = native();
    function apply(j) {
      if (j.queue) S.queue = j.queue;
      S.index = j.index; S.playing = j.playing; S.buffering = j.buffering;
      S.position = j.position; S.posAt = Date.now(); S.duration = j.duration || (S.queue[S.index] || {}).duration || 0;
      S.shuffle = j.shuffle; S.repeat = j.repeat; S.error = j.error || '';
      emit();
    }
    window.onPlayerState = json => { try { apply(JSON.parse(json)); } catch (e) { console.warn(e); } };
    return {
      refresh() { try { apply(JSON.parse(n.state(true))); } catch (e) { /* not ready yet */ } },
      setQueue(list, i) { S.queue = list.slice(); S.index = i; emit(); n.setQueue(JSON.stringify(list.map(forNative)), i); },
      add(list, next) { n.add(JSON.stringify(list.map(forNative)), !!next); },
      cmd(c, arg) { n.control(c, arg == null ? '' : String(arg)); },
    };
  }

  /* ---------------- PC browser: <audio> ---------------- */
  function WebEngine() {
    const a = new Audio(); a.preload = 'auto';
    let order = [];
    const sync = () => { S.playing = !a.paused; S.position = (a.currentTime || 0) * 1000; S.posAt = Date.now(); S.duration = isFinite(a.duration) ? a.duration * 1000 : ((S.queue[S.index] || {}).duration || 0); emit(); };
    ['play', 'pause', 'loadedmetadata', 'seeked', 'durationchange'].forEach(ev => a.addEventListener(ev, sync));
    a.addEventListener('waiting', () => { S.buffering = true; emit(); });
    a.addEventListener('playing', () => { S.buffering = false; S.error = ''; sync(); });
    a.addEventListener('error', () => { S.error = 'This track could not be played. Skipping.'; emit(); setTimeout(() => step(1, true), 800); });
    a.addEventListener('ended', () => { if (S.repeat === 'one') { a.currentTime = 0; a.play(); } else step(1, true); });
    function load(i, autoplay = true) {
      if (i < 0 || i >= S.queue.length) return;
      S.index = i; S.buffering = true; a.src = Audius.streamUrl(S.queue[i].id);
      if (autoplay) a.play().catch(() => {});
      emit();
    }
    function step(d, auto) {
      if (!S.queue.length) return;
      if (S.shuffle && d > 0) {
        if (!order.length) order = S.queue.map((_, i) => i).filter(i => i !== S.index).sort(() => Math.random() - .5);
        const nxt = order.shift(); if (nxt != null) return load(nxt);
      }
      let i = S.index + d;
      if (i >= S.queue.length) { if (S.repeat === 'all' || !auto) i = 0; else { a.pause(); return; } }
      if (i < 0) i = S.repeat === 'all' ? S.queue.length - 1 : 0;
      load(i);
    }
    return {
      refresh() { emit(); },
      setQueue(list, i) { S.queue = list.slice(); order = []; load(i); },
      add(list, next) {
        if (S.index < 0) { S.queue = list.slice(); load(0); return; }
        if (next) S.queue.splice(S.index + 1, 0, ...list); else S.queue.push(...list);
        order = []; emit();
      },
      cmd(c, arg) {
        switch (c) {
          case 'play': if (S.index < 0 && S.queue.length) load(0); else a.play().catch(() => {}); break;
          case 'pause': a.pause(); break;
          case 'toggle': if (a.paused) a.play().catch(() => {}); else a.pause(); break;
          case 'next': step(1, false); break;
          case 'prev': if (a.currentTime > 3) a.currentTime = 0; else step(-1, false); break;
          case 'seek': a.currentTime = (+arg) / 1000; break;
          case 'skipTo': load(+arg); break;
          case 'remove': {
            const i = +arg; if (i === S.index) return;
            S.queue.splice(i, 1); if (i < S.index) S.index--; order = []; emit(); break;
          }
          case 'shuffle': S.shuffle = arg === 'true'; order = []; emit(); break;
          case 'repeat': S.repeat = arg; emit(); break;
        }
      },
    };
  }

  const engine = native() ? NativeEngine() : WebEngine();

  window.Player = {
    state: S,
    onChange(fn) { listeners.add(fn); },
    current: () => S.queue[S.index] || null,
    livePos() {
      let p = S.position + (S.playing && !S.buffering ? Date.now() - S.posAt : 0);
      return Math.max(0, S.duration ? Math.min(p, S.duration) : p);
    },
    play(list, i = 0) { engine.setQueue(list, i); },
    addToQueue(list, next) { engine.add(Array.isArray(list) ? list : [list], next); },
    toggle: () => engine.cmd('toggle'),
    pause: () => engine.cmd('pause'),
    resume: () => engine.cmd('play'),
    next: () => engine.cmd('next'),
    prev: () => engine.cmd('prev'),
    seek: ms => { S.position = ms; S.posAt = Date.now(); engine.cmd('seek', Math.round(ms)); },
    skipTo: i => engine.cmd('skipTo', i),
    removeAt: i => engine.cmd('remove', i),
    setShuffle: on => engine.cmd('shuffle', on),
    setRepeat: mode => engine.cmd('repeat', mode),
    refresh: () => engine.refresh(),
    isNative: !!native(),
  };
})();
