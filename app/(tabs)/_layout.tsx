import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors } from '../../lib/theme';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 60 }}>
      <Text style={{ fontSize: 20 }}>{label}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { borderTopColor: colors.border, paddingTop: 6, height: 64 },
        tabBarLabelStyle: { fontWeight: '700', fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Book',
          tabBarIcon: ({ focused }) => <TabIcon label="🚖" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: 'My Rides',
          tabBarIcon: ({ focused }) => <TabIcon label="📜" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
