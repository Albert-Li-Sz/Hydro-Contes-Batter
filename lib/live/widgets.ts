/**
 * Overlay widget state, ported from ICPC Live v3 backend (data/*Manager.kt, controllers/*.kt, MIT).
 * Kotlin flows become plain listeners: everything runs on Node's single thread.
 */
import { randomInt } from 'node:crypto';

export class ApiActionError extends Error {}

export interface Identified { id: string }
type Listener = (event: unknown) => void;

/** `"<prefix>-<random uint>"` like Widgets.kt generateId. */
export const generateId = (prefix: string) => `${prefix}-${randomInt(0, 2 ** 32 - 1)}`;

/** ManagerWithEvents: an ordered set of shown items, replayed to new subscribers as a snapshot. */
export class OrderedManager<T extends Identified> {
    private items: { item: T; showOrder: number }[] = [];
    private listeners = new Set<Listener>();

    constructor(private events: {
        add: (item: T, showOrder: number) => unknown;
        remove: (id: string) => unknown;
        snapshot: (items: { item: T; showOrder: number }[]) => unknown;
    }, private hooks: { onAdd?: (item: T) => void; onRemove?: (item: T) => void } = {}) {}

    private removeById(id: string) {
        const matching = this.items.filter(({ item }) => item.id === id);
        for (const { item } of matching) this.hooks.onRemove?.(item);
        this.items = this.items.filter(({ item }) => item.id !== id);
        return matching.length > 0;
    }

    add(item: T, showOrder: number) {
        this.removeById(item.id); // the frontend treats an add as a set
        this.items.push({ item, showOrder });
        this.items.sort((a, b) => a.showOrder - b.showOrder);
        this.hooks.onAdd?.(item);
        this.emit(this.events.add(item, showOrder));
    }

    remove(id: string) {
        if (this.removeById(id)) this.emit(this.events.remove(id));
    }

    current() {
        return this.items.map(({ item, showOrder }) => ({ item, showOrder }));
    }

    subscribe(listener: Listener) {
        listener(this.events.snapshot(this.current()));
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit(event: unknown) {
        for (const listener of this.listeners) listener(event);
    }
}

export interface Widget extends Identified {
    type: string;
    widgetLocationId: string;
    statisticsId: string;
    [key: string]: unknown;
}

type UsageEntry = { type: 'simple'; totalShownTimeSeconds: number } | { type: 'per_team'; byTeam: Record<string, UsageEntry> };

export class WidgetManager extends OrderedManager<Widget> {
    // statisticsId (or statisticsId/teamId) -> shown count, shown since, accumulated time
    private usage = new Map<string, { count: number; since: number | null; total: number }>();

    constructor() {
        super({
            add: (widget, showOrder) => ({ type: 'ShowWidget', widget: serializeWidget(widget), showOrder }),
            remove: (id) => ({ type: 'HideWidget', id }),
            snapshot: (items) => ({ type: 'MainScreenSnapshot', widgets: items.map(({ item, showOrder }) => ({ widget: serializeWidget(item), showOrder })) }),
        }, {
            onAdd: (widget) => this.track(widget, 1),
            onRemove: (widget) => this.track(widget, -1),
        });
    }

    private usageKey(widget: Widget) {
        const teamId = (widget.settings as { teamId?: string } | undefined)?.teamId;
        return widget.type === 'TeamViewWidget' && teamId ? `${widget.statisticsId}/${teamId}` : widget.statisticsId;
    }

    private track(widget: Widget, delta: number) {
        const key = this.usageKey(widget);
        const entry = this.usage.get(key) || { count: 0, since: null, total: 0 };
        const now = Date.now();
        if (delta > 0 && entry.count === 0) entry.since = now;
        if (delta < 0 && entry.count === 1 && entry.since !== null) {
            entry.total += now - entry.since;
            entry.since = null;
        }
        entry.count = Math.max(0, entry.count + delta);
        this.usage.set(key, entry);
    }

