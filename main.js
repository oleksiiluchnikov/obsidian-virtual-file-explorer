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
  noteDisplayMode: "list",
  showPath: false,
  zebraRows: true
};

// src/virtual-tree/buildCategoryTree.ts
function buildCategoryTree(files, metadataCache, settings) {
  const sourceFiles = files.filter((file) => !isIgnoredVaultPath(file.path));
  const root = createNode(ROOT_FOLDER_ID, "All notes", 0);
  const folderLookup = /* @__PURE__ */ new Map([[ROOT_FOLDER_ID, root]]);
  const uncategorizedFiles = [];
  for (const file of sortFiles(sourceFiles)) {
    const categoryPaths = extractCategoryPaths(file, metadataCache, settings);
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
  const descendantFilesByFolderId = /* @__PURE__ */ new Map();
  descendantFilesByFolderId.set(ROOT_FOLDER_ID, sortFiles([...sourceFiles]));
  collectDescendantFiles(root, descendantFilesByFolderId);
  if (settings.showUncategorized && settings.showUncategorizedFolder && uncategorizedFiles.length > 0) {
    const uncategorizedNode = createNode(UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME, 1);
    uncategorizedNode.directFiles.push(...sortFiles(uncategorizedFiles));
    root.children.set(UNCATEGORIZED_FOLDER_NAME, uncategorizedNode);
    folderLookup.set(UNCATEGORIZED_FOLDER_ID, uncategorizedNode);
    descendantFilesByFolderId.set(UNCATEGORIZED_FOLDER_ID, sortFiles(uncategorizedFiles));
  }
  return {
    root,
    folderLookup,
    descendantFilesByFolderId,
    allFiles: sortFiles([...sourceFiles]),
    uncategorizedFiles: sortFiles(uncategorizedFiles)
  };
}
function collectDescendantFiles(node, descendantFilesByFolderId) {
  const collectedFiles = [...node.directFiles];
  for (const child of sortNodes([...node.children.values()])) {
    collectedFiles.push(...collectDescendantFiles(child, descendantFilesByFolderId));
  }
  const sortedFiles = sortFiles(collectedFiles);
  descendantFilesByFolderId.set(node.id, sortedFiles);
  return sortedFiles;
}
function extractCategoryPaths(file, metadataCache, settings) {
  const frontmatterValue = metadataCache.getFileCache(file)?.frontmatter?.[settings.frontmatterKey];
  const rawValues = normalizeRawCategoryValues(frontmatterValue);
  const parsedPaths = rawValues.map((rawValue) => parseCategoryPath(rawValue, settings.treatSlashesAsHierarchy, metadataCache)).filter((path) => path !== null);
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
function createNode(id, name, depth) {
  return {
    id,
    name,
    depth,
    children: /* @__PURE__ */ new Map(),
    directFiles: [],
    assignmentValue: null,
    icon: null
  };
}
function sortNodes(nodes) {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
}
function sortFiles(files) {
  return [...files].sort((left, right) => {
    const nameComparison = left.basename.localeCompare(right.basename);
    return nameComparison !== 0 ? nameComparison : left.path.localeCompare(right.path);
  });
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
var VirtualTreeView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.collapsedFolderIds = /* @__PURE__ */ new Set();
    this.selectedFolderId = ROOT_FOLDER_ID;
    this.refreshTimeoutId = null;
    this.cachedTree = null;
    this.isTreeDirty = true;
    this.plugin = plugin;
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestRefresh()));
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
      this.render();
    });
    this.render();
  }
  async onClose() {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
  }
  /**
   * Debounces rerenders when vault metadata changes rapidly.
   */
  requestRefresh() {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId);
    }
    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      this.isTreeDirty = true;
      this.render();
    }, 75);
  }
  render() {
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
      tree.descendantFilesByFolderId.get(selectedNode.id) ?? []
    );
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
  renderSidebar(containerEl, tree) {
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
        text: `${tree.uncategorizedFiles.length}`
      });
      const notesEl = sectionEl.createDiv({ cls: "virtual-tree-sidebar-uncategorized" });
      for (const file of tree.uncategorizedFiles) {
        this.renderSidebarUncategorizedFile(notesEl, file);
      }
    }
  }
  renderFolderNode(containerEl, node, descendantFilesByFolderId) {
    const groupEl = containerEl.createDiv({ cls: "virtual-tree-folder-group" });
    const rowEl = groupEl.createDiv({ cls: "virtual-tree-folder-row" });
    const hasChildren = node.children.size > 0;
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
  renderFolderRow(containerEl, node, files) {
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
      text: `${files.length}`
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
      if (!(abstractFile instanceof import_obsidian2.TFile)) {
        return;
      }
      void this.assignFileToCategory(abstractFile, node, payload.sourceAssignmentValue);
    });
  }
  renderContent(containerEl, selectedNode, files) {
    const headerEl = containerEl.createDiv({ cls: "virtual-tree-content-header" });
    headerEl.createEl("h3", { text: selectedNode.name });
    headerEl.createSpan({
      cls: "virtual-tree-content-count",
      text: `${files.length} ${files.length === 1 ? "note" : "notes"}`
    });
    const filesEl = containerEl.createDiv({
      cls: this.plugin.settings.noteDisplayMode === "cards" ? "virtual-tree-file-grid" : "virtual-tree-file-list"
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
  renderFileRow(containerEl, file, sourceAssignmentValue) {
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
  attachFileInteractions(rowEl, file) {
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
    this.requestRefresh();
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
function sortFolderNodes(nodes) {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
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
    this.settings = nextSettings;
    await this.saveData(nextSettings);
    this.refreshViews();
  }
  /**
   * Refreshes every currently open virtual tree view.
   */
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)) {
      const view = leaf.view;
      if (view instanceof VirtualTreeView) {
        view.requestRefresh();
      }
    }
  }
  async loadSettings() {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...isVirtualTreeSettings(loadedSettings) ? loadedSettings : {}
    };
  }
  async activateView() {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VIRTUAL_TREE)[0];
    const leaf = existingLeaf ?? this.app.workspace.getLeftLeaf(true);
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_VIRTUAL_TREE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
};
function isVirtualTreeSettings(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return true;
}
