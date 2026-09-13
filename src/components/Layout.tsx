import { useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import { BatteryBar, prettyProduct } from "./ui";
import { APP_CREDIT, APP_HOMEPAGE } from "../version";
import { LAYOUTS } from "../data/layouts";
import { useLayout } from "../data/layouts/use-layout";
import type { LayoutId } from "../data/layouts";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { getTheme, toggleTheme, type Theme } from "../theme";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  comingSoon?: boolean;
}

/** Subscribe to the active theme. Re-renders when `themechange` fires from
 *  `theme.ts::setTheme()` — both manual toggle and system-pref change drive it. */
function useTheme(): Theme {
  const [theme, set] = useState<Theme>(getTheme());
  useEffect(() => {
    const onChange = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener("themechange", onChange);
    return () => window.removeEventListener("themechange", onChange);
  }, []);
  return theme;
}

export function Layout<T extends string>({
  brand = "AK820 Pro",
  phaseLabel,
  nav,
  active,
  onSelect,
  connection,
  battery,
  onReconnect,
  wide,
  children,
}: PropsWithChildren<{
  brand?: string;
  phaseLabel?: string;
  nav: readonly NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  connection?: { connected: boolean; product?: string | null };
  battery?: { level: number; charging: boolean };
  onReconnect?: () => void;
  /** Lets a view (e.g. Keymap) opt out of the standard ≤960 px content cap. */
  wide?: boolean;
}>) {
  const theme = useTheme();
  const { layoutId, layout, setLayoutId } = useLayout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("ak820:sidebar-collapsed") === "true",
  );

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("ak820:sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-surface-surface/80 transition-[width] duration-200 ease-out"
        style={{ width: sidebarCollapsed ? 72 : 240 }}
      >
        {/* Brand */}
        <div className={sidebarCollapsed ? "px-4 pb-5 pt-5" : "px-5 pb-5 pt-5"}>
          <div className={sidebarCollapsed ? "flex flex-col items-center gap-3" : "flex items-center gap-2.5"}>
            <Logo />
            <div className={sidebarCollapsed ? "hidden" : "min-w-0 flex-1 leading-none"}>
              <div className="text-sm font-semibold tracking-tight text-fg-0">{brand}</div>
              {phaseLabel && <div className="mt-1 kicker">{phaseLabel}</div>}
            </div>
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition hover:bg-surface-raised hover:text-fg-0"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen size={15} strokeWidth={1.8} />
                : <PanelLeftClose size={15} strokeWidth={1.8} />}
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className={sidebarCollapsed ? "flex-1 px-3 pb-3" : "flex-1 px-2 pb-3"}>
          <ul className="space-y-px">
            {nav.map((item) => {
              const isActive = item.id === active;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => !item.comingSoon && onSelect(item.id)}
                    disabled={item.comingSoon}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "group relative flex w-full items-center rounded-md py-2.5 text-left text-sm transition-all duration-150 ease-out",
                      sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3",
                      isActive
                        ? "bg-surface-raised text-fg-0"
                        : "text-fg-2 hover:bg-surface-elevated/60 hover:text-fg-0",
                      item.comingSoon ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-2" : "",
                    ].join(" ")}
                    title={sidebarCollapsed ? item.label : undefined}
                    aria-label={sidebarCollapsed ? item.label : undefined}
                  >
                    {/* Active rail */}
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-accent-500" />
                    )}
                    <span
                      className={[
                        "flex h-4 w-4 items-center justify-center",
                        isActive ? "text-accent-300" : "text-fg-3 group-hover:text-fg-1",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
                    {!sidebarCollapsed && item.comingSoon && (
                      <span className="rounded-sm bg-surface-base px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-3">
                        soon
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer status */}
        <footer className={sidebarCollapsed ? "border-t border-line px-3 py-3.5" : "border-t border-line px-4 py-3.5"}>
          <div className={sidebarCollapsed ? "flex justify-center" : "mb-2 flex items-center justify-between gap-2"}>
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot connected={!!connection?.connected} />
              <span className={sidebarCollapsed ? "hidden" : "truncate text-xs text-fg-1"}>
                {connection?.connected
                  ? prettyProduct(connection.product)
                  : "Disconnected"}
              </span>
            </div>
            {!sidebarCollapsed && !connection?.connected && onReconnect && (
              <button
                onClick={onReconnect}
                className="rounded-sm border border-line bg-surface-elevated/40 px-1.5 py-0.5 text-2xs font-medium text-fg-1 transition hover:border-accent-500/60 hover:bg-accent-glow hover:text-fg-0"
              >
                Reconnect
              </button>
            )}
          </div>
          {!sidebarCollapsed && connection?.connected && battery && (
            <BatteryBar level={battery.level} charging={battery.charging} compact />
          )}
          <div className={sidebarCollapsed ? "mt-3 flex flex-col items-center gap-2 border-t border-line/60 pt-3" : "mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-2.5"}>
            <a
              href={APP_HOMEPAGE}
              target="_blank"
              rel="noopener noreferrer"
              className={sidebarCollapsed ? "hidden" : "text-[10px] leading-tight text-fg-3 transition-colors hover:text-fg-1"}
              title="Open the project on GitHub"
            >
              {APP_CREDIT}
            </a>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleTheme}
                className="flex h-6 w-6 items-center justify-center rounded-sm border border-line bg-surface-base text-fg-2 transition hover:border-accent-500/60 hover:bg-accent-glow hover:text-fg-0"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark"
                  ? <Sun size={12} strokeWidth={1.8} />
                  : <Moon size={12} strokeWidth={1.8} />}
              </button>
              {!sidebarCollapsed && <select
                value={layoutId}
                onChange={(e) => setLayoutId(e.target.value as LayoutId)}
                title={`Active physical layout: ${layout.displayName}. ${layout.description}`}
                className="appearance-none rounded-sm border border-line bg-surface-base px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-fg-3 hover:border-accent-500/60 hover:text-fg-0 focus:outline-none focus:ring-1 focus:ring-accent-500/60"
                aria-label="Active keyboard layout"
              >
                {Object.entries(LAYOUTS).map(([id, l]) =>
                  l ? (
                    <option key={id} value={id}>
                      {l.displayName}
                    </option>
                  ) : null,
                )}
              </select>}
            </div>
          </div>
        </footer>
      </aside>

      {/* Main */}
      <main className="relative flex-1 overflow-y-auto">
        <div
          className={[
            "mx-auto px-8 pb-16 pt-9 lg:px-10",
            wide ? "max-w-none" : "max-w-[960px]",
          ].join(" ")}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

// ----- page header (in-content title) -------------------------------------

export function PageHeader({
  title,
  description,
  action,
  kicker,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  kicker?: string;
}) {
  return (
    <header className="mb-7 flex items-end justify-between gap-6">
      <div>
        {kicker && <p className="kicker mb-2">{kicker}</p>}
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-fg-0">{title}</h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm text-fg-2">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </header>
  );
}

// ----- decoration ----------------------------------------------------------

function Logo() {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-accent-500 to-accent-700 shadow-[0_4px_12px_-2px_rgba(124,92,255,0.5)]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 8h14v8H5z M3 12h2 M19 12h2 M9 6v-2 M15 6v-2 M9 20v-2 M15 20v-2"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="7.5" y="10.5" width="3" height="3" fill="white" />
      </svg>
    </span>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      <span
        className={[
          "absolute inset-0 rounded-full",
          connected ? "bg-good shadow-[0_0_10px_rgba(61,213,137,0.7)]" : "bg-fg-4",
        ].join(" ")}
      />
      {connected && (
        <span className="absolute inset-0 animate-ping rounded-full bg-good opacity-25" />
      )}
    </span>
  );
}

// ----- icons (Lucide re-export so views import from one place) ------------

export {
  Cable as Plug,
  Sun as Bulb,
  Settings,
  Keyboard,
  Zap as Macro,
  Monitor as Screen,
  Workflow as Automation,
  Layers as Preset,
  RefreshCw,
  Check,
  AlertCircle,
} from "lucide-react";
