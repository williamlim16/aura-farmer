# Third-party notices

## Career Ops

Parts of this project are ported or adapted from Career Ops
(https://github.com/career-ops-hq/career-ops), used under the MIT License below.
"Career Ops" is a trademark of its owner; this project is not affiliated with or
endorsed by it, and does not use the name for product branding.

Ported (code copied and translated to TypeScript):
- `src/lib/apply/option-match.ts`: from `web/src/lib/apply/option-match.mjs`
- `src/lib/apply/ai-directed.ts`: patterns from `web/src/lib/apply/ai-directed-field.mjs`

Adapted (logic or methodology followed, code rewritten):
- `src/lib/apply/classify.ts`: sensitive-question patterns from `web/src/lib/apply/blank-unknown.mjs`
- `src/lib/apply/decision/llm.ts`: prompt-handling approach from `web/src/lib/apply/answer-prompt.mjs`
- `src/lib/match/match.ts`: evaluation method from `modes/oferta.md` (Block B) and `lib/score-action.mjs`
- `src/server/postings/providers.ts`: public endpoints as used in `providers/{greenhouse,lever,ashby}.mjs`
- `src/server/postings/safe-fetch.ts`: private-address ranges after `providers/_ip-guard.mjs`

```
MIT License

Copyright (c) 2026 Santiago Fernández de Valderrama

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