    usageStatistics() {
        const entries: Record<string, UsageEntry> = {};
        const now = Date.now();
        for (const [key, entry] of this.usage) {
            const seconds = Math.floor((entry.total + (entry.since !== null ? now - entry.since : 0)) / 1000);
            const [statisticsId, teamId] = key.split('/');
            if (teamId) {
                const perTeam = (entries[statisticsId] ||= { type: 'per_team', byTeam: {} }) as Extract<UsageEntry, { type: 'per_team' }>;
                perTeam.byTeam[teamId] = { type: 'simple', totalShownTimeSeconds: seconds };
            } else entries[statisticsId] = { type: 'simple', totalShownTimeSeconds: seconds };
        }
        return { entries };
    }
}

function serializeWidget(widget: Widget) {
    const { id, ...rest } = widget;
    return { ...rest, widgetId: id };
}

export interface TickerMessage extends Identified { settings: Record<string, unknown> }

export class TickerManager extends OrderedManager<TickerMessage> {
    constructor() {
        super({
            add: (message, showOrder) => ({ type: 'AddMessage', message, showOrder }),
            remove: (messageId) => ({ type: 'RemoveMessage', messageId }),
            snapshot: (items) => ({ type: 'TickerSnapshot', messages: items.map(({ item, showOrder }) => ({ message: item, showOrder })) }),
        });
    }
}

export class ShowOrderCounter {
    private last = 0;
    next() { return ++this.last; }
    observe(value: number) { this.last = Math.max(this.last, value); }
}

export interface WidgetState<S> {
    settings: S;
    showOrder: number | null;
}

/**
 * SingleWidgetController: settings plus an optional show order. While shown, `construct` turns
 * the settings into the item the overlay displays; `null` means "nothing to show yet".
 */
export class WidgetController<S, W extends Identified> {
    private state: WidgetState<S>;
    private alive = true;
    private shownItem: W | null = null;
    private shownKey = '';

    constructor(
        defaults: S,
        private manager: OrderedManager<W>,
        private counter: ShowOrderCounter,
        private construct: (settings: S) => W | null,
        private normalize: (input: unknown, current: S) => S,
        private onChange: () => void,
        public readonly id: number | null = null,
        /** Items whose content depends on contest data compare by content, not by id. */
        private dynamic = false,
    ) {
        this.state = { settings: defaults, showOrder: null };
    }

    load(state: WidgetState<S> | null | undefined) {
        if (!state) return;
        try {
            this.state = { settings: this.normalize(state.settings, this.state.settings), showOrder: typeof state.showOrder === 'number' ? state.showOrder : null };
        } catch {
            return; // unreadable saved settings: keep the defaults (PersistentStorageService does the same)
        }
        if (this.state.showOrder !== null) this.counter.observe(this.state.showOrder);
        this.sync(true);
    }

    get persistentState(): WidgetState<S> { return { ...this.state }; }
    get settings() { return this.state.settings; }
    get shown() { return this.state.showOrder !== null; }

    status() {
        return { shown: this.state.showOrder !== null, settings: this.state.settings, id: this.id };
    }

    preview(settings: unknown = this.state.settings) {
        const item = this.construct(settings === this.state.settings ? this.state.settings : this.normalize(settings, this.state.settings));
        if (!item) throw new ApiActionError('Nothing to show for these settings');
        return item;
    }

    private change(next: WidgetState<S>) {
        if (!this.alive) throw new ApiActionError("Can't change widget state, it was just deleted");
        const changed = JSON.stringify(next) !== JSON.stringify(this.state);
        this.state = next;
        if (changed) {
            this.sync(true);
            this.onChange();
        }
    }

    setSettings(input: unknown) { this.change({ ...this.state, settings: this.normalize(input, this.state.settings) }); }

    /** Showing a visible widget keeps its place in the stacking order. */
    show() { this.change(this.state.showOrder !== null ? this.state : { ...this.state, showOrder: this.counter.next() }); }

    hide() { this.change({ ...this.state, showOrder: null }); }

    destroy() {
        this.change({ ...this.state, showOrder: null });
        this.alive = false;
    }

