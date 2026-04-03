import { App, PluginSettingTab, Setting } from "obsidian";

import VirtualTreePlugin from "../../main";
import { VirtualTreeSettings } from "./types";

/**
 * Plugin settings UI.
 */
export class VirtualTreeSettingTab extends PluginSettingTab {
  private readonly plugin: VirtualTreePlugin;

  public constructor(app: App, plugin: VirtualTreePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Frontmatter key")
      .setDesc("Use this frontmatter key to build virtual folders.")
      .addText((text) => {
        text
          .setPlaceholder("categories")
          .setValue(this.plugin.settings.frontmatterKey)
          .onChange(async (value) => {
            const nextSettings: VirtualTreeSettings = {
              ...this.plugin.settings,
              frontmatterKey: value.trim() || "categories",
            };
            await this.plugin.savePluginSettings(nextSettings);
          });
      });

    new Setting(containerEl)
      .setName("Treat slashes as hierarchy")
      .setDesc("Interpret values like Projects/Client A as nested folders.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.treatSlashesAsHierarchy)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              treatSlashesAsHierarchy: value,
            });
          });
      });

    new Setting(containerEl)
      .setName("Show uncategorized notes")
      .setDesc("Show notes without the configured frontmatter key in the sidebar and explorer.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showUncategorized)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              showUncategorized: value,
            });
          });
      });

    new Setting(containerEl)
      .setName("Show uncategorized folder")
      .setDesc("Also expose uncategorized notes as a selectable folder row.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showUncategorizedFolder)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              showUncategorizedFolder: value,
            });
          });
      });

    new Setting(containerEl)
      .setName("Note display mode")
      .setDesc("Choose how notes are rendered in the content pane.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("list", "List")
          .addOption("cards", "Cards")
          .setValue(this.plugin.settings.noteDisplayMode)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              noteDisplayMode: value === "cards" ? "cards" : "list",
            });
          });
      });

    new Setting(containerEl)
      .setName("Show path")
      .setDesc("Show the full note path as secondary text in the content pane.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showPath)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              showPath: value,
            });
          });
      });

    new Setting(containerEl)
      .setName("Zebra rows")
      .setDesc("Add a subtle alternating background to note rows in list mode.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.zebraRows)
          .onChange(async (value) => {
            await this.plugin.savePluginSettings({
              ...this.plugin.settings,
              zebraRows: value,
            });
          });
      });
  }
}
