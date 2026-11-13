import "./overrides.css";
import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { Calendar, EventSourceInput } from "@fullcalendar/core";
import { renderCalendar } from "./calendar";
import FullCalendarPlugin from "../main";
import { FCError, PLUGIN_SLUG } from "../types";
import {
    dateEndpointsToFrontmatter,
    fromEventApi,
    toEventInput,
} from "./interop";
import { renderOnboarding } from "./onboard";
import { openFileForEvent } from "./actions";
import { launchCreateModal, launchEditModal } from "./event_modal";
import { isTask, toggleTask, unmakeTask } from "src/ui/tasks";
import { UpdateViewCallback } from "src/core/EventCache";

export const FULL_CALENDAR_VIEW_TYPE = "full-calendar-pj-view";
export const FULL_CALENDAR_SIDEBAR_VIEW_TYPE = "full-calendar-pj-sidebar-view";

function getCalendarColors(color: string | null | undefined): {
    color: string;
    textColor: string;
} {
    let textVar = getComputedStyle(document.body).getPropertyValue(
        "--text-on-accent"
    );
    if (color) {
        const m = color
            .slice(1)
            .match(color.length == 7 ? /(\S{2})/g : /(\S{1})/g);
        if (m) {
            const r = parseInt(m[0], 16),
                g = parseInt(m[1], 16),
                b = parseInt(m[2], 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness > 150) {
                textVar = "black";
            }
        }
    }

    return {
        color:
            color ||
            getComputedStyle(document.body).getPropertyValue(
                "--interactive-accent"
            ),
        textColor: textVar,
    };
}

/** Shorten calendar names for display, e.g. "Time Log/Projects" -> "Projects". */
function friendlyCalendarName(name: string): string {
    try {
        if (/^https?:\/\//i.test(name)) {
            const u = new URL(name);
            const last = decodeURIComponent(
                u.pathname.split("/").filter(Boolean).pop() || ""
            );
            const host = u.hostname.replace(/^www\./, "");
            const service = host.includes("outlook")
                ? "Outlook"
                : host.includes("google")
                ? "Google"
                : host;
            return last ? `${service} · ${last}` : service;
        }
    } catch (e) {}
    return name.split("/").filter(Boolean).pop() || name;
}

const PREVIEW_MAX_LINES = 12;
const HIDDEN_CALENDARS_KEY = "full-calendar-pj-hidden-calendars";