    /** Rebuild the shown item; for dynamic items only when its content changed. */
    sync(force = false) {
        if (!force && !this.dynamic) return;
        let item: W | null = null;
        if (this.state.showOrder !== null) {
            // e.g. a title whose template was deleted: show nothing rather than fail the whole overlay
            try { item = this.construct(this.state.settings); } catch { item = null; }
        }
        if (this.dynamic && item && this.shownItem && !force) {
            const key = JSON.stringify({ ...item, id: undefined });
            if (key === this.shownKey) return;
        }
        const previous = this.shownItem;
        if (previous && previous.id !== item?.id) this.manager.remove(previous.id);
        if (item) this.manager.add(item, this.state.showOrder!);
        this.shownItem = item;
        this.shownKey = item ? JSON.stringify({ ...item, id: undefined }) : '';
    }
}

/** PresetsController: a list of independently shown items, e.g. captions or pictures. */
export class PresetsController<S, W extends Identified> {
    private entries: { controller: WidgetController<S, W>; temporary: boolean; timer?: NodeJS.Timeout; onDelete?: (id: number) => void }[] = [];
    private lastId = 0;

    constructor(
        private manager: OrderedManager<W>,
        private counter: ShowOrderCounter,
        private construct: (settings: S) => W | null,
        private normalize: (input: unknown, current?: S) => S,
        private onChange: () => void,
    ) {}

    private create(settings: S, temporary: boolean) {
        const controller = new WidgetController<S, W>(settings, this.manager, this.counter, this.construct,
            (input, current) => this.normalize(input, current), this.onChange, ++this.lastId);
        const entry: PresetsController<S, W>['entries'][number] = { controller, temporary };
        this.entries.push(entry);
        return entry;
    }

    load(states: unknown) {
        if (!Array.isArray(states)) return;
        for (const state of states as WidgetState<unknown>[]) {
            try {
                const entry = this.create(this.normalize(state?.settings), false);
                entry.controller.load({ settings: entry.controller.settings, showOrder: state?.showOrder ?? null });
            } catch { /* skip unreadable presets */ }
        }
    }

    get persistentState() {
        return this.entries.filter((entry) => !entry.temporary).map((entry) => entry.controller.persistentState);
    }

    status() { return this.entries.map((entry) => entry.controller.status()); }

    private find(id: number) {
        const entry = this.entries.find((candidate) => candidate.controller.id === id);
        if (!entry) throw new ApiActionError('No such id');
        return entry;
    }

    createWidget(input: unknown) {
        const entry = this.create(this.normalize(input), false);
        this.onChange();
        return entry.controller.id!;
    }

    /** A temporary item that deletes itself after `ttlMs` (not persisted, like upstream). */
    createTemporary(settings: S, ttlMs: number, onDelete?: (id: number) => void) {
        const entry = this.create(settings, true);
        entry.onDelete = onDelete;
        entry.timer = setTimeout(() => this.delete(entry.controller.id!), ttlMs);
        entry.timer.unref?.();
        return entry.controller.id!;
    }

    /** create_and_show_with_ttl from the admin's raw input. */
    createTemporaryFromInput(input: unknown, ttlMs: number) {
        const id = this.createTemporary(this.normalize(input), ttlMs);
        this.show(id);
        return id;
    }

    edit(id: number, input: unknown) { this.find(id).controller.setSettings(input); }
    show(id: number) { this.find(id).controller.show(); }
    hide(id: number) { this.find(id).controller.hide(); }
    preview(id: number) { return this.find(id).controller.preview(); }

    delete(id: number) {
        const entry = this.entries.find((candidate) => candidate.controller.id === id);
        if (!entry) return;
        this.entries = this.entries.filter((candidate) => candidate !== entry);
        if (entry.timer) clearTimeout(entry.timer);
        entry.controller.destroy();
        entry.onDelete?.(id);
        this.onChange();
    }

    dispose() {
        for (const entry of this.entries) if (entry.timer) clearTimeout(entry.timer);
    }
}
