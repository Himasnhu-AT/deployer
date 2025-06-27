import * as fs from "fs/promises";
import * as path from "path";
import chalk from "chalk";
import { DeploymentConfig } from "./types";

/**
 * Handles configuration directory and config file operations for deployments.
 */
export class ConfigManager {
  private configDir: string;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(process.cwd(), ".fargate-configs");
  }

  /**
   * Ensures the configuration directory exists.
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.access(this.configDir);
    } catch {
      await fs.mkdir(this.configDir, { recursive: true });
    }
  }

  /**
   * Saves a deployment configuration to a file.
   */
  async saveConfig(config: DeploymentConfig): Promise<void> {
    await this.ensureConfigDir();
    const configPath = path.join(this.configDir, `${config.projectName}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`✓ Configuration saved to ${configPath}`));
  }

  /**
   * Loads a deployment configuration by project name.
   */
  async loadConfig(projectName: string): Promise<DeploymentConfig | null> {
    try {
      const configPath = path.join(this.configDir, `${projectName}.json`);
      const configData = await fs.readFile(configPath, "utf-8");
      return JSON.parse(configData);
    } catch {
      return null;
    }
  }

  /**
   * Lists all saved deployment configuration project names.
   */
  async listSavedConfigs(): Promise<string[]> {
    try {
      await this.ensureConfigDir();
      const files = await fs.readdir(this.configDir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
    } catch {
      return [];
    }
  }
}
