export type DeviceRole = 'order' | 'kitchen' | 'bar' | 'status' | 'billing';

export const DEVICE_ROLES: { role: DeviceRole; label: string }[] = [
  { role: 'order', label: 'Bestellung - 下单' },
  { role: 'kitchen', label: 'Küche - 厨房' },
  { role: 'bar', label: 'Bar - 酒吧' },
  { role: 'status', label: 'Status - 订单状态' },
  { role: 'billing', label: 'Tischübersicht - 桌子概览' },
];