/** Turn a note body into a short plain-text preview. */
function makePreview(body: string): string {
    const lines = body
        .split(/\r?\n/)
        .map((l) =>
            l
                .replace(/^\s*[-*+]\s+\[[xX]\]\s+/, "☑ ")
                .replace(/^\s*[-*+]\s+\[ \]\s+/, "☐ ")
                .replace(/^\s*[-*+]\s+/, "• ")
                .replace(/^#{1,6}\s+/, "")
                .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
                .replace(/[*_`]/g, "")
                .trim()
        )
        .filter((l) => l.length > 0);
    return lines.slice(0, PREVIEW_MAX_LINES).join("\n");
}

export class CalendarView extends ItemView {
    plugin: FullCalendarPlugin;
    inSidebar: boolean;
    // Preview text by note path, valid while the note's mtime is unchanged.
    private previewCache = new Map<string, { mtime: number; text: string }>();

    async getNotePreview(eventId: string): Promise<string | null> {
        if (!this.plugin.cache) {
            return null;
        }
        let path: string;
        try {
            const { location } =
                this.plugin.cache.getInfoForEditableEvent(eventId);
            // Only full-note events have a note of their own.
            if (location.lineNumber !== undefined) {
                return null;
            }
            path = location.path;
        } catch (e) {
            return null; // remote / read-only events
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            return null;
        }
        const cached = this.previewCache.get(path);
        if (cached && cached.mtime === file.stat.mtime) {
            return cached.text;
        }
        const text = await this.app.vault.cachedRead(file);
        const m = text.match(
            /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/
        );
        const preview = makePreview(m ? m[1] : text);
        this.previewCache.set(path, { mtime: file.stat.mtime, text: preview });
        return preview;
    }
    fullCalendarView: Calendar | null = null;
    callback: UpdateViewCallback | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: FullCalendarPlugin,
        inSidebar = false
    ) {
        super(leaf);
        this.plugin = plugin;
        this.inSidebar = inSidebar;
    }

    getIcon(): string {
        return "calendar-glyph";
    }

    getViewType() {
        return this.inSidebar
            ? FULL_CALENDAR_SIDEBAR_VIEW_TYPE
            : FULL_CALENDAR_VIEW_TYPE;
    }

    getDisplayText() {
        return this.inSidebar ? "Full Calendar" : "Calendar";
    }

    translateSources() {
        return this.plugin.cache.getAllEvents().map(
            ({ events, editable, color, id }): EventSourceInput => ({
                id,
                events: events.flatMap(
                    (e) => toEventInput(e.id, e.event) || []
                ),
                editable,
                // Hidden calendars keep their source but their events aren't drawn
                // (and don't take up room when events overlap).
                display: this.hiddenCalendars.has(id) ? "none" : "auto",
                ...getCalendarColors(color),
            })
        );
    }

    // Calendars the user has toggled off in the bar above the calendar.
    private hiddenCalendars: Set<string> = (() => {
        try {
            const raw = window.localStorage.getItem(HIDDEN_CALENDARS_KEY);
            return new Set<string>(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set<string>();
        }
    })();

    private saveHiddenCalendars() {
        try {
            window.localStorage.setItem(
                HIDDEN_CALENDARS_KEY,
                JSON.stringify([...this.hiddenCalendars])
            );
        } catch (e) {}
    }

    private calendarPopover: HTMLElement | null = null;
    private calendarPopoverCleanup: (() => void) | null = null;

    private closeCalendarMenu() {
        this.calendarPopover?.remove();
        this.calendarPopover = null;
        this.calendarPopoverCleanup?.();
        this.calendarPopoverCleanup = null;
    }

    /** Dropdown under the toolbar's "Calendars" button to show/hide each calendar. */
    private openCalendarMenu(anchor: HTMLElement) {
        if (this.calendarPopover) {
            this.closeCalendarMenu();
            return;
        }
        const container = this.containerEl.children[1] as HTMLElement;
        container.style.position = "relative";
        const entries = [...this.plugin.cache.calendars.entries()];
        const apply = () => {
            this.saveHiddenCalendars();
            const fc = this.fullCalendarView;
            if (fc) {
                fc.removeAllEventSources();
                this.translateSources().forEach((s) => fc.addEventSource(s));
            }
        };

        const pop = container.createDiv({ cls: "pj-calendar-popover" });
        this.calendarPopover = pop;
        const cRect = container.getBoundingClientRect();
        const aRect = anchor.getBoundingClientRect();
        pop.style.left = `${aRect.left - cRect.left}px`;
        pop.style.top = `${aRect.bottom - cRect.top + 4}px`;

        for (const [id, cal] of entries) {
            const row = pop.createEl("label", { cls: "pj-calendar-row" });
            row.title = cal.name;
            const box = row.createEl("input", { type: "checkbox" });
            box.checked = !this.hiddenCalendars.has(id);
            const dot = row.createSpan({ cls: "pj-calendar-toggle-dot" });
            dot.style.backgroundColor = getCalendarColors(
                (cal as { color?: string }).color
            ).color;
            row.createSpan({
                cls: "pj-calendar-row-name",
                text: friendlyCalendarName(cal.name),
            });
            box.addEventListener("change", () => {
                if (box.checked) {
                    this.hiddenCalendars.delete(id);
                } else {
                    this.hiddenCalendars.add(id);
                }
                apply();
            });
        }

        // Close when clicking anywhere outside the dropdown or its button.
        const doc = container.ownerDocument;
        const onDocDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (!pop.contains(t) && !anchor.contains(t)) {
                this.closeCalendarMenu();
            }
        };
        doc.addEventListener("mousedown", onDocDown);
        this.calendarPopoverCleanup = () =>
            doc.removeEventListener("mousedown", onDocDown);
    }

    async onOpen() {
        await this.plugin.loadSettings();
        if (!this.plugin.cache) {
            new Notice("Full Calendar event cache not loaded.");
            return;
        }
        if (!this.plugin.cache.initialized) {
            await this.plugin.cache.populate();
        }

        const container = this.containerEl.children[1];
        container.empty();
        let calendarEl = container.createEl("div");

        if (
            this.plugin.settings.calendarSources.filter(
                (s) => s.type !== "FOR_TEST_ONLY"
            ).length === 0
        ) {
            renderOnboarding(this.app, this.plugin, calendarEl);
            return;
        }

        const sources: EventSourceInput[] = this.translateSources();

        if (this.fullCalendarView) {
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        this.fullCalendarView = renderCalendar(calendarEl, sources, {
            forceNarrow: this.inSidebar,
            eventClick: async (info) => {
                try {
                    if (
                        info.jsEvent.getModifierState("Control") ||
                        info.jsEvent.getModifierState("Meta")
                    ) {
                        await openFileForEvent(
                            this.plugin.cache,
                            this.app,
                            info.event.id
                        );
                    } else {
                        launchEditModal(this.plugin, info.event.id);
                    }
                } catch (e) {
                    if (e instanceof Error) {
                        console.warn(e);
                        new Notice(e.message);
                    }
                }
            },
            select: async (start, end, allDay, viewType) => {
                if (viewType === "dayGridMonth") {
                    // Month view will set the end day to the next day even on a single-day event.
                    // This is problematic when moving an event created in the month view to the
                    // time grid to give it a time.

                    // The fix is just to subtract 1 from the end date before processing.
                    end.setDate(end.getDate() - 1);
                }
                const partialEvent = dateEndpointsToFrontmatter(
                    start,
                    end,
                    allDay
                );
                try {
                    if (
                        this.plugin.settings.clickToCreateEventFromMonthView ||
                        viewType !== "dayGridMonth"
                    ) {
                        launchCreateModal(this.plugin, partialEvent);
                    } else {
                        this.fullCalendarView?.changeView("timeGridDay");
                        this.fullCalendarView?.gotoDate(start);
                    }
                } catch (e) {
                    if (e instanceof Error) {
                        console.error(e);
                        new Notice(e.message);
                    }
                }
            },
            modifyEvent: async (newEvent, oldEvent) => {
                try {
                    const didModify = await this.plugin.cache.updateEventWithId(
                        oldEvent.id,
                        fromEventApi(newEvent)
                    );
                    return !!didModify;
                } catch (e: any) {
                    console.error(e);
                    new Notice(e.message);
                    return false;
                }
            },

            eventMouseEnter: async (info) => {
                try {
                    const location = this.plugin.cache.getInfoForEditableEvent(
                        info.event.id
                    ).location;
                    if (location) {
                        this.app.workspace.trigger("hover-link", {
                            event: info.jsEvent,
                            source: PLUGIN_SLUG,
                            hoverParent: calendarEl,
                            targetEl: info.jsEvent.target,
                            linktext: location.path,
                            sourcePath: location.path,
                        });
                    }
                } catch (e) {}
            },
            firstDay: this.plugin.settings.firstDay,
            initialView: this.plugin.settings.initialView,
            timeFormat24h: this.plugin.settings.timeFormat24h,
            getPreview: (eventId) => this.getNotePreview(eventId),
            openCalendarMenu: (anchor) => this.openCalendarMenu(anchor),
            openContextMenuForEvent: async (e, mouseEvent) => {
                const menu = new Menu();
                if (!this.plugin.cache) {
                    return;
                }
                const event = this.plugin.cache.getEventById(e.id);
                if (!event) {
                    return;
                }

                if (this.plugin.cache.isEventEditable(e.id)) {
                    if (!isTask(event)) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Turn into task")
                                .onClick(async () => {
                                    await this.plugin.cache.processEvent(
                                        e.id,
                                        (e) => toggleTask(e, false)
                                    );
                                })
                        );
                    } else {
                        menu.addItem((item) =>
                            item
                                .setTitle("Remove checkbox")
                                .onClick(async () => {
                                    await this.plugin.cache.processEvent(
                                        e.id,
                                        unmakeTask
                                    );
                                })
                        );
                    }
                    menu.addSeparator();
                    menu.addItem((item) =>
                        item.setTitle("Go to note").onClick(() => {
                            if (!this.plugin.cache) {
                                return;
                            }
                            openFileForEvent(this.plugin.cache, this.app, e.id);
                        })
                    );
                    menu.addItem((item) =>
                        item.setTitle("Duplicate").onClick(async () => {
                            if (!this.plugin.cache) {
                                return;
                            }
                            try {
                                const { calendar, location } =
                                    this.plugin.cache.getInfoForEditableEvent(
                                        e.id
                                    );
                                // Full-note events: grab the note body (everything after the frontmatter).
                                let body = "";
                                let folder = "";
                                if (location.lineNumber === undefined) {
                                    const src = this.app.vault.getAbstractFileByPath(
                                        location.path
                                    );
                                    if (src instanceof TFile) {
                                        folder = src.parent?.path ?? "";
                                        const text = await this.app.vault.read(
                                            src
                                        );
                                        const m = text.match(
                                            /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/
                                        );
                                        body = m ? m[1] : "";
                                    }
                                }
                                // "Foo (2)" duplicates as "Foo (3)", not "Foo (2) (1)".
                                const base = event.title.replace(
                                    /\s*\(\d+\)$/,
                                    ""
                                );
                                for (let n = 1; n < 1000; n++) {
                                    const copy = {
                                        ...event,
                                        title: `${base} (${n})`,
                                    };
                                    delete (copy as { id?: string }).id;
                                    try {
                                        await this.plugin.cache.addEvent(
                                            calendar.id,
                                            copy
                                        );
                                        if (
                                            body.trim() &&
                                            copy.type !== "recurring" &&
                                            copy.type !== "rrule"
                                        ) {
                                            const dup =
                                                this.app.vault.getAbstractFileByPath(
                                                    `${folder}/${copy.date} ${copy.title}.md`
                                                );
                                            if (dup instanceof TFile) {
                                                await this.app.vault.append(
                                                    dup,
                                                    body
                                                );
                                            }
                                        }
                                        new Notice(
                                            `Duplicated as "${copy.title}".`
                                        );
                                        return;
                                    } catch (err) {
                                        // File name taken: try the next number.
                                        if (
                                            !(err instanceof Error) ||
                                            !err.message.includes(
                                                "already exists"
                                            )
                                        ) {
                                            throw err;
                                        }
                                    }
                                }
                            } catch (err) {
                                new Notice(
                                    `Could not duplicate event: ${
                                        err instanceof Error
                                            ? err.message
                                            : err
                                    }`
                                );
                            }
                        })
                    );
                    menu.addItem((item) =>
                        item.setTitle("Delete").onClick(async () => {
                            if (!this.plugin.cache) {
                                return;
                            }
                            await this.plugin.cache.deleteEvent(e.id);
                            new Notice(`Deleted event "${e.title}".`);
                        })
                    );
                } else {
                    menu.addItem((item) => {
                        item.setTitle(
                            "No actions available on remote events"
                        ).setDisabled(true);
                    });
                }

                menu.showAtMouseEvent(mouseEvent);
            },
            toggleTask: async (e, isDone) => {
                const event = this.plugin.cache.getEventById(e.id);
                if (!event) {
                    return false;
                }
                if (event.type !== "single") {
                    return false;
                }

                try {
                    await this.plugin.cache.updateEventWithId(
                        e.id,
                        toggleTask(event, isDone)
                    );
                } catch (e) {
                    if (e instanceof FCError) {
                        new Notice(e.message);
                    }
                    return false;
                }
                return true;
            },
        });
        // @ts-ignore
        window.fc = this.fullCalendarView;

        this.registerDomEvent(this.containerEl, "mouseenter", () => {
            this.plugin.cache.revalidateRemoteCalendars();
        });

        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
        this.callback = this.plugin.cache.on("update", (payload) => {
            if (payload.type === "resync") {
                this.fullCalendarView?.removeAllEventSources();
                const sources = this.translateSources();
                sources.forEach((source) =>
                    this.fullCalendarView?.addEventSource(source)
                );
                return;
            } else if (payload.type === "events") {
                const { toRemove, toAdd } = payload;
                console.debug("updating view from cache...", {
                    toRemove,
                    toAdd,
                });
                toRemove.forEach((id) => {
                    const event = this.fullCalendarView?.getEventById(id);
                    if (event) {
                        console.debug("removing event", event.toPlainObject());
                        event.remove();
                    } else {
                        console.warn(
                            `Event with id=${id} was slated to be removed but does not exist in the calendar.`
                        );
                    }
                });
                toAdd.forEach(({ id, event, calendarId }) => {
                    const eventInput = toEventInput(id, event);
                    console.debug("adding event", {
                        id,
                        event,
                        eventInput,
                        calendarId,
                    });
                    const addedEvent = this.fullCalendarView?.addEvent(
                        eventInput!,
                        calendarId
                    );
                    console.debug("event that was added", addedEvent);
                });
            } else if (payload.type == "calendar") {
                const {
                    calendar: { id, events, editable, color },
                } = payload;
                console.debug("replacing calendar with id", payload.calendar);
                this.fullCalendarView?.getEventSourceById(id)?.remove();
                this.fullCalendarView?.addEventSource({
                    id,
                    events: events.flatMap(
                        ({ id, event }) => toEventInput(id, event) || []
                    ),
                    editable,
                    ...getCalendarColors(color),
                });
            }
        });
    }

    onResize(): void {
        if (this.fullCalendarView) {
            this.fullCalendarView.render();
        }
    }

    async onunload() {
        if (this.fullCalendarView) {
            this.fullCalendarView.destroy();
            this.fullCalendarView = null;
        }
        if (this.callback) {
            this.plugin.cache.off("update", this.callback);
            this.callback = null;
        }
    }
}
