"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VirtualTreePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/virtual-tree/types.ts
var ROOT_FOLDER_ID = "__root__";
var UNCATEGORIZED_FOLDER_ID = "__uncategorized__";
var UNCATEGORIZED_FOLDER_NAME = "Uncategorized";
var DEFAULT_SETTINGS = {
  frontmatterKey: "categories",
  treatSlashesAsHierarchy: true,
  showUncategorized: true,
  showUncategorizedFolder: false,
  showUnassignedCategoryNotes: true,
  categoryNoteFilenamePrefix: "category - ",
  noteDisplayMode: "list",
  showPath: false,
  zebraRows: true,
  folderSections: []
};

// src/virtual-tree/buildCategoryTree.ts
function buildCategoryTree(files, metadataCache, settings) {
  const sourceFiles = sortFiles(files.filter((file) => !isIgnoredVaultPath(file.path)));
  const root = createNode(ROOT_FOLDER_ID, "All notes", 0);
  const folderLookup = /* @__PURE__ */ new Map([[ROOT_FOLDER_ID, root]]);
  const uncategorizedFiles = [];
  const categoryPathCache = /* @__PURE__ */ new Map();
  for (const file of sourceFiles) {
    const categoryPaths = extractCategoryPaths(file, metadataCache, settings, categoryPathCache);
    if (categoryPaths.length === 0) {
      if (settings.showUncategorized) {
        uncategorizedFiles.push(file);
      }
      continue;
    }
    for (const categoryPath of categoryPaths) {
      let currentNode = root;
      categoryPath.segments.forEach((segment, index) => {
        const nodeId = categoryPath.segments.slice(0, index + 1).join("/");
        const existingChild = currentNode.children.get(segment);
        if (existingChild) {
          if (index === categoryPath.segments.length - 1) {
            existingChild.assignmentValue ?? (existingChild.assignmentValue = categoryPath.assignmentValue);
            existingChild.icon ?? (existingChild.icon = categoryPath.icon);
          }
          currentNode = existingChild;
          return;
        }
        const nextNode = createNode(nodeId, segment, index + 1);
        if (index === categoryPath.segments.length - 1) {
          nextNode.assignmentValue = categoryPath.assignmentValue;
          nextNode.icon = categoryPath.icon;
        }
        currentNode.children.set(segment, nextNode);
        folderLookup.set(nextNode.id, nextNode);
        currentNode = nextNode;
      });
      currentNode.directFiles.push(file);
    }
  }
  injectUnassignedCategoryNotes(root, folderLookup, sourceFiles, metadataCache, settings);
  if (settings.showUncategorized && settings.showUncategorizedFolder && uncategorizedFiles.length > 0) {
    const uncategorizedNode = createNode(UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME, 1);
    uncategorizedNode.directFiles.push(...uncategorizedFiles);
    root.children.set(UNCATEGORIZED_FOLDER_NAME, uncategorizedNode);
    folderLookup.set(UNCATEGORIZED_FOLDER_ID, uncategorizedNode);
  }
  finalizeSortedChildren(root);
  const descendantFilesByFolderId = /* @__PURE__ */ new Map();
  collectDescendantFiles(root, descendantFilesByFolderId);
  descendantFilesByFolderId.set(ROOT_FOLDER_ID, sourceFiles);
  return {
    root,
    folderLookup,
    descendantFilesByFolderId,
    allFiles: sourceFiles,
    uncategorizedFiles
  };
}
function injectUnassignedCategoryNotes(root, folderLookup, files, metadataCache, settings) {
  const prefix = settings.categoryNoteFilenamePrefix.trim();
  if (!settings.showUnassignedCategoryNotes || prefix.length === 0) {
    return;
  }
  for (const file of files) {
    if (!file.basename.startsWith(prefix)) {
      continue;
    }
    const parsedPath = parseCategoryPath(`[[${file.basename}]]`, settings.treatSlashesAsHierarchy, metadataCache);
    if (!parsedPath) {
      continue;
    }
    ensureCategoryPathFromSegments(
      root,
      folderLookup,
      parsedPath.segments,
      parsedPath.assignmentValue,
      parsedPath.icon
    );
  }
}
function ensureCategoryPathFromSegments(root, folderLookup, segments, assignmentValue, icon) {
  let currentNode = root;
  segments.forEach((segment, index) => {
    const nodeId = segments.slice(0, index + 1).join("/");
    const existingChild = currentNode.children.get(segment);
    if (existingChild) {
      if (index === segments.length - 1) {
        existingChild.assignmentValue ?? (existingChild.assignmentValue = assignmentValue);
        existingChild.icon ?? (existingChild.icon = icon);
      }
      currentNode = existingChild;
      return;
    }
    const nextNode = createNode(nodeId, segment, index + 1);
    if (index === segments.length - 1) {
      nextNode.assignmentValue = assignmentValue;
      nextNode.icon = icon;
    }
    currentNode.children.set(segment, nextNode);
    folderLookup.set(nextNode.id, nextNode);
    currentNode = nextNode;
  });
}
function collectDescendantFiles(node, descendantFilesByFolderId) {
  let collectedFiles = node.directFiles;
  for (const child of node.sortedChildren) {
    collectedFiles = mergeSortedFiles(collectedFiles, collectDescendantFiles(child, descendantFilesByFolderId));
  }
  descendantFilesByFolderId.set(node.id, collectedFiles);
  return collectedFiles;
}
function extractCategoryPaths(file, metadataCache, settings, categoryPathCache) {
  const frontmatterValue = metadataCache.getFileCache(file)?.frontmatter?.[settings.frontmatterKey];
  const rawValues = normalizeRawCategoryValues(frontmatterValue);
  const parsedPaths = [];
  for (const rawValue of rawValues) {
    if (categoryPathCache.has(rawValue)) {
      const cachedPath = categoryPathCache.get(rawValue) ?? null;
      if (cachedPath) {
        parsedPaths.push(cachedPath);
      }
      continue;
    }
    const parsedPath = parseCategoryPath(rawValue, settings.treatSlashesAsHierarchy, metadataCache);
    categoryPathCache.set(rawValue, parsedPath);
    if (parsedPath) {
      parsedPaths.push(parsedPath);
    }
  }
  return parsedPaths.length > 0 ? deduplicatePaths(parsedPaths) : [];
}
function normalizeRawCategoryValues(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string");
}
function parseCategoryPath(rawValue, treatSlashesAsHierarchy, metadataCache) {
  const categoryDetails = resolveCategoryDetails(rawValue, metadataCache);
  const segments = (treatSlashesAsHierarchy ? rawValue.split("/") : [rawValue]).map((segment) => normalizeCategorySegment(segment, metadataCache)).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  return {
    id: segments.join("/"),
    segments,
    assignmentValue: categoryDetails.assignmentValue,
    icon: categoryDetails.icon
  };
}
function resolveCategoryDetails(rawValue, metadataCache) {
  const trimmedValue = rawValue.trim();
  const wikilinkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/u);
  if (!wikilinkMatch) {
    return {
      assignmentValue: trimmedValue.length > 0 ? trimmedValue : null,
      icon: null
    };
  }
  const targetPart = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
  const destination = targetPart.length > 0 ? metadataCache.getFirstLinkpathDest(targetPart, "") : null;
  const destinationPath = destination?.path;
  const frontmatterIcon = destinationPath ? metadataCache.getFileCache(destination)?.frontmatter?.icon : null;
  return {
    assignmentValue: destination ? `[[${destination.basename}]]` : trimmedValue,
    icon: typeof frontmatterIcon === "string" && frontmatterIcon.trim().length > 0 ? frontmatterIcon.trim() : null
  };
}
function normalizeCategorySegment(segment, metadataCache) {
  const trimmedSegment = segment.trim();
  const wikilinkMatch = trimmedSegment.match(/^\[\[(.+?)\]\]$/u);
  if (!wikilinkMatch) {
    return cleanupCategoryLabel(trimmedSegment);
  }
  const [targetPart, displayPart] = wikilinkMatch[1].split("|");
  if (displayPart) {
    return cleanupCategoryLabel(displayPart.trim());
  }
  const cleanTarget = targetPart.split("#")[0].trim();
  const destination = metadataCache.getFirstLinkpathDest(cleanTarget, "");
  const frontmatterTitle = destination ? metadataCache.getFileCache(destination)?.frontmatter?.title : null;
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return cleanupCategoryLabel(frontmatterTitle);
  }
  if (destination) {
    return cleanupCategoryLabel(destination.basename);
  }
  return cleanupCategoryLabel(cleanTarget);
}
function isIgnoredVaultPath(path) {
  return path.startsWith(".obsidian/");
}
function cleanupCategoryLabel(label) {
  return label.replace(/^category\s*-\s*/iu, "").trim();
}
function deduplicatePaths(paths) {
  const byId = /* @__PURE__ */ new Map();
  for (const path of paths) {
    byId.set(path.id, path);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
function finalizeSortedChildren(node) {
  const sortedChildren = sortNodes([...node.children.values()]);
  node.sortedChildren = sortedChildren;
  for (const child of sortedChildren) {
    finalizeSortedChildren(child);
  }
}
function createNode(id, name, depth) {
  return {
    id,
    name,
    depth,
    children: /* @__PURE__ */ new Map(),
    sortedChildren: [],
    directFiles: [],
    assignmentValue: null,
    icon: null
  };
}
function sortNodes(nodes) {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
}
function sortFiles(files) {
  return [...files].sort(compareFiles);
}
function mergeSortedFiles(leftFiles, rightFiles) {
  if (leftFiles.length === 0) {
    return rightFiles;
  }
  if (rightFiles.length === 0) {
    return leftFiles;
  }
  const mergedFiles = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftFiles.length && rightIndex < rightFiles.length) {
    if (compareFiles(leftFiles[leftIndex], rightFiles[rightIndex]) <= 0) {
      mergedFiles.push(leftFiles[leftIndex]);
      leftIndex += 1;
    } else {
      mergedFiles.push(rightFiles[rightIndex]);
      rightIndex += 1;
    }
  }
  while (leftIndex < leftFiles.length) {
    mergedFiles.push(leftFiles[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < rightFiles.length) {
    mergedFiles.push(rightFiles[rightIndex]);
    rightIndex += 1;
  }
  return mergedFiles;
}
function compareFiles(left, right) {
  const nameComparison = left.basename.localeCompare(right.basename);
  return nameComparison !== 0 ? nameComparison : left.path.localeCompare(right.path);
}

// src/virtual-tree/settings.ts
var import_obsidian = require("obsidian");
var VirtualTreeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Frontmatter key").setDesc("Use this frontmatter key to build virtual folders.").addText((text) => {
      text.setPlaceholder("categories").setValue(this.plugin.settings.frontmatterKey).onChange(async (value) => {
        const nextSettings = {
          ...this.plugin.settings,
          frontmatterKey: value.trim() || "categories"
        };
        await this.plugin.savePluginSettings(nextSettings);
      });
    });
    new import_obsidian.Setting(containerEl).setName("Treat slashes as hierarchy").setDesc("Interpret values like Projects/Client A as nested folders.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.treatSlashesAsHierarchy).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          treatSlashesAsHierarchy: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Show uncategorized notes").setDesc("Show notes without the configured frontmatter key in the sidebar and explorer.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showUncategorized).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          showUncategorized: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Show uncategorized folder").setDesc("Also expose uncategorized notes as a selectable folder row.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showUncategorizedFolder).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          showUncategorizedFolder: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Show unassigned category notes").setDesc(
      "Show folders for category definition notes (matching the prefix below) even when no note lists that category in frontmatter yet."
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showUnassignedCategoryNotes).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          showUnassignedCategoryNotes: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Category note filename prefix").setDesc(
      "Treat notes whose filename starts with this text as category definitions. Their folder labels are resolved the same way as linked category notes."
    ).addText((text) => {
      text.setPlaceholder("category - ").setValue(this.plugin.settings.categoryNoteFilenamePrefix).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          categoryNoteFilenamePrefix: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Note display mode").setDesc("Choose how notes are rendered in the content pane.").addDropdown((dropdown) => {
      dropdown.addOption("list", "List").addOption("cards", "Cards").setValue(this.plugin.settings.noteDisplayMode).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteDisplayMode: value === "cards" ? "cards" : "list"
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Show path").setDesc("Show the full note path as secondary text in the content pane.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showPath).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          showPath: value
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Zebra rows").setDesc("Add a subtle alternating background to note rows in list mode.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.zebraRows).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          zebraRows: value
        });
      });
    });
  }
};

