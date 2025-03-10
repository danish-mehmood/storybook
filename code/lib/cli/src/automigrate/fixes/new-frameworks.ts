import chalk from 'chalk';
import dedent from 'ts-dedent';
import semver from '@storybook/semver';
import { ConfigFile, readConfig, writeConfig } from '@storybook/csf-tools';
import { getStorybookInfo } from '@storybook/core-common';

import type { Fix } from '../types';
import type { PackageJsonWithDepsAndDevDeps } from '../../js-package-manager';
import { getStorybookVersionSpecifier } from '../../helpers';

const logger = console;

const packagesMap = {
  '@storybook/react': {
    webpack5: '@storybook/react-webpack5',
    vite: '@storybook/react-vite',
  },
  '@storybook/preact': {
    webpack5: '@storybook/preact-webpack5',
  },
  '@storybook/server': {
    webpack5: '@storybook/server-webpack5',
  },
  '@storybook/angular': {
    webpack5: '@storybook/angular',
  },
  '@storybook/vue': {
    webpack5: '@storybook/vue-webpack5',
    vite: '@storybook/vue-vite',
  },
  '@storybook/vue3': {
    webpack5: '@storybook/vue3-webpack5',
    vite: '@storybook/vue3-vite',
  },
  '@storybook/svelte': {
    webpack5: '@storybook/svelte-webpack5',
    vite: '@storybook/svelte-vite',
  },
  '@storybook/web-components': {
    webpack5: '@storybook/web-components-webpack5',
  },
  '@storybook/html': {
    webpack5: '@storybook/html-webpack5',
  },
};

interface NewFrameworkRunOptions {
  main: ConfigFile;
  packageJson: PackageJsonWithDepsAndDevDeps;
  dependenciesToAdd: string[];
  dependenciesToRemove: string[];
  frameworkPackage: keyof typeof packagesMap;
  frameworkOptions: Record<string, any>;
  builderInfo: {
    name: string;
    options: Record<string, any>;
  };
}

export const getBuilder = (builder: string | { name: string }) => {
  if (typeof builder === 'string') {
    return builder.includes('vite') ? 'vite' : 'webpack5';
  }

  return builder?.name.includes('vite') ? 'vite' : 'webpack5';
};

export const getFrameworkOptions = (framework: string, main: ConfigFile) => {
  const frameworkOptions = main.getFieldValue([`${framework}Options`]);
  return frameworkOptions || {};
};

/**
 * Does the user have separate framework and builders (e.g. @storybook/react + core.builder -> webpack5?
 *
 * If so:
 * - Remove the dependencies (@storybook/react + @storybook/builder-webpack5 + @storybook/manager-webpack5)
 * - Install the correct new package e.g. (@storybook/react-webpack5)
 * - Update the main config to use the new framework
 * -- moving core.builder into framework.options.builder
 * -- moving frameworkOptions (e.g. reactOptions) into framework.options
 */
