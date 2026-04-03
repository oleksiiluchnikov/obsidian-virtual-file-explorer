import {
  App,
  ItemView,
  Menu,
  Modal,
  Notice,
  TAbstractFile,
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
  UNCATEGORIZED_FOLDER_ID,
  VirtualTreeSettings,
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
const AUTO_REFRESH_SUPPRESSION_MS = 2000;
const CONTENT_ORDER_OVERRIDE_MS = 2000;

interface DraggedFilePayload {
  readonly filePath: string;
  readonly filePaths: readonly string[];
  readonly sourceAssignmentValue: string | null;
  readonly isAdditive: boolean;
}

interface CategoryAssignmentOption {
  readonly label: string;
  readonly assignmentValue: string;
}

interface ContentScrollAnchor {
  readonly filePath: string | null;
  readonly offsetTop: number;
  readonly fallbackScrollTop: number;
  readonly estimatedRowHeight: number | null;
}

interface AutoRefreshSuppression {
  readonly expiresAt: number;
  readonly filePaths: ReadonlySet<string>;
}

interface PendingContentOrderOverride {
  readonly viewKey: string;
  readonly orderedFilePaths: readonly string[];
  readonly expiresAt: number;
}

interface SidebarFolderSection {
  readonly id: string;
  readonly title: string;
  readonly folderNodes: readonly CategoryFolderNode[];
  readonly isUngrouped: boolean;
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
  private currentContentFilePaths: readonly string[] = [];
  private readonly selectedNotePaths = new Set<string>();
  private selectionAnchorFilePath: string | null = null;
  private virtualizedListResizeObserver: ResizeObserver | null = null;
  private virtualizedListFrameId: number | null = null;
  private suppressClickUntil = 0;
  private isOrganizingFolderSections = false;
  private activeSectionOrganizeTargetEl: HTMLElement | null = null;
  private activeFolderOrganizeTargetEl: HTMLElement | null = null;
  private pendingSidebarScrollTop: number | null = null;
  private pendingContentScrollAnchor: ContentScrollAnchor | null = null;
  private pendingContentScrollReset = false;
  private pendingRenderScope: RenderScope | null = null;
  private pendingTreeDirty = false;
  private autoRefreshSuppression: AutoRefreshSuppression | null = null;
  private pendingContentOrderOverride: PendingContentOrderOverride | null = null;

  public constructor(leaf: WorkspaceLeaf, plugin: VirtualTreePlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (this.shouldIgnoreAutoRefresh(file.path)) {
        return;
      }

      this.requestRefresh();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.shouldIgnoreAutoRefresh(this.getAbstractFilePath(file))) {
        return;
      }

      this.requestRefresh();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (this.shouldIgnoreAutoRefresh(this.getAbstractFilePath(file))) {
        return;
      }

      this.requestRefresh();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.shouldIgnoreAutoRefresh(this.getAbstractFilePath(file)) || this.shouldIgnoreAutoRefresh(oldPath)) {
        return;
      }

      this.requestRefresh();
    }));
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
    this.clearActiveFolderOrganizeTarget();
    this.activeDraggedFilePayload = null;
    this.isOrganizingFolderSections = false;
    this.pendingRenderScope = null;
    this.pendingTreeDirty = false;
    this.autoRefreshSuppression = null;
    this.pendingContentOrderOverride = null;
    this.sidebarPaneEl = null;
    this.contentPaneEl = null;
  }

  /**
   * Debounces rerenders when vault metadata changes rapidly.
   */
  public requestRefresh(treeDirty = true, resetContentScroll = false): void {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
    }

    this.pendingRenderScope = mergeRenderScope(this.pendingRenderScope, treeDirty ? "all" : "content");
    this.pendingTreeDirty = this.pendingTreeDirty || treeDirty;
    this.pendingContentScrollReset = this.pendingContentScrollReset || resetContentScroll;

    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      this.isTreeDirty = this.isTreeDirty || this.pendingTreeDirty;
      this.pendingTreeDirty = false;
      const renderScope = this.pendingRenderScope ?? (treeDirty ? "all" : "content");
      this.pendingRenderScope = null;
      const shouldResetContentScroll = this.pendingContentScrollReset;
      this.pendingContentScrollReset = false;
      this.render(renderScope, shouldResetContentScroll);
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

    if (resetContentScroll) {
      this.pendingContentOrderOverride = null;
    }

    if ((scope === "all" || scope === "sidebar") && this.sidebarPaneEl) {
      const sidebarScrollTop = this.pendingSidebarScrollTop ?? this.sidebarPaneEl.scrollTop;
      this.renderSidebar(this.sidebarPaneEl, tree, folderSections);
      this.sidebarPaneEl.scrollTop = sidebarScrollTop;
      window.requestAnimationFrame(() => {
        if (this.sidebarPaneEl) {
          this.sidebarPaneEl.scrollTop = sidebarScrollTop;
        }
      });
      this.pendingSidebarScrollTop = null;
    }

    if ((scope === "all" || scope === "content") && this.contentPaneEl) {
      const previousScrollTop = resetContentScroll
        ? 0
        : this.pendingContentScrollAnchor?.fallbackScrollTop ?? this.contentScrollEl?.scrollTop ?? 0;
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

      if (!resetContentScroll) {
        this.restorePendingContentScrollAnchor();
      } else {
        this.pendingContentScrollAnchor = null;
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
    if (this.isOrganizingFolderSections) {
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

    const uncategorizedNode = tree.folderLookup.get(UNCATEGORIZED_FOLDER_ID);
    if (uncategorizedNode) {
      this.renderFolderRow(
        foldersEl,
        uncategorizedNode,
        tree.descendantFilesByFolderId.get(UNCATEGORIZED_FOLDER_ID) ?? [],
      );
    }

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
    if (folderSections.length === 0) {
      const topLevelNodes = tree.root.sortedChildren;

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

        headerRowEl.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSectionMenu(event, section);
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

          this.selectedNotePaths.clear();
          this.selectionAnchorFilePath = null;
          this.selectedSectionId = section.id;
          this.render("all", true);
        });
        sectionHeaderEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.selectedNotePaths.clear();
            this.selectionAnchorFilePath = null;
            this.selectedSectionId = section.id;
            this.render("all", true);
          }
        });
        sectionHeaderEl.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.openSectionMenu(event, section);
        });
      }

      this.attachSectionDropTarget(sectionEl, section, this.isOrganizingFolderSections);

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

    const canOrganizeTopLevelFolder = this.isOrganizingFolderSections && node.depth === 1 && node.id !== UNCATEGORIZED_FOLDER_ID;

    if (!this.isOrganizingFolderSections && this.canDragFolderBetweenSections(node)) {
      rowEl.setAttribute("draggable", "true");
      rowEl.addClass("is-section-draggable");
      this.attachFolderSectionDrag(rowEl, node.id);
    }

    if (this.selectedSectionId === null && node.id === this.selectedFolderId) {
      rowEl.addClass("is-selected");
    }

    if (node.assignmentValue) {
      rowEl.addClass("is-droppable");
      this.attachFolderDropTarget(rowEl, node);
    }

    if (canOrganizeTopLevelFolder) {
      this.attachFolderOrganizeDropTarget(rowEl, node.id);
    }

    const leadingEl = rowEl.createDiv({ cls: "virtual-tree-folder-leading" });
    if (canOrganizeTopLevelFolder) {
      const organizeHandleEl = leadingEl.createEl("button", {
        cls: "clickable-icon virtual-tree-folder-organize-handle",
        attr: {
          "aria-label": `Reorder ${node.name} or move it to another section`,
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

      this.selectedNotePaths.clear();
      this.selectionAnchorFilePath = null;
      this.selectedSectionId = null;
      this.selectedFolderId = node.id;
      this.render("all", true);
    });

    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectedNotePaths.clear();
        this.selectionAnchorFilePath = null;
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

      const draggedFiles = this.resolveDraggedFiles(payload);
      if (draggedFiles.length > 1 || payload.isAdditive) {
        const assignmentValue = this.getAssignmentValueForNode(node);
        if (assignmentValue) {
          void this.assignFilesToCategories(draggedFiles, [assignmentValue]);
        }
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
    const sortedFiles = this.getSortedFiles(files);
    this.setCurrentContentFiles(sortedFiles);

    this.renderContentHeader(
      containerEl,
      selectedNode.name,
      `${sortedFiles.length} ${sortedFiles.length === 1 ? "note" : "notes"}`,
    );

    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list",
    });
    this.contentScrollEl = filesEl;

    if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
      filesEl.addClass("is-zebra");
    }

    if (sortedFiles.length === 0) {
      const emptyStateEl = filesEl.createDiv({ cls: "virtual-tree-empty-state" });
      emptyStateEl.createSpan({ text: "No notes match this folder yet." });
      return;
    }

    if (this.shouldVirtualizeList(sortedFiles)) {
      this.renderVirtualizedFileList(
        filesEl,
        sortedFiles,
        selectedNode.assignmentValue,
        selectedNode.name,
        initialScrollTop,
      );
      return;
    }

    for (const [index, file] of sortedFiles.entries()) {
      if (this.plugin.settings.noteDisplayMode === "cards") {
        this.renderFileCard(filesEl, file, selectedNode.assignmentValue, selectedNode.name);
      } else {
        this.renderFileRow(filesEl, file, selectedNode.assignmentValue, selectedNode.name, index);
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
    this.setCurrentContentFiles(groups.flatMap((group) => group.files));
    const uniqueFileCount = countUniqueFiles(groups);
    this.renderContentHeader(
      containerEl,
      section.title,
      `${uniqueFileCount} ${uniqueFileCount === 1 ? "note" : "notes"}`,
    );

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
          this.renderFileCard(filesEl, file, group.node.assignmentValue, group.node.name);
        } else {
          this.renderFileRow(filesEl, file, group.node.assignmentValue, group.node.name, index);
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
        files: this.getSortedFiles(tree.descendantFilesByFolderId.get(node.id) ?? []),
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
    displayPrefix: string | null,
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
        this.renderFileRow(windowEl, files[index], sourceAssignmentValue, displayPrefix, index);
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
    displayPrefix: string | null,
    rowIndex: number,
  ): void {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-file-row" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");
    rowEl.setAttribute("draggable", "true");
    rowEl.dataset.filePath = file.path;

    if (this.plugin.settings.noteDisplayMode === "list" && this.plugin.settings.zebraRows) {
      rowEl.addClass(rowIndex % 2 === 0 ? "is-zebra-odd" : "is-zebra-even");
    }

    if (this.isFileSelected(file)) {
      rowEl.addClass("is-selected");
    }

    const textEl = rowEl.createDiv({ cls: "virtual-tree-file-row-text" });
    textEl.createDiv({ cls: "virtual-tree-file-title", text: this.getDisplayedFileTitle(file, displayPrefix) });

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
    displayPrefix: string | null,
  ): void {
    const cardEl = containerEl.createEl("button", {
      cls: "virtual-tree-file-card",
      attr: {
        type: "button",
        draggable: "true",
      },
    });
    cardEl.dataset.filePath = file.path;

    if (this.isFileSelected(file)) {
      cardEl.addClass("is-selected");
    }

    cardEl.createDiv({ cls: "virtual-tree-file-title", text: this.getDisplayedFileTitle(file, displayPrefix) });

    if (this.plugin.settings.showPath) {
      cardEl.createDiv({ cls: "virtual-tree-file-path", text: file.path });
    }

    this.attachFileInteractions(cardEl, file);
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

      const selectedFilePaths = this.selectedNotePaths.has(file.path)
        ? this.currentContentFilePaths.filter((filePath) => this.selectedNotePaths.has(filePath))
        : [];
      const draggedFilePaths = selectedFilePaths.length > 1 ? selectedFilePaths : [file.path];
      const payload: DraggedFilePayload = {
        filePath: file.path,
        filePaths: draggedFilePaths,
        sourceAssignmentValue,
        isAdditive: draggedFilePaths.length > 1,
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
    rowEl.addEventListener("click", async (event) => {
      if (this.shouldIgnorePointerActivation()) {
        return;
      }

      if (this.handleSelectionClick(file, event)) {
        return;
      }

      const hadSelection = this.selectedNotePaths.size > 0;
      this.selectedNotePaths.clear();
      this.selectionAnchorFilePath = file.path;
      if (hadSelection) {
        this.updateSelectionUi();
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

  private setCurrentContentFiles(files: readonly TFile[]): void {
    const orderedPaths = uniqueFilePaths(files);
    this.currentContentFilePaths = orderedPaths;

    if (this.selectedNotePaths.size === 0) {
      if (this.selectionAnchorFilePath && !orderedPaths.includes(this.selectionAnchorFilePath)) {
        this.selectionAnchorFilePath = null;
      }
      return;
    }

    const visiblePaths = new Set(orderedPaths);
    for (const path of [...this.selectedNotePaths]) {
      if (!visiblePaths.has(path)) {
        this.selectedNotePaths.delete(path);
      }
    }

    if (this.selectionAnchorFilePath && !visiblePaths.has(this.selectionAnchorFilePath)) {
      this.selectionAnchorFilePath = null;
    }
  }

  private isFileSelected(file: TFile): boolean {
    return this.selectedNotePaths.has(file.path);
  }

  private handleSelectionClick(file: TFile, event: MouseEvent): boolean {
    if (event.shiftKey) {
      this.selectFileRange(file.path);
      this.updateSelectionUi();
      return true;
    }

    if (event.metaKey || event.ctrlKey) {
      if (this.selectedNotePaths.has(file.path)) {
        this.selectedNotePaths.delete(file.path);
        if (this.selectionAnchorFilePath === file.path) {
          this.selectionAnchorFilePath = this.currentContentFilePaths.find((path) => this.selectedNotePaths.has(path)) ?? null;
        }
      } else {
        this.selectedNotePaths.add(file.path);
        this.selectionAnchorFilePath = file.path;
      }

      this.updateSelectionUi();
      return true;
    }

    return false;
  }

  private selectFileRange(targetFilePath: string): void {
    if (!this.selectionAnchorFilePath) {
      this.selectedNotePaths.clear();
      this.selectedNotePaths.add(targetFilePath);
      this.selectionAnchorFilePath = targetFilePath;
      return;
    }

    const anchorIndex = this.currentContentFilePaths.indexOf(this.selectionAnchorFilePath);
    const targetIndex = this.currentContentFilePaths.indexOf(targetFilePath);
    if (anchorIndex < 0 || targetIndex < 0) {
      this.selectedNotePaths.clear();
      this.selectedNotePaths.add(targetFilePath);
      this.selectionAnchorFilePath = targetFilePath;
      return;
    }

    const [startIndex, endIndex] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    this.selectedNotePaths.clear();
    this.currentContentFilePaths.slice(startIndex, endIndex + 1).forEach((filePath) => {
      this.selectedNotePaths.add(filePath);
    });
  }

  private getSelectedFiles(): readonly TFile[] {
    if (this.selectedNotePaths.size === 0) {
      return [];
    }

    const filesByPath = new Map(this.getTree().allFiles.map((file) => [file.path, file] as const));
    return this.currentContentFilePaths
      .filter((filePath) => this.selectedNotePaths.has(filePath))
      .map((filePath) => filesByPath.get(filePath) ?? null)
      .filter((file): file is TFile => file instanceof TFile);
  }

  private getFilesForCategoryAction(file: TFile): readonly TFile[] {
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.some((selectedFile) => selectedFile.path === file.path)) {
      return selectedFiles;
    }

    return [file];
  }

  private openAssignCategoriesModal(files: readonly TFile[]): void {
    if (files.length === 0) {
      return;
    }

    const categoryOptions = this.collectCategoryAssignmentOptions();
    if (categoryOptions.length === 0) {
      new Notice("No categories are available yet.");
      return;
    }

    new AssignCategoriesModal(this.app, files, categoryOptions, async (assignmentValues) => {
      await this.assignFilesToCategories(files, assignmentValues);
    }).open();
  }

  private async assignFilesToCategories(files: readonly TFile[], assignmentValues: readonly string[]): Promise<void> {
    const normalizedValues = [...new Set(
      assignmentValues
        .map((value) => this.canonicalizeAssignmentValue(value))
        .filter((value) => value.length > 0),
    )];
    if (normalizedValues.length === 0) {
      return;
    }

    const previousViewKey = this.getCurrentViewKey();
    this.prepareForContentMutation(files, files.map((file) => file.path));

    const failedFiles: string[] = [];
    let updatedFileCount = 0;

    for (const file of files) {
      try {
        await this.updateFileCategories(file, (existingValues) => {
          const nextValues = [...existingValues];

          normalizedValues.forEach((value) => {
            if (!nextValues.includes(value)) {
              nextValues.push(value);
            }
          });

          return nextValues;
        });
        updatedFileCount += 1;
      } catch {
        failedFiles.push(file.path);
      }
    }

    if (updatedFileCount === 0) {
      new Notice(`Could not assign categories. ${failedFiles.length} note${failedFiles.length === 1 ? "" : "s"} failed.`);
      return;
    }

    if (failedFiles.length > 0) {
      const firstFailedPath = failedFiles[0]?.split("/").pop() ?? failedFiles[0];
      new Notice(
        `Assigned categories to ${updatedFileCount} note${updatedFileCount === 1 ? "" : "s"}. `
          + `${failedFiles.length} failed, starting with ${firstFailedPath}.`,
        10000,
      );
    }

    this.isTreeDirty = true;
    const nextViewKey = this.getCurrentViewKey();
    if (previousViewKey !== nextViewKey) {
      this.pendingContentScrollAnchor = null;
      this.pendingContentOrderOverride = null;
    }
    this.requestRefresh(true, previousViewKey !== nextViewKey);
  }

  private collectCategoryAssignmentOptions(): readonly CategoryAssignmentOption[] {
    const options = [...this.getTree().folderLookup.values()]
      .filter((node) => node.id !== ROOT_FOLDER_ID && node.id !== UNCATEGORIZED_FOLDER_ID)
      .map((node) => {
        const assignmentValue = this.getAssignmentValueForNode(node);
        if (!assignmentValue) {
          return null;
        }

        return {
          label: node.id,
          assignmentValue,
        } satisfies CategoryAssignmentOption;
      })
      .filter((option): option is CategoryAssignmentOption => option !== null)
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));

    const seenAssignmentValues = new Set<string>();
    return options.filter((option) => {
      if (seenAssignmentValues.has(option.assignmentValue)) {
        return false;
      }

      seenAssignmentValues.add(option.assignmentValue);
      return true;
    });
  }

  private getAssignmentValueForNode(node: CategoryFolderNode): string | null {
    const categoryFile = this.resolveCategoryFile(node);
    if (categoryFile) {
      return `[[${categoryFile.basename}]]`;
    }

    if (!node.assignmentValue) {
      return null;
    }

    const canonicalValue = this.canonicalizeAssignmentValue(node.assignmentValue, node.name);
    return canonicalValue.length > 0 ? canonicalValue : null;
  }

  private canonicalizeAssignmentValue(assignmentValue: string, fallbackLabel?: string): string {
    const trimmedValue = assignmentValue.trim();
    if (trimmedValue.length === 0) {
      return "";
    }

    const wikilinkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/u);
    if (!wikilinkMatch) {
      return trimmedValue;
    }

    const targetPart = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
    const destination = targetPart.length > 0 ? this.app.metadataCache.getFirstLinkpathDest(targetPart, "") : null;
    if (destination) {
      return `[[${destination.basename}]]`;
    }

    const categoryLabel = fallbackLabel ?? cleanupCategoryLabel(targetPart);
    const categoryFile = this.findCategoryFileByLabel(categoryLabel);
    return categoryFile ? `[[${categoryFile.basename}]]` : trimmedValue;
  }

  private findCategoryFileByLabel(label: string): TFile | null {
    const normalizedLabel = label.trim().toLocaleLowerCase();
    if (normalizedLabel.length === 0) {
      return null;
    }

    const prefix = this.plugin.settings.categoryNoteFilenamePrefix;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.basename.startsWith(prefix)) {
        continue;
      }

      const frontmatterTitle = this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
      const candidateLabel = typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0
        ? frontmatterTitle.trim()
        : cleanupCategoryLabel(file.basename);
      if (candidateLabel.toLocaleLowerCase() === normalizedLabel) {
        return file;
      }
    }

    return null;
  }

  private async updateFileCategories(
    file: TFile,
    updater: (existingValues: readonly string[]) => readonly string[],
  ): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existingValues = normalizeFrontmatterCategoryValues(frontmatter[this.plugin.settings.frontmatterKey]);
        frontmatter[this.plugin.settings.frontmatterKey] = [...updater(existingValues)];
      });
      return;
    } catch {
      await this.app.vault.process(file, (content) => {
        const existingValues = readRawFrontmatterCategoryValues(content, this.plugin.settings.frontmatterKey);
        const nextValues = [...updater(existingValues)];
        return writeRawFrontmatterCategoryValues(content, this.plugin.settings.frontmatterKey, nextValues);
      });
    }
  }

  private getSortedFiles(files: readonly TFile[]): readonly TFile[] {
    const sortedFiles = sortFilesForDisplay(files, this.plugin.settings, this.app);
    return this.applyPendingContentOrderOverride(sortedFiles);
  }

  private updateSelectionUi(): void {
    if (!this.contentPaneEl) {
      return;
    }

    this.contentPaneEl.querySelectorAll<HTMLElement>(".virtual-tree-file-row[data-file-path], .virtual-tree-file-card[data-file-path]")
      .forEach((element) => {
        const filePath = element.dataset.filePath;
        if (!filePath) {
          return;
        }

        element.toggleClass("is-selected", this.selectedNotePaths.has(filePath));
      });

    const controlsContainerEl = this.contentPaneEl.querySelector<HTMLElement>(".virtual-tree-content-selection-controls");
    if (controlsContainerEl) {
      this.renderSelectionControls(controlsContainerEl);
    }
  }

  private renderSelectionControls(containerEl: HTMLElement): void {
    containerEl.empty();

    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.length === 0) {
      return;
    }

    containerEl.createSpan({
      cls: "virtual-tree-content-selection-count",
      text: `${selectedFiles.length} selected`,
    });

    const assignCategoriesButtonEl = containerEl.createEl("button", {
      cls: "mod-cta virtual-tree-content-selection-action",
      text: "Assign categories",
      attr: {
        type: "button",
      },
    });
    assignCategoriesButtonEl.addEventListener("click", () => {
      this.openAssignCategoriesModal(selectedFiles);
    });

    const clearSelectionButtonEl = containerEl.createEl("button", {
      cls: "virtual-tree-content-selection-action",
      text: "Clear",
      attr: {
        type: "button",
      },
    });
    clearSelectionButtonEl.addEventListener("click", () => {
      this.selectedNotePaths.clear();
      this.selectionAnchorFilePath = null;
      this.updateSelectionUi();
    });
  }

  private renderContentHeader(containerEl: HTMLElement, title: string, noteCountLabel: string): void {
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: title });

    const headerMetaEl = headerEl.createDiv({ cls: "virtual-tree-content-header-meta" });
    headerMetaEl.createSpan({
      cls: "virtual-tree-content-count",
      text: noteCountLabel,
    });

    const selectionControlsEl = headerMetaEl.createDiv({ cls: "virtual-tree-content-selection-controls" });
    this.renderSelectionControls(selectionControlsEl);

    const sortControlsEl = headerMetaEl.createDiv({ cls: "virtual-tree-content-sort-controls" });
    const sortModeSelectEl = sortControlsEl.createEl("select", {
      cls: "dropdown virtual-tree-content-sort-select",
      attr: {
        "aria-label": "Sort notes by",
      },
    });
    addSelectOption(sortModeSelectEl, "modified", "Modified");
    addSelectOption(sortModeSelectEl, "created", "Created");
    addSelectOption(sortModeSelectEl, "title", "Title");
    addSelectOption(sortModeSelectEl, "property", "Property");
    sortModeSelectEl.value = this.plugin.settings.noteSortMode;
    sortModeSelectEl.addEventListener("change", () => {
      const nextMode = parseNoteSortMode(sortModeSelectEl.value);
      void this.plugin.savePluginSettings({
        ...this.plugin.settings,
        noteSortMode: nextMode,
      });
    });

    const sortDirectionButtonEl = sortControlsEl.createEl("button", {
      cls: "mod-muted virtual-tree-content-sort-direction",
      attr: {
        "aria-label": this.plugin.settings.noteSortDirection === "asc"
          ? "Sort ascending"
          : "Sort descending",
        type: "button",
      },
      text: this.plugin.settings.noteSortDirection === "asc" ? "Asc" : "Desc",
    });
    sortDirectionButtonEl.addEventListener("click", () => {
      void this.plugin.savePluginSettings({
        ...this.plugin.settings,
        noteSortDirection: this.plugin.settings.noteSortDirection === "asc" ? "desc" : "asc",
      });
    });

    if (this.plugin.settings.noteSortMode === "property") {
      const sortPropertyInputEl = sortControlsEl.createEl("input", {
        cls: "virtual-tree-content-sort-property",
        attr: {
          "aria-label": "Frontmatter property to sort by",
          placeholder: "property",
          type: "text",
        },
        value: this.plugin.settings.noteSortProperty,
      });
      sortPropertyInputEl.addEventListener("blur", () => {
        void this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteSortProperty: sortPropertyInputEl.value.trim(),
        });
      });
      sortPropertyInputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        sortPropertyInputEl.blur();
      });
    }

    const filenameToggleLabelEl = headerMetaEl.createEl("label", {
      cls: "virtual-tree-content-filename-toggle",
    });
    const filenameToggleInputEl = filenameToggleLabelEl.createEl("input", {
      attr: {
        "aria-label": "Show real filename",
        type: "checkbox",
      },
    });
    filenameToggleInputEl.checked = this.plugin.settings.showRealFilename;
    filenameToggleInputEl.addEventListener("change", () => {
      void this.plugin.savePluginSettings({
        ...this.plugin.settings,
        showRealFilename: filenameToggleInputEl.checked,
      });
    });

    filenameToggleLabelEl.createSpan({ text: "Show real filename" });
  }

  private getDisplayedFileTitle(file: TFile, displayPrefix: string | null): string {
    if (this.plugin.settings.showRealFilename) {
      return file.basename;
    }

    const normalizedPrefix = displayPrefix?.trim() ?? "";
    if (normalizedPrefix.length === 0) {
      return file.basename;
    }

    return stripCaseInsensitivePrefix(file.basename, `${normalizedPrefix} - `);
  }

  private openFileMenu(event: MouseEvent, file: TFile): void {
    const categoryActionFiles = this.getFilesForCategoryAction(file);
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
    menu.addItem((item) => {
      item
        .setTitle(categoryActionFiles.length > 1 ? "Assign categories to selected notes" : "Assign categories")
        .setIcon("tags")
        .onClick(() => {
          this.openAssignCategoriesModal(categoryActionFiles);
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

  private openSectionMenu(event: MouseEvent, section: SidebarFolderSection): void {
    if (section.isUngrouped) {
      return;
    }

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Rename section").setIcon("pencil").onClick(() => {
        new EditSectionTitleModal(this.app, section.title, async (nextTitle) => {
          await this.updateSectionTitleFromInput(section.id, nextTitle);
        }).open();
      });
    });
    menu.showAtMouseEvent(event);
  }

  private async toggleOrganizeFolderSections(): Promise<void> {
    if (this.isOrganizingFolderSections) {
      this.isOrganizingFolderSections = false;
      this.clearActiveSectionOrganizeTarget();
      this.clearActiveFolderOrganizeTarget();
      this.render("sidebar");
      return;
    }

    const namedSections = this.getSidebarFolderSections(this.getTree()).filter((section) => !section.isUngrouped);
    if (namedSections.length === 0) {
      await this.plugin.savePluginSettings({
        ...this.plugin.settings,
        sectionOrder: [...this.plugin.settings.sectionOrder, createSectionTitle(this.plugin.settings.sectionOrder)],
      });
    }

    this.isOrganizingFolderSections = true;
    this.render("sidebar");
  }

  private async addFolderSection(): Promise<void> {
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: [...this.plugin.settings.sectionOrder, createSectionTitle(this.plugin.settings.sectionOrder)],
    });
    this.render("sidebar");
  }

  private async deleteFolderSection(sectionId: string): Promise<void> {
    const tree = this.getTree();
    const section = this.getSidebarFolderSections(tree).find((entry) => entry.id === sectionId && !entry.isUngrouped);
    if (!section) {
      return;
    }

    for (const node of section.folderNodes) {
      await this.updateNodeSection(node, null);
    }

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: this.plugin.settings.sectionOrder.filter((title) => !isSameSectionLabel(title, section.title)),
    });
    this.isTreeDirty = true;

    if (this.selectedSectionId === section.id) {
      this.selectedSectionId = null;
    }

    if (this.getSidebarFolderSections(this.getTree()).filter((entry) => !entry.isUngrouped).length === 0) {
      this.isOrganizingFolderSections = false;
    }

    this.render("sidebar");
  }

  private async updateSectionTitleFromInput(sectionId: string, nextTitle: string): Promise<void> {
    const tree = this.getTree();
    const section = this.getSidebarFolderSections(tree).find((entry) => entry.id === sectionId && !entry.isUngrouped);
    if (!section) {
      return;
    }

    const trimmedTitle = normalizeSectionTitle(nextTitle);
    if (!trimmedTitle) {
      new Notice("Section names cannot be empty.");
      this.render("sidebar");
      return;
    }

    const hasDuplicate = this.getSidebarFolderSections(tree).some((entry) => {
      return !entry.isUngrouped && entry.id !== section.id && isSameSectionLabel(entry.title, trimmedTitle);
    });

    if (hasDuplicate) {
      new Notice("Section names must be unique.");
      this.render("sidebar");
      return;
    }

    if (isSameSectionLabel(section.title, trimmedTitle)) {
      if (section.title !== trimmedTitle) {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          sectionOrder: renameSectionInOrder(this.plugin.settings.sectionOrder, section.title, trimmedTitle),
        });
      }
      this.selectedSectionId = trimmedTitle;
      this.render("sidebar");
      return;
    }

    for (const node of section.folderNodes) {
      await this.updateNodeSection(node, trimmedTitle);
    }

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: renameSectionInOrder(this.plugin.settings.sectionOrder, section.title, trimmedTitle),
    });
    this.isTreeDirty = true;
    this.selectedSectionId = trimmedTitle;
    this.render("sidebar");
  }

  private async moveFolderToSection(folderId: string, targetSectionId: string | null): Promise<void> {
    const tree = this.getTree();
    const node = tree.folderLookup.get(folderId);
    if (!node) {
      return;
    }

    const targetSection = targetSectionId === null
      ? null
      : this.getSidebarFolderSections(tree).find((section) => section.id === targetSectionId && !section.isUngrouped) ?? null;

    await this.updateNodeSection(node, targetSection?.title ?? null);

    const targetFolderIds = targetSection
      ? targetSection.folderNodes.map((folderNode) => folderNode.id)
      : this.getSidebarFolderSections(tree).find((section) => section.isUngrouped)?.folderNodes.map((folderNode) => folderNode.id) ?? [];
    const nextFolderOrder = appendFolderToOrderedGroup(this.getOrderedTopLevelFolderIds(tree), folderId, targetFolderIds);

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: targetSection ? ensureSectionInOrder(this.plugin.settings.sectionOrder, targetSection.title) : this.plugin.settings.sectionOrder,
      folderOrder: nextFolderOrder,
    });
    this.isTreeDirty = true;
    this.preserveSidebarScrollForNextRender();
    this.render("all");
  }

  private async reorderFolderWithinSections(draggedFolderId: string, targetFolderId: string): Promise<void> {
    if (draggedFolderId === targetFolderId) {
      return;
    }

    const tree = this.getTree();
    const draggedNode = tree.folderLookup.get(draggedFolderId);
    const targetNode = tree.folderLookup.get(targetFolderId);
    if (!draggedNode || !targetNode || draggedNode.depth !== 1 || targetNode.depth !== 1) {
      return;
    }

    await this.updateNodeSection(draggedNode, normalizeOptionalSectionTitle(targetNode.section));

    const nextFolderOrder = moveFolderBeforeTarget(this.getOrderedTopLevelFolderIds(tree), draggedFolderId, targetFolderId);
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: targetNode.section
        ? ensureSectionInOrder(this.plugin.settings.sectionOrder, targetNode.section)
        : this.plugin.settings.sectionOrder,
      folderOrder: nextFolderOrder,
    });
    this.isTreeDirty = true;
    this.preserveSidebarScrollForNextRender();
    this.render("all");
  }

  private async reorderFolderSections(draggedSectionId: string, targetSectionId: string): Promise<void> {
    if (draggedSectionId === targetSectionId) {
      return;
    }

    const ordered = this.getSidebarFolderSections(this.getTree())
      .filter((section) => !section.isUngrouped)
      .map((section) => section.title);
    const fromIndex = ordered.findIndex((title) => isSameSectionLabel(title, draggedSectionId));
    const toIndex = ordered.findIndex((title) => isSameSectionLabel(title, targetSectionId));

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const [removed] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, removed);

    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: ordered,
    });
    this.preserveSidebarScrollForNextRender();
    this.render("sidebar");
  }

  private getSidebarFolderSections(tree: CategoryTree): readonly SidebarFolderSection[] {
    return buildSidebarFolderSections(tree.root.sortedChildren, this.plugin.settings.sectionOrder, this.plugin.settings.folderOrder);
  }

  private getOrderedTopLevelFolderIds(tree: CategoryTree): readonly string[] {
    return orderTopLevelNodes(tree.root.sortedChildren, this.plugin.settings.folderOrder)
      .filter((node) => node.id !== UNCATEGORIZED_FOLDER_ID)
      .map((node) => node.id);
  }

  private preserveSidebarScrollForNextRender(): void {
    this.pendingSidebarScrollTop = this.sidebarPaneEl?.scrollTop ?? null;
  }

  private getCurrentViewKey(): string {
    return this.selectedSectionId ? `section:${this.selectedSectionId}` : `folder:${this.selectedFolderId}`;
  }

  private getAbstractFilePath(file: TAbstractFile): string {
    return file.path;
  }

  private suppressAutoRefreshForPaths(filePaths: readonly string[]): void {
    const normalizedPaths = [...new Set(filePaths.filter((filePath) => filePath.length > 0))];
    if (normalizedPaths.length === 0) {
      return;
    }

    this.autoRefreshSuppression = {
      expiresAt: window.performance.now() + AUTO_REFRESH_SUPPRESSION_MS,
      filePaths: new Set(normalizedPaths),
    };
  }

  private shouldIgnoreAutoRefresh(filePath: string): boolean {
    const suppression = this.autoRefreshSuppression;
    if (!suppression) {
      return false;
    }

    if (window.performance.now() > suppression.expiresAt) {
      this.autoRefreshSuppression = null;
      return false;
    }

    return suppression.filePaths.has(filePath);
  }

  private shouldStabilizeCurrentContentOrder(): boolean {
    return this.selectedSectionId === null && this.plugin.settings.noteSortMode === "modified";
  }

  private capturePendingContentOrderOverride(): void {
    if (!this.shouldStabilizeCurrentContentOrder()) {
      this.pendingContentOrderOverride = null;
      return;
    }

    this.pendingContentOrderOverride = {
      viewKey: this.getCurrentViewKey(),
      orderedFilePaths: [...this.currentContentFilePaths],
      expiresAt: window.performance.now() + CONTENT_ORDER_OVERRIDE_MS,
    };
  }

  private applyPendingContentOrderOverride(files: readonly TFile[]): readonly TFile[] {
    const override = this.pendingContentOrderOverride;
    if (!override) {
      return files;
    }

    if (!this.shouldStabilizeCurrentContentOrder()
      || override.viewKey !== this.getCurrentViewKey()
      || window.performance.now() > override.expiresAt) {
      this.pendingContentOrderOverride = null;
      return files;
    }

    return reorderFilesByPaths(files, override.orderedFilePaths);
  }

  private prepareForContentMutation(files: readonly TFile[], excludedFilePaths: readonly string[]): void {
    this.preserveContentScrollAnchorForNextRender(excludedFilePaths);
    this.suppressAutoRefreshForPaths(files.map((file) => file.path));
    this.capturePendingContentOrderOverride();
  }

  private preserveContentScrollAnchorForNextRender(excludedFilePaths: readonly string[] = []): void {
    if (!this.contentPaneEl || !this.contentScrollEl) {
      this.pendingContentScrollAnchor = null;
      return;
    }

    const excludedPaths = new Set(excludedFilePaths);
    const fixedRowAnchor = this.createFixedRowContentScrollAnchor(excludedPaths);
    if (fixedRowAnchor) {
      this.pendingContentScrollAnchor = fixedRowAnchor;
      return;
    }

    const containerRect = this.contentScrollEl.getBoundingClientRect();
    const candidateElements = this.contentPaneEl.querySelectorAll<HTMLElement>(
      ".virtual-tree-file-row[data-file-path], .virtual-tree-file-card[data-file-path]",
    );

    let anchorFilePath: string | null = null;
    let anchorOffsetTop = 0;
    for (const element of Array.from(candidateElements)) {
      const filePath = element.dataset.filePath;
      if (!filePath || excludedPaths.has(filePath)) {
        continue;
      }

      const elementRect = element.getBoundingClientRect();
      if (elementRect.bottom <= containerRect.top || elementRect.top >= containerRect.bottom) {
        continue;
      }

      anchorFilePath = filePath;
      anchorOffsetTop = elementRect.top - containerRect.top;
      break;
    }

    this.pendingContentScrollAnchor = {
      filePath: anchorFilePath,
      offsetTop: anchorOffsetTop,
      fallbackScrollTop: this.contentScrollEl.scrollTop,
      estimatedRowHeight: null,
    };
  }

  private createFixedRowContentScrollAnchor(excludedPaths: ReadonlySet<string>): ContentScrollAnchor | null {
    if (this.selectedSectionId !== null || this.plugin.settings.noteDisplayMode !== "list") {
      return null;
    }

    const rowHeight = this.plugin.settings.showPath ? LIST_ROW_HEIGHT_WITH_PATH : LIST_ROW_HEIGHT;
    const scrollTop = this.contentScrollEl?.scrollTop ?? 0;
    const currentFilePaths = this.currentContentFilePaths;
    if (currentFilePaths.length === 0) {
      return {
        filePath: null,
        offsetTop: 0,
        fallbackScrollTop: scrollTop,
        estimatedRowHeight: rowHeight,
      };
    }

    const firstVisibleIndex = clampIndex(
      Math.floor(scrollTop / rowHeight),
      currentFilePaths.length,
    );
    const anchorIndex = this.findNextAnchorIndex(currentFilePaths, excludedPaths, firstVisibleIndex);
    if (anchorIndex < 0) {
      return {
        filePath: null,
        offsetTop: 0,
        fallbackScrollTop: scrollTop,
        estimatedRowHeight: rowHeight,
      };
    }

    return {
      filePath: currentFilePaths[anchorIndex] ?? null,
      offsetTop: anchorIndex * rowHeight - scrollTop,
      fallbackScrollTop: scrollTop,
      estimatedRowHeight: rowHeight,
    };
  }

  private findNextAnchorIndex(
    filePaths: readonly string[],
    excludedPaths: ReadonlySet<string>,
    startIndex: number,
  ): number {
    for (let index = startIndex; index < filePaths.length; index += 1) {
      if (!excludedPaths.has(filePaths[index] ?? "")) {
        return index;
      }
    }

    for (let index = startIndex - 1; index >= 0; index -= 1) {
      if (!excludedPaths.has(filePaths[index] ?? "")) {
        return index;
      }
    }

    return -1;
  }

  private restorePendingContentScrollAnchor(): void {
    const anchor = this.pendingContentScrollAnchor;
    this.pendingContentScrollAnchor = null;
    if (!anchor || !this.contentPaneEl || !this.contentScrollEl) {
      return;
    }

    const applyAnchor = (): void => {
      if (!this.contentPaneEl || !this.contentScrollEl) {
        return;
      }

      if (!anchor.filePath) {
        this.contentScrollEl.scrollTop = anchor.fallbackScrollTop;
        return;
      }

      const selector = `[data-file-path="${escapeAttributeValue(anchor.filePath)}"]`;
      const anchorEl = this.contentPaneEl.querySelector<HTMLElement>(selector);
      if (!anchorEl) {
        if (anchor.estimatedRowHeight !== null) {
          const anchorIndex = this.currentContentFilePaths.indexOf(anchor.filePath);
          if (anchorIndex >= 0) {
            this.contentScrollEl.scrollTop = anchorIndex * anchor.estimatedRowHeight - anchor.offsetTop;
            return;
          }
        }

        this.contentScrollEl.scrollTop = anchor.fallbackScrollTop;
        return;
      }

      const containerRect = this.contentScrollEl.getBoundingClientRect();
      const anchorRect = anchorEl.getBoundingClientRect();
      this.contentScrollEl.scrollTop += anchorRect.top - containerRect.top - anchor.offsetTop;
    };

    applyAnchor();
    window.requestAnimationFrame(applyAnchor);
  }

  private async updateNodeSection(node: CategoryFolderNode, nextSectionTitle: string | null): Promise<void> {
    const categoryFile = this.resolveCategoryFile(node);
    if (!categoryFile) {
      new Notice(`Unable to update the section for ${node.name} because it is not backed by a category note.`);
      return;
    }

    this.suppressAutoRefreshForPaths([categoryFile.path]);
    await this.app.fileManager.processFrontMatter(categoryFile, (frontmatter) => {
      if (nextSectionTitle) {
        frontmatter[this.plugin.settings.categorySectionKey] = nextSectionTitle;
        return;
      }

      delete frontmatter[this.plugin.settings.categorySectionKey];
    });
  }

  private attachSectionDropTarget(
    sectionEl: HTMLElement,
    section: SidebarFolderSection,
    allowSectionReorder: boolean,
  ): void {
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
        this.clearActiveFolderOrganizeTarget();
        this.setActiveSectionOrganizeTarget(sectionEl);
        return;
      }

      if (allowSectionReorder && isSectionDrag && !section.isUngrouped) {
        event.preventDefault();
        dataTransfer.dropEffect = "move";
        this.setActiveSectionOrganizeTarget(sectionEl);
      }
    };

    const onDrop = (event: DragEvent): void => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      const eventTarget = event.target;
      const hoveredFolderItem = eventTarget instanceof HTMLElement
        ? eventTarget.closest(".virtual-tree-folder-item[data-folder-id]")
        : null;
      if (hoveredFolderItem instanceof HTMLElement) {
        this.clearActiveSectionOrganizeTarget();
        return;
      }

      const folderId = dataTransfer.getData(DRAGGED_FOLDER_ID_MIME);
      if (folderId.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.clearActiveFolderOrganizeTarget();
        this.clearActiveSectionOrganizeTarget();
        const targetId = section.isUngrouped ? null : section.id;
        void this.moveFolderToSection(folderId, targetId);
        return;
      }

      const draggedSectionId = dataTransfer.getData(DRAGGED_SECTION_ID_MIME);
      if (allowSectionReorder && draggedSectionId.length > 0 && !section.isUngrouped) {
        event.preventDefault();
        event.stopPropagation();
        this.clearActiveSectionOrganizeTarget();
        void this.reorderFolderSections(draggedSectionId, section.id);
        return;
      }

      this.clearActiveSectionOrganizeTarget();
    };

    sectionEl.addEventListener("dragover", onDragOver, true);
    sectionEl.addEventListener("drop", onDrop, true);
  }

  private attachFolderSectionDrag(element: HTMLElement, folderId: string): void {
    element.addEventListener("dragstart", (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      dataTransfer.effectAllowed = "move";
      dataTransfer.setData(DRAGGED_FOLDER_ID_MIME, folderId);
      this.contentEl.addClass("is-organizing-folder-drag");
      element.addClass("is-dragging");
      event.stopPropagation();
    });

    element.addEventListener("dragend", () => {
      element.removeClass("is-dragging");
      this.contentEl.removeClass("is-organizing-folder-drag");
      this.clearActiveSectionOrganizeTarget();
      this.suppressClickUntil = window.performance.now() + 150;
    });
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
      this.clearActiveFolderOrganizeTarget();
    });
  }

  private attachFolderOrganizeDropTarget(rowEl: HTMLElement, targetFolderId: string): void {
    rowEl.dataset.folderId = targetFolderId;

    rowEl.addEventListener("dragover", (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !dataTransfer.types.includes(DRAGGED_FOLDER_ID_MIME)) {
        return;
      }

      const draggedFolderId = dataTransfer.getData(DRAGGED_FOLDER_ID_MIME);
      if (draggedFolderId.length === 0 || draggedFolderId === targetFolderId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dataTransfer.dropEffect = "move";
      this.clearActiveSectionOrganizeTarget();
      this.setActiveFolderOrganizeTarget(rowEl);
    });

    rowEl.addEventListener("drop", (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }

      const draggedFolderId = dataTransfer.getData(DRAGGED_FOLDER_ID_MIME);
      if (draggedFolderId.length === 0 || draggedFolderId === targetFolderId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.clearActiveFolderOrganizeTarget();
      this.clearActiveSectionOrganizeTarget();
      void this.reorderFolderWithinSections(draggedFolderId, targetFolderId);
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

  private setActiveFolderOrganizeTarget(nextTarget: HTMLElement): void {
    if (this.activeFolderOrganizeTargetEl === nextTarget) {
      return;
    }

    this.clearActiveFolderOrganizeTarget();
    this.activeFolderOrganizeTargetEl = nextTarget;
    nextTarget.addClass("is-folder-organize-target");
  }

  private clearActiveFolderOrganizeTarget(): void {
    if (!this.activeFolderOrganizeTargetEl) {
      return;
    }

    this.activeFolderOrganizeTargetEl.removeClass("is-folder-organize-target");
    this.activeFolderOrganizeTargetEl = null;
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
    const targetAssignmentValue = this.getAssignmentValueForNode(node);
    if (!targetAssignmentValue) {
      return;
    }

    const previousViewKey = this.getCurrentViewKey();
    this.prepareForContentMutation([file], [file.path]);

    await this.updateFileCategories(file, (existingValues) => {
      const filteredValues = sourceAssignmentValue && sourceAssignmentValue !== targetAssignmentValue
        ? existingValues.filter((value) => value !== sourceAssignmentValue)
        : [...existingValues];
      return filteredValues.includes(targetAssignmentValue)
        ? filteredValues
        : [...filteredValues, targetAssignmentValue];
    });

    const shouldStayOnUncategorized = this.selectedSectionId === null
      && this.selectedFolderId === UNCATEGORIZED_FOLDER_ID;

    if (!shouldStayOnUncategorized) {
      this.selectedFolderId = node.id;
    }

    const nextViewKey = this.getCurrentViewKey();

    this.isTreeDirty = true;
    this.preserveSidebarScrollForNextRender();
    if (previousViewKey !== nextViewKey) {
      this.pendingContentScrollAnchor = null;
      this.pendingContentOrderOverride = null;
    }
    this.requestRefresh(true, previousViewKey !== nextViewKey);
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

    this.suppressAutoRefreshForPaths([file.path]);
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

  private resolveDraggedFiles(payload: DraggedFilePayload): readonly TFile[] {
    const filesByPath = new Map(this.getTree().allFiles.map((file) => [file.path, file] as const));
    return uniqueFilePathsFromPayload(payload)
      .map((filePath) => filesByPath.get(filePath) ?? null)
      .filter((file): file is TFile => file instanceof TFile);
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

  private canDragFolderBetweenSections(node: CategoryFolderNode): boolean {
    if (node.depth !== 1) {
      return false;
    }

    if (!this.resolveCategoryFile(node)) {
      return false;
    }

    return this.getSidebarFolderSections(this.getTree()).some((section) => !section.isUngrouped);
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

class EditSectionTitleModal extends Modal {
  private readonly initialValue: string;
  private readonly onSubmit: (nextTitle: string) => Promise<void>;
  private isSubmitting = false;

  public constructor(app: App, initialValue: string, onSubmit: (nextTitle: string) => Promise<void>) {
    super(app);
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("virtual-tree-edit-title-modal");
    contentEl.createEl("h2", { text: "Rename section" });

    contentEl.createEl("p", {
      cls: "virtual-tree-edit-title-hint",
      text: "Update the section label for every category grouped under it.",
    });

    const formEl = contentEl.createDiv({ cls: "virtual-tree-edit-title-form" });
    const inputEl = formEl.createEl("input", {
      cls: "virtual-tree-edit-title-input",
      attr: {
        placeholder: "Section name",
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

    window.setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
  }

  public override onClose(): void {
    this.contentEl.empty();
  }
}

class AssignCategoriesModal extends Modal {
  private readonly files: readonly TFile[];
  private readonly categoryOptions: readonly CategoryAssignmentOption[];
  private readonly onSubmit: (assignmentValues: readonly string[]) => Promise<void>;
  private readonly selectedAssignmentValues = new Set<string>();
  private filterValue = "";
  private activeIndex = 0;
  private isSubmitting = false;

  public constructor(
    app: App,
    files: readonly TFile[],
    categoryOptions: readonly CategoryAssignmentOption[],
    onSubmit: (assignmentValues: readonly string[]) => Promise<void>,
  ) {
    super(app);
    this.files = files;
    this.categoryOptions = categoryOptions;
    this.onSubmit = onSubmit;
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("virtual-tree-assign-categories-modal-shell");
    contentEl.addClass("virtual-tree-assign-categories-modal");

    const headerEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-header" });
    headerEl.createEl("h2", {
      text: this.files.length === 1 ? "Assign category" : `Assign categories to ${this.files.length} notes`,
    });
    headerEl.createSpan({
      cls: "virtual-tree-category-palette-count",
      text: `${this.categoryOptions.length} categories`,
    });

    const filterInputEl = contentEl.createEl("input", {
      cls: "virtual-tree-category-palette-input",
      attr: {
        placeholder: "Type to filter categories...",
        type: "text",
      },
    });
    const selectedEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-selected" });
    const optionsEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-results" });
    const footerEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-footer" });
    footerEl.createSpan({
      cls: "virtual-tree-category-palette-hint",
      text: "Up/Down move, Enter toggle, Cmd/Ctrl+Enter assign",
    });
    const saveButtonEl = footerEl.createEl("button", {
      cls: "mod-cta virtual-tree-category-palette-submit",
      text: "Assign selected",
      attr: { type: "button" },
    });

    const getVisibleOptions = (): readonly CategoryAssignmentOption[] => {
      const normalizedFilter = this.filterValue.trim().toLocaleLowerCase();
      return this.categoryOptions.filter((option) => {
        return normalizedFilter.length === 0 || option.label.toLocaleLowerCase().includes(normalizedFilter);
      });
    };

    const renderSelected = (): void => {
      selectedEl.empty();

      const selectedOptions = this.categoryOptions.filter((option) => this.selectedAssignmentValues.has(option.assignmentValue));
      if (selectedOptions.length === 0) {
        selectedEl.addClass("is-empty");
        selectedEl.createSpan({
          cls: "virtual-tree-category-palette-empty",
          text: "No categories selected",
        });
      } else {
        selectedEl.removeClass("is-empty");
        selectedOptions.forEach((option) => {
          const chipEl = selectedEl.createEl("button", {
            cls: "virtual-tree-category-palette-chip",
            text: option.label,
            attr: {
              type: "button",
            },
          });
          chipEl.addEventListener("click", () => {
            this.selectedAssignmentValues.delete(option.assignmentValue);
            renderSelected();
            renderOptions();
            filterInputEl.focus();
          });
        });
      }

      saveButtonEl.disabled = this.isSubmitting || this.selectedAssignmentValues.size === 0;
    };

    const renderOptions = (): void => {
      optionsEl.empty();
      const visibleOptions = getVisibleOptions();
      this.activeIndex = clampIndex(this.activeIndex, visibleOptions.length);

      if (visibleOptions.length === 0) {
        optionsEl.createDiv({
          cls: "virtual-tree-category-palette-empty-state",
          text: "No categories match this filter.",
        });
        return;
      }

      visibleOptions.forEach((option, index) => {
        const optionEl = optionsEl.createEl("button", {
          cls: "virtual-tree-category-palette-option",
          attr: {
            type: "button",
          },
        });
        if (index === this.activeIndex) {
          optionEl.addClass("is-active");
        }
        if (this.selectedAssignmentValues.has(option.assignmentValue)) {
          optionEl.addClass("is-selected");
        }

        const optionMainEl = optionEl.createDiv({ cls: "virtual-tree-category-palette-option-main" });
        optionMainEl.createDiv({ cls: "virtual-tree-category-palette-option-title", text: option.label });

        const optionMetaEl = optionEl.createDiv({ cls: "virtual-tree-category-palette-option-meta" });
        optionMetaEl.createSpan({
          cls: "virtual-tree-category-palette-option-action",
          text: this.selectedAssignmentValues.has(option.assignmentValue) ? "Selected" : "Add",
        });

        optionEl.addEventListener("click", () => {
          toggleOption(option.assignmentValue);
          this.activeIndex = index;
          renderSelected();
          renderOptions();
          filterInputEl.focus();
        });
      });

      const activeOptionEl = optionsEl.querySelector<HTMLElement>(".virtual-tree-category-palette-option.is-active");
      activeOptionEl?.scrollIntoView({ block: "nearest" });
    };

    const toggleOption = (assignmentValue: string): void => {
      if (this.selectedAssignmentValues.has(assignmentValue)) {
        this.selectedAssignmentValues.delete(assignmentValue);
      } else {
        this.selectedAssignmentValues.add(assignmentValue);
      }
    };

    const submit = async (): Promise<void> => {
      if (this.isSubmitting || this.selectedAssignmentValues.size === 0) {
        return;
      }

      this.isSubmitting = true;
      saveButtonEl.disabled = true;

      try {
        await this.onSubmit([...this.selectedAssignmentValues]);
        this.close();
      } finally {
        this.isSubmitting = false;
        saveButtonEl.disabled = false;
      }
    };

    filterInputEl.addEventListener("input", () => {
      this.filterValue = filterInputEl.value;
      this.activeIndex = 0;
      renderSelected();
      renderOptions();
    });
    filterInputEl.addEventListener("keydown", (event) => {
      const visibleOptions = getVisibleOptions();

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.activeIndex = clampIndex(this.activeIndex + 1, visibleOptions.length);
        renderOptions();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.activeIndex = clampIndex(this.activeIndex - 1, visibleOptions.length);
        renderOptions();
        return;
      }

      if (event.key === "Backspace" && filterInputEl.value.length === 0 && this.selectedAssignmentValues.size > 0) {
        const lastSelectedValue = [...this.selectedAssignmentValues].at(-1);
        if (lastSelectedValue) {
          this.selectedAssignmentValues.delete(lastSelectedValue);
          renderSelected();
          renderOptions();
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();

        if ((event.metaKey || event.ctrlKey) && this.selectedAssignmentValues.size > 0) {
          void submit();
          return;
        }

        const activeOption = visibleOptions[this.activeIndex];
        if (!activeOption) {
          return;
        }

        toggleOption(activeOption.assignmentValue);
        renderSelected();
        renderOptions();
      }
    });
    saveButtonEl.addEventListener("click", () => {
      void submit();
    });

    renderSelected();
    renderOptions();
    window.setTimeout(() => {
      filterInputEl.focus();
    }, 0);
  }

  public override onClose(): void {
    this.modalEl.removeClass("virtual-tree-assign-categories-modal-shell");
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

function readRawFrontmatterCategoryValues(content: string, key: string): readonly string[] {
  const frontmatterRange = findFrontmatterRange(content);
  if (!frontmatterRange) {
    return [];
  }

  const frontmatterLines = content.slice(frontmatterRange.start, frontmatterRange.end).split("\n");
  const fieldRange = findFrontmatterFieldRange(frontmatterLines, key);
  if (!fieldRange) {
    return [];
  }

  const firstLine = frontmatterLines[fieldRange.startIndex] ?? "";
  const inlineValue = firstLine.slice(firstLine.indexOf(":") + 1).trim();
  if (inlineValue.length > 0) {
    const parsedValue = parseYamlScalar(inlineValue);
    return parsedValue ? [parsedValue] : [];
  }

  const values: string[] = [];
  for (let index = fieldRange.startIndex + 1; index < fieldRange.endIndex; index += 1) {
    const trimmedLine = (frontmatterLines[index] ?? "").trim();
    if (!trimmedLine.startsWith("- ")) {
      continue;
    }

    const parsedValue = parseYamlScalar(trimmedLine.slice(2).trim());
    if (parsedValue) {
      values.push(parsedValue);
    }
  }

  return values;
}

function writeRawFrontmatterCategoryValues(content: string, key: string, values: readonly string[]): string {
  const fieldLines = serializeFrontmatterArrayField(key, values);
  const frontmatterRange = findFrontmatterRange(content);

  if (!frontmatterRange) {
    const normalizedContent = content.length > 0 && !content.startsWith("\n") ? `\n${content}` : content;
    return `---\n${fieldLines.join("\n")}\n---${normalizedContent}`;
  }

  const beforeFrontmatter = content.slice(0, frontmatterRange.start);
  const frontmatterLines = content.slice(frontmatterRange.start, frontmatterRange.end).split("\n");
  const afterFrontmatter = content.slice(frontmatterRange.end);
  const fieldRange = findFrontmatterFieldRange(frontmatterLines, key);

  const nextFrontmatterLines = fieldRange
    ? [
      ...frontmatterLines.slice(0, fieldRange.startIndex),
      ...fieldLines,
      ...frontmatterLines.slice(fieldRange.endIndex),
    ]
    : [...frontmatterLines, ...fieldLines];

  return `${beforeFrontmatter}---\n${nextFrontmatterLines.join("\n")}\n---${afterFrontmatter}`;
}

function findFrontmatterRange(content: string): { start: number; end: number } | null {
  if (!content.startsWith("---\n")) {
    return null;
  }

  const closingDelimiterIndex = content.indexOf("\n---", 4);
  if (closingDelimiterIndex < 0) {
    return null;
  }

  return {
    start: 4,
    end: closingDelimiterIndex,
  };
}

function findFrontmatterFieldRange(
  frontmatterLines: readonly string[],
  key: string,
): { startIndex: number; endIndex: number } | null {
  const fieldPattern = new RegExp(`^${escapeRegExp(key)}\s*:`);
  const startIndex = frontmatterLines.findIndex((line) => fieldPattern.test(line));
  if (startIndex < 0) {
    return null;
  }

  let endIndex = startIndex + 1;
  while (endIndex < frontmatterLines.length && /^(\s+|-\s)/.test(frontmatterLines[endIndex] ?? "")) {
    endIndex += 1;
  }

  return { startIndex, endIndex };
}

function serializeFrontmatterArrayField(key: string, values: readonly string[]): readonly string[] {
  if (values.length === 0) {
    return [`${key}: []`];
  }

  return [
    `${key}:`,
    ...values.map((value) => `  - ${JSON.stringify(value)}`),
  ];
}

function parseYamlScalar(value: string): string | null {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    try {
      const parsedValue = JSON.parse(trimmedValue) as unknown;
      return typeof parsedValue === "string" ? parsedValue : trimmedValue;
    } catch {
      return trimmedValue.slice(1, -1);
    }
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1).replace(/''/gu, "'");
  }

  return trimmedValue;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function buildSidebarFolderSections(
  topLevelNodes: readonly CategoryFolderNode[],
  sectionOrder: readonly string[],
  folderOrder: readonly string[],
): readonly SidebarFolderSection[] {
  const orderedTopLevelNodes = orderTopLevelNodes(topLevelNodes, folderOrder);
  const sectionsByKey = new Map<string, {
    id: string;
    title: string;
    folderNodes: CategoryFolderNode[];
    isUngrouped: boolean;
  }>();
  const orderedKeys: string[] = [];

  for (const title of sectionOrder) {
    const normalizedTitle = normalizeSectionTitle(title);
    if (!normalizedTitle) {
      continue;
    }

    const sectionKey = normalizeSectionKey(normalizedTitle);
    if (sectionsByKey.has(sectionKey)) {
      continue;
    }

    sectionsByKey.set(sectionKey, {
      id: normalizedTitle,
      title: normalizedTitle,
      folderNodes: [],
      isUngrouped: false,
    });
    orderedKeys.push(sectionKey);
  }

  const ungroupedNodes: CategoryFolderNode[] = [];

  for (const node of orderedTopLevelNodes) {
    if (node.id === UNCATEGORIZED_FOLDER_ID) {
      continue;
    }

    const sectionTitle = normalizeOptionalSectionTitle(node.section);
    if (!sectionTitle) {
      ungroupedNodes.push(node);
      continue;
    }

    const sectionKey = normalizeSectionKey(sectionTitle);
    const existingSection = sectionsByKey.get(sectionKey);
    if (existingSection) {
      existingSection.folderNodes = [...existingSection.folderNodes, node];
      continue;
    }

    sectionsByKey.set(sectionKey, {
      id: sectionTitle,
      title: sectionTitle,
      folderNodes: [node],
      isUngrouped: false,
    });
    orderedKeys.push(sectionKey);
  }

  const sections: SidebarFolderSection[] = [];
  for (const sectionKey of orderedKeys) {
    const section = sectionsByKey.get(sectionKey);
    if (section) {
      sections.push(section);
    }
  }

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

function orderTopLevelNodes(
  topLevelNodes: readonly CategoryFolderNode[],
  folderOrder: readonly string[],
): readonly CategoryFolderNode[] {
  const orderLookup = new Map<string, number>();
  folderOrder.forEach((folderId, index) => {
    if (!orderLookup.has(folderId)) {
      orderLookup.set(folderId, index);
    }
  });

  return [...topLevelNodes].sort((left, right) => {
    const leftIndex = orderLookup.get(left.id);
    const rightIndex = orderLookup.get(right.id);

    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }

    if (leftIndex !== undefined) {
      return -1;
    }

    if (rightIndex !== undefined) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function appendFolderToOrderedGroup(
  orderedFolderIds: readonly string[],
  draggedFolderId: string,
  targetGroupFolderIds: readonly string[],
): readonly string[] {
  const remainingFolderIds = orderedFolderIds.filter((folderId) => folderId !== draggedFolderId);
  const targetIds = targetGroupFolderIds.filter((folderId) => folderId !== draggedFolderId);
  if (targetIds.length === 0) {
    return [...remainingFolderIds, draggedFolderId];
  }

  let insertIndex = -1;
  targetIds.forEach((targetFolderId) => {
    const targetIndex = remainingFolderIds.indexOf(targetFolderId);
    if (targetIndex > insertIndex) {
      insertIndex = targetIndex;
    }
  });

  if (insertIndex < 0) {
    return [...remainingFolderIds, draggedFolderId];
  }

  remainingFolderIds.splice(insertIndex + 1, 0, draggedFolderId);
  return remainingFolderIds;
}

function moveFolderBeforeTarget(
  orderedFolderIds: readonly string[],
  draggedFolderId: string,
  targetFolderId: string,
): readonly string[] {
  const remainingFolderIds = orderedFolderIds.filter((folderId) => folderId !== draggedFolderId);
  const targetIndex = remainingFolderIds.indexOf(targetFolderId);
  if (targetIndex < 0) {
    return [...remainingFolderIds, draggedFolderId];
  }

  remainingFolderIds.splice(targetIndex, 0, draggedFolderId);
  return remainingFolderIds;
}

function normalizeSectionTitle(value: string): string | null {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeOptionalSectionTitle(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeSectionKey(value: string): string {
  return value.toLocaleLowerCase();
}

function isSameSectionLabel(left: string, right: string): boolean {
  return normalizeSectionKey(left) === normalizeSectionKey(right);
}

function ensureSectionInOrder(sectionOrder: readonly string[], sectionTitle: string): readonly string[] {
  if (sectionOrder.some((title) => isSameSectionLabel(title, sectionTitle))) {
    return sectionOrder;
  }

  return [...sectionOrder, sectionTitle];
}

function renameSectionInOrder(
  sectionOrder: readonly string[],
  currentTitle: string,
  nextTitle: string,
): readonly string[] {
  let foundCurrentTitle = false;
  const nextOrder = sectionOrder.map((title) => {
    if (!isSameSectionLabel(title, currentTitle)) {
      return title;
    }

    foundCurrentTitle = true;
    return nextTitle;
  });

  return foundCurrentTitle ? nextOrder : [...nextOrder, nextTitle];
}

function createSectionTitle(sectionOrder: readonly string[]): string {
  let index = 1;

  while (sectionOrder.some((title) => isSameSectionLabel(title, `Section ${index}`))) {
    index += 1;
  }

  return `Section ${index}`;
}

function countUniqueFiles(groups: readonly SectionContentGroup[]): number {
  return new Set(groups.flatMap((group) => group.files.map((file) => file.path))).size;
}

function cleanupCategoryLabel(label: string): string {
  return label.replace(/^category\s*-\s*/iu, "").trim();
}

function uniqueFilePaths(files: readonly TFile[]): readonly string[] {
  return [...new Set(files.map((file) => file.path))];
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
}

function mergeRenderScope(currentScope: RenderScope | null, nextScope: RenderScope): RenderScope {
  if (currentScope === "all" || nextScope === "all") {
    return "all";
  }

  return currentScope ?? nextScope;
}

function reorderFilesByPaths(files: readonly TFile[], orderedFilePaths: readonly string[]): readonly TFile[] {
  if (files.length <= 1 || orderedFilePaths.length === 0) {
    return files;
  }

  const filesByPath = new Map(files.map((file) => [file.path, file] as const));
  const reorderedFiles: TFile[] = [];
  const seenPaths = new Set<string>();

  for (const filePath of orderedFilePaths) {
    const file = filesByPath.get(filePath);
    if (!file) {
      continue;
    }

    reorderedFiles.push(file);
    seenPaths.add(filePath);
  }

  for (const file of files) {
    if (seenPaths.has(file.path)) {
      continue;
    }

    reorderedFiles.push(file);
  }

  return reorderedFiles;
}

function uniqueFilePathsFromPayload(payload: DraggedFilePayload): readonly string[] {
  const candidatePaths = payload.filePaths.length > 0 ? payload.filePaths : [payload.filePath];
  return [...new Set(candidatePaths)];
}

function addSelectOption(selectEl: HTMLSelectElement, value: string, label: string): void {
  const optionEl = selectEl.createEl("option", { text: label });
  optionEl.value = value;
}

function parseNoteSortMode(value: string): VirtualTreeSettings["noteSortMode"] {
  return value === "created" || value === "title" || value === "property" ? value : "modified";
}

function sortFilesForDisplay(
  files: readonly TFile[],
  settings: Pick<VirtualTreeSettings, "noteSortMode" | "noteSortDirection" | "noteSortProperty">,
  app: App,
): readonly TFile[] {
  return [...files].sort((left, right) => compareFilesForDisplay(left, right, settings, app));
}

function compareFilesForDisplay(
  left: TFile,
  right: TFile,
  settings: Pick<VirtualTreeSettings, "noteSortMode" | "noteSortDirection" | "noteSortProperty">,
  app: App,
): number {
  const directionMultiplier = settings.noteSortDirection === "asc" ? 1 : -1;

  let comparison = 0;
  switch (settings.noteSortMode) {
    case "created":
      comparison = comparePrimitiveValues(left.stat.ctime, right.stat.ctime);
      break;
    case "title":
      comparison = comparePrimitiveValues(left.basename, right.basename);
      break;
    case "property": {
      const propertyName = settings.noteSortProperty.trim();
      comparison = propertyName.length > 0
        ? compareSortValues(
          readSortableFrontmatterValue(left, propertyName, app),
          readSortableFrontmatterValue(right, propertyName, app),
        )
        : 0;
      break;
    }
    case "modified":
    default:
      comparison = comparePrimitiveValues(left.stat.mtime, right.stat.mtime);
      break;
  }

  if (comparison !== 0) {
    return comparison * directionMultiplier;
  }

  const fallbackComparison = comparePrimitiveValues(left.basename, right.basename);
  if (fallbackComparison !== 0) {
    return fallbackComparison;
  }

  return comparePrimitiveValues(left.path, right.path);
}

function readSortableFrontmatterValue(file: TFile, propertyName: string, app: App): SortableValue {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return normalizeSortableValue(frontmatter?.[propertyName]);
}

type SortableValue = string | number | boolean | null;

function normalizeSortableValue(value: unknown): SortableValue {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedEntries = value
    .map((entry) => normalizeSortableValue(entry))
    .filter((entry): entry is Exclude<SortableValue, null> => entry !== null);

  if (normalizedEntries.length === 0) {
    return null;
  }

  return normalizedEntries.map((entry) => `${entry}`).join(", ");
}

function compareSortValues(left: SortableValue, right: SortableValue): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return comparePrimitiveValues(left, right);
}

function comparePrimitiveValues(left: string | number | boolean, right: string | number | boolean): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return `${left}`.localeCompare(`${right}`, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function stripCaseInsensitivePrefix(value: string, prefix: string): string {
  if (!value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return value;
  }

  const strippedValue = value.slice(prefix.length).trim();
  return strippedValue.length > 0 ? strippedValue : value;
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
    filePaths: [fallbackPath],
    sourceAssignmentValue: null,
    isAdditive: false,
  };
}

function isDraggedFilePayload(value: unknown): value is DraggedFilePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DraggedFilePayload>;
  return typeof candidate.filePath === "string"
    && Array.isArray(candidate.filePaths)
    && candidate.filePaths.every((filePath): filePath is string => typeof filePath === "string")
    && (typeof candidate.sourceAssignmentValue === "string" || candidate.sourceAssignmentValue === null)
    && typeof candidate.isAdditive === "boolean";
}
