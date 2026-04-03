import { TFile } from "obsidian";

/**
 * Supported note preview layouts.
 */
export type NoteDisplayMode = "list" | "cards";

/**
 * Supported note sort modes for the content pane.
 */
export type NoteSortMode = "modified" | "created" | "title" | "property";

/**
 * Supported note sort directions for the content pane.
 */
export type NoteSortDirection = "asc" | "desc";

/**
 * A UI-only sidebar section that groups top-level folders.
 */
export interface FolderSection {
  readonly id: string;
  readonly title: string;
  readonly folderIds: readonly string[];
}

/**
 * Settings that control the virtual folder explorer.
 */
export interface VirtualTreeSettings {
  readonly frontmatterKey: string;
  readonly treatSlashesAsHierarchy: boolean;
  readonly showUncategorized: boolean;
  readonly showUncategorizedFolder: boolean;
  /** When enabled, notes whose filename starts with the category note prefix create folders even if no note lists them yet. */
  readonly showUnassignedCategoryNotes: boolean;
  /** Basename prefix for category definition notes (e.g. `category - `). */
  readonly categoryNoteFilenamePrefix: string;
  /** Frontmatter key on category notes used to group top-level folders into sections. */
  readonly categorySectionKey: string;
  readonly noteDisplayMode: NoteDisplayMode;
  readonly noteSortMode: NoteSortMode;
  readonly noteSortDirection: NoteSortDirection;
  readonly noteSortProperty: string;
  /** When disabled, note titles can hide the active category prefix in the content pane. */
  readonly showRealFilename: boolean;
  readonly showPath: boolean;
  readonly zebraRows: boolean;
  /** Manual UI order for section labels discovered from category note frontmatter. */
  readonly sectionOrder: readonly string[];
  /** Manual UI order for top-level category folders. */
  readonly folderOrder: readonly string[];
  /** Deprecated UI-only grouping model kept only for one-way migration into category note frontmatter. */
  readonly folderSections: readonly FolderSection[];
}

/**
 * A parsed category path from frontmatter.
 */
export interface CategoryPath {
  readonly id: string;
  readonly segments: readonly string[];
  readonly assignmentValue: string | null;
  readonly icon: string | null;
  readonly section: string | null;
}

/**
 * A virtual folder node derived from frontmatter values.
 */
export interface CategoryFolderNode {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly children: Map<string, CategoryFolderNode>;
  sortedChildren: readonly CategoryFolderNode[];
  readonly directFiles: TFile[];
  assignmentValue: string | null;
  icon: string | null;
  section: string | null;
}

/**
 * Tree data consumed by the custom view.
 */
export interface CategoryTree {
  readonly root: CategoryFolderNode;
  readonly folderLookup: ReadonlyMap<string, CategoryFolderNode>;
  readonly descendantFilesByFolderId: ReadonlyMap<string, readonly TFile[]>;
  readonly allFiles: readonly TFile[];
  readonly uncategorizedFiles: readonly TFile[];
}

/**
 * Stable folder ID used for the synthetic root.
 */
export const ROOT_FOLDER_ID = "__root__";

/**
 * Stable folder ID used for uncategorized notes.
 */
export const UNCATEGORIZED_FOLDER_ID = "__uncategorized__";

/**
 * Stable folder name used for uncategorized notes.
 */
export const UNCATEGORIZED_FOLDER_NAME = "Uncategorized";

/**
 * Default plugin settings.
 */
export const DEFAULT_SETTINGS: VirtualTreeSettings = {
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
  folderSections: [],
};
