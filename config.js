// Where the peak list is loaded from, in order. The first source that responds wins.
//
// data/peaks.json in this repo is canonical. The Gist is an automated mirror
// (see .github/workflows/sync-gist.yml) published for anyone who wants to consume
// the dataset, and kept here only as a long-shot fallback.
window.APP_CONFIG = {
  DATA_URL: 'data/peaks.json',
  FALLBACK_URL: 'https://gist.githubusercontent.com/petrofang/46213d7d93292f14ffd54d955b7f3f67/raw/peaks.json'
};
