# sass-path-resolver

A custom [`FileImporter`](https://sass-lang.com/documentation/js-api/interfaces/fileimporter/) for Dart Sass that adds include path resolution, similar to the deprecated `includePaths` option.

## Why?

Dart Sass removed the `includePaths` option. This package provides a `FileImporter` that restores that behavior, allowing you to resolve `@use` and `@import` from directories like `node_modules`.

I needed this for my own bundler and static site generator [Poops](https://github.com/stamat/poops) in 2023. Since legacy API support [`includePaths`](https://sass-lang.com/documentation/js-api/interfaces/legacyfileoptions/#includePaths) didn't work for me at all and I wanted it to work like I was remembering it, I went ahead and wrote it. Might be completely useless by now...

Now that it's complete and supports paths like in good old days, because:

> It's dangerous to go alone! Take this.

P.S. I see now `pkg:` prefixed node imports exist since exactly a year ago... well, whatever... 🤣

## Install

```bash
npm install sass-path-resolver
```

## Usage

```js
import { compile } from "sass";
import { sassPathResolver } from "sass-path-resolver";

const result = compile("src/styles/main.scss", {
  importers: [sassPathResolver("node_modules")],
});
```

Multiple include paths:

```js
const result = compile("src/styles/main.scss", {
  importers: [sassPathResolver(["node_modules", "vendor/styles"])],
});
```

Works with `compileString` too:

```js
import { compileString } from "sass";
import { sassPathResolver } from "sass-path-resolver";

const result = compileString('@use "my-package";', {
  importers: [sassPathResolver("node_modules")],
});
```

## Resolution algorithm

Given `@use "my-pkg/core/config"` and an include path of `node_modules`, the resolver tries the following in order:

1. **Directory with index file** - `node_modules/my-pkg/core/config/index.{sass,scss,css}`
2. **Directory with `package.json`** - reads `sass`, `scss`, `style`, `css`, the `exports` map's root entry, or `main`
3. **Exact file** - `node_modules/my-pkg/core/config`
4. **File with extension** - `node_modules/my-pkg/core/config.{sass,scss,css}`
5. **Underscore partial** - `node_modules/my-pkg/core/_config.{sass,scss,css}`
6. **`exports` subpath** - resolves `./core/config` through the package's `exports` map (exact and `*` wildcard entries)
7. **Package-relative path** - resolves the path relative to the package entry point defined in `package.json`

The first match is returned as a `file:` URL. If nothing matches across all include paths, `null` is returned and Sass falls through to its default resolution.

## Example

Say you have a package `my-design-system` published to npm:

```
node_modules/
└── my-design-system/
    ├── package.json          { "sass": "src/index.scss" }
    └── src/
        ├── index.scss
        └── core/
            ├── _config.scss
            ├── index.scss
            └── utils/
                ├── _helpers.scss
                └── index.scss
```

With `sassPathResolver('node_modules')`, these all resolve:

```scss
// Package entry point (via sass field in package.json)
@use "my-design-system"; // → src/index.scss

// Directory with index file
@use "my-design-system/src/core"; // → src/core/index.scss
@use "my-design-system/src/core/utils"; // → src/core/utils/index.scss

// Direct file (with or without extension)
@use "my-design-system/src/index"; // → src/index.scss
@use "my-design-system/src/index.scss"; // → src/index.scss

// Underscore partials
@use "my-design-system/src/core/config"; // → src/core/_config.scss
@use "my-design-system/src/core/utils/helpers"; // → src/core/utils/_helpers.scss

// Package-relative paths (resolved relative to package.json entry)
@use "my-design-system/core/config"; // → src/core/_config.scss
@use "my-design-system/core/utils/helpers"; // → src/core/utils/_helpers.scss

// If your package is scoped, for instance, same rules apply
@use "@scope/my-design-system"; // → entry from package.json
@use "@scope/my-design-system/core/config"; // → resolved via package.json entry
```

The last two are the key feature — `core/config` doesn't exist at `node_modules/my-design-system/core/config`, but the resolver reads `package.json`, finds the entry point is in `src/`, and resolves relative to that.

## `package.json` fields

When resolving a package root (e.g. `@use "my-pkg"`), the resolver reads `package.json` and checks the following fields in order:

- `sass`
- `scss`
- `style`
- `css`
- `exports` (root entry)
- `main`

### `exports` map

The `exports` field is supported for both the package root and subpaths, including `*` wildcard patterns. Within a condition object, the resolver picks the first of `sass`, `scss`, `style`, `css`, `default` (nested condition objects are followed):

```jsonc
{
  "exports": {
    ".": { "sass": "./src/index.scss" },
    "./theme": { "sass": "./src/theme/dark.scss" },
    "./styles/*": { "sass": "./src/*" }
  }
}
```

```scss
@use "my-pkg";              // → src/index.scss
@use "my-pkg/theme";        // → src/theme/dark.scss
@use "my-pkg/styles/extra"; // → src/extra.scss
```

Non-style `exports` targets (e.g. a `default` condition pointing at a `.js` file) are rejected rather than handed to Sass.

## API

### `sassPathResolver(includePaths)`

Returns a Dart Sass [`FileImporter`](https://sass-lang.com/documentation/js-api/interfaces/fileimporter/) object.

- **`includePaths`** `string | string[]` - One or more directories to search for imports. Throws if not provided or not a string/array.

### `resolvePath(url, includePath)`

Lower-level function that resolves a single URL against a single include path. Returns a `URL` object or `null`.

## License

MIT
