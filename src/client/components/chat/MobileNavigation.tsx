import { MaterialIcon } from "../MaterialIcon.tsx";

export function MobileNavigation({
  historyOpen,
  newChatActive,
  onHistoryClick,
  onNewChat,
  onSettingsClick,
}: {
  historyOpen: boolean;
  newChatActive: boolean;
  onHistoryClick(): void;
  onNewChat(): void;
  onSettingsClick(): void;
}) {
  return (
    <nav className="fixed bottom-0 left-0 z-30 flex w-full items-center justify-around border-t border-outline-variant bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
      <MobileNavButton
        active={historyOpen}
        icon="history"
        label="History"
        onClick={onHistoryClick}
      />
      <MobileNavButton
        active={newChatActive}
        icon="add_circle"
        label="New Chat"
        onClick={onNewChat}
      />
      <MobileNavButton icon="settings" label="Settings" onClick={onSettingsClick} />
    </nav>
  );
}

function MobileNavButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={[
        "grid min-w-16 place-items-center gap-1 px-2 py-1 text-xs font-medium transition",
        active ? "text-primary" : "text-on-surface-variant hover:text-primary",
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <MaterialIcon fill={active} name={icon} size={25} />
      <span>{label}</span>
    </button>
  );
}
