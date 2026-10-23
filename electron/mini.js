// Floating mini-player: shows what the main Осколок window plays and sends button presses back to it.
const $ = id => document.getElementById(id);
let state = null, receivedAt = 0;
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';

function render() {
  const s = state;
  $('mini').classList.toggle('idle', !s || !s.title);
  $('title').textContent = s && s.title ? s.title : 'Осколок';
  $('artist').textContent = s && s.title ? s.artist : 'Ничего не играет';
  const art = $('art');
  if (s && s.artworkUrl) { if (art.src !== s.artworkUrl) art.src = s.artworkUrl; } else art.removeAttribute('src');
  $('playIcon').firstElementChild.setAttribute('d', s && s.playing ? PAUSE : PLAY);
  $('play').setAttribute('aria-label', s && s.playing ? 'Пауза' : 'Воспроизвести');
  $('like').classList.toggle('on', !!(s && s.liked));
}
function tick() {
  const s = state;
  if (s && s.duration > 0) {
    const pos = Math.min(s.duration, s.position + (s.playing ? (Date.now() - receivedAt) / 1000 : 0));
    $('bar').style.width = `${(pos / s.duration) * 100}%`;
  } else $('bar').style.width = '0';
  requestAnimationFrame(tick);
}
if (window.oskolokMini) window.oskolokMini.onState(s => { state = s; receivedAt = Date.now(); render(); });
for (const [id, action] of [['prev', 'previous'], ['play', 'toggle'], ['next', 'next'], ['like', 'like'], ['open', 'open'], ['close', 'close']]) {
  $(id).addEventListener('click', () => window.oskolokMini && window.oskolokMini.send(action));
}
$('art').addEventListener('dblclick', () => window.oskolokMini && window.oskolokMini.send('open'));
render(); tick();
