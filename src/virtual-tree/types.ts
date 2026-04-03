import { TFile } from "obsidian";

/**
 * Supported note preview layouts.
 */
export type NoteDisplayMode = "list" | "cards";

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
  readonly noteDisplayMode: NoteDisplayMode;
  readonly showPath: boolean;
  readonly zebraRows: boolean;
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
  noteDisplayMode: "list",
  showPath: false,
  zebraRows: true,
  folderSections: [],
};
