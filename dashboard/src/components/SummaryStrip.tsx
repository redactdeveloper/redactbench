interface SummaryItem {
  hiddenOnMobile?: boolean;
  label: string;
  value: string;
}

export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <dl className="summary-strip" aria-label="Selected model summary">
      {items.map((item) => (
        <div
          className={`summary-item${item.hiddenOnMobile ? " summary-item--desktop" : ""}`}
          key={item.label}
        >
          <dt>{item.label}</dt>
          <dd aria-label={`${item.label}: ${item.value === "—" ? "Not measured" : item.value}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
