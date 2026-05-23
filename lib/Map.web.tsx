import { forwardRef } from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';

// Web stub for react-native-maps. The booking UI keeps working in the browser
// without an interactive map — the search/route/fare flow still functions.
// On real devices the native module renders an actual map.

type AnyProps = { children?: React.ReactNode; style?: StyleProp<ViewStyle> } & Record<string, any>;

const MapView = forwardRef<any, AnyProps>(({ children, style }, _ref) => (
  <View style={[{ backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color: '#6b7280', fontSize: 12, padding: 8, textAlign: 'center' }}>
      Map preview is only available in the iOS / Android app.{'\n'}
      Search and book normally — your route is calculated server-side.
    </Text>
    {children}
  </View>
));
MapView.displayName = 'MapViewWebStub';

// All sub-components render nothing on web.
export const Marker = (_: AnyProps) => null;
export const Polyline = (_: AnyProps) => null;
export const UrlTile = (_: AnyProps) => null;
export const PROVIDER_DEFAULT = undefined as unknown as string;

export default MapView;
