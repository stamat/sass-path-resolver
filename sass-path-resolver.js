import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const STYLE_EXTENSIONS = ['sass', 'scss', 'css']

/**
 * Checks if a file exists at the given path.
 * @param {...string} pathSegments The segments of the path to check.
 * @returns {boolean} True if the file exists, false otherwise.
 */
export function pathExists() {
  return fs.existsSync(path.join(...arguments))
}

/**
 * Checks if the given path is a directory.
 * @param {...string} pathSegments The segments of the path to check.
 * @returns {boolean} True if the path exists and is a directory, false otherwise.
 */
export function pathIsDirectory() {
  // statSync over lstatSync: pnpm installs packages as symlinks to its store
  return fs.statSync(path.join(...arguments)).isDirectory()
}

/**
 * Checks if a file exists with the given path, trying different extensions and underscored versions.
 * @param {string} filePath The base file path to check, e.g. `src/styles/main`.
 * @param {string[]} extensions An array of extensions to try, e.g. `['sass', 'scss', 'css']`.
 * @returns {string|null} The full path to the existing file if found, or null if not found.
 */
export function tryToFindFile(filePath, extensions) {
  const pathParts = path.parse(filePath)
  if (pathParts.ext && pathParts.ext.length > 0 && extensions.includes(pathParts.ext.slice(1))) {
    if (fs.existsSync(filePath)) return filePath
    // explicit-extension imports still resolve partials: `foo.scss` -> `_foo.scss`
    if (!pathParts.name.startsWith('_')) {
      const underscoredPath = path.join(pathParts.dir, `_${pathParts.base}`)
      if (fs.existsSync(underscoredPath)) return underscoredPath
    }
  }

  let fileExt = extensions.find(ext => fs.existsSync(`${filePath}.${ext}`))
  if (fileExt) return `${filePath}.${fileExt}`

  if (!pathParts.name.startsWith('_')) {
    // path.join over path.format so the result uses native separators
    // throughout, instead of mixing them with the input's on Windows
    const underscoredFilePath = path.join(pathParts.dir, `_${pathParts.base}`)
    fileExt = extensions.find(ext => fs.existsSync(`${underscoredFilePath}.${ext}`))
    if (fileExt) return `${underscoredFilePath}.${fileExt}`
  }

  return null
}

/**
 * Extracts the main style path from a package.json file, checking common fields like `sass`, `scss`, `style`, `css`, and `main`.
 * @param {string} packageJsonPath The path to the package directory containing the package.json file.
 * @returns {string|null} The main style path if found, or null if not found or if package.json doesn't exist.
 */
export function extractMainPathFromPackageJson(packageJsonPath) {
  if (!pathExists(packageJsonPath, 'package.json')) return null

  const pkg = JSON.parse(fs.readFileSync(path.join(packageJsonPath, 'package.json'), 'utf-8'))

  const mainPath = pkg.sass || pkg.scss || pkg.style || pkg.css || pkg.main
  if (!mainPath) return null

  return mainPath
}

/** Extracts the package name from a given import URL, handling both regular and scoped packages.
 * @param {string} url The import URL, e.g. `my-pkg/src/styles` or `@scoped/my-pkg/index`.
 * @returns {string|null} The package name if it can be extracted, or null if not.
 */
export function getPackagePath(url) {
  // Sass import URLs always use forward slashes, never path.sep
  const chunks = url.split('/').filter(Boolean)
  if (chunks.length < 2) return null
  if (chunks[0].startsWith('@')) {
    return chunks.length > 2 ? `${chunks[0]}/${chunks[1]}` : null
  }
  return chunks[0]
}

/**
 * Resolves a Sass import URL to an actual file path, supporting include paths and package.json discovery.
 *
 * @param {string} url The import URL from the Sass file, e.g. `my-pkg/styles/main.scss` or `@scoped/my-pkg/index`.
 * @param {string} includePath The base path to resolve from, typically a directory like `node_modules`.
 * @returns {URL|null} A URL object pointing to the resolved file if found, or null if the file cannot be resolved.
 */
export function resolvePath(url, includePath) {
  // Work in native paths throughout; convert to file URLs only when
  // returning. Roundtripping through URL.pathname breaks on Windows
  // (`/D:/...` is not a valid fs path there).
  const basePath = path.resolve(includePath)
  if (!fs.existsSync(basePath)) return null
  const importPath = path.join(basePath, ...url.split('/'))

  // 1. Maybe it's a directory?
  if (pathExists(importPath) && pathIsDirectory(importPath)) {
    // Try to find an index file within the directory
    const correctIndexFile = tryToFindFile(path.join(importPath, 'index'), STYLE_EXTENSIONS)
    if (correctIndexFile) return pathToFileURL(correctIndexFile)

    // package.json discovery
    const style = extractMainPathFromPackageJson(importPath)

    if (style) {
      const stylePath = path.join(importPath, style)
      if (fs.existsSync(stylePath)) return pathToFileURL(stylePath)
    }
  }

  // 2. Maybe it's a file? Directories were handled above; returning one
  // here would make sass fail to load it instead of trying the next importer
  if (pathExists(importPath) && !pathIsDirectory(importPath)) return pathToFileURL(importPath)

  // 2.1 Try to find the correct file with different formats
  const correctFile = tryToFindFile(importPath, STYLE_EXTENSIONS)
  if (correctFile) return pathToFileURL(correctFile)

  // 2.2 Maybe it's a file within a package?
  const packagePath = getPackagePath(url)
  if (packagePath) {
    const packageFullPath = path.join(basePath, ...packagePath.split('/'))
    const stylePath = extractMainPathFromPackageJson(packageFullPath)

    if (stylePath) {
      const styleDir = path.dirname(stylePath)
      const styleFinalPath = path.join(packageFullPath, styleDir, ...url.slice(packagePath.length).split('/').filter(Boolean))

      const correctPackageFile = tryToFindFile(styleFinalPath, STYLE_EXTENSIONS)
      if (correctPackageFile) return pathToFileURL(correctPackageFile)
    }
  }

  return null
}

/**
 * Creates a custom resolver for dart-sass that supports include paths.
 * @param {string|string[]} includePaths - A string or array of strings representing
 * the include paths to search for Sass files. For example, `node_modules`.
 * @returns {Object} An object with a `findFileUrl` method that can be used as a custom importer in dart-sass.
 * @example
 * import { sassPathResolver } from 'sass-path-resolver'
 * import { compile } from 'sass'
 *
 * const resolver = sassPathResolver('node_modules')
 *
 * compile('src/styles/main.scss', {
 *  importers: [sassPathResolver(['node_modules'])]
 * })
 */
export function sassPathResolver(includePaths) {
  if (!includePaths) throw new Error('sassPathResolver requires at least one include path')
  if (typeof includePaths === 'string') {
    includePaths = [includePaths]
  }
  if (!Array.isArray(includePaths)) throw new Error('sassPathResolver expects a string or array of strings')

  return {
    findFileUrl(url) {
      for (const includePath of includePaths) {
        const result = resolvePath(url, includePath)
        if (result) return result
      }
      return null
    }
  }
}

export default sassPathResolver
