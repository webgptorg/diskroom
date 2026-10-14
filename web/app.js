'use strict';
// This site is a static explanation. It never requests local file access.
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#main-nav');
menuButton?.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  navigation?.classList.toggle('open', !expanded);
});
navigation?.addEventListener('click', event => {
  if (event.target.closest('a')) { navigation.classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation?.classList.contains('open')) {
    navigation.classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false'); menuButton?.focus();
  }
});
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const text = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      const status = document.getElementById('copy-status');
      if (status) status.textContent = `Copied: ${text}`;
      setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    } catch {
      button.textContent = 'Select text';
      const block = button.parentElement.querySelector('code');
      if (block) { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(block); selection?.removeAllRanges(); selection?.addRange(range); }
      const status = document.getElementById('copy-status');
      if (status) status.textContent = 'Clipboard is unavailable. The command is selected for manual copying.';
    }
  });
}
const goal = document.getElementById('goal');
function updateGoal() {
  const target = Number(goal.value);
  goal.setAttribute('aria-valuetext', `${target.toFixed(1)} GB total free space`);
  const free = 0.4, gain = target > free ? 1.9 : 0;
  document.getElementById('goal-output').textContent = `${target.toFixed(1)} GB free`;
  document.getElementById('gain-segment').style.width = `${gain / 8 * 100}%`;
  document.getElementById('goal-marker').style.left = `${target / 8 * 100}%`;
  document.querySelector('.space-track').setAttribute('aria-label', `${free} GB already free, ${gain} GB selected, ${target.toFixed(1)} GB goal`);
  const row = document.getElementById('demo-old');
  const pill = row.querySelector('.pill');
  pill.textContent = gain ? 'Selected' : 'Keep';
  pill.classList.toggle('muted', !gain);
  row.querySelector('.demo-indicator').textContent = gain ? '✓' : '—';
  const status = document.getElementById('plan-status');
  const unmet = target > free + gain + 0.00001;
  status.classList.toggle('unmet', unmet);
  if (!gain) {
    status.querySelector('strong').textContent = 'Already there. Nothing to remove.';
    status.querySelector('span').textContent = 'Your goal is met by the 0.4 GB already available.';
  } else if (unmet) {
    status.querySelector('strong').textContent = `Still ${(target - free - gain).toFixed(1)} GB short. No automatic escalation.`;
    status.querySelector('span').textContent = 'Expected free: 2.3 GB. Protected and unreviewed data stay out of the plan.';
  } else {
    status.querySelector('strong').textContent = 'One operation. Enough room.';
    status.querySelector('span').textContent = 'Expected free: 2.3 GB. Your active project stays intact.';
  }
}
if (goal) { goal.addEventListener('input', updateGoal); updateGoal(); }
function setVerifiedLink(id, url, allowedHosts) {
  const link = document.getElementById(id);
  if (!link || typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) return;
    link.href = parsed.href; link.hidden = false;
  } catch { /* Invalid release metadata cannot create a misleading link. */ }
}
fetch('release.json', { cache: 'no-cache' }).then(response => {
  if (!response.ok) throw new Error('Release metadata unavailable');
  return response.json();
}).then(release => {
  const published = release.npmPublished === true;
  for (const element of document.querySelectorAll('[data-release-version]')) element.textContent = release.version || 'Unreleased';
  const status = document.getElementById('release-status');
  if (status) status.textContent = published ? `v${release.version} · on npm` : 'Release preparation';
  const note = document.getElementById('install-note');
  if (published && note) note.textContent = 'Install globally, then open the interactive workflow. Nothing is cleaned without a confirmed plan.';
  for (const element of document.querySelectorAll('[data-publication-note]')) {
    if (published) { element.textContent = `Version ${release.version} is published on npm. Check platform verification before cleaning.`; element.classList.remove('pending'); }
  }
  if (published) { setVerifiedLink('npm-link', release.npmUrl, ['www.npmjs.com', 'npmjs.com']); setVerifiedLink('docs-npm-link', release.npmUrl, ['www.npmjs.com', 'npmjs.com']); }
  setVerifiedLink('repo-link', release.repositoryUrl, ['github.com']);
  setVerifiedLink('docs-repo-link', release.repositoryUrl, ['github.com']);
  if (typeof release.repositoryUrl === 'string') {
    const base = release.repositoryUrl.replace(/\/$/, '');
    setVerifiedLink('issues-link', `${base}/issues`, ['github.com']);
    setVerifiedLink('security-link', `${base}/security/policy`, ['github.com']);
  }
  const license = document.getElementById('license-status');
  if (license && release.license) license.textContent = release.license;
  for (const [platform, result] of Object.entries(release.platformVerification || {})) {
    if (!['linux', 'macos', 'windows'].includes(platform)) continue;
    const element = document.querySelector(`[data-platform="${platform}"]`);
    if (element && typeof result === 'string') element.textContent = result;
  }
}).catch(() => { /* Static release information remains visible without JS or metadata. */ });
