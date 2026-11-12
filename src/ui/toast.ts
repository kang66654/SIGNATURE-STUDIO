let timer = 0;

export function toast(message: string, ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('on');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('on'), ms);
}
