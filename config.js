// Point DATA_URL at the raw URL of your public Gist's peaks.json.
// Use the "raw" link WITHOUT the commit SHA so edits to the Gist show up automatically:
//   https://gist.githubusercontent.com/Petrofang/<GIST_ID>/raw/peaks.json
// Leave it null to use the bundled copy in data/peaks.json.
window.APP_CONFIG = {
  DATA_URL: null,
  FALLBACK_URL: 'data/peaks.json'
};
