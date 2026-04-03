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
  categorySectionKey: "section",
  noteDisplayMode: "list",
  noteSortMode: "modified",
  noteSortDirection: "desc",
  noteSortProperty: "",
  showRealFilename: true,
  showPath: false,
  zebraRows: true,
  sectionOrder: [],
  folderOrder: [],
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
            existingChild.section ?? (existingChild.section = categoryPath.section);
          }
          currentNode = existingChild;
          return;
        }
        const nextNode = createNode(nodeId, segment, index + 1);
        if (index === categoryPath.segments.length - 1) {
          nextNode.assignmentValue = categoryPath.assignmentValue;
          nextNode.icon = categoryPath.icon;
          nextNode.section = categoryPath.section;
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
    const parsedPath = parseCategoryPath(`[[${file.basename}]]`, settings, metadataCache);
    if (!parsedPath) {
      continue;
    }
    ensureCategoryPathFromSegments(
      root,
      folderLookup,
      parsedPath.segments,
      parsedPath.assignmentValue,
      parsedPath.icon,
      parsedPath.section
    );
  }
}
function ensureCategoryPathFromSegments(root, folderLookup, segments, assignmentValue, icon, section) {
  let currentNode = root;
  segments.forEach((segment, index) => {
    const nodeId = segments.slice(0, index + 1).join("/");
    const existingChild = currentNode.children.get(segment);
    if (existingChild) {
      if (index === segments.length - 1) {
        existingChild.assignmentValue ?? (existingChild.assignmentValue = assignmentValue);
        existingChild.icon ?? (existingChild.icon = icon);
        existingChild.section ?? (existingChild.section = section);
      }
      currentNode = existingChild;
      return;
    }
    const nextNode = createNode(nodeId, segment, index + 1);
    if (index === segments.length - 1) {
      nextNode.assignmentValue = assignmentValue;
      nextNode.icon = icon;
      nextNode.section = section;
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
    const parsedPath = parseCategoryPath(rawValue, settings, metadataCache);
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
function parseCategoryPath(rawValue, settings, metadataCache) {
  const categoryDetails = resolveCategoryDetails(rawValue, metadataCache, settings.categorySectionKey);
  const segments = (settings.treatSlashesAsHierarchy ? rawValue.split("/") : [rawValue]).map((segment) => normalizeCategorySegment(segment, metadataCache)).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  return {
    id: segments.join("/"),
    segments,
    assignmentValue: categoryDetails.assignmentValue,
    icon: categoryDetails.icon,
    section: categoryDetails.section
  };
}
function resolveCategoryDetails(rawValue, metadataCache, categorySectionKey) {
  const trimmedValue = rawValue.trim();
  const wikilinkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/u);
  if (!wikilinkMatch) {
    return {
      assignmentValue: trimmedValue.length > 0 ? trimmedValue : null,
      icon: null,
      section: null
    };
  }
  const targetPart = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
  const destination = targetPart.length > 0 ? metadataCache.getFirstLinkpathDest(targetPart, "") : null;
  const destinationPath = destination?.path;
  const frontmatter = destinationPath ? metadataCache.getFileCache(destination)?.frontmatter : null;
  const frontmatterIcon = frontmatter?.icon;
  const frontmatterSection = frontmatter?.[categorySectionKey];
  return {
    assignmentValue: destination ? `[[${destination.basename}]]` : trimmedValue,
    icon: typeof frontmatterIcon === "string" && frontmatterIcon.trim().length > 0 ? frontmatterIcon.trim() : null,
    section: normalizeSectionLabel(frontmatterSection)
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
function normalizeSectionLabel(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
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
    icon: null,
    section: null
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
    new import_obsidian.Setting(containerEl).setName("Category section key").setDesc("Use this frontmatter key on category notes to group top-level folders into sections.").addText((text) => {
      text.setPlaceholder("section").setValue(this.plugin.settings.categorySectionKey).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          categorySectionKey: value.trim() || "section"
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
    new import_obsidian.Setting(containerEl).setName("Note sort").setDesc("Choose the default sort used in the content pane toolbar.").addDropdown((dropdown) => {
      dropdown.addOption("modified", "Modified").addOption("created", "Created").addOption("title", "Title").addOption("property", "Property").setValue(this.plugin.settings.noteSortMode).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteSortMode: value === "created" || value === "title" || value === "property" ? value : "modified"
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Note sort direction").setDesc("Choose the default direction used in the content pane toolbar.").addDropdown((dropdown) => {
      dropdown.addOption("asc", "Ascending").addOption("desc", "Descending").setValue(this.plugin.settings.noteSortDirection).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteSortDirection: value === "asc" ? "asc" : "desc"
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Note sort property").setDesc("Use this frontmatter property when the content pane sort mode is set to Property.").addText((text) => {
      text.setPlaceholder("priority").setValue(this.plugin.settings.noteSortProperty).onChange(async (value) => {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteSortProperty: value.trim()
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
var AUTO_REFRESH_SUPPRESSION_MS = 2e3;
var CONTENT_ORDER_OVERRIDE_MS = 2e3;
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
    this.currentContentFilePaths = [];
    this.selectedNotePaths = /* @__PURE__ */ new Set();
    this.selectionAnchorFilePath = null;
    this.virtualizedListResizeObserver = null;
    this.virtualizedListFrameId = null;
    this.suppressClickUntil = 0;
    this.isOrganizingFolderSections = false;
    this.activeSectionOrganizeTargetEl = null;
    this.activeFolderOrganizeTargetEl = null;
    this.pendingSidebarScrollTop = null;
    this.pendingContentScrollAnchor = null;
    this.pendingContentScrollReset = false;
    this.pendingRenderScope = null;
    this.pendingTreeDirty = false;
    this.autoRefreshSuppression = null;
    this.pendingContentOrderOverride = null;
    this.mobileActivePane = "folders";
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
  getViewType() {
    return VIEW_TYPE_VIRTUAL_TREE;
  }
  getDisplayText() {
    return "Virtual File Explorer";
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
  requestRefresh(treeDirty = true, resetContentScroll = false) {
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
  render(scope = "all", resetContentScroll = false) {
    const tree = this.getTree();
    const folderSections = this.getSidebarFolderSections(tree);
    const selectedNode = tree.folderLookup.get(this.selectedFolderId) ?? tree.root;
    const selectedSection = this.selectedSectionId ? folderSections.find((section) => section.id === this.selectedSectionId) ?? null : null;
    this.selectedFolderId = selectedNode.id;
    this.selectedSectionId = selectedSection?.id ?? null;
    this.ensureLayout();
    this.syncMobilePaneLayout();
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
      const previousScrollTop = resetContentScroll ? 0 : this.pendingContentScrollAnchor?.fallbackScrollTop ?? this.contentScrollEl?.scrollTop ?? 0;
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
      if (!resetContentScroll) {
        this.restorePendingContentScrollAnchor();
      } else {
        this.pendingContentScrollAnchor = null;
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
    this.syncMobilePaneLayout();
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
    this.renderMobilePaneSwitch(headerEl, "folders");
    const actionsEl = headerEl.createDiv({ cls: "virtual-tree-sidebar-actions" });
    if (this.isOrganizingFolderSections) {
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
    const uncategorizedNode = tree.folderLookup.get(UNCATEGORIZED_FOLDER_ID);
    if (uncategorizedNode) {
      this.renderFolderRow(
        foldersEl,
        uncategorizedNode,
        tree.descendantFilesByFolderId.get(UNCATEGORIZED_FOLDER_ID) ?? []
      );
    }
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
          text: `${section.folderNodes.length}`
        });
        sectionHeaderEl.addEventListener("click", () => {
          if (this.shouldIgnorePointerActivation()) {
            return;
          }
          this.selectedNotePaths.clear();
          this.selectionAnchorFilePath = null;
          this.selectedSectionId = section.id;
          this.showMobileNotesPane();
          this.render("all", true);
        });
        sectionHeaderEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.selectedNotePaths.clear();
            this.selectionAnchorFilePath = null;
            this.selectedSectionId = section.id;
            this.showMobileNotesPane();
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
      this.selectedNotePaths.clear();
      this.selectionAnchorFilePath = null;
      this.selectedSectionId = null;
      this.selectedFolderId = node.id;
      this.showMobileNotesPane();
      this.render("all", true);
    });
    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectedNotePaths.clear();
        this.selectionAnchorFilePath = null;
        this.selectedSectionId = null;
        this.selectedFolderId = node.id;
        this.showMobileNotesPane();
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
      const draggedFiles = this.resolveDraggedFiles(payload);
      if (draggedFiles.length > 1 || payload.isAdditive) {
        const assignmentValue = this.getAssignmentValueForNode(node);
        if (assignmentValue) {
          void this.assignFilesToCategories(draggedFiles, [assignmentValue]);
        }
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
    const sortedFiles = this.getSortedFiles(files);
    this.setCurrentContentFiles(sortedFiles);
    this.renderContentHeader(
      containerEl,
      selectedNode.name,
      `${sortedFiles.length} ${sortedFiles.length === 1 ? "note" : "notes"}`
    );
    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list"
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
        initialScrollTop
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
  renderSectionContent(containerEl, section, tree, initialScrollTop) {
    this.cleanupVirtualizedList();
    containerEl.empty();
    const groups = this.buildSectionContentGroups(section, tree);
    this.setCurrentContentFiles(groups.flatMap((group) => group.files));
    const uniqueFileCount = countUniqueFiles(groups);
    this.renderContentHeader(
      containerEl,
      section.title,
      `${uniqueFileCount} ${uniqueFileCount === 1 ? "note" : "notes"}`
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
          this.renderFileCard(filesEl, file, group.node.assignmentValue, group.node.name);
        } else {
          this.renderFileRow(filesEl, file, group.node.assignmentValue, group.node.name, index);
        }
      });
    });
    contentEl.scrollTop = initialScrollTop;
  }
  buildSectionContentGroups(section, tree) {
    return section.folderNodes.map((node) => ({
      node,
      files: this.getSortedFiles(tree.descendantFilesByFolderId.get(node.id) ?? [])
    })).filter((group) => group.files.length > 0);
  }
  shouldVirtualizeList(files) {
    return this.plugin.settings.noteDisplayMode === "list" && files.length >= LIST_VIRTUALIZATION_THRESHOLD;
  }
  renderVirtualizedFileList(containerEl, files, sourceAssignmentValue, displayPrefix, initialScrollTop) {
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
        this.renderFileRow(windowEl, files[index], sourceAssignmentValue, displayPrefix, index);
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
  renderFileRow(containerEl, file, sourceAssignmentValue, displayPrefix, rowIndex) {
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
    this.renderFileActionButton(rowEl, file);
    this.attachFileInteractions(rowEl, file);
    this.attachFileDragSource(rowEl, file, sourceAssignmentValue);
  }
  renderFileCard(containerEl, file, sourceAssignmentValue, displayPrefix) {
    const cardEl = containerEl.createEl("button", {
      cls: "virtual-tree-file-card",
      attr: {
        type: "button",
        draggable: "true"
      }
    });
    cardEl.dataset.filePath = file.path;
    if (this.isFileSelected(file)) {
      cardEl.addClass("is-selected");
    }
    cardEl.createDiv({ cls: "virtual-tree-file-title", text: this.getDisplayedFileTitle(file, displayPrefix) });
    if (this.plugin.settings.showPath) {
      cardEl.createDiv({ cls: "virtual-tree-file-path", text: file.path });
    }
    this.renderFileActionButton(cardEl, file);
    this.attachFileInteractions(cardEl, file);
    this.attachFileDragSource(cardEl, file, sourceAssignmentValue);
  }
  renderFileActionButton(containerEl, file) {
    if (!import_obsidian2.Platform.isMobile) {
      return;
    }
    const actionButtonEl = containerEl.createEl("button", {
      cls: "clickable-icon virtual-tree-file-action-button",
      attr: {
        "aria-label": `Open note actions for ${file.basename}`,
        type: "button"
      }
    });
    (0, import_obsidian2.setIcon)(actionButtonEl, "ellipsis");
    actionButtonEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openFileMenuAtElement(actionButtonEl, file);
    });
  }
  attachFileDragSource(element, file, sourceAssignmentValue) {
    element.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      const selectedFilePaths = this.selectedNotePaths.has(file.path) ? this.currentContentFilePaths.filter((filePath) => this.selectedNotePaths.has(filePath)) : [];
      const draggedFilePaths = selectedFilePaths.length > 1 ? selectedFilePaths : [file.path];
      const payload = {
        filePath: file.path,
        filePaths: draggedFilePaths,
        sourceAssignmentValue,
        isAdditive: draggedFilePaths.length > 1
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
  setCurrentContentFiles(files) {
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
  isFileSelected(file) {
    return this.selectedNotePaths.has(file.path);
  }
  handleSelectionClick(file, event) {
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
  selectFileRange(targetFilePath) {
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
    const [startIndex, endIndex] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    this.selectedNotePaths.clear();
    this.currentContentFilePaths.slice(startIndex, endIndex + 1).forEach((filePath) => {
      this.selectedNotePaths.add(filePath);
    });
  }
  getSelectedFiles() {
    if (this.selectedNotePaths.size === 0) {
      return [];
    }
    const filesByPath = new Map(this.getTree().allFiles.map((file) => [file.path, file]));
    return this.currentContentFilePaths.filter((filePath) => this.selectedNotePaths.has(filePath)).map((filePath) => filesByPath.get(filePath) ?? null).filter((file) => file instanceof import_obsidian2.TFile);
  }
  getFilesForCategoryAction(file) {
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.some((selectedFile) => selectedFile.path === file.path)) {
      return selectedFiles;
    }
    return [file];
  }
  openAssignCategoriesModal(files) {
    if (files.length === 0) {
      return;
    }
    const categoryOptions = this.collectCategoryAssignmentOptions();
    if (categoryOptions.length === 0) {
      new import_obsidian2.Notice("No categories are available yet.");
      return;
    }
    new AssignCategoriesModal(this.app, files, categoryOptions, async (assignmentValues) => {
      await this.assignFilesToCategories(files, assignmentValues);
    }).open();
  }
  async assignFilesToCategories(files, assignmentValues) {
    const normalizedValues = [...new Set(
      assignmentValues.map((value) => this.canonicalizeAssignmentValue(value)).filter((value) => value.length > 0)
    )];
    if (normalizedValues.length === 0) {
      return;
    }
    const previousViewKey = this.getCurrentViewKey();
    this.prepareForContentMutation(files, files.map((file) => file.path));
    const failedFiles = [];
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
      new import_obsidian2.Notice(`Could not assign categories. ${failedFiles.length} note${failedFiles.length === 1 ? "" : "s"} failed.`);
      return;
    }
    if (failedFiles.length > 0) {
      const firstFailedPath = failedFiles[0]?.split("/").pop() ?? failedFiles[0];
      new import_obsidian2.Notice(
        `Assigned categories to ${updatedFileCount} note${updatedFileCount === 1 ? "" : "s"}. ${failedFiles.length} failed, starting with ${firstFailedPath}.`,
        1e4
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
  collectCategoryAssignmentOptions() {
    const options = [...this.getTree().folderLookup.values()].filter((node) => node.id !== ROOT_FOLDER_ID && node.id !== UNCATEGORIZED_FOLDER_ID).map((node) => {
      const assignmentValue = this.getAssignmentValueForNode(node);
      if (!assignmentValue) {
        return null;
      }
      return {
        label: node.id,
        assignmentValue
      };
    }).filter((option) => option !== null).sort((left, right) => left.label.localeCompare(right.label, void 0, { sensitivity: "base" }));
    const seenAssignmentValues = /* @__PURE__ */ new Set();
    return options.filter((option) => {
      if (seenAssignmentValues.has(option.assignmentValue)) {
        return false;
      }
      seenAssignmentValues.add(option.assignmentValue);
      return true;
    });
  }
  getAssignmentValueForNode(node) {
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
  canonicalizeAssignmentValue(assignmentValue, fallbackLabel) {
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
    const categoryLabel = fallbackLabel ?? cleanupCategoryLabel2(targetPart);
    const categoryFile = this.findCategoryFileByLabel(categoryLabel);
    return categoryFile ? `[[${categoryFile.basename}]]` : trimmedValue;
  }
  findCategoryFileByLabel(label) {
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
      const candidateLabel = typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0 ? frontmatterTitle.trim() : cleanupCategoryLabel2(file.basename);
      if (candidateLabel.toLocaleLowerCase() === normalizedLabel) {
        return file;
      }
    }
    return null;
  }
  async updateFileCategories(file, updater) {
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
  getSortedFiles(files) {
    const sortedFiles = sortFilesForDisplay(files, this.plugin.settings, this.app);
    return this.applyPendingContentOrderOverride(sortedFiles);
  }
  updateSelectionUi() {
    if (!this.contentPaneEl) {
      return;
    }
    this.contentPaneEl.querySelectorAll(".virtual-tree-file-row[data-file-path], .virtual-tree-file-card[data-file-path]").forEach((element) => {
      const filePath = element.dataset.filePath;
      if (!filePath) {
        return;
      }
      element.toggleClass("is-selected", this.selectedNotePaths.has(filePath));
    });
    const controlsContainerEl = this.contentPaneEl.querySelector(".virtual-tree-content-selection-controls");
    if (controlsContainerEl) {
      this.renderSelectionControls(controlsContainerEl);
    }
  }
  renderSelectionControls(containerEl) {
    containerEl.empty();
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.length === 0) {
      return;
    }
    containerEl.createSpan({
      cls: "virtual-tree-content-selection-count",
      text: `${selectedFiles.length} selected`
    });
    const assignCategoriesButtonEl = containerEl.createEl("button", {
      cls: "mod-cta virtual-tree-content-selection-action",
      text: "Assign categories",
      attr: {
        type: "button"
      }
    });
    assignCategoriesButtonEl.addEventListener("click", () => {
      this.openAssignCategoriesModal(selectedFiles);
    });
    const clearSelectionButtonEl = containerEl.createEl("button", {
      cls: "virtual-tree-content-selection-action",
      text: "Clear",
      attr: {
        type: "button"
      }
    });
    clearSelectionButtonEl.addEventListener("click", () => {
      this.selectedNotePaths.clear();
      this.selectionAnchorFilePath = null;
      this.updateSelectionUi();
    });
  }
  renderContentHeader(containerEl, title, noteCountLabel) {
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: title });
    this.renderMobilePaneSwitch(headerEl, "notes");
    const headerMetaEl = headerEl.createDiv({ cls: "virtual-tree-content-header-meta" });
    headerMetaEl.createSpan({
      cls: "virtual-tree-content-count",
      text: noteCountLabel
    });
    const currentCategoryNode = this.getCurrentCategoryNode();
    if (currentCategoryNode) {
      const createNoteButtonEl = headerMetaEl.createEl("button", {
        cls: "mod-cta virtual-tree-content-create-note",
        attr: {
          "aria-label": `Create a note in ${currentCategoryNode.name}`,
          type: "button"
        },
        text: "Create note"
      });
      createNoteButtonEl.addEventListener("click", () => {
        void this.createNoteForCurrentCategory(currentCategoryNode);
      });
    }
    const selectionControlsEl = headerMetaEl.createDiv({ cls: "virtual-tree-content-selection-controls" });
    this.renderSelectionControls(selectionControlsEl);
    const sortControlsEl = headerMetaEl.createDiv({ cls: "virtual-tree-content-sort-controls" });
    const sortModeSelectEl = sortControlsEl.createEl("select", {
      cls: "dropdown virtual-tree-content-sort-select",
      attr: {
        "aria-label": "Sort notes by"
      }
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
        noteSortMode: nextMode
      });
    });
    const sortDirectionButtonEl = sortControlsEl.createEl("button", {
      cls: "mod-muted virtual-tree-content-sort-direction",
      attr: {
        "aria-label": this.plugin.settings.noteSortDirection === "asc" ? "Sort ascending" : "Sort descending",
        type: "button"
      },
      text: this.plugin.settings.noteSortDirection === "asc" ? "Asc" : "Desc"
    });
    sortDirectionButtonEl.addEventListener("click", () => {
      void this.plugin.savePluginSettings({
        ...this.plugin.settings,
        noteSortDirection: this.plugin.settings.noteSortDirection === "asc" ? "desc" : "asc"
      });
    });
    if (this.plugin.settings.noteSortMode === "property") {
      const sortPropertyInputEl = sortControlsEl.createEl("input", {
        cls: "virtual-tree-content-sort-property",
        attr: {
          "aria-label": "Frontmatter property to sort by",
          placeholder: "property",
          type: "text"
        },
        value: this.plugin.settings.noteSortProperty
      });
      sortPropertyInputEl.addEventListener("blur", () => {
        void this.plugin.savePluginSettings({
          ...this.plugin.settings,
          noteSortProperty: sortPropertyInputEl.value.trim()
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
      cls: "virtual-tree-content-filename-toggle"
    });
    const filenameToggleInputEl = filenameToggleLabelEl.createEl("input", {
      attr: {
        "aria-label": "Show real filename",
        type: "checkbox"
      }
    });
    filenameToggleInputEl.checked = this.plugin.settings.showRealFilename;
    filenameToggleInputEl.addEventListener("change", () => {
      void this.plugin.savePluginSettings({
        ...this.plugin.settings,
        showRealFilename: filenameToggleInputEl.checked
      });
    });
    filenameToggleLabelEl.createSpan({ text: "Show real filename" });
  }
  getDisplayedFileTitle(file, displayPrefix) {
    if (this.plugin.settings.showRealFilename) {
      return file.basename;
    }
    const normalizedPrefix = displayPrefix?.trim() ?? "";
    if (normalizedPrefix.length === 0) {
      return file.basename;
    }
    return stripCaseInsensitivePrefix(file.basename, `${normalizedPrefix} - `);
  }
  getCurrentCategoryNode() {
    if (this.selectedSectionId !== null) {
      return null;
    }
    const node = this.getTree().folderLookup.get(this.selectedFolderId) ?? null;
    if (!node || !node.assignmentValue || node.id === ROOT_FOLDER_ID || node.id === UNCATEGORIZED_FOLDER_ID) {
      return null;
    }
    return node;
  }
  async createNoteForCurrentCategory(node) {
    const assignmentValue = this.getAssignmentValueForNode(node);
    if (!assignmentValue) {
      new import_obsidian2.Notice(`Could not resolve the category link for ${node.name}.`);
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    const parentFolder = this.app.fileManager.getNewFileParent(activeFile?.path ?? "", `${node.name} - untitled.md`);
    const baseName = `${node.name} - untitled`;
    const filePath = this.getAvailableMarkdownPath(parentFolder.path, baseName);
    const file = await this.app.vault.create(filePath, this.buildNewCategoryNoteContent(assignmentValue, baseName));
    this.autoRefreshSuppression = null;
    await this.app.workspace.getLeaf(false).openFile(file);
  }
  getAvailableMarkdownPath(parentPath, baseName) {
    const normalizedParentPath = parentPath === "/" ? "" : parentPath;
    const sanitizedBaseName = sanitizeFileBasename(baseName);
    let attempt = 1;
    while (true) {
      const candidateBaseName = attempt === 1 ? sanitizedBaseName : `${sanitizedBaseName} ${attempt}`;
      const candidatePath = (0, import_obsidian2.normalizePath)(
        normalizedParentPath.length > 0 ? `${normalizedParentPath}/${candidateBaseName}.md` : `${candidateBaseName}.md`
      );
      if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }
      attempt += 1;
    }
  }
  buildNewCategoryNoteContent(assignmentValue, title) {
    return `---
${this.plugin.settings.frontmatterKey}:
  - "${escapeYamlDoubleQuotedString(assignmentValue)}"
title: "${escapeYamlDoubleQuotedString(title)}"
---

`;
  }
  openFileMenu(event, file) {
    this.createFileMenu(file).showAtMouseEvent(event);
  }
  openFileMenuAtElement(element, file) {
    const rect = element.getBoundingClientRect();
    this.createFileMenu(file).showAtPosition({
      x: rect.right,
      y: rect.bottom
    }, element.ownerDocument);
  }
  createFileMenu(file) {
    const categoryActionFiles = this.getFilesForCategoryAction(file);
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
    menu.addItem((item) => {
      item.setTitle(categoryActionFiles.length > 1 ? "Assign categories to selected notes" : "Assign categories").setIcon("tags").onClick(() => {
        this.openAssignCategoriesModal(categoryActionFiles);
      });
    });
    return menu;
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
  openSectionMenu(event, section) {
    if (section.isUngrouped) {
      return;
    }
    const menu = new import_obsidian2.Menu();
    menu.addItem((item) => {
      item.setTitle("Rename section").setIcon("pencil").onClick(() => {
        new EditSectionTitleModal(this.app, section.title, async (nextTitle) => {
          await this.updateSectionTitleFromInput(section.id, nextTitle);
        }).open();
      });
    });
    menu.showAtMouseEvent(event);
  }
  async toggleOrganizeFolderSections() {
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
        sectionOrder: [...this.plugin.settings.sectionOrder, createSectionTitle(this.plugin.settings.sectionOrder)]
      });
    }
    this.isOrganizingFolderSections = true;
    this.render("sidebar");
  }
  async addFolderSection() {
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: [...this.plugin.settings.sectionOrder, createSectionTitle(this.plugin.settings.sectionOrder)]
    });
    this.render("sidebar");
  }
  async deleteFolderSection(sectionId) {
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
      sectionOrder: this.plugin.settings.sectionOrder.filter((title) => !isSameSectionLabel(title, section.title))
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
  async updateSectionTitleFromInput(sectionId, nextTitle) {
    const tree = this.getTree();
    const section = this.getSidebarFolderSections(tree).find((entry) => entry.id === sectionId && !entry.isUngrouped);
    if (!section) {
      return;
    }
    const trimmedTitle = normalizeSectionTitle(nextTitle);
    if (!trimmedTitle) {
      new import_obsidian2.Notice("Section names cannot be empty.");
      this.render("sidebar");
      return;
    }
    const hasDuplicate = this.getSidebarFolderSections(tree).some((entry) => {
      return !entry.isUngrouped && entry.id !== section.id && isSameSectionLabel(entry.title, trimmedTitle);
    });
    if (hasDuplicate) {
      new import_obsidian2.Notice("Section names must be unique.");
      this.render("sidebar");
      return;
    }
    if (isSameSectionLabel(section.title, trimmedTitle)) {
      if (section.title !== trimmedTitle) {
        await this.plugin.savePluginSettings({
          ...this.plugin.settings,
          sectionOrder: renameSectionInOrder(this.plugin.settings.sectionOrder, section.title, trimmedTitle)
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
      sectionOrder: renameSectionInOrder(this.plugin.settings.sectionOrder, section.title, trimmedTitle)
    });
    this.isTreeDirty = true;
    this.selectedSectionId = trimmedTitle;
    this.render("sidebar");
  }
  async moveFolderToSection(folderId, targetSectionId) {
    const tree = this.getTree();
    const node = tree.folderLookup.get(folderId);
    if (!node) {
      return;
    }
    const targetSection = targetSectionId === null ? null : this.getSidebarFolderSections(tree).find((section) => section.id === targetSectionId && !section.isUngrouped) ?? null;
    await this.updateNodeSection(node, targetSection?.title ?? null);
    const targetFolderIds = targetSection ? targetSection.folderNodes.map((folderNode) => folderNode.id) : this.getSidebarFolderSections(tree).find((section) => section.isUngrouped)?.folderNodes.map((folderNode) => folderNode.id) ?? [];
    const nextFolderOrder = appendFolderToOrderedGroup(this.getOrderedTopLevelFolderIds(tree), folderId, targetFolderIds);
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: targetSection ? ensureSectionInOrder(this.plugin.settings.sectionOrder, targetSection.title) : this.plugin.settings.sectionOrder,
      folderOrder: nextFolderOrder
    });
    this.isTreeDirty = true;
    this.preserveSidebarScrollForNextRender();
    this.render("all");
  }
  async reorderFolderWithinSections(draggedFolderId, targetFolderId) {
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
      sectionOrder: targetNode.section ? ensureSectionInOrder(this.plugin.settings.sectionOrder, targetNode.section) : this.plugin.settings.sectionOrder,
      folderOrder: nextFolderOrder
    });
    this.isTreeDirty = true;
    this.preserveSidebarScrollForNextRender();
    this.render("all");
  }
  async reorderFolderSections(draggedSectionId, targetSectionId) {
    if (draggedSectionId === targetSectionId) {
      return;
    }
    const ordered = this.getSidebarFolderSections(this.getTree()).filter((section) => !section.isUngrouped).map((section) => section.title);
    const fromIndex = ordered.findIndex((title) => isSameSectionLabel(title, draggedSectionId));
    const toIndex = ordered.findIndex((title) => isSameSectionLabel(title, targetSectionId));
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const [removed] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, removed);
    await this.plugin.savePluginSettings({
      ...this.plugin.settings,
      sectionOrder: ordered
    });
    this.preserveSidebarScrollForNextRender();
    this.render("sidebar");
  }
  getSidebarFolderSections(tree) {
    return buildSidebarFolderSections(tree.root.sortedChildren, this.plugin.settings.sectionOrder, this.plugin.settings.folderOrder);
  }
  getOrderedTopLevelFolderIds(tree) {
    return orderTopLevelNodes(tree.root.sortedChildren, this.plugin.settings.folderOrder).filter((node) => node.id !== UNCATEGORIZED_FOLDER_ID).map((node) => node.id);
  }
  preserveSidebarScrollForNextRender() {
    this.pendingSidebarScrollTop = this.sidebarPaneEl?.scrollTop ?? null;
  }
  isMobilePaneLayout() {
    return window.matchMedia("(max-width: 700px)").matches;
  }
  syncMobilePaneLayout() {
    const isMobileLayout = this.isMobilePaneLayout();
    this.contentEl.toggleClass("is-mobile-pane-layout", isMobileLayout);
    this.contentEl.toggleClass("is-mobile-show-folders", isMobileLayout && this.mobileActivePane === "folders");
    this.contentEl.toggleClass("is-mobile-show-notes", isMobileLayout && this.mobileActivePane === "notes");
  }
  setMobileActivePane(nextPane) {
    if (this.mobileActivePane === nextPane) {
      return;
    }
    this.mobileActivePane = nextPane;
    this.syncMobilePaneLayout();
  }
  showMobileNotesPane() {
    if (!this.isMobilePaneLayout()) {
      return;
    }
    this.setMobileActivePane("notes");
  }
  renderMobilePaneSwitch(containerEl, activePane) {
    const switchEl = containerEl.createDiv({ cls: "virtual-tree-mobile-pane-switch" });
    this.createMobilePaneSwitchButton(switchEl, "folders", activePane, "Folders");
    this.createMobilePaneSwitchButton(switchEl, "notes", activePane, "Notes");
  }
  createMobilePaneSwitchButton(containerEl, pane, activePane, label) {
    const buttonEl = containerEl.createEl("button", {
      cls: pane === activePane ? "virtual-tree-mobile-pane-button is-active" : "virtual-tree-mobile-pane-button",
      attr: {
        "aria-label": `Show ${label.toLocaleLowerCase()} pane`,
        type: "button"
      },
      text: label
    });
    buttonEl.addEventListener("click", () => {
      this.setMobileActivePane(pane);
      this.render("all");
    });
  }
  getCurrentViewKey() {
    return this.selectedSectionId ? `section:${this.selectedSectionId}` : `folder:${this.selectedFolderId}`;
  }
  getAbstractFilePath(file) {
    return file.path;
  }
  suppressAutoRefreshForPaths(filePaths) {
    const normalizedPaths = [...new Set(filePaths.filter((filePath) => filePath.length > 0))];
    if (normalizedPaths.length === 0) {
      return;
    }
    this.autoRefreshSuppression = {
      expiresAt: window.performance.now() + AUTO_REFRESH_SUPPRESSION_MS,
      filePaths: new Set(normalizedPaths)
    };
  }
  shouldIgnoreAutoRefresh(filePath) {
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
  shouldStabilizeCurrentContentOrder() {
    return this.selectedSectionId === null && this.plugin.settings.noteSortMode === "modified";
  }
  capturePendingContentOrderOverride() {
    if (!this.shouldStabilizeCurrentContentOrder()) {
      this.pendingContentOrderOverride = null;
      return;
    }
    this.pendingContentOrderOverride = {
      viewKey: this.getCurrentViewKey(),
      orderedFilePaths: [...this.currentContentFilePaths],
      expiresAt: window.performance.now() + CONTENT_ORDER_OVERRIDE_MS
    };
  }
  applyPendingContentOrderOverride(files) {
    const override = this.pendingContentOrderOverride;
    if (!override) {
      return files;
    }
    if (!this.shouldStabilizeCurrentContentOrder() || override.viewKey !== this.getCurrentViewKey() || window.performance.now() > override.expiresAt) {
      this.pendingContentOrderOverride = null;
      return files;
    }
    return reorderFilesByPaths(files, override.orderedFilePaths);
  }
  prepareForContentMutation(files, excludedFilePaths) {
    this.preserveContentScrollAnchorForNextRender(excludedFilePaths);
    this.suppressAutoRefreshForPaths(files.map((file) => file.path));
    this.capturePendingContentOrderOverride();
  }
  preserveContentScrollAnchorForNextRender(excludedFilePaths = []) {
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
    const candidateElements = this.contentPaneEl.querySelectorAll(
      ".virtual-tree-file-row[data-file-path], .virtual-tree-file-card[data-file-path]"
    );
    let anchorFilePath = null;
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
      estimatedRowHeight: null
    };
  }
  createFixedRowContentScrollAnchor(excludedPaths) {
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
        estimatedRowHeight: rowHeight
      };
    }
    const firstVisibleIndex = clampIndex(
      Math.floor(scrollTop / rowHeight),
      currentFilePaths.length
    );
    const anchorIndex = this.findNextAnchorIndex(currentFilePaths, excludedPaths, firstVisibleIndex);
    if (anchorIndex < 0) {
      return {
        filePath: null,
        offsetTop: 0,
        fallbackScrollTop: scrollTop,
        estimatedRowHeight: rowHeight
      };
    }
    return {
      filePath: currentFilePaths[anchorIndex] ?? null,
      offsetTop: anchorIndex * rowHeight - scrollTop,
      fallbackScrollTop: scrollTop,
      estimatedRowHeight: rowHeight
    };
  }
  findNextAnchorIndex(filePaths, excludedPaths, startIndex) {
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
  restorePendingContentScrollAnchor() {
    const anchor = this.pendingContentScrollAnchor;
    this.pendingContentScrollAnchor = null;
    if (!anchor || !this.contentPaneEl || !this.contentScrollEl) {
      return;
    }
    const applyAnchor = () => {
      if (!this.contentPaneEl || !this.contentScrollEl) {
        return;
      }
      if (!anchor.filePath) {
        this.contentScrollEl.scrollTop = anchor.fallbackScrollTop;
        return;
      }
      const selector = `[data-file-path="${escapeAttributeValue(anchor.filePath)}"]`;
      const anchorEl = this.contentPaneEl.querySelector(selector);
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
  async updateNodeSection(node, nextSectionTitle) {
    const categoryFile = this.resolveCategoryFile(node);
    if (!categoryFile) {
      new import_obsidian2.Notice(`Unable to update the section for ${node.name} because it is not backed by a category note.`);
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
  attachSectionDropTarget(sectionEl, section, allowSectionReorder) {
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
    const onDrop = (event) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return;
      }
      const eventTarget = event.target;
      const hoveredFolderItem = eventTarget instanceof HTMLElement ? eventTarget.closest(".virtual-tree-folder-item[data-folder-id]") : null;
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
  attachFolderSectionDrag(element, folderId) {
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
      this.clearActiveFolderOrganizeTarget();
    });
  }
  attachFolderOrganizeDropTarget(rowEl, targetFolderId) {
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
  setActiveFolderOrganizeTarget(nextTarget) {
    if (this.activeFolderOrganizeTargetEl === nextTarget) {
      return;
    }
    this.clearActiveFolderOrganizeTarget();
    this.activeFolderOrganizeTargetEl = nextTarget;
    nextTarget.addClass("is-folder-organize-target");
  }
  clearActiveFolderOrganizeTarget() {
    if (!this.activeFolderOrganizeTargetEl) {
      return;
    }
    this.activeFolderOrganizeTargetEl.removeClass("is-folder-organize-target");
    this.activeFolderOrganizeTargetEl = null;
  }
  async renameFileWithObsidianCommand(file) {
    const targetLeaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await targetLeaf.openFile(file);
    const commandApp = this.app;
    commandApp.commands.executeCommandById("workspace:edit-file-title");
  }
  async assignFileToCategory(file, node, sourceAssignmentValue) {
    const targetAssignmentValue = this.getAssignmentValueForNode(node);
    if (!targetAssignmentValue) {
      return;
    }
    const previousViewKey = this.getCurrentViewKey();
    this.prepareForContentMutation([file], [file.path]);
    await this.updateFileCategories(file, (existingValues) => {
      const filteredValues = sourceAssignmentValue && sourceAssignmentValue !== targetAssignmentValue ? existingValues.filter((value) => value !== sourceAssignmentValue) : [...existingValues];
      return filteredValues.includes(targetAssignmentValue) ? filteredValues : [...filteredValues, targetAssignmentValue];
    });
    const shouldStayOnUncategorized = this.selectedSectionId === null && this.selectedFolderId === UNCATEGORIZED_FOLDER_ID;
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
  resolveDraggedFiles(payload) {
    const filesByPath = new Map(this.getTree().allFiles.map((file) => [file.path, file]));
    return uniqueFilePathsFromPayload(payload).map((filePath) => filesByPath.get(filePath) ?? null).filter((file) => file instanceof import_obsidian2.TFile);
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
  canDragFolderBetweenSections(node) {
    if (node.depth !== 1) {
      return false;
    }
    if (!this.resolveCategoryFile(node)) {
      return false;
    }
    return this.getSidebarFolderSections(this.getTree()).some((section) => !section.isUngrouped);
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
var EditSectionTitleModal = class extends import_obsidian2.Modal {
  constructor(app, initialValue, onSubmit) {
    super(app);
    this.isSubmitting = false;
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("virtual-tree-edit-title-modal");
    contentEl.createEl("h2", { text: "Rename section" });
    contentEl.createEl("p", {
      cls: "virtual-tree-edit-title-hint",
      text: "Update the section label for every category grouped under it."
    });
    const formEl = contentEl.createDiv({ cls: "virtual-tree-edit-title-form" });
    const inputEl = formEl.createEl("input", {
      cls: "virtual-tree-edit-title-input",
      attr: {
        placeholder: "Section name",
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
    window.setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AssignCategoriesModal = class extends import_obsidian2.Modal {
  constructor(app, files, categoryOptions, onSubmit) {
    super(app);
    this.selectedAssignmentValues = /* @__PURE__ */ new Set();
    this.filterValue = "";
    this.activeIndex = 0;
    this.isSubmitting = false;
    this.files = files;
    this.categoryOptions = categoryOptions;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("virtual-tree-assign-categories-modal-shell");
    contentEl.addClass("virtual-tree-assign-categories-modal");
    const headerEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-header" });
    headerEl.createEl("h2", {
      text: this.files.length === 1 ? "Assign category" : `Assign categories to ${this.files.length} notes`
    });
    headerEl.createSpan({
      cls: "virtual-tree-category-palette-count",
      text: `${this.categoryOptions.length} categories`
    });
    const filterInputEl = contentEl.createEl("input", {
      cls: "virtual-tree-category-palette-input",
      attr: {
        placeholder: "Type to filter categories...",
        type: "text"
      }
    });
    const selectedEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-selected" });
    const optionsEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-results" });
    const footerEl = contentEl.createDiv({ cls: "virtual-tree-category-palette-footer" });
    footerEl.createSpan({
      cls: "virtual-tree-category-palette-hint",
      text: "Up/Down move, Enter toggle, Cmd/Ctrl+Enter assign"
    });
    const saveButtonEl = footerEl.createEl("button", {
      cls: "mod-cta virtual-tree-category-palette-submit",
      text: "Assign selected",
      attr: { type: "button" }
    });
    const getVisibleOptions = () => {
      const normalizedFilter = this.filterValue.trim().toLocaleLowerCase();
      return this.categoryOptions.filter((option) => {
        return normalizedFilter.length === 0 || option.label.toLocaleLowerCase().includes(normalizedFilter);
      });
    };
    const renderSelected = () => {
      selectedEl.empty();
      const selectedOptions = this.categoryOptions.filter((option) => this.selectedAssignmentValues.has(option.assignmentValue));
      if (selectedOptions.length === 0) {
        selectedEl.addClass("is-empty");
        selectedEl.createSpan({
          cls: "virtual-tree-category-palette-empty",
          text: "No categories selected"
        });
      } else {
        selectedEl.removeClass("is-empty");
        selectedOptions.forEach((option) => {
          const chipEl = selectedEl.createEl("button", {
            cls: "virtual-tree-category-palette-chip",
            text: option.label,
            attr: {
              type: "button"
            }
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
    const renderOptions = () => {
      optionsEl.empty();
      const visibleOptions = getVisibleOptions();
      this.activeIndex = clampIndex(this.activeIndex, visibleOptions.length);
      if (visibleOptions.length === 0) {
        optionsEl.createDiv({
          cls: "virtual-tree-category-palette-empty-state",
          text: "No categories match this filter."
        });
        return;
      }
      visibleOptions.forEach((option, index) => {
        const optionEl = optionsEl.createEl("button", {
          cls: "virtual-tree-category-palette-option",
          attr: {
            type: "button"
          }
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
          text: this.selectedAssignmentValues.has(option.assignmentValue) ? "Selected" : "Add"
        });
        optionEl.addEventListener("click", () => {
          toggleOption(option.assignmentValue);
          this.activeIndex = index;
          renderSelected();
          renderOptions();
          filterInputEl.focus();
        });
      });
      const activeOptionEl = optionsEl.querySelector(".virtual-tree-category-palette-option.is-active");
      activeOptionEl?.scrollIntoView({ block: "nearest" });
    };
    const toggleOption = (assignmentValue) => {
      if (this.selectedAssignmentValues.has(assignmentValue)) {
        this.selectedAssignmentValues.delete(assignmentValue);
      } else {
        this.selectedAssignmentValues.add(assignmentValue);
      }
    };
    const submit = async () => {
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
  onClose() {
    this.modalEl.removeClass("virtual-tree-assign-categories-modal-shell");
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
function readRawFrontmatterCategoryValues(content, key) {
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
  const values = [];
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
function writeRawFrontmatterCategoryValues(content, key, values) {
  const fieldLines = serializeFrontmatterArrayField(key, values);
  const frontmatterRange = findFrontmatterRange(content);
  if (!frontmatterRange) {
    const normalizedContent = content.length > 0 && !content.startsWith("\n") ? `
${content}` : content;
    return `---
${fieldLines.join("\n")}
---${normalizedContent}`;
  }
  const beforeFrontmatter = content.slice(0, frontmatterRange.start);
  const frontmatterLines = content.slice(frontmatterRange.start, frontmatterRange.end).split("\n");
  const afterFrontmatter = content.slice(frontmatterRange.end);
  const fieldRange = findFrontmatterFieldRange(frontmatterLines, key);
  const nextFrontmatterLines = fieldRange ? [
    ...frontmatterLines.slice(0, fieldRange.startIndex),
    ...fieldLines,
    ...frontmatterLines.slice(fieldRange.endIndex)
  ] : [...frontmatterLines, ...fieldLines];
  return `${beforeFrontmatter}---
${nextFrontmatterLines.join("\n")}
---${afterFrontmatter}`;
}
function findFrontmatterRange(content) {
  if (!content.startsWith("---\n")) {
    return null;
  }
  const closingDelimiterIndex = content.indexOf("\n---", 4);
  if (closingDelimiterIndex < 0) {
    return null;
  }
  return {
    start: 4,
    end: closingDelimiterIndex
  };
}
function findFrontmatterFieldRange(frontmatterLines, key) {
  const fieldPattern = new RegExp(`^${escapeRegExp(key)}s*:`);
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
function serializeFrontmatterArrayField(key, values) {
  if (values.length === 0) {
    return [`${key}: []`];
  }
  return [
    `${key}:`,
    ...values.map((value) => `  - ${JSON.stringify(value)}`)
  ];
}
function parseYamlScalar(value) {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }
  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    try {
      const parsedValue = JSON.parse(trimmedValue);
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
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function escapeAttributeValue(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}
function buildSidebarFolderSections(topLevelNodes, sectionOrder, folderOrder) {
  const orderedTopLevelNodes = orderTopLevelNodes(topLevelNodes, folderOrder);
  const sectionsByKey = /* @__PURE__ */ new Map();
  const orderedKeys = [];
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
      isUngrouped: false
    });
    orderedKeys.push(sectionKey);
  }
  const ungroupedNodes = [];
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
      isUngrouped: false
    });
    orderedKeys.push(sectionKey);
  }
  const sections = [];
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
      isUngrouped: true
    });
  }
  return sections;
}
function orderTopLevelNodes(topLevelNodes, folderOrder) {
  const orderLookup = /* @__PURE__ */ new Map();
  folderOrder.forEach((folderId, index) => {
    if (!orderLookup.has(folderId)) {
      orderLookup.set(folderId, index);
    }
  });
  return [...topLevelNodes].sort((left, right) => {
    const leftIndex = orderLookup.get(left.id);
    const rightIndex = orderLookup.get(right.id);
    if (leftIndex !== void 0 && rightIndex !== void 0) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== void 0) {
      return -1;
    }
    if (rightIndex !== void 0) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}
function appendFolderToOrderedGroup(orderedFolderIds, draggedFolderId, targetGroupFolderIds) {
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
function moveFolderBeforeTarget(orderedFolderIds, draggedFolderId, targetFolderId) {
  const remainingFolderIds = orderedFolderIds.filter((folderId) => folderId !== draggedFolderId);
  const targetIndex = remainingFolderIds.indexOf(targetFolderId);
  if (targetIndex < 0) {
    return [...remainingFolderIds, draggedFolderId];
  }
  remainingFolderIds.splice(targetIndex, 0, draggedFolderId);
  return remainingFolderIds;
}
function normalizeSectionTitle(value) {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}
function normalizeOptionalSectionTitle(value) {
  if (value === null) {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}
function normalizeSectionKey(value) {
  return value.toLocaleLowerCase();
}
function isSameSectionLabel(left, right) {
  return normalizeSectionKey(left) === normalizeSectionKey(right);
}
function ensureSectionInOrder(sectionOrder, sectionTitle) {
  if (sectionOrder.some((title) => isSameSectionLabel(title, sectionTitle))) {
    return sectionOrder;
  }
  return [...sectionOrder, sectionTitle];
}
function renameSectionInOrder(sectionOrder, currentTitle, nextTitle) {
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
function createSectionTitle(sectionOrder) {
  let index = 1;
  while (sectionOrder.some((title) => isSameSectionLabel(title, `Section ${index}`))) {
    index += 1;
  }
  return `Section ${index}`;
}
function countUniqueFiles(groups) {
  return new Set(groups.flatMap((group) => group.files.map((file) => file.path))).size;
}
function cleanupCategoryLabel2(label) {
  return label.replace(/^category\s*-\s*/iu, "").trim();
}
function uniqueFilePaths(files) {
  return [...new Set(files.map((file) => file.path))];
}
function sanitizeFileBasename(value) {
  const sanitizedValue = value.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  return sanitizedValue.length > 0 ? sanitizedValue : "untitled";
}
function escapeYamlDoubleQuotedString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function clampIndex(index, length) {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, length - 1));
}
function mergeRenderScope(currentScope, nextScope) {
  if (currentScope === "all" || nextScope === "all") {
    return "all";
  }
  return currentScope ?? nextScope;
}
function reorderFilesByPaths(files, orderedFilePaths) {
  if (files.length <= 1 || orderedFilePaths.length === 0) {
    return files;
  }
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const reorderedFiles = [];
  const seenPaths = /* @__PURE__ */ new Set();
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
function uniqueFilePathsFromPayload(payload) {
  const candidatePaths = payload.filePaths.length > 0 ? payload.filePaths : [payload.filePath];
  return [...new Set(candidatePaths)];
}
function addSelectOption(selectEl, value, label) {
  const optionEl = selectEl.createEl("option", { text: label });
  optionEl.value = value;
}
function parseNoteSortMode(value) {
  return value === "created" || value === "title" || value === "property" ? value : "modified";
}
function sortFilesForDisplay(files, settings, app) {
  return [...files].sort((left, right) => compareFilesForDisplay(left, right, settings, app));
}
function compareFilesForDisplay(left, right, settings, app) {
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
      comparison = propertyName.length > 0 ? compareSortValues(
        readSortableFrontmatterValue(left, propertyName, app),
        readSortableFrontmatterValue(right, propertyName, app)
      ) : 0;
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
function readSortableFrontmatterValue(file, propertyName, app) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return normalizeSortableValue(frontmatter?.[propertyName]);
}
function normalizeSortableValue(value) {
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
  const normalizedEntries = value.map((entry) => normalizeSortableValue(entry)).filter((entry) => entry !== null);
  if (normalizedEntries.length === 0) {
    return null;
  }
  return normalizedEntries.map((entry) => `${entry}`).join(", ");
}
function compareSortValues(left, right) {
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
function comparePrimitiveValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return `${left}`.localeCompare(`${right}`, void 0, {
    numeric: true,
    sensitivity: "base"
  });
}
function stripCaseInsensitivePrefix(value, prefix) {
  if (!value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return value;
  }
  const strippedValue = value.slice(prefix.length).trim();
  return strippedValue.length > 0 ? strippedValue : value;
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
    filePaths: [fallbackPath],
    sourceAssignmentValue: null,
    isAdditive: false
  };
}
function isDraggedFilePayload(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return typeof candidate.filePath === "string" && Array.isArray(candidate.filePaths) && candidate.filePaths.every((filePath) => typeof filePath === "string") && (typeof candidate.sourceAssignmentValue === "string" || candidate.sourceAssignmentValue === null) && typeof candidate.isAdditive === "boolean";
}

// main.ts
var OPEN_EXPLORER_COMMAND_ID = "open-virtual-file-explorer";
var OPEN_EXPLORER_COMMAND_NAME = "Open virtual file explorer";
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
    this.addRibbonIcon("folder-tree", OPEN_EXPLORER_COMMAND_NAME, async () => {
      await this.activateView();
    });
    this.addCommand({
      id: OPEN_EXPLORER_COMMAND_ID,
      name: OPEN_EXPLORER_COMMAND_NAME,
      callback: async () => {
        await this.activateView();
      }
    });
    this.addSettingTab(new VirtualTreeSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      void this.migrateLegacyFolderSections();
    });
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
  async migrateLegacyFolderSections() {
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
        this.settings.folderSections.map((section) => section.title)
      ),
      folderSections: []
    });
  }
  resolveCategoryFileFromAssignment(assignmentValue) {
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
    ...typeof candidate.categorySectionKey === "string" ? { categorySectionKey: candidate.categorySectionKey } : {},
    ...candidate.noteDisplayMode === "list" || candidate.noteDisplayMode === "cards" ? { noteDisplayMode: candidate.noteDisplayMode } : {},
    ...candidate.noteSortMode === "modified" || candidate.noteSortMode === "created" || candidate.noteSortMode === "title" || candidate.noteSortMode === "property" ? { noteSortMode: candidate.noteSortMode } : {},
    ...candidate.noteSortDirection === "asc" || candidate.noteSortDirection === "desc" ? { noteSortDirection: candidate.noteSortDirection } : {},
    ...typeof candidate.noteSortProperty === "string" ? { noteSortProperty: candidate.noteSortProperty } : {},
    ...typeof candidate.showRealFilename === "boolean" ? { showRealFilename: candidate.showRealFilename } : {},
    ...typeof candidate.showPath === "boolean" ? { showPath: candidate.showPath } : {},
    ...typeof candidate.zebraRows === "boolean" ? { zebraRows: candidate.zebraRows } : {},
    ...Array.isArray(candidate.sectionOrder) ? { sectionOrder: candidate.sectionOrder.filter((value2) => typeof value2 === "string") } : {},
    ...Array.isArray(candidate.folderOrder) ? { folderOrder: candidate.folderOrder.filter((value2) => typeof value2 === "string") } : {},
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
  return currentSettings.frontmatterKey !== nextSettings.frontmatterKey || currentSettings.treatSlashesAsHierarchy !== nextSettings.treatSlashesAsHierarchy || currentSettings.showUncategorized !== nextSettings.showUncategorized || currentSettings.showUncategorizedFolder !== nextSettings.showUncategorizedFolder || currentSettings.showUnassignedCategoryNotes !== nextSettings.showUnassignedCategoryNotes || currentSettings.categoryNoteFilenamePrefix !== nextSettings.categoryNoteFilenamePrefix || currentSettings.categorySectionKey !== nextSettings.categorySectionKey;
}
function mergeSectionOrder(existingOrder, nextValues) {
  const mergedOrder = [];
  const seenLabels = /* @__PURE__ */ new Set();
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
