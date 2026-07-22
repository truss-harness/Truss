export function MaterialIcon({
  className = "",
  fill = false,
  name,
  size,
}: {
  className?: string;
  fill?: boolean;
  name: string;
  size: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={["material-symbols-outlined select-none", className].join(" ")}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: `"FILL" ${fill ? 1 : 0}, "wght" 300, "GRAD" 0, "opsz" 24`,
      }}
    >
      {name}
    </span>
  );
}
