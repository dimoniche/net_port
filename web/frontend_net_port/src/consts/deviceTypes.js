/** Совпадает с backend: devices.hooks.js, deviceValidation.js, openapi.yaml */
export const DEVICE_TYPES = [
  { value: 'iot_gateway', label: 'IoT Шлюз' },
  { value: 'sensor', label: 'Датчик' },
  { value: 'camera', label: 'Камера' },
  { value: 'router', label: 'Роутер' },
  { value: 'other', label: 'Другое' },
];

export const DEVICE_TYPE_VALUES = DEVICE_TYPES.map((t) => t.value);

/** Устаревшие значения в БД (раньше были в формах). */
const LEGACY_DEVICE_TYPE_LABELS = {
  controller: 'Контроллер',
};

export function getDeviceTypeLabel(type) {
  if (!type) {
    return '—';
  }
  const known = DEVICE_TYPES.find((t) => t.value === type);
  if (known) {
    return known.label;
  }
  if (LEGACY_DEVICE_TYPE_LABELS[type]) {
    return LEGACY_DEVICE_TYPE_LABELS[type];
  }
  return type;
}

/** Опции для select: канонические + текущее устаревшее значение, если есть. */
export function deviceTypeSelectOptions(currentType) {
  const options = [...DEVICE_TYPES];
  if (
    currentType &&
    !DEVICE_TYPE_VALUES.includes(currentType) &&
    !options.some((o) => o.value === currentType)
  ) {
    options.push({
      value: currentType,
      label: `${getDeviceTypeLabel(currentType)} (устаревший)`,
    });
  }
  return options;
}
