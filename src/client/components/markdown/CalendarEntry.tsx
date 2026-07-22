import { useState } from "react";
import { DetailList } from "../DetailList.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";
import { Modal } from "../Modal.tsx";

export interface CalendarEntry {
  date: string;
  description?: string;
  end?: string;
  location?: string;
  time?: string;
  title: string;
}

export interface CalendarEntryActions {
  googleCalendar: boolean;
  ics: boolean;
  outlookCalendar: boolean;
}

export function CalendarEntryInline({
  actions,
  entry,
}: {
  actions: CalendarEntryActions;
  entry: CalendarEntry;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dateLabel = formatCalendarDate(entry.date);
  const timeLabel = formatCalendarTimeRange(entry);
  const ariaLabel = ["Calendar entry", entry.title, dateLabel, timeLabel, entry.location]
    .filter(Boolean)
    .join(", ");
  const detailItems = [
    { label: "Title", value: entry.title },
    { label: "Date", value: dateLabel },
    { label: "Start time", value: entry.time },
    { label: "End time", value: entry.end },
    { label: "Location", value: entry.location },
    { label: "Details", value: entry.description },
  ];
  const hasActions = actions.googleCalendar || actions.outlookCalendar || actions.ics;

  return (
    <>
      <button
        aria-label={`${ariaLabel}. Open details.`}
        className="truss-calendar-entry"
        onClick={() => setDetailsOpen(true)}
        title={ariaLabel}
        type="button"
      >
        <span className="truss-calendar-entry-icon">
          <MaterialIcon name="event" size={15} />
        </span>
        <span className="truss-calendar-entry-body">
          <span className="truss-calendar-entry-title">{entry.title}</span>
          <span className="truss-calendar-entry-meta">
            <span>{dateLabel}</span>
            {timeLabel ? <span>{timeLabel}</span> : null}
            {entry.location ? <span>{entry.location}</span> : null}
          </span>
        </span>
      </button>
      <Modal
        description="Calendar entry details"
        footer={
          hasActions ? (
            <CalendarActionFooter actions={actions} entry={entry} />
          ) : undefined
        }
        icon="event"
        onClose={() => setDetailsOpen(false)}
        open={detailsOpen}
        size="sm"
        title={entry.title}
      >
        <DetailList items={detailItems} />
      </Modal>
    </>
  );
}

function CalendarActionFooter({
  actions,
  entry,
}: {
  actions: CalendarEntryActions;
  entry: CalendarEntry;
}) {
  return (
    <div className="truss-calendar-action-footer">
      {actions.googleCalendar ? (
        <a
          className="truss-calendar-action"
          href={googleCalendarUrl(entry)}
          rel="noreferrer noopener"
          target="_blank"
        >
          <MaterialIcon name="event_available" size={17} />
          Google Calendar
        </a>
      ) : null}
      {actions.outlookCalendar ? (
        <a
          className="truss-calendar-action"
          href={outlookCalendarUrl(entry)}
          rel="noreferrer noopener"
          target="_blank"
        >
          <MaterialIcon name="calendar_month" size={17} />
          Outlook Calendar
        </a>
      ) : null}
      {actions.ics ? (
        <button
          className="truss-calendar-action"
          onClick={() => downloadIcs(entry)}
          type="button"
        >
          <MaterialIcon name="download" size={17} />
          ICS
        </button>
      ) : null}
    </div>
  );
}

export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatCalendarTimeRange(entry: CalendarEntry): string {
  if (entry.time && entry.end) {
    return `${entry.time} - ${entry.end}`;
  }

  return entry.time ?? entry.end ?? "";
}

function googleCalendarUrl(entry: CalendarEntry): string {
  const url = new URL("https://www.google.com/calendar/render");
  const range = eventRange(entry);

  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", entry.title);
  url.searchParams.set(
    "dates",
    range.allDay
      ? `${formatDateOnly(range.start)}/${formatDateOnly(range.end)}`
      : `${formatGoogleDateTime(range.start)}/${formatGoogleDateTime(range.end)}`,
  );

  if (entry.description) {
    url.searchParams.set("details", entry.description);
  }

  if (entry.location) {
    url.searchParams.set("location", entry.location);
  }

  return url.toString();
}

function outlookCalendarUrl(entry: CalendarEntry): string {
  const url = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  const range = eventRange(entry);

  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  url.searchParams.set("subject", entry.title);
  url.searchParams.set("allday", range.allDay ? "true" : "false");
  url.searchParams.set(
    "startdt",
    range.allDay ? formatDashedDate(range.start) : range.start.toISOString(),
  );
  url.searchParams.set(
    "enddt",
    range.allDay ? formatDashedDate(range.end) : range.end.toISOString(),
  );

  if (entry.description) {
    url.searchParams.set("body", entry.description);
  }

  if (entry.location) {
    url.searchParams.set("location", entry.location);
  }

  return url.toString();
}

function downloadIcs(entry: CalendarEntry): void {
  const range = eventRange(entry);
  const now = formatIcsDateTime(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Truss//Rich Features//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@truss.local`,
    `DTSTAMP:${now}`,
    range.allDay
      ? `DTSTART;VALUE=DATE:${formatDateOnly(range.start)}`
      : `DTSTART:${formatIcsDateTime(range.start)}`,
    range.allDay
      ? `DTEND;VALUE=DATE:${formatDateOnly(range.end)}`
      : `DTEND:${formatIcsDateTime(range.end)}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
    entry.description ? `DESCRIPTION:${escapeIcsText(entry.description)}` : "",
    entry.location ? `LOCATION:${escapeIcsText(entry.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${safeCalendarFilename(entry.title)}.ics`;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function eventRange(entry: CalendarEntry): {
  allDay: boolean;
  end: Date;
  start: Date;
} {
  const start = parseEventDate(entry.date, entry.time);

  if (!entry.time) {
    return {
      allDay: true,
      end: addDays(start, 1),
      start,
    };
  }

  const end = entry.end ? parseEventDate(entry.date, entry.end) : addMinutes(start, 60);

  return {
    allDay: false,
    end: end > start ? end : addMinutes(start, 60),
    start,
  };
}

function parseEventDate(date: string, time: string | undefined): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time ? time.split(":").map(Number) : [];

  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function formatGoogleDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatIcsDateTime(date: Date): string {
  return formatGoogleDateTime(date);
}

function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatDashedDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function safeCalendarFilename(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safe || "truss-event";
}
