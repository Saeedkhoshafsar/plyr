import fs from 'fs';
import path from 'path';
import { sanitizeModuleName } from '../validation';

export interface ModuleManifest {
  name: string;
  description: string;
  version: string;
  inputs: Record<string, {
    type: string;
    required?: boolean;
    default?: any;
    description?: string;
  }>;
}

export interface LoadedModule {
  type: 'modern' | 'legacy';
  run: (context: any, params: any) => Promise<any>;
  manifest: ModuleManifest | null;
}

export class ModuleLoader {
  private modulesDir: string;
  private cache = new Map<string, LoadedModule>();

  constructor(modulesDir?: string) {
    this.modulesDir = modulesDir || path.resolve(__dirname, '../../modules');
  }

  load(actionName: string): LoadedModule | null {
    try {
      const safeName = sanitizeModuleName(actionName);

      // Check cache in production
      if (process.env.NODE_ENV === 'production' && this.cache.has(safeName)) {
        return this.cache.get(safeName)!;
      }

      const folderPath = path.join(this.modulesDir, safeName);

      // Check if folder exists
      if (!fs.existsSync(folderPath)) {
        // Try legacy single-file format
        return this.loadLegacy(safeName);
      }

      // Security: Prevent path traversal
      const realPath = fs.realpathSync(folderPath).replace(/\\/g, '/');
      const realBase = fs.realpathSync(this.modulesDir).replace(/\\/g, '/');

      if (!realPath.startsWith(realBase)) {
        throw new Error(`Security Error: Path traversal attempt detected for module "${safeName}"`);
      }

      // Modern format: folder with manifest.json and run.js
      const manifestPath = path.join(folderPath, 'manifest.json');
      const runPath = path.join(folderPath, 'run.js');

      if (fs.existsSync(manifestPath) && fs.existsSync(runPath)) {
        // Clear cache in development
        if (process.env.NODE_ENV !== 'production') {
          delete require.cache[require.resolve(runPath)];
          delete require.cache[require.resolve(manifestPath)];
        }

        const result: LoadedModule = {
          type: 'modern',
          run: require(runPath).run,
          manifest: require(manifestPath) as ModuleManifest
        };

        this.cache.set(safeName, result);
        return result;
      }

      // Try run.js only (no manifest)
      if (fs.existsSync(runPath)) {
        if (process.env.NODE_ENV !== 'production') {
          delete require.cache[require.resolve(runPath)];
        }

        const result: LoadedModule = {
          type: 'modern',
          run: require(runPath).run,
          manifest: null
        };

        this.cache.set(safeName, result);
        return result;
      }

      return null;
    } catch (e) {
      console.error(`[ModuleLoader] Error loading module "${actionName}":`, e);
      return null;
    }
  }

  private loadLegacy(safeName: string): LoadedModule | null {
    const legacyPath = path.join(this.modulesDir, safeName + '.js');

    if (!fs.existsSync(legacyPath)) {
      return null;
    }

    // Security: Prevent path traversal
    const realLegacy = fs.realpathSync(legacyPath).replace(/\\/g, '/');
    const realBase = fs.realpathSync(this.modulesDir).replace(/\\/g, '/');

    if (!realLegacy.startsWith(realBase)) {
      return null;
    }

    // Clear cache in development
    if (process.env.NODE_ENV !== 'production') {
      delete require.cache[require.resolve(legacyPath)];
    }

    const result: LoadedModule = {
      type: 'legacy',
      run: require(legacyPath).run,
      manifest: null
    };

    this.cache.set(safeName, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  listModules(): string[] {
    try {
      const items = fs.readdirSync(this.modulesDir);
      const modules: string[] = [];

      for (const item of items) {
        const itemPath = path.join(this.modulesDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          // Modern format
          if (fs.existsSync(path.join(itemPath, 'run.js'))) {
            modules.push(item);
          }
        } else if (item.endsWith('.js')) {
          // Legacy format
          modules.push(item.replace('.js', ''));
        }
      }

      return modules;
    } catch {
      return [];
    }
  }
}