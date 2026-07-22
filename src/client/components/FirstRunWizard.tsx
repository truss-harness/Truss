import type { SessionInfo } from "../../shared/protocol.ts";
import { ChatLandingScreen } from "./ChatLanding.tsx";

interface FirstRunWizardProps {
  onContinueToApp(): Promise<void>;
  session: SessionInfo;
}

export function FirstRunWizard(_props: FirstRunWizardProps) {
  return <ChatLandingScreen />;
}
