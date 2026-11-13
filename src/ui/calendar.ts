/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
    Calendar,
    EventApi,
    EventClickArg,
    EventHoveringArg,
    EventSourceInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import googleCalendarPlugin from "@fullcalendar/google-calendar";
import iCalendarPlugin from "@fullcalendar/icalendar";
import { setIcon } from "obsidian";

// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
    const hours = errd.rruleSet._dtstart.getHours();
    return errd.rruleSet
        .between(de.toDate(fr.start), de.toDate(fr.end), true)
        .map((d: Date) => {
            return new Date(
                Date.UTC(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                    hours,
                    d.getMinutes()
                )
            );
        });
};

interface ExtraRenderProps {
    eventClick?: (info: EventClickArg) => void;
    select?: (
        startDate: Date,
        endDate: Date,
        allDay: boolean,
        viewType: string
    ) => Promise<void>;
    modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
    eventMouseEnter?: (info: EventHoveringArg) => void;
    firstDay?: number;
    initialView?: { desktop: string; mobile: string };
    timeFormat24h?: boolean;
    openContextMenuForEvent?: (
        event: EventApi,
        mouseEvent: MouseEvent
    ) => Promise<void>;
    toggleTask?: (event: EventApi, isComplete: boolean) => Promise<boolean>;
    forceNarrow?: boolean;
    /** Returns a short plain-text preview of the note behind an event. */
    getPreview?: (eventId: string) => Promise<string | null>;
    /** Opens the show/hide calendars dropdown under the given toolbar button. */
    openCalendarMenu?: (anchor: HTMLElement) => void;
    /** Start with Saturday and Sunday hidden. */
    hideWeekends?: boolean;
    /** Opens this plugin's settings tab. */
    openSettings?: () => void;
}

