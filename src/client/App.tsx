import { ChatLandingScreen } from "./components/ChatLanding.tsx";
import { SettingsScreen } from "./components/SettingsScreen.tsx";
import { HistoryManagementScreen } from "./components/HistoryManagementScreen.tsx";
import { ScheduledTasksScreen } from "./components/ScheduledTasksScreen.tsx";

export function App() {
  if (window.location.pathname === "/settings") {
    return <SettingsScreen />;
  }

  if (window.location.pathname === "/history" || window.location.pathname === "/history-management") {
    return <HistoryManagementScreen />;
  }

  if (window.location.pathname === "/scheduled-tasks") {
    return <ScheduledTasksScreen />;
  }

  return <ChatLandingScreen />;
}