export const newFrameworks: Fix<NewFrameworkRunOptions> = {
  id: 'newFrameworks',

  async check({ packageManager }) {
    const packageJson = packageManager.retrievePackageJson();
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    const config = getStorybookInfo(packageJson);
    const { mainConfig, version: storybookVersion, framework } = config;
    if (!mainConfig) {
      logger.warn('Unable to find storybook main.js config, skipping');
      return null;
    }

    const storybookCoerced = storybookVersion && semver.coerce(storybookVersion)?.version;
    if (!storybookCoerced) {
      logger.warn(dedent`
        ❌ Unable to determine storybook version, skipping ${chalk.cyan('newFrameworks')} fix.
        🤔 Are you running automigrate from your project directory?
      `);
      return null;
    }

    if (!semver.gte(storybookCoerced, '7.0.0')) {
      return null;
    }

    // If in the future the eslint plugin has a framework option, using main to extract the framework field will be very useful
    const main = await readConfig(mainConfig);

    const frameworkPackage = main.getFieldValue(['framework']) as keyof typeof packagesMap;
    const builder = main.getFieldValue(['core', 'builder']);

    if (!frameworkPackage) {
      return null;
    }

    const supportedPackages = Object.keys(packagesMap);
    if (!supportedPackages.includes(frameworkPackage)) {
      return null;
    }

    const builderInfo = {
      name: getBuilder(builder),
      options: main.getFieldValue(['core', 'builder', 'options']) || {},
    } as const;

    // TODO: once we have vite frameworks e.g. @storybook/react-vite, then we support it here
    // and remove ['storybook-builder-vite', '@storybook/builder-vite'] from deps
    if (builderInfo.name === 'vite') {
      return null;
    }

    const frameworkOptions = getFrameworkOptions(framework, main);

    const dependenciesToRemove = [
      '@storybook/builder-webpack5',
      '@storybook/manager-webpack5',
      '@storybook/builder-webpack4',
      '@storybook/manager-webpack4',
    ].filter((dep) => allDeps[dep]);

    const newFrameworkPackage = packagesMap[frameworkPackage][builderInfo.name];
    const dependenciesToAdd = [];

    // some frameworks didn't change e.g. Angular, Ember
    if (newFrameworkPackage !== frameworkPackage) {
      dependenciesToRemove.push(frameworkPackage);
      dependenciesToAdd.push(newFrameworkPackage);
    }

    return {
      main,
      dependenciesToAdd,
      dependenciesToRemove,
      frameworkPackage: newFrameworkPackage,
      frameworkOptions,
      builderInfo,
      packageJson,
    };
  },

  prompt() {
    return dedent`
      We've detected you are using an older format of Storybook frameworks and builders.

      In Storybook 7, frameworks also specify the builder to be used.

      We can remove the dependencies that are no longer needed and install the new framework that already includes the builder.

      To learn more about the framework field, see: ${chalk.yellow(
        'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#framework-field-mandatory'
      )}

      ${chalk.underline(chalk.bold(chalk.cyan('Webpack4 users')))}

      Unless you're using Storybook's Vite builder, this automigration will install a Webpack5-based framework.
      
      If you were using Storybook's Webpack4 builder (default in 6.x, discontinued in 7.0), this could be a breaking
      change--especially if your project has a custom webpack configuration.
      
      To learn more about migrating from Webpack4, see: ${chalk.yellow(
        'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#webpack4-support-discontinued'
      )}
    `;
  },

  async run({
    result: {
      dependenciesToAdd,
      dependenciesToRemove,
      main,
      frameworkPackage,
      frameworkOptions,
      builderInfo,
      packageJson,
    },
    packageManager,
    dryRun,
  }) {
    logger.info(`✅ Removing legacy dependencies: ${dependenciesToRemove.join(', ')}`);
    if (!dryRun) {
      packageManager.removeDependencies(
        { skipInstall: dependenciesToAdd.length > 0, packageJson },
        dependenciesToRemove
      );
    }
    if (dependenciesToAdd.length > 0) {
      logger.info(`✅ Installing new dependencies: ${dependenciesToAdd.join(', ')}`);
      if (!dryRun) {
        const versionToInstall = getStorybookVersionSpecifier(packageJson);
        const depsToAdd = dependenciesToAdd.map((dep) => `${dep}@${versionToInstall}`);
        packageManager.addDependencies({ installAsDevDependencies: true }, depsToAdd);
      }
    }

    if (!dryRun) {
      logger.info(`✅ Updating framework field in main.js`);
      const currentCore = main.getFieldValue(['core']);
      main.setFieldValue(['framework', 'name'], frameworkPackage);
      main.setFieldValue(['framework', 'options'], frameworkOptions);

      if (currentCore?.builder) {
        delete currentCore.builder;
      }

      if (Object.keys(builderInfo.options).length > 0) {
        main.setFieldValue(['framework', 'options', 'builder'], builderInfo.options);
      }

      if (currentCore) {
        if (Object.keys(currentCore).length === 0) {
          // TODO: this should delete the field instead
          main.setFieldValue(['core'], {});
        } else {
          main.setFieldValue(['core'], currentCore);
        }
      }

      await writeConfig(main);
    }
  },
};
