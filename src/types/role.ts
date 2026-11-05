export type DeviceRole = 'order' | 'kitchen' | 'bar' | 'status' | 'billing' | 'revenue' | 'admin';

export const DEVICE_ROLES: { role: DeviceRole; emoji: string; label: string; hanzi: string }[] = [
  { role: 'order', emoji: '📝', label: 'Bestellung', hanzi: '下单' },
  { role: 'kitchen', emoji: '👨‍🍳', label: 'Küche', hanzi: '厨房' },
  { role: 'bar', emoji: '🍹', label: 'Bar', hanzi: '酒吧' },
  { role: 'status', emoji: '⏱️', label: 'Status', hanzi: '订单状态' },
  { role: 'billing', emoji: '🧾', label: 'Tischübersicht', hanzi: '桌子概览' },
  { role: 'revenue', emoji: '💰', label: 'Umsatz', hanzi: '营业额' },
  { role: 'admin', emoji: '🔐', label: 'Admin', hanzi: '管理' },
];
