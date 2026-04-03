import { MetadataCache, TFile } from "obsidian";

import {
  CategoryFolderNode,
  CategoryPath,
  CategoryTree,
  ROOT_FOLDER_ID,
  UNCATEGORIZED_FOLDER_ID,
  UNCATEGORIZED_FOLDER_NAME,
  VirtualTreeSettings,
} from "./types";

/**
 * Builds the virtual folder tree from markdown note frontmatter.
 */
export function buildCategoryTree(
  files: readonly TFile[],
  metadataCache: MetadataCache,
  settings: VirtualTreeSettings,
): CategoryTree {
  const sourceFiles = files.filter((file) => !isIgnoredVaultPath(file.path));
  const root = createNode(ROOT_FOLDER_ID, "All notes", 0);
  const folderLookup = new Map<string, CategoryFolderNode>([[ROOT_FOLDER_ID, root]]);
  const uncategorizedFiles: TFile[] = [];

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
            existingChild.assignmentValue ??= categoryPath.assignmentValue;
            existingChild.icon ??= categoryPath.icon;
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

  const descendantFilesByFolderId = new Map<string, readonly TFile[]>();
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
    uncategorizedFiles: sortFiles(uncategorizedFiles),
  };
}

function collectDescendantFiles(
  node: CategoryFolderNode,
  descendantFilesByFolderId: Map<string, readonly TFile[]>,
): readonly TFile[] {
  const collectedFiles = [...node.directFiles];

  for (const child of sortNodes([...node.children.values()])) {
    collectedFiles.push(...collectDescendantFiles(child, descendantFilesByFolderId));
  }

  const sortedFiles = sortFiles(collectedFiles);
  descendantFilesByFolderId.set(node.id, sortedFiles);

  return sortedFiles;
}

function extractCategoryPaths(
  file: TFile,
  metadataCache: MetadataCache,
  settings: VirtualTreeSettings,
): readonly CategoryPath[] {
  const frontmatterValue = metadataCache.getFileCache(file)?.frontmatter?.[settings.frontmatterKey] as unknown;
  const rawValues = normalizeRawCategoryValues(frontmatterValue);
  const parsedPaths = rawValues
    .map((rawValue) => parseCategoryPath(rawValue, settings.treatSlashesAsHierarchy, metadataCache))
    .filter((path): path is CategoryPath => path !== null);

  return parsedPaths.length > 0 ? deduplicatePaths(parsedPaths) : [];
}

function normalizeRawCategoryValues(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseCategoryPath(
  rawValue: string,
  treatSlashesAsHierarchy: boolean,
  metadataCache: MetadataCache,
): CategoryPath | null {
  const categoryDetails = resolveCategoryDetails(rawValue, metadataCache);
  const segments = (treatSlashesAsHierarchy ? rawValue.split("/") : [rawValue])
    .map((segment) => normalizeCategorySegment(segment, metadataCache))
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  return {
    id: segments.join("/"),
    segments,
    assignmentValue: categoryDetails.assignmentValue,
    icon: categoryDetails.icon,
  };
}

function resolveCategoryDetails(
  rawValue: string,
  metadataCache: MetadataCache,
): Pick<CategoryPath, "assignmentValue" | "icon"> {
  const trimmedValue = rawValue.trim();
  const wikilinkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/u);

  if (!wikilinkMatch) {
    return {
      assignmentValue: trimmedValue.length > 0 ? trimmedValue : null,
      icon: null,
    };
  }

  const targetPart = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
  const destination = targetPart.length > 0 ? metadataCache.getFirstLinkpathDest(targetPart, "") : null;
  const destinationPath = destination?.path;
  const frontmatterIcon = destinationPath
    ? metadataCache.getFileCache(destination)?.frontmatter?.icon
    : null;

  return {
    assignmentValue: destination ? `[[${destination.basename}]]` : trimmedValue,
    icon: typeof frontmatterIcon === "string" && frontmatterIcon.trim().length > 0 ? frontmatterIcon.trim() : null,
  };
}

function normalizeCategorySegment(segment: string, metadataCache: MetadataCache): string {
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
  const frontmatterTitle = destination
    ? metadataCache.getFileCache(destination)?.frontmatter?.title
    : null;

  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return cleanupCategoryLabel(frontmatterTitle);
  }

  if (destination) {
    return cleanupCategoryLabel(destination.basename);
  }

  return cleanupCategoryLabel(cleanTarget);
}

function isIgnoredVaultPath(path: string): boolean {
  return path.startsWith(".obsidian/");
}

function cleanupCategoryLabel(label: string): string {
  return label.replace(/^category\s*-\s*/iu, "").trim();
}

function deduplicatePaths(paths: readonly CategoryPath[]): readonly CategoryPath[] {
  const byId = new Map<string, CategoryPath>();

  for (const path of paths) {
    byId.set(path.id, path);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function createNode(id: string, name: string, depth: number): CategoryFolderNode {
  return {
    id,
    name,
    depth,
    children: new Map<string, CategoryFolderNode>(),
    directFiles: [],
    assignmentValue: null,
    icon: null,
  };
}

function sortNodes(nodes: readonly CategoryFolderNode[]): CategoryFolderNode[] {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
}

function sortFiles(files: readonly TFile[]): TFile[] {
  return [...files].sort((left, right) => {
    const nameComparison = left.basename.localeCompare(right.basename);
    return nameComparison !== 0 ? nameComparison : left.path.localeCompare(right.path);
  });
}
