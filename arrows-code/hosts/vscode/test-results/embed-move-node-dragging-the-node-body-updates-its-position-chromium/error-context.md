# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: embed.spec.ts >> move node: dragging the node body updates its position
- Location: tests/e2e/embed.spec.ts:45:5

# Error details

```
TimeoutError: page.waitForFunction: Timeout 5000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e7]:
      - button [ref=e9] [cursor=pointer]:
        - generic [ref=e10]: 
      - generic [ref=e11]:
        - button [disabled]:
          - generic: 
      - button [ref=e14] [cursor=pointer]:
        - generic [ref=e15]: 
      - button [ref=e17] [cursor=pointer]:
        - generic [ref=e18]: 
      - button [ref=e21] [cursor=pointer]:
        - generic [ref=e22]: 
    - contentinfo [ref=e24]:
      - paragraph [ref=e25]:
        - text: Arrows.app powered by
        - link "Neo4j Labs" [ref=e26] [cursor=pointer]:
          - /url: https://neo4j.com/labs/arrows
      - paragraph [ref=e27]: Help
      - paragraph [ref=e28]:
        - link "Privacy" [ref=e29] [cursor=pointer]:
          - /url: https://neo4j.com/legal-terms/privacy-notice/
      - paragraph [ref=e30]:
        - link "Terms" [ref=e31] [cursor=pointer]:
          - /url: https://neo4j.com/terms
      - paragraph [ref=e32]:
        - link "Feedback" [ref=e33] [cursor=pointer]:
          - /url: https://feedback.neo4j.com/arrows
      - paragraph [ref=e34]
      - paragraph [ref=e35]:
        - link "Neo4j logo" [ref=e36] [cursor=pointer]:
          - /url: https://neo4j.com?ref=arrows.app
          - img "Neo4j logo" [ref=e37]
  - generic [ref=e38]:
    - button "Hide inspector" [ref=e39] [cursor=pointer]:
      - generic [ref=e40]: 
    - complementary [ref=e41]:
      - generic [ref=e43]:
        - generic [ref=e44]:
          - generic [ref=e45]: "Graph:"
          - generic [ref=e47] [cursor=pointer]:
            - generic [ref=e48]: 
            - text: "nodes:"
            - generic [ref=e49]: "1"
        - button "Add Node" [ref=e50] [cursor=pointer]:
          - generic [ref=e51]: 
          - text: Add Node
        - generic [ref=e52]: Style
        - generic [ref=e54]:
          - button "Theme" [ref=e55] [cursor=pointer]
          - button "Customize" [ref=e56] [cursor=pointer]
        - generic [ref=e57]:
          - img [ref=e59] [cursor=pointer]:
            - generic [ref=e60]:
              - generic [ref=e68]: KNOWS
              - generic [ref=e76]: a
              - generic [ref=e84]: b
          - generic [ref=e85]: Chunky
        - generic [ref=e86]:
          - img [ref=e88] [cursor=pointer]:
            - generic [ref=e89]:
              - generic [ref=e97]: CATEGORY
              - generic [ref=e102]:
                - generic [ref=e106]: Product
                - generic [ref=e109]:
                  - generic [ref=e110]: "SKU:"
                  - generic [ref=e111]: "750045"
                  - generic [ref=e112]: "unit:"
                  - generic [ref=e113]: "100"
              - generic [ref=e118]:
                - generic [ref=e122]: Category
                - generic [ref=e125]:
                  - generic [ref=e126]: "stock:"
                  - generic [ref=e127]: "true"
          - generic [ref=e128]: Dark Code
        - generic [ref=e129]:
          - img [ref=e131] [cursor=pointer]:
            - generic [ref=e132]:
              - generic [ref=e140]: ACTED IN
              - generic [ref=e148]: Liv Tyler
              - generic [ref=e155]:
                - generic [ref=e156]: That thing
                - generic [ref=e157]: you do
          - generic [ref=e158]: Bloom
        - generic [ref=e159]:
          - img [ref=e161] [cursor=pointer]:
            - generic [ref=e162]:
              - generic [ref=e170]: ACTED_IN
              - generic [ref=e177]:
                - generic [ref=e178]: Tom
                - generic [ref=e179]: Hanks
              - generic [ref=e183]:
                - generic [ref=e186]:
                  - generic [ref=e187]: The
                  - generic [ref=e188]: Da Vinci
                  - generic [ref=e189]: Code
                - generic [ref=e190]:
                  - generic [ref=e194]: Movie
                  - generic [ref=e198]:
                    - generic [ref=e199]: "released:"
                    - generic [ref=e200]: "2006"
                    - generic [ref=e201]: "tagline:"
                    - generic [ref=e202]: Break The Codes
                    - generic [ref=e203]: "title:"
                    - generic [ref=e204]: The Da Vinci Code
          - generic [ref=e205]: Browser
        - generic [ref=e206]:
          - img [ref=e208] [cursor=pointer]
          - generic [ref=e252]: Iconic
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | 
  3  | declare global {
  4  |   interface Window {
  5  |     __captured: unknown[];
  6  |   }
  7  | }
  8  | 
  9  | async function loadEmbed(page: Page): Promise<void> {
  10 |   await page.addInitScript(() => {
  11 |     window.__captured = [];
  12 |     const real = window.parent.postMessage.bind(window.parent);
  13 |     window.parent.postMessage = ((msg: unknown, target?: string) => {
  14 |       window.__captured.push(msg);
  15 |       try { real(msg, target ?? '*'); } catch { /* same-origin self-post; ignore */ }
  16 |     }) as typeof window.parent.postMessage;
  17 |   });
  18 |   await page.goto('/embed.html', { waitUntil: 'networkidle' });
  19 |   await page.waitForSelector('canvas');
  20 |   await page.waitForFunction(() => {
  21 |     const c = document.querySelector('canvas') as HTMLCanvasElement | null;
  22 |     return !!c && c.getBoundingClientRect().width > 100;
  23 |   }, undefined, { timeout: 15000 });
  24 | }
  25 | 
  26 | async function sendLoad(page: Page, graph: unknown, docVersion = 1): Promise<void> {
  27 |   await page.evaluate(
  28 |     ({ g, v }) => window.postMessage({ type: 'load', graph: g, docVersion: v }, '*'),
  29 |     { g: graph, v: docVersion },
  30 |   );
  31 | }
  32 | 
  33 | async function waitForGraphChange(page: Page, minCount = 1): Promise<{ graph: { nodes: { position: { x: number; y: number } }[] } }> {
> 34 |   await page.waitForFunction(
     |              ^ TimeoutError: page.waitForFunction: Timeout 5000ms exceeded.
  35 |     (n) => window.__captured.filter((m) => (m as { type?: string }).type === 'graph-changed').length >= n,
  36 |     minCount,
  37 |     { timeout: 5000 },
  38 |   );
  39 |   const changes = await page.evaluate(() =>
  40 |     window.__captured.filter((m) => (m as { type?: string }).type === 'graph-changed')
  41 |   );
  42 |   return changes[changes.length - 1] as { graph: { nodes: { position: { x: number; y: number } }[] } };
  43 | }
  44 | 
  45 | test('move node: dragging the node body updates its position', async ({ page }) => {
  46 |   await loadEmbed(page);
  47 |   await sendLoad(page, {
  48 |     style: { 'node-color': '#ffe081', 'font-family': 'sans-serif' },
  49 |     nodes: [{ id: 'n0', position: { x: 0, y: 0 }, caption: 'X', labels: [], properties: {}, style: {} }],
  50 |     relationships: [],
  51 |   });
  52 |   await waitForGraphChange(page, 1);
  53 | 
  54 |   const target = await page.evaluate(() => {
  55 |     const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  56 |     const r = canvas.getBoundingClientRect();
  57 |     return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  58 |   });
  59 | 
  60 |   await page.mouse.move(target.cx, target.cy);
  61 |   await page.mouse.down();
  62 |   await page.mouse.move(target.cx + 80, target.cy + 40, { steps: 10 });
  63 |   await page.mouse.up();
  64 | 
  65 |   const change = await waitForGraphChange(page, 2);
  66 |   const pos = change.graph.nodes[0].position;
  67 |   expect(pos.x !== 0 || pos.y !== 0).toBe(true);
  68 | });
  69 | 
```