// src/virtual-tree/view.ts
var import_obsidian2 = require("obsidian");
var VIEW_TYPE_VIRTUAL_TREE = "virtual-tree-view";
var DRAGGED_FILE_PATH_MIME = "application/x-virtual-tree-file-path";
var DRAGGED_FILE_PAYLOAD_MIME = "application/x-virtual-tree-file-payload";
var DRAGGED_FOLDER_ID_MIME = "application/x-virtual-tree-folder-id";
var DRAGGED_SECTION_ID_MIME = "application/x-virtual-tree-section-id";
var UNGROUPED_SECTION_ID = "__ungrouped__";
var LIST_VIRTUALIZATION_THRESHOLD = 200;
var LIST_VIRTUALIZATION_OVERSCAN = 12;
var LIST_ROW_HEIGHT = 32;
var LIST_ROW_HEIGHT_WITH_PATH = 48;
var VirtualTreeView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.collapsedFolderIds = /* @__PURE__ */ new Set();
    this.selectedFolderId = ROOT_FOLDER_ID;
    this.selectedSectionId = null;
    this.refreshTimeoutId = null;
    this.cachedTree = null;
    this.isTreeDirty = true;
    this.activeDraggedFilePayload = null;
    this.activeDropTargetEl = null;
    this.sidebarPaneEl = null;
    this.contentPaneEl = null;
    this.contentScrollEl = null;
    this.virtualizedListResizeObserver = null;
    this.virtualizedListFrameId = null;
    this.suppressClickUntil = 0;
    this.isOrganizingFolderSections = false;
    this.activeSectionOrganizeTargetEl = null;
    this.plugin = plugin;
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRefresh()));
  }
  getViewType() {
    return VIEW_TYPE_VIRTUAL_TREE;
  }
  getDisplayText() {
    return "Virtual tree";
  }
  getIcon() {
    return "folder-tree";
  }
  async onOpen() {
    this.addAction("refresh-cw", "Refresh virtual tree", () => {
      this.isTreeDirty = true;
      this.render();
    });
    this.render();
  }
  async onClose() {
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
  requestRefresh(treeDirty = true) {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
    }
    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      this.isTreeDirty = this.isTreeDirty || treeDirty;
      this.render();
    }, 75);
  }
  render(scope = "all", resetContentScroll = false) {
    const tree = this.getTree();
    const folderSections = this.getSidebarFolderSections(tree);
    const selectedNode = tree.folderLookup.get(this.selectedFolderId) ?? tree.root;
    const selectedSection = this.selectedSectionId ? folderSections.find((section) => section.id === this.selectedSectionId) ?? null : null;
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
          previousScrollTop
        );
      }
    }
  }
  ensureLayout() {
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
  getTree() {
    if (this.cachedTree && !this.isTreeDirty) {
      return this.cachedTree;
    }
    this.cachedTree = buildCategoryTree(
      this.app.vault.getMarkdownFiles(),
      this.app.metadataCache,
      this.plugin.settings
    );
    this.isTreeDirty = false;
    return this.cachedTree;
  }
  renderSidebar(containerEl, tree, folderSections) {
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
          type: "button"
        }
      });
      (0, import_obsidian2.setIcon)(addSectionButtonEl, "plus");
      addSectionButtonEl.addEventListener("click", () => {
        void this.addFolderSection();
      });
    }
    const organizeSectionsButtonEl = actionsEl.createEl("button", {
      cls: this.isOrganizingFolderSections ? "clickable-icon virtual-tree-sidebar-organize-button is-active" : "clickable-icon virtual-tree-sidebar-organize-button",
      attr: {
        "aria-label": this.isOrganizingFolderSections ? "Done organizing sections" : "Organize folder sections",
        "data-tooltip-position": "top",
        type: "button"
      }
    });
    (0, import_obsidian2.setIcon)(organizeSectionsButtonEl, this.isOrganizingFolderSections ? "check" : "pencil");
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
        text: `${tree.uncategorizedFiles.length}`
      });
      const notesEl = sectionEl.createDiv({ cls: "virtual-tree-sidebar-uncategorized" });
      for (const file of tree.uncategorizedFiles) {
        this.renderSidebarUncategorizedFile(notesEl, file);
      }
    }
  }
  renderFolderSections(containerEl, tree, folderSections) {
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
            type: "button"
          }
        });
        (0, import_obsidian2.setIcon)(gripEl, "grip-vertical");
        this.attachSectionReorderDrag(gripEl, section.id);
        const titleInputEl = headerRowEl.createEl("input", {
          cls: "virtual-tree-section-title-input",
          attr: {
            "aria-label": "Section name",
            type: "text"
          },
          value: section.title
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
          text: `${section.folderNodes.length}`
        });
        const deleteSectionButtonEl = headerRowEl.createEl("button", {
          cls: "clickable-icon",
          attr: {
            "aria-label": "Delete section",
            "data-tooltip-position": "top",
            type: "button"
          }
        });
        (0, import_obsidian2.setIcon)(deleteSectionButtonEl, "trash");
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
          text: `${section.folderNodes.length}`
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
          text: section.isUngrouped ? "No ungrouped folders." : "No folders assigned yet."
        });
        continue;
      }
      const sectionFoldersEl = sectionEl.createDiv({ cls: "virtual-tree-folders" });
      for (const childNode of section.folderNodes) {
        this.renderFolderNode(sectionFoldersEl, childNode, tree.descendantFilesByFolderId);
      }
    }
  }
  renderFolderNode(containerEl, node, descendantFilesByFolderId) {
    const groupEl = containerEl.createDiv({ cls: "virtual-tree-folder-group" });
    const rowEl = groupEl.createDiv({ cls: "virtual-tree-folder-row" });
    const hasChildren = node.sortedChildren.length > 0;
    if (hasChildren) {
      const toggleEl = rowEl.createEl("button", {
        cls: "virtual-tree-folder-toggle clickable-icon",
        attr: {
          "aria-label": this.collapsedFolderIds.has(node.id) ? `Expand ${node.name}` : `Collapse ${node.name}`,
          type: "button"
        }
      });
      (0, import_obsidian2.setIcon)(toggleEl, this.collapsedFolderIds.has(node.id) ? "chevron-right" : "chevron-down");
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
  renderFolderRow(containerEl, node, files) {
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
          type: "button"
        }
      });
      (0, import_obsidian2.setIcon)(organizeHandleEl, "grip-vertical");
      this.attachFolderOrganizeDrag(organizeHandleEl, node.id);
    }
    this.renderFolderIcon(leadingEl, node);
    leadingEl.createSpan({ cls: "virtual-tree-folder-label", text: node.name });
    rowEl.createSpan({
      cls: "virtual-tree-folder-count",
      text: `${files.length}`
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
  renderFolderIcon(containerEl, node) {
    const iconEl = containerEl.createSpan({ cls: "virtual-tree-folder-icon" });
    if (node.id === ROOT_FOLDER_ID) {
      (0, import_obsidian2.setIcon)(iconEl, "library");
      return;
    }
    if (node.icon) {
      if (/^[a-z0-9-]+$/iu.test(node.icon)) {
        (0, import_obsidian2.setIcon)(iconEl, node.icon);
      } else {
        iconEl.setText(node.icon);
      }
      return;
    }
    (0, import_obsidian2.setIcon)(iconEl, "folder");
  }
  renderSidebarUncategorizedFile(containerEl, file) {
    const rowEl = containerEl.createDiv({ cls: "virtual-tree-sidebar-file-row" });
    rowEl.setAttribute("role", "button");
    rowEl.setAttribute("tabindex", "0");
    rowEl.setAttribute("draggable", "true");
    const iconEl = rowEl.createSpan({ cls: "virtual-tree-sidebar-file-icon" });
    (0, import_obsidian2.setIcon)(iconEl, "file");
    rowEl.createSpan({ cls: "virtual-tree-sidebar-file-label", text: file.basename });
    this.attachFileInteractions(rowEl, file);
    this.attachFileDragSource(rowEl, file, null);
  }
  attachFolderDropTarget(rowEl, node) {
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
      if (!(abstractFile instanceof import_obsidian2.TFile)) {
        return;
      }
      void this.assignFileToCategory(abstractFile, node, payload.sourceAssignmentValue);
    });
  }
  renderContent(containerEl, selectedNode, files, initialScrollTop) {
    this.cleanupVirtualizedList();
    containerEl.empty();
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: selectedNode.name });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${files.length} ${files.length === 1 ? "note" : "notes"}`
    });
    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list"
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
  renderSectionContent(containerEl, section, tree, initialScrollTop) {
    this.cleanupVirtualizedList();
    containerEl.empty();
    const groups = this.buildSectionContentGroups(section, tree);
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: section.title });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${countUniqueFiles(groups)} ${countUniqueFiles(groups) === 1 ? "note" : "notes"}`
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
        text: `${group.files.length}`
      });
      const filesEl = groupEl.createDiv({
        cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid virtual-tree-section-group-files" : "virtual-tree-file-list virtual-tree-section-group-files"
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
  buildSectionContentGroups(section, tree) {
    return section.folderNodes.map((node) => ({
      node,
      files: tree.descendantFilesByFolderId.get(node.id) ?? []
    })).filter((group) => group.files.length > 0);
  }
  shouldVirtualizeList(files) {
    return this.plugin.settings.noteDisplayMode === "list" && files.length >= LIST_VIRTUALIZATION_THRESHOLD;
  }
  renderVirtualizedFileList(containerEl, files, sourceAssignmentValue, initialScrollTop) {
    containerEl.addClass("is-virtualized");
    const spacerEl = containerEl.createDiv({ cls: "virtual-tree-file-list-spacer" });
    const windowEl = containerEl.createDiv({ cls: "virtual-tree-file-list-window" });
    const rowHeight = this.plugin.settings.showPath ? LIST_ROW_HEIGHT_WITH_PATH : LIST_ROW_HEIGHT;
    spacerEl.style.height = `${files.length * rowHeight}px`;
    containerEl.scrollTop = initialScrollTop;
    const renderWindow = () => {
      this.virtualizedListFrameId = null;
      const viewportHeight = Math.max(containerEl.clientHeight, rowHeight * 8);
      const scrollTop = containerEl.scrollTop;
      const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - LIST_VIRTUALIZATION_OVERSCAN);
      const endIndex = Math.min(
        files.length,
        Math.ceil((scrollTop + viewportHeight) / rowHeight) + LIST_VIRTUALIZATION_OVERSCAN
      );
      windowEl.empty();
      windowEl.style.transform = `translateY(${startIndex * rowHeight}px)`;
      for (let index = startIndex; index < endIndex; index += 1) {
        this.renderFileRow(windowEl, files[index], sourceAssignmentValue, index);
      }
    };
    const scheduleRenderWindow = () => {
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
  cleanupVirtualizedList() {
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
  renderFileRow(containerEl, file, sourceAssignmentValue, rowIndex) {
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
  renderFileCard(containerEl, file, sourceAssignmentValue) {
    const cardEl = containerEl.createEl("button", {
      cls: "virtual-tree-file-card",
      attr: {
        type: "button",
        draggable: "true"
      }
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
  attachFileDragSource(element, file, sourceAssignmentValue) {
    element.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      const payload = {
        filePath: file.path,
        sourceAssignmentValue
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
  attachFileInteractions(rowEl, file) {
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
  openFileMenu(event, file) {
    const menu = new import_obsidian2.Menu();
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
  openFolderMenu(event, node) {
    const categoryFile = this.resolveCategoryFile(node);
    if (!categoryFile) {
      return;
    }
    const menu = new import_obsidian2.Menu();
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
  async toggleOrganizeFolderSections() {
    if (this.isOrganizingFolderSections) {
      this.isOrganizingFolderSections = false;
      this.clearActiveSectionOrganizeTarget();
      this.render("sidebar");
      return;
    }
    if (this.plugin.settings.folderSections.length === 0) {
      const nextSection = {
        id: createFolderSectionId(),
        title: "Section 1",
        folderIds: []
      };
      await this.plugin.savePluginSettings({
        ...this.plugin.settings,
        folderSections: [nextSection]
      });
      this.isTreeDirty = true;
    }
    this.isOrganizingFolderSections = true;
    this.render("sidebar");
  }
  async addFolderSection() {
    const nextSection = {
      id: createFolderSectionId(),
      title: `Section ${this.plugin.settings.folderSections.length + 1}`,
      folderIds: []
    };
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: [...this.plugin.settings.folderSections, nextSection]
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }
  async deleteFolderSection(sectionId) {
    const nextSections = this.plugin.settings.folderSections.filter((section) => section.id !== sectionId);
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: nextSections
    });
    this.isTreeDirty = true;
    if (nextSections.length === 0) {
      this.isOrganizingFolderSections = false;
    }
    this.render("sidebar");
  }
  async updateSectionTitleFromInput(sectionId, nextTitle) {
    const tree = this.getTree();
    const folderOptions = this.getFolderSectionOptions(tree);
    const drafts = this.plugin.settings.folderSections.map((section) => {
      if (section.id !== sectionId) {
        return {
          id: section.id,
          title: section.title,
          folderIds: [...section.folderIds]
        };
      }
      return {
        id: section.id,
        title: nextTitle,
        folderIds: [...section.folderIds]
      };
    });
    const validated = validateFolderSections(drafts, folderOptions);
    if (!validated) {
      this.render("sidebar");
      return;
    }
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }
  async moveFolderToSection(folderId, targetSectionId) {
    const tree = this.getTree();
    const folderOptions = this.getFolderSectionOptions(tree);
    let drafts = this.plugin.settings.folderSections.map((section) => ({
      id: section.id,
      title: section.title,
      folderIds: section.folderIds.filter((existingFolderId) => existingFolderId !== folderId)
    }));
    if (targetSectionId) {
      drafts = drafts.map(
        (section) => section.id === targetSectionId ? { ...section, folderIds: [...section.folderIds, folderId] } : section
      );
    }
    const validated = validateFolderSections(drafts, folderOptions);
    if (!validated) {
      return;
    }
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }
  async reorderFolderSections(draggedSectionId, targetSectionId) {
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
    const drafts = ordered.map((section) => ({
      id: section.id,
      title: section.title,
      folderIds: [...section.folderIds]
    }));
    const validated = validateFolderSections(drafts, this.getFolderSectionOptions(tree));
    if (!validated) {
      return;
    }
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      folderSections: validated
    });
    this.isTreeDirty = true;
    this.render("sidebar");
  }
  getFolderSectionOptions(tree) {
    return tree.root.sortedChildren.map((node) => ({
      id: node.id,
      name: node.name
    }));
  }
  getSidebarFolderSections(tree) {
    return buildSidebarFolderSections(tree.root.sortedChildren, this.plugin.settings.folderSections);
  }
  attachSectionOrganizeDropTarget(sectionEl, section) {
    const onDragOver = (event) => {
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
    const onDrop = (event) => {
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
  attachFolderOrganizeDrag(handleEl, folderId) {
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
  attachSectionReorderDrag(handleEl, sectionId) {
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
  setActiveSectionOrganizeTarget(nextTarget) {
    if (this.activeSectionOrganizeTargetEl === nextTarget) {
      return;
    }
    this.clearActiveSectionOrganizeTarget();
    this.activeSectionOrganizeTargetEl = nextTarget;
    nextTarget.addClass("is-section-organize-target");
  }
  clearActiveSectionOrganizeTarget() {
    if (!this.activeSectionOrganizeTargetEl) {
      return;
    }
    this.activeSectionOrganizeTargetEl.removeClass("is-section-organize-target");
    this.activeSectionOrganizeTargetEl = null;
  }
  async renameFileWithObsidianCommand(file) {
    const targetLeaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await targetLeaf.openFile(file);
    const commandApp = this.app;
    commandApp.commands.executeCommandById("workspace:edit-file-title");
  }
  async assignFileToCategory(file, node, sourceAssignmentValue) {
    if (!node.assignmentValue) {
      return;
    }
    const targetAssignmentValue = node.assignmentValue;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existingValues = normalizeFrontmatterCategoryValues(frontmatter[this.plugin.settings.frontmatterKey]);
      const filteredValues = sourceAssignmentValue && sourceAssignmentValue !== targetAssignmentValue ? existingValues.filter((value) => value !== sourceAssignmentValue) : existingValues;
      const nextValues = filteredValues.includes(targetAssignmentValue) ? filteredValues : [...filteredValues, targetAssignmentValue];
      frontmatter[this.plugin.settings.frontmatterKey] = nextValues;
    });
    this.selectedFolderId = node.id;
    this.isTreeDirty = true;
    this.render("all", true);
  }
  resolveCategoryFile(node) {
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
  readCategoryDisplayTitle(file) {
    const rawTitle = this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
    return typeof rawTitle === "string" ? rawTitle : "";
  }
  async updateCategoryDisplayTitle(file, nextTitle) {
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
  shouldIgnorePointerActivation() {
    return window.performance.now() < this.suppressClickUntil;
  }
  setActiveDropTarget(nextTarget) {
    if (this.activeDropTargetEl === nextTarget) {
      return;
    }
    this.clearActiveDropTarget();
    this.activeDropTargetEl = nextTarget;
    nextTarget.addClass("is-drop-target");
  }
  clearActiveDropTarget() {
    if (!this.activeDropTargetEl) {
      return;
    }
    this.activeDropTargetEl.removeClass("is-drop-target");
    this.activeDropTargetEl = null;
  }
  readActiveDraggedFilePayload(dataTransfer) {
    return this.activeDraggedFilePayload ?? readDraggedFilePayload(dataTransfer);
  }
  updateDropTargetFromPointer(clientX, clientY) {
    if (clientX <= 0 && clientY <= 0) {
      return;
    }
    const hoveredElement = this.contentEl.ownerDocument.elementFromPoint(clientX, clientY);
    const dropTarget = hoveredElement instanceof HTMLElement ? hoveredElement.closest(".virtual-tree-folder-item.is-droppable") : null;
    if (!(dropTarget instanceof HTMLElement) || !this.contentEl.contains(dropTarget)) {
      this.clearActiveDropTarget();
      return;
    }
    this.setActiveDropTarget(dropTarget);
  }
};
var EditCategoryTitleModal = class extends import_obsidian2.Modal {
  constructor(app, file, initialValue, onSubmit) {
    super(app);
    this.isSubmitting = false;
    this.file = file;
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("virtual-tree-edit-title-modal");
    contentEl.createEl("h2", { text: "Edit category display title" });
    contentEl.createEl("p", {
      cls: "virtual-tree-edit-title-hint",
      text: `Set the sidebar label for ${this.file.basename}. Leave empty to use the filename.`
    });
    const formEl = contentEl.createDiv({ cls: "virtual-tree-edit-title-form" });
    const inputEl = formEl.createEl("input", {
      cls: "virtual-tree-edit-title-input",
      attr: {
        placeholder: this.file.basename,
        type: "text"
      },
      value: this.initialValue
    });
    const saveButtonEl = formEl.createEl("button", {
      cls: "mod-cta",
      text: "Save",
      attr: {
        type: "button"
      }
    });
    const save = async () => {
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
        type: "button"
      }
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
  onClose() {
    this.contentEl.empty();
  }
};
function normalizeFrontmatterCategoryValues(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string");
}
function buildSidebarFolderSections(topLevelNodes, folderSections) {
  if (folderSections.length === 0) {
    return [];
  }
  const nodesById = new Map(topLevelNodes.map((node) => [node.id, node]));
  const claimedFolderIds = /* @__PURE__ */ new Set();
  const sections = [];
  folderSections.forEach((section) => {
    const folderNodes = [];
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
      isUngrouped: false
    });
  });
  const ungroupedNodes = topLevelNodes.filter((node) => !claimedFolderIds.has(node.id));
  if (ungroupedNodes.length > 0) {
    sections.push({
      id: UNGROUPED_SECTION_ID,
      title: "Ungrouped",
      folderNodes: ungroupedNodes,
      isUngrouped: true
    });
  }
  return sections;
}
function validateFolderSections(sections, folderOptions) {
  const availableFolderIds = new Set(folderOptions.map((folderOption) => folderOption.id));
  const usedTitles = /* @__PURE__ */ new Set();
  const claimedFolderIds = /* @__PURE__ */ new Set();
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
        folderIds
      };
    });
  } catch (error) {
    new import_obsidian2.Notice(error instanceof Error ? error.message : "Unable to save folder sections.");
    return null;
  }
}
function countUniqueFiles(groups) {
  return new Set(groups.flatMap((group) => group.files.map((file) => file.path))).size;
}
function createFolderSectionId() {
  return `folder-section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function readDraggedFilePayload(dataTransfer) {
  if (!dataTransfer) {
    return null;
  }
  const rawPayload = dataTransfer.getData(DRAGGED_FILE_PAYLOAD_MIME);
  if (rawPayload) {
    try {
      const parsedPayload = JSON.parse(rawPayload);
      if (isDraggedFilePayload(parsedPayload)) {
        return parsedPayload;
      }
    } catch {
    }
  }
  const fallbackPath = dataTransfer.getData(DRAGGED_FILE_PATH_MIME) || dataTransfer.getData("text/plain");
  if (!fallbackPath) {
    return null;
  }
  return {
    filePath: fallbackPath,
    sourceAssignmentValue: null
  };
}
function isDraggedFilePayload(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return typeof candidate.filePath === "string" && (typeof candidate.sourceAssignmentValue === "string" || candidate.sourceAssignmentValue === null);
}

// main.ts
var VirtualTreePlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_VIRTUAL_TREE,
      (leaf) => new VirtualTreeView(leaf, this)
    );
    this.addRibbonIcon("folder-tree", "Open virtual tree", async () => {
      await this.activateView();
    });
    this.addCommand({
      id: "open-virtual-tree",
      name: "Open virtual tree",
      callback: async () => {
        await this.activateView();
      }
    });
    this.addSettingTab(new VirtualTreeSettingTab(this.app, this));
  }
  async onunload() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE);
    await Promise.all(leaves.map((leaf) => leaf.detach()));
  }
  /**
   * Persists plugin settings and refreshes all open views.
   */
  async savePluginSettings(nextSettings) {
    const shouldRebuildTree = shouldRebuildTreeForSettingsChange(this.settings, nextSettings);
    this.settings = nextSettings;
    await this.saveData(nextSettings);
    this.refreshViews(shouldRebuildTree);
  }
  /**
   * Refreshes every currently open virtual tree view.
   */
  refreshViews(treeDirty = true) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)) {
      const view = leaf.view;
      if (view instanceof VirtualTreeView) {
        view.requestRefresh(treeDirty);
      }
    }
  }
  async loadSettings() {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...readVirtualTreeSettings(loadedSettings)
    };
  }
  async activateView() {
    const leaf = await this.ensureVirtualTreeLeaf();
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_VIRTUAL_TREE, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: false });
    this.app.workspace.revealLeaf(leaf);
  }
  async ensureVirtualTreeLeaf() {
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
};
function readVirtualTreeSettings(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const candidate = value;
  const categoryNoteFilenamePrefix = normalizeCategoryNoteFilenamePrefix(candidate.categoryNoteFilenamePrefix);
  return {
    ...typeof candidate.frontmatterKey === "string" ? { frontmatterKey: candidate.frontmatterKey } : {},
    ...typeof candidate.treatSlashesAsHierarchy === "boolean" ? { treatSlashesAsHierarchy: candidate.treatSlashesAsHierarchy } : {},
    ...typeof candidate.showUncategorized === "boolean" ? { showUncategorized: candidate.showUncategorized } : {},
    ...typeof candidate.showUncategorizedFolder === "boolean" ? { showUncategorizedFolder: candidate.showUncategorizedFolder } : {},
    ...typeof candidate.showUnassignedCategoryNotes === "boolean" ? { showUnassignedCategoryNotes: candidate.showUnassignedCategoryNotes } : {},
    ...categoryNoteFilenamePrefix !== null ? { categoryNoteFilenamePrefix } : {},
    ...candidate.noteDisplayMode === "list" || candidate.noteDisplayMode === "cards" ? { noteDisplayMode: candidate.noteDisplayMode } : {},
    ...typeof candidate.showPath === "boolean" ? { showPath: candidate.showPath } : {},
    ...typeof candidate.zebraRows === "boolean" ? { zebraRows: candidate.zebraRows } : {},
    ...Array.isArray(candidate.folderSections) ? { folderSections: candidate.folderSections.filter(isFolderSection) } : {}
  };
}
function normalizeCategoryNoteFilenamePrefix(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value === "^category - " ? "category - " : value;
}
function isFolderSection(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return typeof candidate.id === "string" && typeof candidate.title === "string" && Array.isArray(candidate.folderIds) && candidate.folderIds.every((folderId) => typeof folderId === "string");
}
function shouldRebuildTreeForSettingsChange(currentSettings, nextSettings) {
  return currentSettings.frontmatterKey !== nextSettings.frontmatterKey || currentSettings.treatSlashesAsHierarchy !== nextSettings.treatSlashesAsHierarchy || currentSettings.showUncategorized !== nextSettings.showUncategorized || currentSettings.showUncategorizedFolder !== nextSettings.showUncategorizedFolder || currentSettings.showUnassignedCategoryNotes !== nextSettings.showUnassignedCategoryNotes || currentSettings.categoryNoteFilenamePrefix !== nextSettings.categoryNoteFilenamePrefix;
}
