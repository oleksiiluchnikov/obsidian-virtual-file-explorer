import {
  App,
  ItemView,
  Menu,
  Modal,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import VirtualTreePlugin from "../../main";
import { buildCategoryTree } from "./buildCategoryTree";
import {
  CategoryFolderNode,
  CategoryTree,
  FolderSection,
  ROOT_FOLDER_ID,
} from "./types";

/**
 * View type ID used for workspace registration.
 */
export const VIEW_TYPE_VIRTUAL_TREE = "virtual-tree-view";

const DRAGGED_FILE_PATH_MIME = "application/x-virtual-tree-file-path";
const DRAGGED_FILE_PAYLOAD_MIME = "application/x-virtual-tree-file-payload";
const DRAGGED_FOLDER_ID_MIME = "application/x-virtual-tree-folder-id";
const DRAGGED_SECTION_ID_MIME = "application/x-virtual-tree-section-id";
const UNGROUPED_SECTION_ID = "__ungrouped__";
const LIST_VIRTUALIZATION_THRESHOLD = 200;
const LIST_VIRTUALIZATION_OVERSCAN = 12;
const LIST_ROW_HEIGHT = 32;
const LIST_ROW_HEIGHT_WITH_PATH = 48;

interface DraggedFilePayload {
  readonly filePath: string;
  readonly sourceAssignmentValue: string | null;
}

interface SidebarFolderSection {
  readonly id: string;
  readonly title: string;
  readonly folderNodes: readonly CategoryFolderNode[];
  readonly isUngrouped: boolean;
}

interface FolderSectionOption {
  readonly id: string;
  readonly name: string;
}

interface FolderSectionDraft {
  readonly id: string;
  title: string;
  folderIds: string[];
}

interface SectionContentGroup {
  readonly node: CategoryFolderNode;
  readonly files: readonly TFile[];
}

type RenderScope = "all" | "sidebar" | "content";

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
  private selectedSectionId: string | null = null;
  private refreshTimeoutId: number | null = null;
  private cachedTree: CategoryTree | null = null;
  private isTreeDirty = true;
  private activeDraggedFilePayload: DraggedFilePayload | null = null;
  private activeDropTargetEl: HTMLElement | null = null;
  private sidebarPaneEl: HTMLElement | null = null;
  private contentPaneEl: HTMLElement | null = null;
  private contentScrollEl: HTMLElement | null = null;
  private virtualizedListResizeObserver: ResizeObserver | null = null;
  private virtualizedListFrameId: number | null = null;
  private suppressClickUntil = 0;
  private isOrganizingFolderSections = false;
  private activeSectionOrganizeTargetEl: HTMLElement | null = null;

  public constructor(leaf: WorkspaceLeaf, plugin: VirtualTreePlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRefresh()));
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
      this.isTreeDirty = true;
      this.render();
    });

    this.render();
  }

  public override async onClose(): Promise<void> {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }

    this.cleanupVirtualizedList();
    this.clearActiveDropTarget();
    this.clearActiveSectionOrganizeTarget();
    this.activeDraggedFilePayload = null;
    this.isOrganizingFolderSections = false;
    this.sidebarPaneEl = null;
    this.contentPaneEl = null;
  }

  /**
   * Debounces rerenders when vault metadata changes rapidly.
   */
  public requestRefresh(treeDirty = true): void {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      this.isTreeDirty = this.isTreeDirty || treeDirty;
      this.render();
    }, 75);
  }

  private render(scope: RenderScope = "all", resetContentScroll = false): void {
    const tree = this.getTree();
    const folderSections = this.getSidebarFolderSections(tree);
    const selectedNode = tree.folderLookup.get(this.selectedFolderId) ?? tree.root;
    const selectedSection = this.selectedSectionId
      ? folderSections.find((section) => section.id === this.selectedSectionId) ?? null
      : null;
    this.selectedFolderId = selectedNode.id;
    this.selectedSectionId = selectedSection?.id ?? null;

    this.ensureLayout();

    if ((scope === "all" || scope === "sidebar") && this.sidebarPaneEl) {
      const sidebarScrollTop = this.sidebarPaneEl.scrollTop;
      this.renderSidebar(this.sidebarPaneEl, tree, folderSections);
      this.sidebarPaneEl.scrollTop = sidebarScrollTop;
    }

    if ((scope === "all" || scope === "content") && this.contentPaneEl) {
      const previousScrollTop = resetContentScroll ? 0 : this.contentScrollEl?.scrollTop ?? 0;
      if (selectedSection) {
        this.renderSectionContent(this.contentPaneEl, selectedSection, tree, previousScrollTop);
      } else {
        this.renderContent(
          this.contentPaneEl,
          selectedNode,
          tree.descendantFilesByFolderId.get(selectedNode.id) ?? [],
          previousScrollTop,
        );
      }
    }
  }

  private ensureLayout(): void {
    if (this.sidebarPaneEl && this.contentPaneEl) {
      return;
    }

    this.cleanupVirtualizedList();
    this.contentEl.empty();
    this.contentEl.addClass("virtual-tree-view");

    const layoutEl = this.contentEl.createDiv({ cls: "virtual-tree-layout" });
    this.sidebarPaneEl = layoutEl.createDiv({ cls: "virtual-tree-sidebar" });
    this.contentPaneEl = layoutEl.createDiv({ cls: "virtual-tree-content" });
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

  private renderSidebar(containerEl: HTMLElement, tree: CategoryTree, folderSections: readonly SidebarFolderSection[]): void {
    containerEl.empty();

    const headerEl = containerEl.createDiv({ cls: "virtual-tree-sidebar-header" });
    headerEl.createEl("h3", { text: "Folders" });
    const actionsEl = headerEl.createDiv({ cls: "virtual-tree-sidebar-actions" });
    if (this.isOrganizingFolderSections && this.plugin.settings.folderSections.length > 0) {
      const addSectionButtonEl = actionsEl.createEl("button", {
        cls: "clickable-icon",
        attr: {
          "aria-label": "Add section",
          "data-tooltip-position": "top",
          type: "button",
        },
      });
      setIcon(addSectionButtonEl, "plus");
      addSectionButtonEl.addEventListener("click", () => {
        void this.addFolderSection();
      });
    }

    const organizeSectionsButtonEl = actionsEl.createEl("button", {
      cls: this.isOrganizingFolderSections
        ? "clickable-icon virtual-tree-sidebar-organize-button is-active"
        : "clickable-icon virtual-tree-sidebar-organize-button",
      attr: {
        "aria-label": this.isOrganizingFolderSections ? "Done organizing sections" : "Organize folder sections",
        "data-tooltip-position": "top",
        type: "button",
      },
    });
    setIcon(organizeSectionsButtonEl, this.isOrganizingFolderSections ? "check" : "pencil");
    organizeSectionsButtonEl.addEventListener("click", () => {
      void this.toggleOrganizeFolderSections();
    });

    const foldersEl = containerEl.createDiv({ cls: "virtual-tree-folders" });
    this.renderFolderRow(foldersEl, tree.root, tree.descendantFilesByFolderId.get(ROOT_FOLDER_ID) ?? []);

    this.renderFolderSections(foldersEl, tree, folderSections);

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

  private renderFolderSections(
    containerEl: HTMLElement,
    tree: CategoryTree,
    folderSections: readonly SidebarFolderSection[],
  ): void {
    const topLevelNodes = tree.root.sortedChildren;
    const configuredSections = this.plugin.settings.folderSections;

    if (configuredSections.length === 0 && !this.isOrganizingFolderSections) {
      for (const childNode of topLevelNodes) {
        this.renderFolderNode(containerEl, childNode, tree.descendantFilesByFolderId);
      }

      return;
    }
    for (const section of folderSections) {
      const sectionEl = containerEl.createDiv({ cls: "virtual-tree-folder-section" });
      if (section.id === this.selectedSectionId) {
        sectionEl.addClass("is-selected");
      }
      if (this.isOrganizingFolderSections) {
        sectionEl.addClass("is-organizing");
      }

      const sectionHeaderEl = sectionEl.createDiv({ cls: "virtual-tree-folder-section-header" });

      if (this.isOrganizingFolderSections && !section.isUngrouped) {
        const headerRowEl = sectionHeaderEl.createDiv({ cls: "virtual-tree-folder-section-header-row" });
        const gripEl = headerRowEl.createEl("button", {
          cls: "clickable-icon virtual-tree-section-organize-handle",
          attr: {
            "aria-label": "Drag to reorder section",
            "data-tooltip-position": "top",
            draggable: "true",
            type: "button",
          },
        });
        setIcon(gripEl, "grip-vertical");
        this.attachSectionReorderDrag(gripEl, section.id);

        const titleInputEl = headerRowEl.createEl("input", {
          cls: "virtual-tree-section-title-input",
          attr: {
            "aria-label": "Section name",
            type: "text",
          },
          value: section.title,
        });
        titleInputEl.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        titleInputEl.addEventListener("keydown", (event) => {
          event.stopPropagation();
        });
        titleInputEl.addEventListener("blur", () => {
          void this.updateSectionTitleFromInput(section.id, titleInputEl.value);
        });

        headerRowEl.createSpan({
          cls: "virtual-tree-sidebar-section-count",
          text: `${section.folderNodes.length}`,
        });

        const deleteSectionButtonEl = headerRowEl.createEl("button", {
          cls: "clickable-icon",
          attr: {
            "aria-label": "Delete section",
            "data-tooltip-position": "top",
            type: "button",
          },
        });
        setIcon(deleteSectionButtonEl, "trash");
        deleteSectionButtonEl.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.deleteFolderSection(section.id);
        });
      } else {
        sectionHeaderEl.setAttribute("role", "button");
        sectionHeaderEl.setAttribute("tabindex", "0");
        sectionHeaderEl.createSpan({ text: section.title });
        sectionHeaderEl.createSpan({
          cls: "virtual-tree-sidebar-section-count",
          text: `${section.folderNodes.length}`,
        });

        sectionHeaderEl.addEventListener("click", () => {
          if (this.shouldIgnorePointerActivation()) {
            return;
          }

          this.selectedSectionId = section.id;
          this.render("all", true);
        });
        sectionHeaderEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.selectedSectionId = section.id;
            this.render("all", true);
          }
        });
      }

      if (this.isOrganizingFolderSections) {
        this.attachSectionOrganizeDropTarget(sectionEl, section);
      }

      if (section.folderNodes.length === 0) {
        sectionEl.createDiv({
          cls: "virtual-tree-folder-section-empty",
          text: section.isUngrouped ? "No ungrouped folders." : "No folders assigned yet.",
        });
        continue;
      }

      const sectionFoldersEl = sectionEl.createDiv({ cls: "virtual-tree-folders" });
      for (const childNode of section.folderNodes) {
        this.renderFolderNode(sectionFoldersEl, childNode, tree.descendantFilesByFolderId);
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
    const hasChildren = node.sortedChildren.length > 0;

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

        this.render("sidebar");
      });
    } else {
      rowEl.createDiv({ cls: "virtual-tree-folder-spacer" });
    }

    this.renderFolderRow(rowEl, node, descendantFilesByFolderId.get(node.id) ?? []);

    if (hasChildren && !this.collapsedFolderIds.has(node.id)) {
      const childrenEl = groupEl.createDiv({ cls: "virtual-tree-folder-children" });

      for (const childNode of node.sortedChildren) {
        this.renderFolderNode(childrenEl, childNode, descendantFilesByFolderId);
      }
    }
  }

  private renderFolderRow(containerEl: HTMLElement, node: CategoryFolderNode, files: readonly TFile[]): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-folder-item" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");

    if (this.selectedSectionId === null && node.id === this.selectedFolderId) {
      rowEl.addClass("is-selected");
    }

    if (node.assignmentValue) {
      rowEl.addClass("is-droppable");
      this.attachFolderDropTarget(rowEl, node);
    }

    const leadingEl = rowEl.createDiv({ cls: "virtual-tree-folder-leading" });
    if (this.isOrganizingFolderSections && this.plugin.settings.folderSections.length > 0 && node.depth === 1) {
      const organizeHandleEl = leadingEl.createEl("button", {
        cls: "clickable-icon virtual-tree-folder-organize-handle",
        attr: {
          "aria-label": `Move ${node.name} to another section`,
          "data-tooltip-position": "top",
          draggable: "true",
          type: "button",
        },
      });
      setIcon(organizeHandleEl, "grip-vertical");
      this.attachFolderOrganizeDrag(organizeHandleEl, node.id);
    }

    this.renderFolderIcon(leadingEl, node);
    leadingEl.createSpan({ cls: "virtual-tree-folder-label", text: node.name });

    rowEl.createSpan({
      cls: "virtual-tree-folder-count",
      text: `${files.length}`,
    });

    rowEl.addEventListener("click", () => {
      if (this.shouldIgnorePointerActivation()) {
        return;
      }

      this.selectedSectionId = null;
      this.selectedFolderId = node.id;
      this.render("all", true);
    });

    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectedSectionId = null;
        this.selectedFolderId = node.id;
        this.render("all", true);
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
      const dataTransfer = event.dataTransfer;
      if (!this.readActiveDraggedFilePayload(dataTransfer) || !dataTransfer) {
        return;
      }

      event.preventDefault();
      dataTransfer.dropEffect = "move";
      if (this.activeDropTargetEl !== rowEl) {
        this.setActiveDropTarget(rowEl);
      }
    });

    rowEl.addEventListener("drop", (event) => {
      event.preventDefault();
      this.clearActiveDropTarget();

      const payload = this.readActiveDraggedFilePayload(event.dataTransfer);
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

  private renderContent(
    containerEl: HTMLElement,
    selectedNode: CategoryFolderNode,
    files: readonly TFile[],
    initialScrollTop: number,
  ): void {
    this.cleanupVirtualizedList();
    containerEl.empty();

    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: selectedNode.name });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${files.length} ${files.length === 1 ? "note" : "notes"}`,
    });

    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list",
    });
    this.contentScrollEl = filesEl;

    if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
      filesEl.addClass("is-zebra");
    }

    if (files.length === 0) {
      const emptyStateEl = filesEl.createDiv({ cls: "virtual-tree-empty-state" });
      emptyStateEl.createSpan({ text: "No notes match this folder yet." });
      return;
    }

    if (this.shouldVirtualizeList(files)) {
      this.renderVirtualizedFileList(filesEl, files, selectedNode.assignmentValue, initialScrollTop);
      return;
    }

    for (const [index, file] of files.entries()) {
      if (this.plugin.settings.noteDisplayMode === "cards") {
        this.renderFileCard(filesEl, file, selectedNode.assignmentValue);
      } else {
        this.renderFileRow(filesEl, file, selectedNode.assignmentValue, index);
      }
    }

    filesEl.scrollTop = initialScrollTop;
  }

  private renderSectionContent(
    containerEl: HTMLElement,
    section: SidebarFolderSection,
    tree: CategoryTree,
    initialScrollTop: number,
  ): void {
    this.cleanupVirtualizedList();
    containerEl.empty();

    const groups = this.buildSectionContentGroups(section, tree);
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: section.title });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${countUniqueFiles(groups)} ${countUniqueFiles(groups) === 1 ? "note" : "notes"}`,
    });

    const contentEl = containerEl.createDiv({ cls: "virtual-tree-section-content" });
    this.contentScrollEl = contentEl;

    if (groups.length === 0) {
      const emptyStateEl = contentEl.createDiv({ cls: "virtual-tree-empty-state" });
      emptyStateEl.createSpan({ text: "No notes match this section yet." });
      return;
    }

    groups.forEach((group) => {
      const groupEl = contentEl.createDiv({ cls: "virtual-tree-section-group" });
      const groupHeaderEl = groupEl.createDiv({ cls: "virtual-tree-section-group-header" });
      groupHeaderEl.createSpan({ cls: "virtual-tree-section-group-title", text: group.node.name });
      groupHeaderEl.createSpan({
        cls: "virtual-tree-sidebar-section-count",
        text: `${group.files.length}`,
      });

      const filesEl = groupEl.createDiv({
        cls: this.plugin.settings.noteDisplayMode === "cards"
          ? "virtual-tree-file-grid virtual-tree-section-group-files"
          : "virtual-tree-file-list virtual-tree-section-group-files",
      });

      if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
        filesEl.addClass("is-zebra");
      }

      group.files.forEach((file, index) => {
        if (this.plugin.settings.noteDisplayMode === "cards") {
          this.renderFileCard(filesEl, file, group.node.assignmentValue);
        } else {
          this.renderFileRow(filesEl, file, group.node.assignmentValue, index);
        }
      });
    });

    contentEl.scrollTop = initialScrollTop;
  }

  private buildSectionContentGroups(
    section: SidebarFolderSection,
    tree: CategoryTree,
  ): readonly SectionContentGroup[] {
    return section.folderNodes
      .map((node) => ({
        node,
        files: tree.descendantFilesByFolderId.get(node.id) ?? [],
      }))
      .filter((group) => group.files.length > 0);
  }

  private shouldVirtualizeList(files: readonly TFile[]): boolean {
    return this.plugin.settings.noteDisplayMode === "list" && files.length >= LIST_VIRTUALIZATION_THRESHOLD;
  }

  private renderVirtualizedFileList(
    containerEl: HTMLElement,
    files: readonly TFile[],
    sourceAssignmentValue: string | null,
    initialScrollTop: number,
  ): void {
    containerEl.addClass("is-virtualized");

    const spacerEl = containerEl.createDiv({ cls: "virtual-tree-file-list-spacer" });
    const windowEl = containerEl.createDiv({ cls: "virtual-tree-file-list-window" });
    const rowHeight = this.plugin.settings.showPath ? LIST_ROW_HEIGHT_WITH_PATH : LIST_ROW_HEIGHT;
    spacerEl.style.height = `${files.length * rowHeight}px`;
    containerEl.scrollTop = initialScrollTop;

    const renderWindow = (): void => {
      this.virtualizedListFrameId = null;

      const viewportHeight = Math.max(containerEl.clientHeight, rowHeight * 8);
      const scrollTop = containerEl.scrollTop;
      const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - LIST_VIRTUALIZATION_OVERSCAN);
      const endIndex = Math.min(
        files.length,
        Math.ceil((scrollTop + viewportHeight) / rowHeight) + LIST_VIRTUALIZATION_OVERSCAN,
      );

      windowEl.empty();
      windowEl.style.transform = `translateY(${startIndex * rowHeight}px)`;

      for (let index = startIndex; index < endIndex; index += 1) {
        this.renderFileRow(windowEl, files[index], sourceAssignmentValue, index);
      }
    };

    const scheduleRenderWindow = (): void => {
      if (this.virtualizedListFrameId !== null) {
        return;
      }

      this.virtualizedListFrameId = window.requestAnimationFrame(renderWindow);
    };

    containerEl.addEventListener("scroll", scheduleRenderWindow);
    this.virtualizedListResizeObserver = new ResizeObserver(() => {
      scheduleRenderWindow();
    });
    this.virtualizedListResizeObserver.observe(containerEl);

    renderWindow();
    scheduleRenderWindow();
  }

  private cleanupVirtualizedList(): void {
    if (this.virtualizedListResizeObserver) {
      this.virtualizedListResizeObserver.disconnect();
      this.virtualizedListResizeObserver = null;
    }

    if (this.virtualizedListFrameId !== null) {
      window.cancelAnimationFrame(this.virtualizedListFrameId);
      this.virtualizedListFrameId = null;
    }

    this.contentScrollEl = null;
  }

  private renderFileRow(
    containerEl: HTMLElement,
    file: TFile,
    sourceAssignmentValue: string | null,
    rowIndex: number,
  ): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-file-row" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");
    rowEl.setAttribute("draggable", "true");

    if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
      rowEl.addClass(rowIndex % 2 === 0 ? "is-zebra-odd" : "is-zebra-even");
    }

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

      this.activeDraggedFilePayload = payload;
      this.contentEl.addClass("is-dragging-file");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAGGED_FILE_PAYLOAD_MIME, JSON.stringify(payload));
      event.dataTransfer.setData(DRAGGED_FILE_PATH_MIME, file.path);
      event.dataTransfer.setData("text/plain", file.path);
      element.addClass("is-dragging");
    });

    element.addEventListener("drag", (event) => {
      if (!this.activeDraggedFilePayload) {
        return;
      }

      this.updateDropTargetFromPointer(event.clientX, event.clientY);
    });

    element.addEventListener("dragend", () => {
      element.removeClass("is-dragging");
      this.activeDraggedFilePayload = null;
      this.clearActiveDropTarget();
      this.contentEl.removeClass("is-dragging-file");
      this.suppressClickUntil = window.performance.now() + 150;
    });
  }

  private attachFileInteractions(rowEl: HTMLElement, file: TFile): void {
    rowEl.addEventListener("click", async () => {
      if (this.shouldIgnorePointerActivation()) {
        return;
      }

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

  private async toggleOrganizeFolderSections(): Promise<void> {
    if (this.isOrganizingFolderSections) {
      this.isOrganizingFolderSections = false;
      this.clearActiveSectionOrganizeTarget();
      this.render("sidebar");
      return;
    }

    if (this.plugin.settings.folderSections.length === 0) {
      const nextSection: FolderSection = {
        id: createFolderSectionId(),
        title: "Section 1",
        folderIds: [],
      };

      await this.plugin.savePluginSettings({
        ...this.plugin.settings,
        folderSections: [nextSection],
      });
      this.isTreeDirty = true;
    }

    this.isOrganizingFolderSections = true;
    this.render("sidebar");
  }

  private async addFolderSection(): Promise<void> {
    const nextSection: FolderSection = {
      id: createFolderSectionId(),
      title: `Section ${this.plugin.settings.folderSections.length + 1}`,
      folderIds: [],
    };

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: [...this.plugin.settings.folderSections, nextSection],
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }

  private async deleteFolderSection(sectionId: string): Promise<void> {
    const nextSections = this.plugin.settings.folderSections.filter((section) => section.id !== sectionId);

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: nextSections,
    });
    this.isTreeDirty = true;

    if (nextSections.length === 0) {
      this.isOrganizingFolderSections = false;
    }

    this.render("sidebar");
  }

  private async updateSectionTitleFromInput(sectionId: string, nextTitle: string): Promise<void> {
    const tree = this.getTree();
    const folderOptions = this.getFolderSectionOptions(tree);
    const drafts: FolderSectionDraft[] = this.plugin.settings.folderSections.map((section) => {
      if (section.id !== sectionId) {
        return {
          id: section.id,
          title: section.title,
          folderIds: [...section.folderIds],
        };
      }

      return {
        id: section.id,
        title: nextTitle,
        folderIds: [...section.folderIds],
      };
    });

    const validated = validateFolderSections(drafts, folderOptions);
    if (!validated) {
      this.render("sidebar");
      return;
    }

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated,
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }

  private async moveFolderToSection(folderId: string, targetSectionId: string | null): Promise<void> {
    const tree = this.getTree();
    const folderOptions = this.getFolderSectionOptions(tree);

    let drafts: FolderSectionDraft[] = this.plugin.settings.folderSections.map((section) => ({
      id: section.id,
      title: section.title,
      folderIds: section.folderIds.filter((existingFolderId) => existingFolderId !== folderId),
    }));

    if (targetSectionId) {
      drafts = drafts.map((section) =>
        section.id === targetSectionId
          ? { ...section, folderIds: [...section.folderIds, folderId] }
          : section,
      );
    }

    const validated = validateFolderSections(drafts, folderOptions);
    if (!validated) {
      return;
    }

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated,
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }

  private async reorderFolderSections(draggedSectionId: string, targetSectionId: string): Promise<void> {
    if (draggedSectionId === targetSectionId) {
      return;
    }

    const ordered = [...this.plugin.settings.folderSections];
    const fromIndex = ordered.findIndex((section) => section.id === draggedSectionId);
    const toIndex = ordered.findIndex((section) => section.id === targetSectionId);

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const [removed] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, removed);

    const tree = this.getTree();
    const drafts: FolderSectionDraft[] = ordered.map((section) => ({
      id: section.id,
      title: section.title,
      folderIds: [...section.folderIds],
    }));

    const validated = validateFolderSections(drafts, this.getFolderSectionOptions(tree));
    if (!validated) {
      return;
    }

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated,
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }

  private getFolderSectionOptions(tree: CategoryTree): FolderSectionOption[] {
    return tree.root.sortedChildren.map((node) => ({
      id: node.id,
      name: node.name,
    }));
  }

  private getSidebarFolderSections(tree: CategoryTree): readonly SidebarFolderSection[] {
    return buildSidebarFolderSections(tree.root.sortedChildren, this.plugin.settings.folderSections);
  }

  private attachSectionOrganizeDropTarget(sectionEl: HTMLElement, section: SidebarFolderSection): void {
    const onDragOver = (event: DragEvent): void => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      const isFolderDrag = dataTransfer.types.includes(DRAGGED_FOLDER_ID_MIME);
      const isSectionDrag = dataTransfer.types.includes(DRAGGED_SECTION_ID_MIME);

      if (isFolderDrag) {
        event.preventDefault();
        dataTransfer.dropEffect = "move";
        this.setActiveSectionOrganizeTarget(sectionEl);
        return;
      }

      if (isSectionDrag && !section.isUngrouped) {
        event.preventDefault();
        dataTransfer.dropEffect = "move";
        this.setActiveSectionOrganizeTarget(sectionEl);
      }
    };

    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.clearActiveSectionOrganizeTarget();

      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      const folderId = dataTransfer.getData(DRAGGED_FOLDER_ID_MIME);
      if (folderId.length > 0) {
        const targetId = section.isUngrouped ? null : section.id;
        void this.moveFolderToSection(folderId, targetId);
        return;
      }

      const draggedSectionId = dataTransfer.getData(DRAGGED_SECTION_ID_MIME);
      if (draggedSectionId.length > 0 && !section.isUngrouped) {
        void this.reorderFolderSections(draggedSectionId, section.id);
      }
    };

    sectionEl.addEventListener("dragover", onDragOver, true);
    sectionEl.addEventListener("drop", onDrop, true);
  }

  private attachFolderOrganizeDrag(handleEl: HTMLElement, folderId: string): void {
    handleEl.setAttribute("draggable", "true");
    handleEl.addEventListener("dragstart", (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      dataTransfer.effectAllowed = "move";
      dataTransfer.setData(DRAGGED_FOLDER_ID_MIME, folderId);
      this.contentEl.addClass("is-organizing-folder-drag");
      event.stopPropagation();
    });

    handleEl.addEventListener("dragend", () => {
      this.contentEl.removeClass("is-organizing-folder-drag");
      this.clearActiveSectionOrganizeTarget();
    });
  }

  private attachSectionReorderDrag(handleEl: HTMLElement, sectionId: string): void {
    handleEl.setAttribute("draggable", "true");
    handleEl.addEventListener("dragstart", (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      dataTransfer.effectAllowed = "move";
      dataTransfer.setData(DRAGGED_SECTION_ID_MIME, sectionId);
      this.contentEl.addClass("is-organizing-section-drag");
      event.stopPropagation();
    });

    handleEl.addEventListener("dragend", () => {
      this.contentEl.removeClass("is-organizing-section-drag");
      this.clearActiveSectionOrganizeTarget();
    });
  }

  private setActiveSectionOrganizeTarget(nextTarget: HTMLElement): void {
    if (this.activeSectionOrganizeTargetEl === nextTarget) {
      return;
    }

    this.clearActiveSectionOrganizeTarget();
    this.activeSectionOrganizeTargetEl = nextTarget;
    nextTarget.addClass("is-section-organize-target");
  }

  private clearActiveSectionOrganizeTarget(): void {
    if (!this.activeSectionOrganizeTargetEl) {
      return;
    }

    this.activeSectionOrganizeTargetEl.removeClass("is-section-organize-target");
    this.activeSectionOrganizeTargetEl = null;
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
    this.render("all", true);
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

  private shouldIgnorePointerActivation(): boolean {
    return window.performance.now() < this.suppressClickUntil;
  }

  private setActiveDropTarget(nextTarget: HTMLElement): void {
    if (this.activeDropTargetEl === nextTarget) {
      return;
    }

    this.clearActiveDropTarget();
    this.activeDropTargetEl = nextTarget;
    nextTarget.addClass("is-drop-target");
  }

  private clearActiveDropTarget(): void {
    if (!this.activeDropTargetEl) {
      return;
    }

    this.activeDropTargetEl.removeClass("is-drop-target");
    this.activeDropTargetEl = null;
  }

  private readActiveDraggedFilePayload(dataTransfer: DataTransfer | null): DraggedFilePayload | null {
    return this.activeDraggedFilePayload ?? readDraggedFilePayload(dataTransfer);
  }

  private updateDropTargetFromPointer(clientX: number, clientY: number): void {
    if (clientX <= 0 && clientY <= 0) {
      return;
    }

    const hoveredElement = this.contentEl.ownerDocument.elementFromPoint(clientX, clientY);
    const dropTarget = hoveredElement instanceof HTMLElement
      ? hoveredElement.closest(".virtual-tree-folder-item.is-droppable")
      : null;

    if (!(dropTarget instanceof HTMLElement) || !this.contentEl.contains(dropTarget)) {
      this.clearActiveDropTarget();
      return;
    }

    this.setActiveDropTarget(dropTarget);
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

function buildSidebarFolderSections(
  topLevelNodes: readonly CategoryFolderNode[],
  folderSections: readonly FolderSection[],
): readonly SidebarFolderSection[] {
  if (folderSections.length === 0) {
    return [];
  }

  const nodesById = new Map(topLevelNodes.map((node) => [node.id, node]));
  const claimedFolderIds = new Set<string>();
  const sections: SidebarFolderSection[] = [];

  folderSections.forEach((section) => {
    const folderNodes: CategoryFolderNode[] = [];

    section.folderIds.forEach((folderId) => {
      if (claimedFolderIds.has(folderId)) {
        return;
      }

      const node = nodesById.get(folderId);
      if (!node) {
        return;
      }

      claimedFolderIds.add(folderId);
      folderNodes.push(node);
    });

    sections.push({
      id: section.id,
      title: section.title,
      folderNodes,
      isUngrouped: false,
    });
  });

  const ungroupedNodes = topLevelNodes.filter((node) => !claimedFolderIds.has(node.id));
  if (ungroupedNodes.length > 0) {
    sections.push({
      id: UNGROUPED_SECTION_ID,
      title: "Ungrouped",
      folderNodes: ungroupedNodes,
      isUngrouped: true,
    });
  }

  return sections;
}

function validateFolderSections(
  sections: readonly FolderSectionDraft[],
  folderOptions: readonly FolderSectionOption[],
): readonly FolderSection[] | null {
  const availableFolderIds = new Set(folderOptions.map((folderOption) => folderOption.id));
  const usedTitles = new Set<string>();
  const claimedFolderIds = new Set<string>();

  try {
    return sections.map((section) => {
      const title = section.title.trim();
      if (title.length === 0) {
        throw new Error("Section names cannot be empty.");
      }

      const normalizedTitle = title.toLocaleLowerCase();
      if (usedTitles.has(normalizedTitle)) {
        throw new Error("Section names must be unique.");
      }
      usedTitles.add(normalizedTitle);

      const folderIds = section.folderIds.filter((folderId) => {
        if (!availableFolderIds.has(folderId) || claimedFolderIds.has(folderId)) {
          return false;
        }

        claimedFolderIds.add(folderId);
        return true;
      });

      return {
        id: section.id,
        title,
        folderIds,
      };
    });
  } catch (error) {
    new Notice(error instanceof Error ? error.message : "Unable to save folder sections.");
    return null;
  }
}

function countUniqueFiles(groups: readonly SectionContentGroup[]): number {
  return new Set(groups.flatMap((group) => group.files.map((file) => file.path))).size;
}

function createFolderSectionId(): string {
  return `folder-section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
