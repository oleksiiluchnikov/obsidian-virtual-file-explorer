import { Plugin, WorkspaceLeaf } from "obsidian";

import {
  DEFAULT_SETTINGS,
  VIEW_TYPE_VIRTUAL_TREE,
  VirtualTreeSettingTab,
  VirtualTreeSettings,
  VirtualTreeView,
} from "./src/virtual-tree";

/**
 * Main plugin entrypoint for the virtual category explorer.
 */
export default class VirtualTreePlugin extends Plugin {
  public settings: VirtualTreeSettings = DEFAULT_SETTINGS;

  public override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_VIRTUAL_TREE,
      (leaf: WorkspaceLeaf) => new VirtualTreeView(leaf, this),
    );

    this.addRibbonIcon("folder-tree", "Open virtual tree", async (): Promise<void> => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-virtual-tree",
      name: "Open virtual tree",
      callback: async (): Promise<void> => {
        await this.activateView();
      },
    });

    this.addSettingTab(new VirtualTreeSettingTab(this.app, this));
  }

  public override async onunload(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE);
    await Promise.all(leaves.map((leaf) => leaf.detach()));
  }

  /**
   * Persists plugin settings and refreshes all open views.
   */
  public async savePluginSettings(nextSettings: VirtualTreeSettings): Promise<void> {
    this.settings = nextSettings;
    await this.saveData(nextSettings);
    this.refreshViews();
  }

  /**
   * Refreshes every currently open virtual tree view.
   */
  public refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)) {
      const view = leaf.view;
      if (view instanceof VirtualTreeView) {
        view.requestRefresh();
      }
    }
  }

  private async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(isVirtualTreeSettings(loadedSettings) ? loadedSettings : {}),
    };
  }

  private async activateView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)[0];
    const leaf = existingLeaf ?? this.app.workspace.getLeftLeaf(true);

    if (!leaf) {
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_VIRTUAL_TREE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}

/**
 * Validates persisted plugin settings before merging defaults.
 */
function isVirtualTreeSettings(value: unknown): value is Partial<VirtualTreeSettings> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return true;
}
