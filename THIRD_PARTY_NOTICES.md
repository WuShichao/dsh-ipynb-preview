# Third-party notices

## KaTeX

This package vendors [KaTeX](https://katex.org) to render LaTeX without a network
request:

- `katex.min.js` (the engine) is embedded in `lib/client.js` as a string and
  executed inside the plugin factory.
- `katex.min.css` is embedded with each `woff2` web font inlined as a data URI.
  The `woff` and `ttf` fallbacks are dropped, because every engine able to run
  the DSH client supports `woff2`, and keeping them would roughly quadruple the
  payload.

Version: **0.18.9**. The version is pinned in `devDependencies`: a minor bump can
change both the generated stylesheet and the engine's output, and the vendored
bytes are part of what the test suite asserts. To upgrade, change the pin, run
`npm run build`, and confirm `npm test` still passes — then commit the new
`lib/client.js`.

License: MIT — https://github.com/KaTeX/KaTeX/blob/main/LICENSE

```
The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
