import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PROVIDER_GOOGLE } from 'react-native-maps';

export { default } from 'react-native-maps';
export { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, UrlTile, Callout } from 'react-native-maps';

/**
 * Which map engine to render with.
 *
 * Android always uses Google Maps — it is the platform default and our key is
 * restricted to the package + signing cert.
 *
 * iOS only opts in when a genuine iOS-restricted key exists. An Android key
 * will NOT authenticate on iOS, and forcing PROVIDER_GOOGLE without a valid key
 * renders a blank grey tile. Leaving it undefined falls back to Apple Maps,
 * which needs no key and looks native — a better failure mode than a grey box.
 */
export const mapProvider =
  Platform.OS === 'android' || Constants.expoConfig?.extra?.IOS_GOOGLE_MAPS === true
    ? PROVIDER_GOOGLE
    : undefined;
