import { Plugin, TFile, WorkspaceLeaf } from "obsidian";

import {
  buildCategoryTree,
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
    this.app.workspace.onLayoutReady(() => {
      void this.migrateLegacyFolderSections();
    });
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

  private async migrateLegacyFolderSections(): Promise<void> {
    if (this.settings.folderSections.length === 0) {
      return;
    }

    const tree = buildCategoryTree(this.app.vault.getMarkdownFiles(), this.app.metadataCache, this.settings);

    for (const section of this.settings.folderSections) {
      for (const folderId of section.folderIds) {
        const node = tree.folderLookup.get(folderId);
        const categoryFile = node ? this.resolveCategoryFileFromAssignment(node.assignmentValue) : null;
        if (!categoryFile) {
          continue;
        }

        await this.app.fileManager.processFrontMatter(categoryFile, (frontmatter) => {
          frontmatter[this.settings.categorySectionKey] = section.title;
        });
      }
    }

    await this.savePluginSettings({
      ...this.settings,
      sectionOrder: mergeSectionOrder(
        this.settings.sectionOrder,
        this.settings.folderSections.map((section) => section.title),
      ),
      folderSections: [],
    });
  }

  private resolveCategoryFileFromAssignment(assignmentValue: string | null): TFile | null {
    if (!assignmentValue) {
      return null;
    }

    const wikilinkMatch = assignmentValue.match(/^\[\[(.+?)\]\]$/u);
    if (!wikilinkMatch) {
      return null;
    }

    const linkpath = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
    if (linkpath.length === 0) {
      return null;
    }

    return this.app.metadataCache.getFirstLinkpathDest(linkpath, "");
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
    ...(typeof candidate.categorySectionKey === "string" ? { categorySectionKey: candidate.categorySectionKey } : {}),
    ...(candidate.noteDisplayMode === "list" || candidate.noteDisplayMode === "cards"
      ? { noteDisplayMode: candidate.noteDisplayMode }
      : {}),
    ...(candidate.noteSortMode === "modified"
      || candidate.noteSortMode === "created"
      || candidate.noteSortMode === "title"
      || candidate.noteSortMode === "property"
      ? { noteSortMode: candidate.noteSortMode }
      : {}),
    ...(candidate.noteSortDirection === "asc" || candidate.noteSortDirection === "desc"
      ? { noteSortDirection: candidate.noteSortDirection }
      : {}),
    ...(typeof candidate.noteSortProperty === "string" ? { noteSortProperty: candidate.noteSortProperty } : {}),
    ...(typeof candidate.showRealFilename === "boolean" ? { showRealFilename: candidate.showRealFilename } : {}),
    ...(typeof candidate.showPath === "boolean" ? { showPath: candidate.showPath } : {}),
    ...(typeof candidate.zebraRows === "boolean" ? { zebraRows: candidate.zebraRows } : {}),
    ...(Array.isArray(candidate.sectionOrder)
      ? { sectionOrder: candidate.sectionOrder.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(Array.isArray(candidate.folderOrder)
      ? { folderOrder: candidate.folderOrder.filter((value): value is string => typeof value === "string") }
      : {}),
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
    || currentSettings.categoryNoteFilenamePrefix !== nextSettings.categoryNoteFilenamePrefix
    || currentSettings.categorySectionKey !== nextSettings.categorySectionKey;
}

function mergeSectionOrder(existingOrder: readonly string[], nextValues: readonly string[]): readonly string[] {
  const mergedOrder: string[] = [];
  const seenLabels = new Set<string>();

  for (const value of [...existingOrder, ...nextValues]) {
    const trimmedValue = value.trim();
    const normalizedValue = trimmedValue.toLocaleLowerCase();

    if (trimmedValue.length === 0 || seenLabels.has(normalizedValue)) {
      continue;
    }

    seenLabels.add(normalizedValue);
    mergedOrder.push(trimmedValue);
  }

  return mergedOrder;
}
