import {
  applyDocumentTheme,
  applyHostStyleVariables,
  type App,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

export interface ViewerAction {
  id: string;
  label: string;
  title?: string;
  ariaLabel?: string;
  run: () => void | Promise<void>;
}

export interface ViewerRenderer {
  mount(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export class ViewerShell {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly toolbar: HTMLElement;
  private readonly app: App;
  private readonly titleElement: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly actions = new Map<string, HTMLButtonElement>();
  private fullscreen = false;

  constructor(app: App, defaultTitle: string) {
    this.app = app;
    const mount = document.querySelector<HTMLElement>("#app");
    if (!mount) throw new Error("Viewer mount element is missing.");

    this.root = element("main", "viewer-shell");
    this.root.id = "app-shell";
    this.toolbar = element("header", "viewer-toolbar");
    this.toolbar.setAttribute("aria-label", "Viewer controls");
    this.titleElement = element("div", "viewer-title", defaultTitle);
    this.titleElement.id = "toolbar-title";
    this.controls = element("div", "viewer-controls");
    this.toolbar.append(this.titleElement, this.controls);
    this.content = element("section", "viewer-content");
    this.content.id = "viewer-content";
    this.statusElement = element("div", "viewer-status", "Loading…");
    this.statusElement.id = "status";
    this.statusElement.setAttribute("role", "status");
    this.content.append(this.statusElement);
    this.root.append(this.toolbar, this.content);
    mount.replaceChildren(this.root);

    this.addAction({
      id: "fullscreen",
      label: "⛶",
      title: "Fullscreen",
      ariaLabel: "Toggle fullscreen",
      run: () => this.toggleFullscreen(),
    });
  }

  addAction(action: ViewerAction, beforeFullscreen = true): HTMLButtonElement {
    if (this.actions.has(action.id)) throw new Error(`Duplicate viewer action: ${action.id}`);
    const button = element("button", "viewer-action", action.label);
    button.id = action.id;
    button.type = "button";
    button.title = action.title ?? action.label;
    button.setAttribute("aria-label", action.ariaLabel ?? action.title ?? action.label);
    button.addEventListener("click", () => void Promise.resolve(action.run()).catch((error) => {
      this.toast(error instanceof Error ? error.message : "Viewer action failed.");
    }));
    const fullscreen = this.actions.get("fullscreen");
    if (beforeFullscreen && fullscreen) this.controls.insertBefore(button, fullscreen);
    else this.controls.append(button);
    this.actions.set(action.id, button);
    return button;
  }

  addControl(control: HTMLElement, beforeFullscreen = true): void {
    const fullscreen = this.actions.get("fullscreen");
    if (beforeFullscreen && fullscreen) this.controls.insertBefore(control, fullscreen);
    else this.controls.append(control);
  }

  action(id: string): HTMLButtonElement {
    const action = this.actions.get(id);
    if (!action) throw new Error(`Unknown viewer action: ${id}`);
    return action;
  }

  setActionEnabled(id: string, enabled: boolean, title?: string): void {
    const action = this.action(id);
    action.disabled = !enabled;
    if (title) action.title = title;
  }

  setActionVisible(id: string, visible: boolean): void {
    this.action(id).hidden = !visible;
  }

  setTitle(title: string, tooltip?: string): void {
    this.titleElement.textContent = title;
    this.titleElement.title = tooltip ?? title;
  }

  setStatus(message: string, error = false): void {
    this.statusElement.textContent = message;
    this.statusElement.classList.toggle("error", error);
    this.statusElement.hidden = false;
  }

  clearStatus(): void {
    this.statusElement.hidden = true;
  }

  toast(message: string): void {
    const node = element("div", "viewer-toast toast", message);
    node.setAttribute("role", "status");
    document.body.append(node);
    window.setTimeout(() => node.remove(), 2200);
  }

  applyHostContext(context?: Partial<McpUiHostContext>): void {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context?.displayMode) {
      this.fullscreen = context.displayMode === "fullscreen";
      this.root.classList.toggle("fullscreen", this.fullscreen);
    }
  }

  async toggleFullscreen(): Promise<void> {
    const requested = this.fullscreen ? "inline" : "fullscreen";
    const result = await this.app.requestDisplayMode({ mode: requested });
    this.fullscreen = result.mode === "fullscreen";
    this.root.classList.toggle("fullscreen", this.fullscreen);
  }
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function installHostTheming(app: App, shell: ViewerShell): void {
  app.onhostcontextchanged = (context) => shell.applyHostContext(context);
  shell.applyHostContext(app.getHostContext());
}

export function toolResultError(result: { content?: unknown }, fallback: string): string {
  if (!Array.isArray(result.content)) return fallback;
  const message = result.content
    .filter((item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
  return message || fallback;
}
