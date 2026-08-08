import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ThemeToggleButton from '../components/ThemeToggleButton';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import OrderScreen from '../screens/order/OrderScreen';
import KitchenScreen from '../screens/kitchen/KitchenScreen';
import BarScreen from '../screens/bar/BarScreen';
import StatusScreen from '../screens/status/StatusScreen';
import TableDetailScreen from '../screens/status/TableDetailScreen';
import TableOverviewScreen from '../screens/billing/TableOverviewScreen';
import TableBillingScreen from '../screens/billing/TableBillingScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="RoleSelect"
      screenOptions={{ headerRight: () => <ThemeToggleButton /> }}
    >
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ title: 'Hauptmenü' }} />
      <Stack.Screen name="Order" component={OrderScreen} options={{ title: 'Bestellung' }} />
      <Stack.Screen name="Kitchen" component={KitchenScreen} options={{ title: 'Küche' }} />
      <Stack.Screen name="Bar" component={BarScreen} options={{ title: 'Bar' }} />
      <Stack.Screen name="Status" component={StatusScreen} options={{ title: 'Status' }} />
      <Stack.Screen
        name="TableDetail"
        component={TableDetailScreen}
        options={({ route }) => ({ title: `Tisch ${route.params.tableNumber}` })}
      />
      <Stack.Screen name="TableOverview" component={TableOverviewScreen} options={{ title: 'Tischübersicht' }} />
      <Stack.Screen
        name="TableBilling"
        component={TableBillingScreen}
        options={({ route }) => ({ title: `Tisch ${route.params.tableNumber} — Abrechnung` })}
      />
    </Stack.Navigator>
  );
}
