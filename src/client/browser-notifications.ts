import type { ChatUserChoiceRequest } from "../shared/protocol.ts";

export interface TrussBrowserNotification {
  body: string;
  tag: string;
  title: string;
}

const notificationAutoCloseMs = 12_000;
const notificationBodyMaxLength = 180;
const notificationIconPath = "/icon.png";

let notificationPermissionRequest: Promise<NotificationPermission> | null = null;
let notificationPermissionRequested = false;

export function requestBrowserNotificationPermission(): void {
  const notification = browserNotificationConstructor();

  if (!notification || notification.permission !== "default" || notificationPermissionRequested) {
    return;
  }

  notificationPermissionRequested = true;
  notificationPermissionRequest = notification.requestPermission().catch((caught) => {
    console.warn("[notifications] Failed to request browser notification permission.", caught);
    return notification.permission;
  });
}

export function notifySessionFinished(sessionId: string | null): void {
  showBrowserNotification(sessionFinishedNotification(sessionId));
}

export function notifyUserChoiceRequest(request: ChatUserChoiceRequest): void {
  showBrowserNotification(userChoiceNotification(request));
}

export function sessionFinishedNotification(
  sessionId: string | null,
): TrussBrowserNotification {
  return {
    body: "The session is ready for your next message.",
    tag: sessionId ? `truss-session-finished-${sessionId}` : "truss-session-finished",
    title: "Truss session finished",
  };
}

export function userChoiceNotification(
  request: ChatUserChoiceRequest,
): TrussBrowserNotification {
  return {
    body: compactNotificationBody(userChoiceNotificationBody(request)),
    tag: `truss-user-choice-${request.id}`,
    title: "Truss needs your input",
  };
}

function showBrowserNotification(payload: TrussBrowserNotification): void {
  const notification = browserNotificationConstructor();

  if (!notification) {
    return;
  }

  if (notification.permission === "default" && notificationPermissionRequest) {
    void notificationPermissionRequest.then((permission) => {
      if (permission === "granted") {
        showBrowserNotification(payload);
      }
    });
    return;
  }

  if (notification.permission !== "granted") {
    return;
  }

  try {
    const browserNotification = new notification(payload.title, {
      body: payload.body,
      icon: notificationIconPath,
      tag: payload.tag,
    });

    browserNotification.onclick = () => {
      window.focus();
      browserNotification.close();
    };
    window.setTimeout(() => browserNotification.close(), notificationAutoCloseMs);
  } catch (caught) {
    console.warn("[notifications] Failed to show browser notification.", caught);
  }
}

function browserNotificationConstructor(): typeof Notification | null {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return null;
  }

  return window.Notification;
}

function userChoiceNotificationBody(request: ChatUserChoiceRequest): string {
  if (request.kind === "directory_access" && request.directoryAccess) {
    const accessLabel = request.directoryAccess.readOnly ? "read-only" : "read/write";

    return `Review ${accessLabel} file access for ${request.directoryAccess.directoryPath}.`;
  }

  if (request.kind === "command_approval" && request.commandApproval) {
    return `Review command approval: ${
      request.commandApproval.summary || request.commandApproval.command
    }`;
  }

  if (request.kind === "command_whitelist" && request.commandWhitelist) {
    return `Review Command Runner whitelist access for ${request.commandWhitelist.pattern}.`;
  }

  return request.question || request.title;
}

function compactNotificationBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();

  if (normalized.length <= notificationBodyMaxLength) {
    return normalized;
  }

  return `${normalized.slice(0, notificationBodyMaxLength - 3).trimEnd()}...`;
}
