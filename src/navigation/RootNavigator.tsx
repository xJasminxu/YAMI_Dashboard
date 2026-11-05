import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View } from 'react-native';
import LanguageToggleButton from '../components/LanguageToggleButton';
import ThemeToggleButton from '../components/ThemeToggleButton';
import { useI18n } from '../i18n/LanguageContext';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import OrderScreen from '../screens/order/OrderScreen';
import KitchenScreen from '../screens/kitchen/KitchenScreen';
import BarScreen from '../screens/bar/BarScreen';
import StatusScreen from '../screens/status/StatusScreen';
import TableDetailScreen from '../screens/status/TableDetailScreen';
import TableOverviewScreen from '../screens/billing/TableOverviewScreen';
import TableBillingScreen from '../screens/billing/TableBillingScreen';
import RevenueScreen from '../screens/billing/RevenueScreen';
import AdminScreen from '../screens/admin/AdminScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Rechts in jeder App-Leiste: Sprachumschalter (Deutsch ⇄ Chinesisch) + Hell/Dunkel.
function HeaderRight() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <LanguageToggleButton />
      <ThemeToggleButton />
    </View>
  );
}

export default function RootNavigator() {
  const { t } = useI18n();
  return (
    <Stack.Navigator
      initialRouteName="RoleSelect"
      screenOptions={{ headerRight: () => <HeaderRight /> }}
    >
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ title: t('navHome') }} />
      <Stack.Screen name="Order" component={OrderScreen} options={{ title: t('navOrder') }} />
      <Stack.Screen name="Kitchen" component={KitchenScreen} options={{ title: t('navKitchen') }} />
      <Stack.Screen name="Bar" component={BarScreen} options={{ title: '🍹 Bar' /* Bar bleibt immer Deutsch */ }} />
      <Stack.Screen name="Status" component={StatusScreen} options={{ title: t('navStatus') }} />
      <Stack.Screen
        name="TableDetail"
        component={TableDetailScreen}
        options={({ route }) => ({ title: t('navTableDetail', { n: route.params.tableNumber }) })}
      />
      <Stack.Screen name="TableOverview" component={TableOverviewScreen} options={{ title: t('navOverview') }} />
      <Stack.Screen name="Revenue" component={RevenueScreen} options={{ title: t('navRevenue') }} />
      <Stack.Screen name="Admin" component={AdminScreen} options={{ title: t('navAdmin') }} />
      <Stack.Screen
        name="TableBilling"
        component={TableBillingScreen}
        options={({ route }) => ({ title: t('navBilling', { n: route.params.tableNumber }) })}
      />
    </Stack.Navigator>
  );
}