export function renderCalendar(
    containerEl: HTMLElement,
    eventSources: EventSourceInput[],
    settings?: ExtraRenderProps
): Calendar {
    const isMobile = window.innerWidth < 500;
    const isNarrow = settings?.forceNarrow || isMobile;
    const {
        eventClick,
        select,
        modifyEvent,
        eventMouseEnter,
        openContextMenuForEvent,
        toggleTask,
        getPreview,
        openCalendarMenu,
        openSettings,
    } = settings || {};
    const modifyEventCallback =
        modifyEvent &&
        (async ({
            event,
            oldEvent,
            revert,
        }: {
            event: EventApi;
            oldEvent: EventApi;
            revert: () => void;
        }) => {
            const success = await modifyEvent(event, oldEvent);
            if (!success) {
                revert();
            }
        });

    // Zoom: row height (em) of each time slot, remembered between sessions.
    const ZOOM_KEY = "full-calendar-pj-slot-height";
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 6;
    const ZOOM_DEFAULT = 1.5;
    let slotHeight = ZOOM_DEFAULT;
    try {
        const stored = parseFloat(window.localStorage.getItem(ZOOM_KEY) || "");
        if (!isNaN(stored)) {
            slotHeight = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stored));
        }
    } catch (e) {}
    containerEl.style.setProperty("--pj-slot-height", `${slotHeight}em`);
    const setZoom = (next: number) => {
        const oldHeight = slotHeight;
        slotHeight = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
        if (slotHeight === oldHeight) {
            return;
        }
        containerEl.style.setProperty("--pj-slot-height", `${slotHeight}em`);
        try {
            window.localStorage.setItem(ZOOM_KEY, String(slotHeight));
        } catch (e) {}
        // FullCalendar only recomputes event/now-line positions when the time
        // grid redraws, and a CSS change alone doesn't trigger that. So redraw,
        // keeping the current date and scroll position (scaled to the new height).
        const scrollSelector = ".fc-timegrid .fc-scroller";
        const scroller = containerEl.querySelector(
            scrollSelector
        ) as HTMLElement | null;
        const scrollTop = scroller
            ? scroller.scrollTop * (slotHeight / oldHeight)
            : 0;
        const date = cal.getDate();
        cal.destroy();
        cal.render();
        cal.gotoDate(date);
        requestAnimationFrame(() => {
            const s = containerEl.querySelector(
                scrollSelector
            ) as HTMLElement | null;
            if (s) {
                s.scrollTop = scrollTop;
            }
        });
    };
    const zoomFactor = 1.25;
    containerEl.addEventListener(
        "wheel",
        (e: WheelEvent) => {
            if (!e.ctrlKey) {
                return;
            }
            e.preventDefault();
            setZoom(e.deltaY < 0 ? slotHeight * zoomFactor : slotHeight / zoomFactor);
        },
        { passive: false }
    );

    const cal = new Calendar(containerEl, {
        customButtons: {
            zoomIn: { text: "+", hint: "Zoom in", click: () => setZoom(slotHeight * zoomFactor) },
            zoomOut: { text: "−", hint: "Zoom out", click: () => setZoom(slotHeight / zoomFactor) },
            settings: {
                text: "⚙",
                hint: "Plugin settings",
                click: () => openSettings?.(),
            },
            calendars: {
                text: "Calendars ▾",
                hint: "Show or hide calendars",
                click: (_ev: MouseEvent, el: HTMLElement) =>
                    openCalendarMenu?.(el),
            },
        },
        plugins: [
            // View plugins
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            // Drag + drop and editing
            interactionPlugin,
            // Remote sources
            googleCalendarPlugin,
            iCalendarPlugin,
            rrulePlugin,
        ],
        googleCalendarApiKey: "AIzaSyDIiklFwJXaLWuT_4y6I9ZRVVsPuf4xGrk",
        initialView:
            settings?.initialView?.[isNarrow ? "mobile" : "desktop"] ||
            (isNarrow ? "timeGrid3Days" : "timeGridWeek"),
        nowIndicator: true,
        weekends: !settings?.hideWeekends,
        // Icon-only toolbar buttons need accessible names (runs after each render).
        datesSet: () => {
            const names: Record<string, string> = {
                zoomIn: "Zoom in",
                zoomOut: "Zoom out",
                calendars: "Show or hide calendars",
                settings: "Plugin settings",
            };
            for (const [key, label] of Object.entries(names)) {
                const btn = containerEl.querySelector(`.fc-${key}-button`);
                btn?.setAttribute("aria-label", label);
                if (key === "settings" && btn instanceof HTMLElement) {
                    // Lucide "settings" icon from Obsidian's built-in set.
                    btn.empty();
                    setIcon(btn, "settings");
                }
                if (key === "calendars") {
                    btn?.setAttribute("aria-haspopup", "true");
                    if (!btn?.hasAttribute("aria-expanded")) {
                        btn?.setAttribute("aria-expanded", "false");
                    }
                }
            }
        },
        // Time badge on the hour axis at the now-line, kept current each minute.
        nowIndicatorDidMount: ({ el, isAxis }) => {
            if (!isAxis) {
                return;
            }
            const update = () => {
                el.textContent = new Date().toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: !settings?.timeFormat24h,
                });
            };
            update();
            const timer = window.setInterval(update, 30000);
            (el as HTMLElement & { pjTimer?: number }).pjTimer = timer;
        },
        nowIndicatorWillUnmount: ({ el, isAxis }) => {
            if (isAxis) {
                window.clearInterval(
                    (el as HTMLElement & { pjTimer?: number }).pjTimer
                );
            }
        },
        // Week/day headers: muted weekday plus a date number that is circled today.
        dayHeaderContent: (arg) => {
            if (!arg.view.type.startsWith("timeGrid")) {
                return undefined;
            }
            const wrap = document.createElement("span");
            wrap.className = "pj-day-header";
            const name = wrap.createSpan({ cls: "pj-day-name" });
            name.textContent = arg.date.toLocaleDateString([], {
                weekday: "short",
            });
            const num = wrap.createSpan({ cls: "pj-day-num" });
            num.textContent = String(arg.date.getDate());
            if (arg.isToday) {
                num.classList.add("is-today");
            }
            return { domNodes: [wrap] };
        },
        slotDuration: "00:15:00",
        snapDuration: "00:15:00",
        scrollTimeReset: false,
        dayMaxEvents: true,

        headerToolbar: !isNarrow
            ? {
                  left: "title",
                  center: "",
                  right:
                      (openCalendarMenu ? "calendars " : "") +
                      "today prev,next zoomOut,zoomIn dayGridMonth,timeGridWeek,timeGridDay,listWeek" +
                      (openSettings ? " settings" : ""),
              }
            : !isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,
        footerToolbar: isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,

        views: {
            timeGridDay: {
                type: "timeGrid",
                duration: { days: 1 },
                buttonText: isNarrow ? "1" : "day",
            },
            timeGrid3Days: {
                type: "timeGrid",
                duration: { days: 3 },
                buttonText: "3",
            },
        },
        firstDay: settings?.firstDay,
        ...(settings?.timeFormat24h && {
            eventTimeFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
            slotLabelFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
        }),
        eventSources,
        eventClick,

        selectable: select && true,
        // A plain click on empty space does nothing; the pointer must move a few
        // pixels (a drag) before an event is created.
        selectMinDistance: 5,
        selectMirror: select && true,
        select:
            select &&
            (async (info) => {
                await select(info.start, info.end, info.allDay, info.view.type);
                info.view.calendar.unselect();
            }),

        editable: modifyEvent && true,
        eventDrop: modifyEventCallback,
        eventResize: modifyEventCallback,

        eventMouseEnter,

        eventDidMount: ({ event, el, textColor, view }) => {
            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                openContextMenuForEvent && openContextMenuForEvent(event, e);
            });
            // Notion-style card: CSS tints the background and draws a left accent
            // bar from --pj-event-color, which is the event's resolved colour.
            if (
                !view.type.startsWith("list") &&
                !el.classList.contains("fc-daygrid-dot-event")
            ) {
                const c = el.style.backgroundColor || el.style.borderColor;
                const m = c && c.match(/\d+(\.\d+)?/g);
                if (m && m.length >= 3) {
                    el.style.setProperty("--pj-event-color", `${m[0]}, ${m[1]}, ${m[2]}`);
                    el.classList.add("pj-card");
                }
            }
            // Flag narrow (side-by-side) events so CSS can shrink/wrap the title.
            if (view.type.startsWith("timeGrid") && !event.allDay) {
                const updateNarrow = () => {
                    el.classList.toggle("pj-narrow", el.clientWidth < 130);
                };
                if (typeof ResizeObserver !== "undefined") {
                    new ResizeObserver(updateNarrow).observe(el);
                }
                updateNarrow();
            }
            // Total duration (e.g. "1h 30m") next to the time range.
            if (view.type.startsWith("timeGrid") && !event.allDay) {
                const timeEl = el.querySelector(".fc-event-time");
                if (timeEl && event.start && event.end) {
                    const mins = Math.round(
                        (event.end.getTime() - event.start.getTime()) / 60000
                    );
                    if (mins > 0) {
                        const h = Math.floor(mins / 60);
                        const m = mins % 60;
                        const text = [h ? `${h}h` : "", m ? `${m}m` : ""]
                            .filter((s) => s)
                            .join(" ");
                        const durEl = document.createElement("span");
                        durEl.className = "pj-event-duration";
                        durEl.textContent = text;
                        timeEl.appendChild(durEl);
                    }
                }
            }
            // Note preview: shown under the title in the time-grid views. The
            // event block clips overflow, so short events just show their title.
            if (getPreview && view.type.startsWith("timeGrid")) {
                const frame =
                    el.querySelector(".fc-event-main-frame") ||
                    el.querySelector(".fc-event-main");
                if (frame) {
                    const previewEl = document.createElement("div");
                    previewEl.className = "pj-event-preview";
                    frame.appendChild(previewEl);
                    getPreview(event.id)
                        .then((text) => {
                            if (text) {
                                previewEl.textContent = text;
                            } else {
                                previewEl.remove();
                            }
                        })
                        .catch(() => previewEl.remove());
                }
            }
            if (toggleTask) {
                if (event.extendedProps.isTask) {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked =
                        event.extendedProps.taskCompleted !== false;
                    checkbox.onclick = async (e) => {
                        e.stopPropagation();
                        if (e.target) {
                            let ret = await toggleTask(
                                event,
                                (e.target as HTMLInputElement).checked
                            );
                            if (!ret) {
                                (e.target as HTMLInputElement).checked = !(
                                    e.target as HTMLInputElement
                                ).checked;
                            }
                        }
                    };
                    // Make the checkbox more visible against different color events.
                    if (textColor == "black") {
                        checkbox.addClass("ofc-checkbox-black");
                    } else {
                        checkbox.addClass("ofc-checkbox-white");
                    }

                    if (checkbox.checked) {
                        el.addClass("ofc-task-completed");
                    }

                    // Depending on the view, we should put the checkbox in a different spot.
                    const container =
                        el.querySelector(".fc-event-time") ||
                        el.querySelector(".fc-event-title") ||
                        el.querySelector(".fc-list-event-title");

                    container?.addClass("ofc-has-checkbox");
                    container?.prepend(checkbox);
                }
            }
        },

        longPressDelay: 250,
    });
    cal.render();
    return cal;
}
