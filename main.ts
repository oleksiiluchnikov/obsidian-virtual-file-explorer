import { Plugin, WorkspaceLeaf } from "obsidian";

import {
  DEFAULT_SETTINGS,
  type FolderSection,
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
    const shouldRebuildTree = shouldRebuildTreeForSettingsChange(this.settings, nextSettings);
    this.settings = nextSettings;
    await this.saveData(nextSettings);
    this.refreshViews(shouldRebuildTree);
  }

  /**
   * Refreshes every currently open virtual tree view.
   */
  public refreshViews(treeDirty = true): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)) {
      const view = leaf.view;
      if (view instanceof VirtualTreeView) {
        view.requestRefresh(treeDirty);
      }
    }
  }

  private async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...readVirtualTreeSettings(loadedSettings),
    };
  }

  private async activateView(): Promise<void> {
    const leaf = await this.ensureVirtualTreeLeaf();

    if (!leaf) {
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_VIRTUAL_TREE, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: false });
    this.app.workspace.revealLeaf(leaf);
  }

  private async ensureVirtualTreeLeaf(): Promise<WorkspaceLeaf | null> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)[0];
    if (existingLeaf) {
      return existingLeaf;
    }

    const leaf = this.app.workspace.getLeftLeaf(true);

    if (!leaf) {
      return null;
    }

    await leaf.setViewState({ type: VIEW_TYPE_VIRTUAL_TREE, active: false });
    return leaf;
  }
}

function readVirtualTreeSettings(value: unknown): Partial<VirtualTreeSettings> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const categoryNoteFilenamePrefix = normalizeCategoryNoteFilenamePrefix(candidate.categoryNoteFilenamePrefix);
  return {
    ...(typeof candidate.frontmatterKey === "string" ? { frontmatterKey: candidate.frontmatterKey } : {}),
    ...(typeof candidate.treatSlashesAsHierarchy === "boolean"
      ? { treatSlashesAsHierarchy: candidate.treatSlashesAsHierarchy }
      : {}),
    ...(typeof candidate.showUncategorized === "boolean" ? { showUncategorized: candidate.showUncategorized } : {}),
    ...(typeof candidate.showUncategorizedFolder === "boolean"
      ? { showUncategorizedFolder: candidate.showUncategorizedFolder }
      : {}),
    ...(typeof candidate.showUnassignedCategoryNotes === "boolean"
      ? { showUnassignedCategoryNotes: candidate.showUnassignedCategoryNotes }
      : {}),
    ...(categoryNoteFilenamePrefix !== null ? { categoryNoteFilenamePrefix } : {}),
    ...(candidate.noteDisplayMode === "list" || candidate.noteDisplayMode === "cards"
      ? { noteDisplayMode: candidate.noteDisplayMode }
      : {}),
    ...(typeof candidate.showPath === "boolean" ? { showPath: candidate.showPath } : {}),
    ...(typeof candidate.zebraRows === "boolean" ? { zebraRows: candidate.zebraRows } : {}),
    ...(Array.isArray(candidate.folderSections)
      ? { folderSections: candidate.folderSections.filter(isFolderSection) }
      : {}),
  };
}

function normalizeCategoryNoteFilenamePrefix(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  // Early versions treated `^` like a regex anchor, but this setting is a literal filename prefix.
  return value === "^category - " ? "category - " : value;
}

function isFolderSection(value: unknown): value is FolderSection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FolderSection>;
  return typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && Array.isArray(candidate.folderIds)
    && candidate.folderIds.every((folderId) => typeof folderId === "string");
}

function shouldRebuildTreeForSettingsChange(
  currentSettings: VirtualTreeSettings,
  nextSettings: VirtualTreeSettings,
): boolean {
  return currentSettings.frontmatterKey !== nextSettings.frontmatterKey
    || currentSettings.treatSlashesAsHierarchy !== nextSettings.treatSlashesAsHierarchy
    || currentSettings.showUncategorized !== nextSettings.showUncategorized
    || currentSettings.showUncategorizedFolder !== nextSettings.showUncategorizedFolder
    || currentSettings.showUnassignedCategoryNotes !== nextSettings.showUnassignedCategoryNotes
    || currentSettings.categoryNoteFilenamePrefix !== nextSettings.categoryNoteFilenamePrefix;
}
