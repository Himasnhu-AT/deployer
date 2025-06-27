import chalk from "chalk";
import { spawn } from "child_process";

/**
 * Builds a Docker image using the provided image tag.
 * @param dockerImage The tag/name for the Docker image.
 */
export async function buildDockerImage(dockerImage: string): Promise<void> {
  console.log(chalk.blue(`🔨 Building Docker image: ${dockerImage}`));

  return new Promise((resolve, reject) => {
    const buildProcess = spawn("docker", ["build", "-t", dockerImage, "."], {
      stdio: "inherit",
    });

    buildProcess.on("close", (code) => {
      if (code === 0) {
        console.log(
          chalk.green(`✓ Docker image built successfully: ${dockerImage}`)
        );
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });
  });
}
