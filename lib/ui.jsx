import * as Select from '@radix-ui/react-select';

export function ChevronIcon({ size = 10 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2 4 3 3 3-3" />
    </svg>
  );
}

/**
 * Themed wrapper around Radix Select. `items` is `[{ value, label }]`.
 * Pass `value={undefined}` (not '') for an unset state — empty string is
 * not a legal Radix Select value.
 */
export function SimpleSelect({
  value,
  onValueChange,
  items,
  placeholder,
  ariaLabel,
  triggerClassName = 'radix-select-trigger',
  contentClassName = 'radix-select-content'
}) {
  const selectValue = value === '' ? undefined : value ?? undefined;

  return (
    <Select.Root value={selectValue} onValueChange={onValueChange}>
      <Select.Trigger className={triggerClassName} aria-label={ariaLabel}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={contentClassName} position="popper" sideOffset={4}>
          <Select.Viewport className="radix-select-viewport">
            {items.map((item) => (
              <Select.Item key={item.value} value={item.value} className="radix-select-item">
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator className="radix-select-indicator">
                  <span className="radix-select-dot" aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
