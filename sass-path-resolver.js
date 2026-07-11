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
 * Reads and parses a package.json from the given package directory.
 * @param {string} packageDir The path to the package directory containing the package.json file.
 * @returns {Object|null} The parsed package.json, or null if missing or malformed.
 */
export function readPackageJson(packageDir) {
  if (!pathExists(packageDir, 'package.json')) return null

  try {
    return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'))
  } catch {
    // malformed package.json in one package shouldn't kill the whole compile
    return null
  }
}

const STYLE_CONDITIONS = ['sass', 'scss', 'style', 'css', 'default']

/**
 * Resolves an exports entry value to a path string, following style conditions
 * (`sass`, `scss`, `style`, `css`, `default`) through nested condition objects.
 * @param {string|Object} value An exports entry value.
 * @returns {string|null} The target path if one resolves, or null.
 */
function resolveExportValue(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const condition of STYLE_CONDITIONS) {
    if (condition in value) {
      const result = resolveExportValue(value[condition])
      if (result) return result
    }
  }
  return null
}

/**
 * Resolves a subpath through a package.json `exports` map, supporting root entries,
 * exact subpaths, single-`*` wildcard patterns, and style conditions.
 * @param {string|Object} exports The package.json `exports` field.
 * @param {string} subpath The subpath to resolve, e.g. `.` or `./scss/bootstrap`.
 * @returns {string|null} The target path relative to the package root, or null.
 */
export function extractPathFromExports(exports, subpath = '.') {
  if (!exports) return null
  if (typeof exports === 'string') return subpath === '.' ? exports : null
  if (typeof exports !== 'object' || Array.isArray(exports)) return null

  // a conditions-only object ({ "sass": ... }) describes the root subpath
  const keys = Object.keys(exports)
  if (!keys.some(key => key === '.' || key.startsWith('./'))) {
    return subpath === '.' ? resolveExportValue(exports) : null
  }

  if (exports[subpath] !== undefined) return resolveExportValue(exports[subpath])

  // wildcard patterns, e.g. "./scss/*": "./dist/scss/*"
  for (const key of keys) {
    const starIndex = key.indexOf('*')
    if (starIndex === -1) continue
    const prefix = key.slice(0, starIndex)
    const suffix = key.slice(starIndex + 1)
    if (subpath.length < prefix.length + suffix.length) continue
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    const target = resolveExportValue(exports[key])
    if (target) return target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length))
  }

  return null
}

/**
 * Extracts the main style path from a package.json file, checking common fields like `sass`, `scss`, `style`, `css`,
 * the `exports` map's root entry, and `main`.
 * @param {string} packageJsonPath The path to the package directory containing the package.json file.
 * @returns {string|null} The main style path if found, or null if not found or if package.json doesn't exist.
 */
export function extractMainPathFromPackageJson(packageJsonPath) {
  const pkg = readPackageJson(packageJsonPath)
  if (!pkg) return null

  // top-level style fields are explicit intent; exports beats the usually-js `main`
  const mainPath = pkg.sass || pkg.scss || pkg.style || pkg.css || extractPathFromExports(pkg.exports) || pkg.main
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
      // tryToFindFile over existsSync so a non-style `main` (index.js)
      // is rejected instead of handed to sass
      const stylePath = path.join(importPath, style)
      const correctStyleFile = tryToFindFile(stylePath, STYLE_EXTENSIONS)
      if (correctStyleFile) return pathToFileURL(correctStyleFile)
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

    // exports subpath mapping, e.g. "./scss/*": "./dist/scss/*"
    const pkg = readPackageJson(packageFullPath)
    if (pkg) {
      const exportsTarget = extractPathFromExports(pkg.exports, `.${url.slice(packagePath.length)}`)
      if (exportsTarget) {
        const exportsFile = tryToFindFile(path.join(packageFullPath, ...exportsTarget.split('/')), STYLE_EXTENSIONS)
        if (exportsFile) return pathToFileURL(exportsFile)
      }
    }

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
