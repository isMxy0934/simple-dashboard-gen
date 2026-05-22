export interface ChartErrorPlaceholderProps {
  title?: string;
  message?: string;
}

export function ChartErrorPlaceholder(props: ChartErrorPlaceholderProps) {
  return (
    <div role="status" aria-live="polite">
      <strong>{props.title ?? "Chart unavailable"}</strong>
      {props.message ? <p>{props.message}</p> : null}
    </div>
  );
}
