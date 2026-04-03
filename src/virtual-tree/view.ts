import {
  App,
  ItemView,
  Menu,
  Modal,
  Setting,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import VirtualTreePlugin from "../../main";
import { buildCategoryTree } from "./buildCategoryTree";
import {
  CategoryFolderNode,
  CategoryTree,
  ROOT_FOLDER_ID,
} from "./types";

/**
 * View type ID used for workspace registration.
 */
export const VIEW_TYPE_VIRTUAL_TREE = "virtual-tree-view";

const DRAGGED_FILE_PATH_MIME = "application/x-virtual-tree-file-path";
const DRAGGED_FILE_PAYLOAD_MIME = "application/x-virtual-tree-file-payload";

interface DraggedFilePayload {
  readonly filePath: string;
  readonly sourceAssignmentValue: string | null;
}

interface AppWithCommands extends App {
  readonly commands: {
    executeCommandById(commandId: string): boolean;
  };
}

/**
 * Eagle-inspired explorer built from frontmatter categories.
 */
export class VirtualTreeView extends ItemView {
  private readonly plugin: VirtualTreePlugin;
  private readonly collapsedFolderIds = new Set<string>();
  private selectedFolderId = ROOT_FOLDER_ID;
  private refreshTimeoutId: number | null = null;
  private cachedTree: CategoryTree | null = null;
  private isTreeDirty = true;

  public constructor(leaf: WorkspaceLeaf, plugin: VirtualTreePlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRefresh()));
  }

  public override getViewType(): string {
    return VIEW_TYPE_VIRTUAL_TREE;
  }

  public override getDisplayText(): string {
    return "Virtual tree";
  }

  public override getIcon(): string {
    return "folder-tree";
  }

  public override async onOpen(): Promise<void> {
    this.addAction("refresh-cw", "Refresh virtual tree", (): void => {
      this.render();
    });

    this.render();
  }

  public override async onClose(): Promise<void> {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
  }

  /**
   * Debounces rerenders when vault metadata changes rapidly.
   */
  public requestRefresh(): void {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      this.isTreeDirty = true;
      this.render();
    }, 75);
  }

  private render(): void {
    const tree = this.getTree();
    const selectedNode = tree.folderLookup.get(this.selectedFolderId) ?? tree.root;
    this.selectedFolderId = selectedNode.id;

    this.contentEl.empty();
    this.contentEl.addClass("virtual-tree-view");

    const layoutEl = this.contentEl.createDiv({ cls: "virtual-tree-layout" });
    const sidebarEl = layoutEl.createDiv({ cls: "virtual-tree-sidebar" });
    const contentEl = layoutEl.createDiv({ cls: "virtual-tree-content" });

    this.renderSidebar(sidebarEl, tree);
    this.renderContent(
      contentEl,
      selectedNode,
      tree.descendantFilesByFolderId.get(selectedNode.id) ?? [],
    );
  }

  private getTree(): CategoryTree {
    if (this.cachedTree && !this.isTreeDirty) {
      return this.cachedTree;
    }

    this.cachedTree = buildCategoryTree(
      this.app.vault.getMarkdownFiles(),
      this.app.metadataCache,
      this.plugin.settings,
    );
    this.isTreeDirty = false;

    return this.cachedTree;
  }

  private renderSidebar(containerEl: HTMLElement, tree: CategoryTree): void {
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-sidebar-header" });
    headerEl.createEl("h3", { text: "Folders" });

    const foldersEl = containerEl.createDiv({ cls: "virtual-tree-folders" });
    this.renderFolderRow(foldersEl, tree.root, tree.descendantFilesByFolderId.get(ROOT_FOLDER_ID) ?? []);

    for (const childNode of sortFolderNodes(tree.root.children.values())) {
      this.renderFolderNode(foldersEl, childNode, tree.descendantFilesByFolderId);
    }

    if (tree.uncategorizedFiles.length > 0) {
      const sectionEl = containerEl.createDiv({ cls: "virtual-tree-sidebar-section" });
      const sectionHeaderEl = sectionEl.createDiv({ cls: "virtual-tree-sidebar-section-header" });
      sectionHeaderEl.createSpan({ text: "Uncategorized" });
      sectionHeaderEl.createSpan({
        cls: "virtual-tree-sidebar-section-count",
        text: `${tree.uncategorizedFiles.length}`,
      });

      const notesEl = sectionEl.createDiv({ cls: "virtual-tree-sidebar-uncategorized" });

      for (const file of tree.uncategorizedFiles) {
        this.renderSidebarUncategorizedFile(notesEl, file);
      }
    }
  }

  private renderFolderNode(
    containerEl: HTMLElement,
    node: CategoryFolderNode,
    descendantFilesByFolderId: ReadonlyMap<string, readonly TFile[]>,
  ): void {
    const groupEl = containerEl.createDiv({ cls: "virtual-tree-folder-group" });
    const rowEl = groupEl.createDiv({ cls: "virtual-tree-folder-row" });
    const hasChildren = node.children.size > 0;

    if (hasChildren) {
      const toggleEl = rowEl.createEl("button", {
        cls: "virtual-tree-folder-toggle clickable-icon",
        attr: {
          "aria-label": this.collapsedFolderIds.has(node.id) ? `Expand ${node.name}` : `Collapse ${node.name}`,
          type: "button",
        },
      });
      setIcon(toggleEl, this.collapsedFolderIds.has(node.id) ? "chevron-right" : "chevron-down");
      toggleEl.addEventListener("click", (event) => {
        event.stopPropagation();

        if (this.collapsedFolderIds.has(node.id)) {
          this.collapsedFolderIds.delete(node.id);
        } else {
          this.collapsedFolderIds.add(node.id);
        }

        this.render();
      });
    } else {
      rowEl.createDiv({ cls: "virtual-tree-folder-spacer" });
    }

    this.renderFolderRow(rowEl, node, descendantFilesByFolderId.get(node.id) ?? []);

    if (hasChildren && !this.collapsedFolderIds.has(node.id)) {
      const childrenEl = groupEl.createDiv({ cls: "virtual-tree-folder-children" });

      for (const childNode of sortFolderNodes(node.children.values())) {
        this.renderFolderNode(childrenEl, childNode, descendantFilesByFolderId);
      }
    }
  }

  private renderFolderRow(containerEl: HTMLElement, node: CategoryFolderNode, files: readonly TFile[]): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-folder-item" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");

    if (node.id === this.selectedFolderId) {
      rowEl.addClass("is-selected");
    }

    if (node.assignmentValue) {
      rowEl.addClass("is-droppable");
      this.attachFolderDropTarget(rowEl, node);
    }

    const leadingEl = rowEl.createDiv({ cls: "virtual-tree-folder-leading" });
    this.renderFolderIcon(leadingEl, node);
    leadingEl.createSpan({ cls: "virtual-tree-folder-label", text: node.name });

    rowEl.createSpan({
      cls: "virtual-tree-folder-count",
      text: `${files.length}`,
    });

    rowEl.addEventListener("click", () => {
      this.selectedFolderId = node.id;
      this.render();
    });

    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectedFolderId = node.id;
        this.render();
      }
    });

    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openFolderMenu(event, node);
    });
  }

  private renderFolderIcon(containerEl: HTMLElement, node: CategoryFolderNode): void {
    const iconEl = containerEl.createSpan({ cls: "virtual-tree-folder-icon" });

    if (node.id === ROOT_FOLDER_ID) {
      setIcon(iconEl, "library");
      return;
    }

    if (node.icon) {
      if (/^[a-z0-9-]+$/iu.test(node.icon)) {
        setIcon(iconEl, node.icon);
      } else {
        iconEl.setText(node.icon);
      }

      return;
    }

    setIcon(iconEl, "folder");
  }

  private renderSidebarUncategorizedFile(containerEl: HTMLElement, file: TFile): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-sidebar-file-row" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");
    rowEl.setAttribute("draggable", "true");

    const iconEl = rowEl.createSpan({ cls: "virtual-tree-sidebar-file-icon" });
    setIcon(iconEl, "file");
    rowEl.createSpan({ cls: "virtual-tree-sidebar-file-label", text: file.basename });

    this.attachFileInteractions(rowEl, file);
    this.attachFileDragSource(rowEl, file, null);
  }

  private attachFolderDropTarget(rowEl: HTMLElement, node: CategoryFolderNode): void {
    rowEl.addEventListener("dragover", (event) => {
      if (!event.dataTransfer) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      rowEl.addClass("is-drop-target");
    });

    rowEl.addEventListener("dragleave", () => {
      rowEl.removeClass("is-drop-target");
    });

    rowEl.addEventListener("drop", (event) => {
      event.preventDefault();
      rowEl.removeClass("is-drop-target");

      const payload = readDraggedFilePayload(event.dataTransfer);
      if (!payload) {
        return;
      }

      const abstractFile = this.app.vault.getAbstractFileByPath(payload.filePath);
      if (!(abstractFile instanceof TFile)) {
        return;
      }

      void this.assignFileToCategory(abstractFile, node, payload.sourceAssignmentValue);
    });
  }

  private renderContent(containerEl: HTMLElement, selectedNode: CategoryFolderNode, files: readonly TFile[]): void {
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: selectedNode.name });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${files.length} ${files.length === 1 ? "note" : "notes"}`,
    });

    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list",
    });

    if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
      filesEl.addClass("is-zebra");
    }

    if (files.length === 0) {
      const emptyStateEl = filesEl.createDiv({ cls: "virtual-tree-empty-state" });
      emptyStateEl.createSpan({ text: "No notes match this folder yet." });
      return;
    }

    for (const file of files) {
      if (this.plugin.settings.noteDisplayMode === "cards") {
        this.renderFileCard(filesEl, file, selectedNode.assignmentValue);
      } else {
        this.renderFileRow(filesEl, file, selectedNode.assignmentValue);
      }
    }
  }

  private renderFileRow(containerEl: HTMLElement, file: TFile, sourceAssignmentValue: string | null): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-file-row" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");
    rowEl.setAttribute("draggable", "true");

    const textEl = rowEl.createDiv({ cls: "virtual-tree-file-row-text" });
    textEl.createDiv({ cls: "virtual-tree-file-title", text: file.basename });

    if (this.plugin.settings.showPath) {
      textEl.createDiv({ cls: "virtual-tree-file-path", text: file.path });
    }

    this.attachFileInteractions(rowEl, file);
    this.attachFileDragSource(rowEl, file, sourceAssignmentValue);
  }

  private renderFileCard(
    containerEl: HTMLElement,
    file: TFile,
    sourceAssignmentValue: string | null,
  ): void {
    const cardEl = containerEl.createEl("button", {
      cls: "virtual-tree-file-card",
      attr: {
        type: "button",
        draggable: "true",
      },
    });

    cardEl.createDiv({ cls: "virtual-tree-file-title", text: file.basename });

    if (this.plugin.settings.showPath) {
      cardEl.createDiv({ cls: "virtual-tree-file-path", text: file.path });
    }

    cardEl.addEventListener("click", async () => {
      await this.app.workspace.getLeaf(false).openFile(file);
    });

    cardEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openFileMenu(event, file);
    });

    this.attachFileDragSource(cardEl, file, sourceAssignmentValue);
  }

  private attachFileDragSource(
    element: HTMLElement,
    file: TFile,
    sourceAssignmentValue: string | null,
  ): void {
    element.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }

      const payload: DraggedFilePayload = {
        filePath: file.path,
        sourceAssignmentValue,
      };

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAGGED_FILE_PAYLOAD_MIME, JSON.stringify(payload));
      event.dataTransfer.setData(DRAGGED_FILE_PATH_MIME, file.path);
      event.dataTransfer.setData("text/plain", file.path);
      element.addClass("is-dragging");
    });

    element.addEventListener("dragend", () => {
      element.removeClass("is-dragging");
    });
  }

  private attachFileInteractions(rowEl: HTMLElement, file: TFile): void {
    rowEl.addEventListener("click", async () => {
      await this.app.workspace.getLeaf(false).openFile(file);
    });

    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openFileMenu(event, file);
    });

    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.app.workspace.getLeaf(false).openFile(file);
      }
    });
  }

  private openFileMenu(event: MouseEvent, file: TFile): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Open note").setIcon("document").onClick(async () => {
        await this.app.workspace.getLeaf(false).openFile(file);
      });
    });
    menu.addItem((item) => {
      item.setTitle("Open to the side").setIcon("separator-vertical").onClick(async () => {
        await this.app.workspace.getLeaf("split", "vertical").openFile(file);
      });
    });
    menu.addItem((item) => {
      item.setTitle("Rename note").setIcon("pencil").onClick(async () => {
        await this.renameFileWithObsidianCommand(file);
      });
    });
    menu.showAtMouseEvent(event);
  }

  private openFolderMenu(event: MouseEvent, node: CategoryFolderNode): void {
    const categoryFile = this.resolveCategoryFile(node);
    if (!categoryFile) {
      return;
    }

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Open category note").setIcon("file-symlink").onClick(async () => {
        await this.app.workspace.getLeaf(false).openFile(categoryFile);
      });
    });
    menu.addItem((item) => {
      item.setTitle("Edit display title").setIcon("pencil").onClick(() => {
        const currentTitle = this.readCategoryDisplayTitle(categoryFile);
        new EditCategoryTitleModal(this.app, categoryFile, currentTitle, async (nextTitle) => {
          await this.updateCategoryDisplayTitle(categoryFile, nextTitle);
        }).open();
      });
    });
    menu.showAtMouseEvent(event);
  }

  private async renameFileWithObsidianCommand(file: TFile): Promise<void> {
    const targetLeaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await targetLeaf.openFile(file);
    const commandApp = this.app as AppWithCommands;
    commandApp.commands.executeCommandById("workspace:edit-file-title");
  }

  private async assignFileToCategory(
    file: TFile,
    node: CategoryFolderNode,
    sourceAssignmentValue: string | null,
  ): Promise<void> {
    if (!node.assignmentValue) {
      return;
    }

    const targetAssignmentValue = node.assignmentValue;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existingValues = normalizeFrontmatterCategoryValues(frontmatter[this.plugin.settings.frontmatterKey]);
      const filteredValues = sourceAssignmentValue && sourceAssignmentValue !== targetAssignmentValue
        ? existingValues.filter((value) => value !== sourceAssignmentValue)
        : existingValues;
      const nextValues = filteredValues.includes(targetAssignmentValue)
        ? filteredValues
        : [...filteredValues, targetAssignmentValue];

      frontmatter[this.plugin.settings.frontmatterKey] = nextValues;
    });

    this.selectedFolderId = node.id;
    this.isTreeDirty = true;
    this.requestRefresh();
  }

  private resolveCategoryFile(node: CategoryFolderNode): TFile | null {
    const assignmentValue = node.assignmentValue;
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

  private readCategoryDisplayTitle(file: TFile): string {
    const rawTitle = this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
    return typeof rawTitle === "string" ? rawTitle : "";
  }

  private async updateCategoryDisplayTitle(file: TFile, nextTitle: string): Promise<void> {
    const trimmedTitle = nextTitle.trim();

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (trimmedTitle.length > 0) {
        frontmatter.title = trimmedTitle;
        return;
      }

      delete frontmatter.title;
    });

    this.isTreeDirty = true;
    this.requestRefresh();
  }
}

class EditCategoryTitleModal extends Modal {
  private readonly file: TFile;
  private readonly initialValue: string;
  private readonly onSubmit: (nextTitle: string) => Promise<void>;
  private isSubmitting = false;

  public constructor(
    app: App,
    file: TFile,
    initialValue: string,
    onSubmit: (nextTitle: string) => Promise<void>,
  ) {
    super(app);
    this.file = file;
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("virtual-tree-edit-title-modal");
    contentEl.createEl("h2", { text: "Edit category display title" });

    contentEl.createEl("p", {
      cls: "virtual-tree-edit-title-hint",
      text: `Set the sidebar label for ${this.file.basename}. Leave empty to use the filename.`,
    });

    const formEl = contentEl.createDiv({ cls: "virtual-tree-edit-title-form" });
    const inputEl = formEl.createEl("input", {
      cls: "virtual-tree-edit-title-input",
      attr: {
        placeholder: this.file.basename,
        type: "text",
      },
      value: this.initialValue,
    });
    const saveButtonEl = formEl.createEl("button", {
      cls: "mod-cta",
      text: "Save",
      attr: {
        type: "button",
      },
    });

    const save = async (): Promise<void> => {
      if (this.isSubmitting) {
        return;
      }

      this.isSubmitting = true;
      saveButtonEl.disabled = true;

      try {
        await this.onSubmit(inputEl.value);
        this.close();
      } finally {
        this.isSubmitting = false;
        saveButtonEl.disabled = false;
      }
    };

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save();
      }
    });
    saveButtonEl.addEventListener("click", () => {
      void save();
    });

    const actionsEl = contentEl.createDiv({ cls: "virtual-tree-edit-title-actions" });
    const clearButtonEl = actionsEl.createEl("button", {
      text: "Clear title",
      attr: {
        type: "button",
      },
    });
    clearButtonEl.addEventListener("click", async () => {
      inputEl.value = "";
      await save();
    });

    window.setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
  }

  public override onClose(): void {
    this.contentEl.empty();
  }
}

function normalizeFrontmatterCategoryValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function readDraggedFilePayload(dataTransfer: DataTransfer | null): DraggedFilePayload | null {
  if (!dataTransfer) {
    return null;
  }

  const rawPayload = dataTransfer.getData(DRAGGED_FILE_PAYLOAD_MIME);
  if (rawPayload) {
    try {
      const parsedPayload = JSON.parse(rawPayload) as unknown;
      if (isDraggedFilePayload(parsedPayload)) {
        return parsedPayload;
      }
    } catch {
      // Fall back to legacy/plain path payloads.
    }
  }

  const fallbackPath = dataTransfer.getData(DRAGGED_FILE_PATH_MIME) || dataTransfer.getData("text/plain");
  if (!fallbackPath) {
    return null;
  }

  return {
    filePath: fallbackPath,
    sourceAssignmentValue: null,
  };
}

function isDraggedFilePayload(value: unknown): value is DraggedFilePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DraggedFilePayload>;
  return typeof candidate.filePath === "string"
    && (typeof candidate.sourceAssignmentValue === "string" || candidate.sourceAssignmentValue === null);
}

function sortFolderNodes(nodes: Iterable<CategoryFolderNode>): CategoryFolderNode[] {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
}
