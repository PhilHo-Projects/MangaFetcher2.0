const DEFAULT_SOURCE_URLS = Object.freeze({
  'd65c0332-3764-4c89-84bd-b1a4e7278ad7': 'https://readkagura.com/',
  '9d9b04ad-9a83-49f4-8ae4-a9a3780fe9c0': 'https://www.readsakamotodays.com/',
  '60441951323': 'https://readkagura.com/',
  '55469435605': 'https://www.readsakamotodays.com/'
});

const DEFAULT_SOURCE_URLS_BY_TITLE = Object.freeze({
  kagurabachi: 'https://readkagura.com/',
  'sakamoto days': 'https://www.readsakamotodays.com/'
});

function normalizeSourceUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTitleKey(title) {
  return String(title ?? '').trim().toLowerCase();
}

function getDefaultSourceUrl(value) {
  return DEFAULT_SOURCE_URLS[String(value ?? '')] || '';
}

function getDefaultSourceUrlForTitle(title) {
  return DEFAULT_SOURCE_URLS_BY_TITLE[normalizeTitleKey(title)] || '';
}

function resolveDefaultSourceUrl({ mangaId = '', providerSeriesId = '', title = '' } = {}) {
  return (
    getDefaultSourceUrl(mangaId) ||
    getDefaultSourceUrl(providerSeriesId) ||
    getDefaultSourceUrlForTitle(title)
  );
}

function isValidSourceUrl(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized.length > 0 && /^https?:\/\//i.test(normalized);
}

module.exports = {
  DEFAULT_SOURCE_URLS,
  DEFAULT_SOURCE_URLS_BY_TITLE,
  getDefaultSourceUrl,
  getDefaultSourceUrlForTitle,
  resolveDefaultSourceUrl,
  isValidSourceUrl,
  normalizeSourceUrl
};
