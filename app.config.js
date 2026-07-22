// Injects secrets into the Expo config at evaluation time.
//
// app.json holds everything static and safe to commit; this file layers on the
// values that come from .env.local (gitignored) so no API key is ever committed.
// Expo CLI loads .env / .env.local automatically before evaluating this file.
//
// For EAS builds, .env.local is NOT uploaded (it is gitignored), so the same
// names must exist in EAS — see the note at the top of .env.local.

const ANDROID_MAPS_KEY = process.env.GOOGLE_MAPS_ANDROID_KEY || '';
const IOS_MAPS_KEY = process.env.GOOGLE_MAPS_IOS_KEY || '';

const API_URL = process.env.API_URL || 'https://www.csctravels.com';
const BILLING_URL = process.env.BILLING_URL || 'https://app.csctravels.com';

if (!ANDROID_MAPS_KEY) {
  console.warn(
    '\n⚠️  GOOGLE_MAPS_ANDROID_KEY is not set — the Android build will show a blank map.\n' +
    '   Set it in .env.local for local runs, and in EAS for cloud builds.\n',
  );
}

module.exports = ({ config }) => ({
  ...config,

  ios: {
    ...config.ios,
    // An Android-restricted key does not work on iOS. Only opt into Google Maps
    // when a genuine iOS key exists; otherwise react-native-maps falls back to
    // Apple Maps, which needs no key at all.
    ...(IOS_MAPS_KEY ? { config: { ...config.ios?.config, googleMapsApiKey: IOS_MAPS_KEY } } : {}),
  },

  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: ANDROID_MAPS_KEY },
    },
  },

  extra: {
    ...config.extra,
    API_URL,
    BILLING_URL,
    // Drives PROVIDER_GOOGLE vs PROVIDER_DEFAULT on iOS at runtime.
    IOS_GOOGLE_MAPS: IOS_MAPS_KEY.length > 0,
  },
});
